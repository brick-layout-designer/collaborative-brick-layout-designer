// Deleting a club, done properly (routes/clubDeletion.ts, privacy/clubDeletion.ts):
// the summary, the club's data download, moving things out first, the
// hidden waiting time with a notice to every member, restoring, and what
// happens to its public catalog items when it goes for good (fake time).

import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db, loginAs, resetDb, schema } from '../../test/helpers.js';
import { sqlite } from '../../db/index.js';
import { readZip } from '../../test/zip.js';
import { attachUser } from '../../auth/cookie.js';
import { passwordRoutes } from '../auth/password.js';
import { layoutRoutes } from '../layouts.js';
import { moduleRoutes } from '../modules.js';
import { orgRoutes } from '../orgs.js';
import { adminRoutes } from '../admin.js';
import { warningRoutes } from '../warnings.js';
import { privacyRoutes } from '../privacy.js';
import { clubDeletionRoutes } from '../clubDeletion.js';
import { invalidatePrivacyCache } from '../../privacy/settings.js';
import { settleExports } from '../../privacy/exports.js';
import { privacyTick } from '../../privacy/tick.js';

const DAY = 86_400_000;

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ bodyLimit: 20 * 1024 * 1024 });
  await app.register(cookie);
  app.addHook('preHandler', attachUser);
  await app.register(passwordRoutes);
  await app.register(layoutRoutes);
  await app.register(moduleRoutes);
  await app.register(orgRoutes);
  await app.register(adminRoutes);
  await app.register(warningRoutes);
  await app.register(privacyRoutes);
  await app.register(clubDeletionRoutes);
  return app;
}

type Who = { cookie: string; id: string };
const h = (w: Who) => ({ cookie: w.cookie });

describe('deleting a club', () => {
  let app: FastifyInstance;
  let ada: Who; // the club's admin
  let ben: Who; // a member
  let cy: Who; // not in it
  let root: Who; // a site admin
  let orgId: string;

  async function call(w: Who | null, method: string, url: string, payload?: object) {
    return app.inject({ method: method as 'GET', url, ...(w ? { headers: h(w) } : {}), ...(payload ? { payload } : {}) });
  }

  beforeEach(async () => {
    resetDb();
    sqlite.exec('DELETE FROM data_exports; DELETE FROM erasures; DELETE FROM catalog_collections; DELETE FROM catalog_items;');
    invalidatePrivacyCache();
    app = await buildApp();
    ada = await loginAs(app, 'ada@example.com');
    ben = await loginAs(app, 'ben@example.com');
    cy = await loginAs(app, 'cy@example.com');
    root = await loginAs(app, 'root@example.com');
    await db.update(schema.users).set({ isGlobalAdmin: true }).where(eq(schema.users.id, root.id));
    orgId = (await call(ada, 'POST', '/api/orgs', { name: 'Train Club' })).json().id;
    await db.update(schema.orgs).set({ listed: true }).where(eq(schema.orgs.id, orgId));
    await db.insert(schema.orgMembers).values({ orgId, userId: ben.id, role: 'member', joinedAt: new Date() });
  });
  afterEach(async () => {
    await settleExports();
    await app.close();
  });

  async function publicThings() {
    const now = new Date();
    const item = randomUUID();
    await db.insert(schema.catalogItems).values({ id: item, kind: 'module', sourceId: randomUUID(), ownerOrgId: orgId, title: 'Club crossing', status: 'public', publicVersion: 1, createdAt: now, updatedAt: now });
    const pub = randomUUID();
    await db.insert(schema.catalogCollections).values({ id: pub, title: 'Club picks', ownerUserId: ada.id, orgId, status: 'public', audience: 'everyone', createdAt: now, updatedAt: now });
    const priv = randomUUID();
    await db.insert(schema.catalogCollections).values({ id: priv, title: 'Members only', ownerUserId: ada.id, orgId, status: 'public', audience: 'private', createdAt: now, updatedAt: now });
    return { item, pub, priv };
  }

  it('says what deleting it would take with it; only its admins may ask', async () => {
    await call(ada, 'POST', '/api/layouts', { title: 'Show yard', orgSlug: 'train-club' });
    await publicThings();
    expect((await call(ben, 'GET', '/api/orgs/train-club/deletion')).statusCode).toBe(403);
    expect((await call(cy, 'GET', '/api/orgs/train-club/deletion')).statusCode).toBe(404);
    const s = (await call(ada, 'GET', '/api/orgs/train-club/deletion')).json();
    expect(s.layouts.map((l: { name: string }) => l.name)).toEqual(['Show yard']);
    expect(s.members).toHaveLength(2);
    expect(s.publicItems.map((i: { name: string }) => i.name)).toEqual(['Club crossing']);
    expect(s.publicCollections.map((c: { name: string }) => c.name)).toEqual(['Club picks']);
    expect(s.clubCollections.map((c: { name: string }) => c.name)).toEqual(['Members only']);
    expect(s.graceDays).toBe(14);
  });

  it('downloads the club’s data for its admins only', async () => {
    await call(ada, 'POST', '/api/layouts', { title: 'Show yard', orgSlug: 'train-club' });
    expect((await call(ben, 'POST', '/api/orgs/train-club/exports')).statusCode).toBe(403);
    expect((await call(cy, 'POST', '/api/orgs/train-club/exports')).statusCode).toBe(404);
    expect((await call(ada, 'POST', '/api/orgs/train-club/exports')).statusCode).toBe(202);
    await settleExports();
    const list = (await call(ada, 'GET', '/api/orgs/train-club/exports')).json();
    const url = list.exports[0].downloadUrl as string;
    const zip = readZip((await call(ada, 'GET', url)).rawPayload);
    expect(zip.get('README.txt')!.toString()).toContain("Your club's data");
    expect(JSON.parse(zip.get('data/members.json')!.toString()).rows).toHaveLength(2);
    expect([...zip.keys()]).toContain('layouts/Show yard.bld-layout');
    // Ben can't fetch Ada's copy.
    expect((await call(ben, 'GET', url)).statusCode).toBe(404);
    // Once a day.
    expect((await call(ada, 'POST', '/api/orgs/train-club/exports')).statusCode).toBe(429);
  });

  it('moves all its layouts or modules to a member or another club first', async () => {
    const yard = (await call(ada, 'POST', '/api/layouts', { title: 'Show yard', orgSlug: 'train-club' })).json().id as string;
    const shed = (await call(ada, 'POST', '/api/modules', { title: 'Shed', orgSlug: 'train-club' })).json().id as string;
    expect((await call(ben, 'POST', '/api/orgs/train-club/move-all', { kind: 'layouts', toUserId: ben.id })).statusCode).toBe(403);
    expect((await call(ada, 'POST', '/api/orgs/train-club/move-all', { kind: 'layouts', toUserId: cy.id })).statusCode).toBe(400);
    const moved = await call(ada, 'POST', '/api/orgs/train-club/move-all', { kind: 'layouts', toUserId: ben.id });
    expect(moved.json()).toMatchObject({ ok: true, moved: 1 });
    expect((await db.select().from(schema.layouts).where(eq(schema.layouts.id, yard)).get())!.ownerUserId).toBe(ben.id);
    // Another club Ada is in.
    const other = (await call(ada, 'POST', '/api/orgs', { name: 'Other Club' })).json().id as string;
    expect((await call(ada, 'POST', '/api/orgs/train-club/move-all', { kind: 'modules', toOrgSlug: 'other-club' })).json().moved).toBe(1);
    expect((await db.select().from(schema.modules).where(eq(schema.modules.id, shed)).get())!.ownerOrgId).toBe(other);
  });

  it('hides it at once, tells every member who and until when, and its admins can restore it', async () => {
    const yard = (await call(ada, 'POST', '/api/layouts', { title: 'Show yard', orgSlug: 'train-club' })).json().id as string;
    const token = (await call(ada, 'POST', `/api/layouts/${yard}/public-share`)).json().token as string;
    expect((await call(null, 'GET', `/api/public-layouts/${token}`)).statusCode).toBe(200);
    expect((await call(ada, 'DELETE', '/api/orgs/train-club', { confirm: 'Train Club', heirUserId: cy.id })).statusCode).toBe(400);
    const res = await call(ada, 'DELETE', '/api/orgs/train-club', { confirm: 'Train Club', catalog: 'hand', heirUserId: ben.id });
    expect(res.statusCode).toBe(200);
    expect(res.json().dueAt).toBeGreaterThan(Date.now() + 13.9 * DAY);

    // Hidden: not in anyone's clubs, its layouts and share link gone from view.
    expect((await call(ben, 'GET', '/api/orgs')).json().orgs).toEqual([]);
    expect((await call(ben, 'GET', '/api/orgs/train-club')).statusCode).toBe(404);
    expect((await call(ben, 'GET', `/api/layouts/${yard}`)).statusCode).toBe(404);
    // An old share link answers "no layout" (200, not a 404 a firewall would count).
    const shared = await call(null, 'GET', `/api/public-layouts/${token}`);
    expect(shared.statusCode).toBe(200);
    expect(shared.json()).toEqual({ layout: null });
    // Each member got a notice naming who, when it goes, and that it can be restored.
    const notes = await db.select().from(schema.warnings).where(eq(schema.warnings.subjectUserId, ben.id)).all();
    expect(notes).toHaveLength(1);
    expect(notes[0]!.reason).toContain('ada deleted the club Train Club');
    expect(notes[0]!.reason).toContain('gone for good on');
    expect(notes[0]!.reason).toContain('restore it');
    // Ada deleted it herself: no note telling her what she just did.
    expect(await db.select().from(schema.warnings).where(eq(schema.warnings.subjectUserId, ada.id)).all()).toHaveLength(0);

    // Being deleted: both see it; only Ada (an admin) can restore.
    const benList = (await call(ben, 'GET', '/api/orgs/deleting')).json().clubs;
    expect(benList).toEqual([expect.objectContaining({ name: 'Train Club', canRestore: false })]);
    expect((await call(ada, 'GET', '/api/orgs/deleting')).json().clubs[0].canRestore).toBe(true);
    expect((await call(cy, 'GET', '/api/orgs/deleting')).json().clubs).toEqual([]);
    expect((await call(ben, 'POST', '/api/orgs/train-club/restore')).statusCode).toBe(404);
    expect((await call(cy, 'POST', '/api/orgs/train-club/restore')).statusCode).toBe(404);

    // One click puts it back, as it was.
    expect((await call(ada, 'POST', '/api/orgs/train-club/restore')).json()).toMatchObject({ ok: true, members: 2 });
    const back = (await call(ben, 'GET', '/api/orgs')).json().orgs;
    expect(back).toEqual([expect.objectContaining({ slug: 'train-club', myRole: 'member' })]);
    expect((await call(ada, 'GET', '/api/orgs/train-club')).json()).toMatchObject({ myRole: 'admin', listed: true });
    expect((await call(ben, 'GET', `/api/layouts/${yard}`)).statusCode).toBe(200);
    const after = await db.select().from(schema.warnings).where(eq(schema.warnings.subjectUserId, ben.id)).all();
    expect(after.some((n) => n.reason.includes('restored the club Train Club'))).toBe(true);
    expect(await db.select().from(schema.warnings).where(eq(schema.warnings.subjectUserId, ada.id)).all()).toHaveLength(0);
    // And it won't be deleted when the time would have come.
    expect((await privacyTick(new Date(Date.now() + 20 * DAY))).clubsErased).toBe(0);
  });

  it('a site admin deletes with the same wait, and can restore it', async () => {
    expect((await call(ada, 'DELETE', `/api/admin/orgs/${orgId}`)).statusCode).toBe(403);
    expect((await call(root, 'DELETE', `/api/admin/orgs/${orgId}`)).statusCode).toBe(200);
    const notes = await db.select().from(schema.warnings).where(eq(schema.warnings.subjectUserId, ada.id)).all();
    expect(notes[0]!.reason).toContain('A site admin deleted the club');
    expect((await call(ada, 'POST', `/api/admin/orgs/${orgId}/restore`)).statusCode).toBe(403);
    expect((await call(root, 'POST', `/api/admin/orgs/${orgId}/restore`)).statusCode).toBe(200);
    expect((await call(ada, 'GET', '/api/orgs/train-club')).statusCode).toBe(200);
  });

  it('after the wait (fake time): handed-over public things stay up under the member; the rest goes', async () => {
    const yard = (await call(ada, 'POST', '/api/layouts', { title: 'Show yard', orgSlug: 'train-club' })).json().id as string;
    const mine = (await call(ben, 'POST', '/api/layouts', { title: 'Ben’s own' })).json().id as string;
    const { item, pub, priv } = await publicThings();
    await call(ada, 'DELETE', '/api/orgs/train-club', { confirm: 'Train Club', catalog: 'hand', heirUserId: ben.id });
    expect((await privacyTick(new Date(Date.now() + 13 * DAY))).clubsErased).toBe(0);
    expect((await privacyTick(new Date(Date.now() + 15 * DAY))).clubsErased).toBe(1);

    expect(await db.select().from(schema.orgs).where(eq(schema.orgs.id, orgId)).get()).toBeUndefined();
    expect(await db.select().from(schema.layouts).where(eq(schema.layouts.id, yard)).get()).toBeUndefined();
    // A member's own things stay.
    expect(await db.select().from(schema.layouts).where(eq(schema.layouts.id, mine)).get()).toBeDefined();
    // Public: now Ben's, still up.
    const i = await db.select().from(schema.catalogItems).where(eq(schema.catalogItems.id, item)).get();
    expect(i).toMatchObject({ ownerUserId: ben.id, ownerOrgId: null, status: 'public' });
    const c = await db.select().from(schema.catalogCollections).where(eq(schema.catalogCollections.id, pub)).get();
    expect(c).toMatchObject({ ownerUserId: ben.id, orgId: null });
    // Members-only collection went with the club.
    expect(await db.select().from(schema.catalogCollections).where(eq(schema.catalogCollections.id, priv)).get()).toBeUndefined();
    const er = await db.select().from(schema.erasures).all();
    expect(er[0]).toMatchObject({ kind: 'org' });
    expect(er[0]!.ref).toMatch(/^Deleted club #/);
    expect(JSON.parse(er[0]!.counts)).toMatchObject({ layouts: 1, members: 2, catalogHandedOver: 2 });
  });

  it('“take them down” removes the public items with the club', async () => {
    const { item, pub } = await publicThings();
    await call(ada, 'DELETE', '/api/orgs/train-club', { confirm: 'Train Club', catalog: 'takedown' });
    await privacyTick(new Date(Date.now() + 15 * DAY));
    expect(await db.select().from(schema.catalogItems).where(eq(schema.catalogItems.id, item)).get()).toBeUndefined();
    expect(await db.select().from(schema.catalogCollections).where(eq(schema.catalogCollections.id, pub)).get()).toBeUndefined();
  });

  it('“Erase now” skips the wait, behind the typed name, with the same choice', async () => {
    const { item } = await publicThings();
    expect((await call(ada, 'POST', `/api/admin/orgs/${orgId}/erase`, { confirm: 'Train Club' })).statusCode).toBe(403);
    expect((await call(root, 'POST', `/api/admin/orgs/${orgId}/erase`, { confirm: 'Train' })).statusCode).toBe(400);
    const res = await call(root, 'POST', `/api/admin/orgs/${orgId}/erase`, { confirm: 'train club', catalog: 'hand', heirUserId: ben.id });
    expect(res.statusCode).toBe(200);
    expect(await db.select().from(schema.orgs).where(eq(schema.orgs.id, orgId)).get()).toBeUndefined();
    expect((await db.select().from(schema.catalogItems).where(eq(schema.catalogItems.id, item)).get())!.ownerUserId).toBe(ben.id);
  });
});

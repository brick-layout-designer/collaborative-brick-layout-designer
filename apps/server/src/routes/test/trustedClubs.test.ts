// Trusted clubs: the club's own review replaces the site's for what's
// published under its name.

import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { db, resetDb, schema } from '../../test/helpers.js';
import { attachUser } from '../../auth/cookie.js';
import { passwordRoutes } from '../auth/password.js';
import { sessionRoutes } from '../auth/session.js';
import { orgRoutes } from '../orgs.js';
import { moduleRoutes } from '../modules.js';
import { catalogRoutes } from '../catalog.js';
import { collectionRoutes } from '../collections.js';
import { clubReviewRoutes } from '../clubReview.js';
import { getPlatformSettings, PLATFORM_SETTINGS_ID } from '../../auth/platformSettings.js';

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ bodyLimit: 10 * 1024 * 1024 });
  await app.register(cookie);
  await app.register(rateLimit, { global: false });
  app.addHook('preHandler', attachUser);
  await app.register(passwordRoutes);
  await app.register(sessionRoutes);
  await app.register(orgRoutes);
  await app.register(moduleRoutes);
  await app.register(catalogRoutes);
  await app.register(collectionRoutes);
  await app.register(clubReviewRoutes);
  return app;
}

async function login(app: FastifyInstance, email: string): Promise<string> {
  await app.inject({ method: 'POST', url: '/api/auth/password/register', payload: { email, password: 'correct horse battery', displayName: email.split('@')[0] } });
  const user = await db.select().from(schema.users).where(eq(schema.users.email, email)).get();
  const v = await db.select().from(schema.emailVerifications).where(eq(schema.emailVerifications.userId, user!.id)).get();
  const res = await app.inject({ method: 'POST', url: `/api/auth/password/verify-email/${v!.token}` });
  const c = res.headers['set-cookie'];
  return Array.isArray(c) ? c.join('; ') : (c ?? '');
}

async function settings(patch: Partial<typeof schema.platformSettings.$inferInsert>) {
  await getPlatformSettings();
  await db.update(schema.platformSettings).set(patch).where(eq(schema.platformSettings.id, PLATFORM_SETTINGS_ID));
}

const userId = async (email: string) => (await db.select().from(schema.users).where(eq(schema.users.email, email)).get())!.id;

type Queue = { queue: { itemId: string; versionId: string }[]; trustedQueue: { itemId: string; versionId: string; trustedClub: boolean }[] };

describe('trusted clubs', () => {
  let app: FastifyInstance;
  let ada: string; // ArkLUG admin
  let max: string; // ArkLUG manager
  let mel: string; // ArkLUG member
  let out: string; // not in the club
  let mod: string; // site moderator
  let orgId: string;

  const req = (method: 'GET' | 'POST' | 'PATCH', url: string, cookie?: string, payload?: unknown) =>
    app.inject({ method, url, headers: cookie ? { cookie } : {}, ...(payload !== undefined ? { payload: payload as Record<string, unknown> } : {}) });
  const clubModule = async (title: string) => ((await req('POST', '/api/modules', ada, { title, orgSlug: 'arklug' })).json() as { id: string }).id;
  const share = (cookie: string, sourceId: string) => req('POST', '/api/catalog/submissions', cookie, { kind: 'module', sourceId });
  const siteQueue = async () => (await req('GET', '/api/moderation/items', mod)).json() as Queue;
  const clubQueue = async (cookie = max) => req('GET', '/api/orgs/arklug/review', cookie);
  const trust = (trusted: boolean, cookie = mod) => req('POST', '/api/moderation/clubs/arklug/trust', cookie, { trusted });
  const item = async (id: string) => (await db.select().from(schema.catalogItems).where(eq(schema.catalogItems.id, id)).get())!;

  beforeEach(async () => {
    resetDb();
    app = await buildApp();
    ada = await login(app, 'ada@example.com');
    max = await login(app, 'max@example.com');
    mel = await login(app, 'mel@example.com');
    out = await login(app, 'out@example.com');
    mod = await login(app, 'mod@example.com');
    await db.update(schema.users).set({ isModerator: true }).where(eq(schema.users.id, await userId('mod@example.com')));
    await settings({ moduleCatalogEnabled: true, partsCatalogEnabled: true, catalogReview: 'moderators' });
    orgId = ((await req('POST', '/api/orgs', ada, { name: 'ArkLUG', slug: 'arklug' })).json() as { id: string }).id;
    const now = new Date();
    await db.insert(schema.orgMembers).values({ orgId, userId: await userId('max@example.com'), role: 'manager', joinedAt: now });
    await db.insert(schema.orgMembers).values({ orgId, userId: await userId('mel@example.com'), role: 'member', joinedAt: now });
  });
  afterEach(async () => {
    await app.close();
  });

  it('an untrusted club’s admin can’t bypass review, its members can’t share, and it has no queue', async () => {
    const m = await clubModule('Show corner');
    const r = await share(ada, m);
    expect(r.json()).toMatchObject({ status: 'in_review' });
    expect((await siteQueue()).queue.map((q) => q.itemId)).toEqual([(r.json() as { id: string }).id]);
    expect((await share(mel, await clubModule('Bench'))).statusCode).toBe(403);
    expect((await clubQueue()).json()).toMatchObject({ error: 'club_not_trusted' });
    expect((await clubQueue()).statusCode).toBe(403);
    // Its own review routes don't work either.
    const v = (await siteQueue()).queue[0]!.versionId;
    expect((await req('POST', `/api/orgs/arklug/review/versions/${v}/approve`, ada, {})).statusCode).toBe(403);
    expect((await item((r.json() as { id: string }).id)).status).toBe('in_review');
  });

  it('only site admins and moderators trust a club; it’s audited and shows on the club', async () => {
    expect((await trust(true, ada)).statusCode).toBe(403);
    expect((await trust(true, out)).statusCode).toBe(403);
    expect((await trust(true)).json()).toMatchObject({ ok: true, trusted: true });
    const orgs = ((await req('GET', '/api/orgs', mel)).json() as { orgs: { slug: string; trusted: boolean }[] }).orgs;
    expect(orgs).toEqual([expect.objectContaining({ slug: 'arklug', trusted: true })]);
    expect(((await req('GET', '/api/moderation/clubs', mod)).json() as { clubs: { slug: string }[] }).clubs.map((c) => c.slug)).toEqual(['arklug']);
    expect(((await req('GET', '/api/moderation/clubs?q=ark', mod)).json() as { clubs: unknown[] }).clubs).toHaveLength(1);
    expect((await req('GET', '/api/moderation/clubs', ada)).statusCode).toBe(403);
    await trust(false);
    const audit = await db.select().from(schema.auditEvents).where(eq(schema.auditEvents.resourceId, orgId)).all();
    expect(audit.map((a) => a.eventType).filter((e) => e.startsWith('club_'))).toEqual(['club_trust', 'club_untrust']);
  });

  it('trusted: managers publish at once; a member’s goes to the club’s queue, not the site’s', async () => {
    await trust(true);
    const byMax = (await share(max, await clubModule('Show corner'))).json() as { id: string; status: string };
    expect(byMax.status).toBe('public');
    const melShare = await share(mel, await clubModule('Bench'));
    expect(melShare.statusCode).toBe(201);
    const melItem = (melShare.json() as { id: string; status: string });
    expect(melItem.status).toBe('in_review');
    const site = await siteQueue();
    expect(site.queue).toEqual([]);
    expect(site.trustedQueue).toEqual([expect.objectContaining({ itemId: melItem.id, trustedClub: true })]);
    const club = (await clubQueue()).json() as { items: { itemId: string; versionId: string; submitter: string }[]; published: { id: string }[] };
    expect(club.items).toEqual([expect.objectContaining({ itemId: melItem.id, submitter: 'mel' })]);
    expect(club.published.map((p) => p.id)).toEqual([byMax.id]);
    // The public catalog says it's a trusted club's.
    const listed = ((await req('GET', '/api/catalog/items?kind=module', out)).json() as { items: { id: string; trustedClub: boolean }[] }).items;
    expect(listed).toEqual([expect.objectContaining({ id: byMax.id, trustedClub: true })]);
  });

  it('a member can’t work the club’s queue; outsiders don’t see it; the club only acts on its own', async () => {
    await trust(true);
    const melItem = (await share(mel, await clubModule('Bench'))).json() as { id: string };
    const v = ((await clubQueue()).json() as { items: { versionId: string }[] }).items[0]!.versionId;
    expect((await clubQueue(mel)).statusCode).toBe(403);
    expect((await clubQueue(out)).statusCode).toBe(404);
    for (const path of [`versions/${v}/approve`, `versions/${v}/decline`, `items/${melItem.id}/unpublish`]) {
      expect([path, (await req('POST', `/api/orgs/arklug/review/${path}`, mel, {})).statusCode]).toEqual([path, 403]);
      expect([path, (await req('POST', `/api/orgs/arklug/review/${path}`, out, {})).statusCode]).toEqual([path, 404]);
    }
    expect((await item(melItem.id)).status).toBe('in_review');
    // Another trusted club's admin can't approve ArkLUG's item through their own queue.
    const other = ((await req('POST', '/api/orgs', out, { name: 'Other', slug: 'other' })).json() as { id: string }).id;
    await req('POST', '/api/moderation/clubs/other/trust', mod, { trusted: true });
    expect((await req('POST', `/api/orgs/other/review/versions/${v}/approve`, out, {})).statusCode).toBe(404);
    expect((await req('POST', `/api/orgs/other/review/items/${melItem.id}/unpublish`, out, {})).statusCode).toBe(404);
    expect(other).toBeTruthy();
    expect((await item(melItem.id)).status).toBe('in_review');
  });

  it('the club approves, declines with a reason, and unpublishes; all audited', async () => {
    await trust(true);
    const a = (await share(mel, await clubModule('Bench'))).json() as { id: string };
    const b = (await share(mel, await clubModule('Lamp'))).json() as { id: string };
    const q = ((await clubQueue()).json() as { items: { itemId: string; versionId: string }[] }).items;
    const va = q.find((x) => x.itemId === a.id)!.versionId;
    const vb = q.find((x) => x.itemId === b.id)!.versionId;
    expect((await req('POST', `/api/orgs/arklug/review/versions/${va}/approve`, max, {})).statusCode).toBe(200);
    expect((await item(a.id)).status).toBe('public');
    expect((await req('POST', `/api/orgs/arklug/review/versions/${vb}/decline`, ada, { reason: 'Not ready' })).statusCode).toBe(200);
    expect(await item(b.id)).toMatchObject({ status: 'declined', reason: 'Not ready' });
    expect((await req('POST', `/api/orgs/arklug/review/items/${a.id}/unpublish`, max, { reason: 'Old' })).statusCode).toBe(200);
    expect(await item(a.id)).toMatchObject({ status: 'unpublished', reason: 'Old' });
    const audit = await db.select().from(schema.auditEvents).where(eq(schema.auditEvents.resourceKind, 'catalog_item')).all();
    expect(audit.filter((e) => JSON.stringify(e.payload).includes(orgId)).map((e) => e.eventType).sort()).toEqual(['catalog_approve', 'catalog_decline', 'catalog_unpublish']);
  });

  it('site moderators can still decline or unpublish a trusted club’s items', async () => {
    await trust(true);
    const a = (await share(mel, await clubModule('Bench'))).json() as { id: string };
    const v = (await siteQueue()).trustedQueue[0]!.versionId;
    expect((await req('POST', `/api/moderation/versions/${v}/decline`, mod, { reason: 'No' })).statusCode).toBe(200);
    expect((await item(a.id)).status).toBe('declined');
    const pub = (await share(max, await clubModule('Show corner'))).json() as { id: string };
    expect((await req('POST', `/api/moderation/items/${pub.id}/unpublish`, mod, { reason: 'Spam' })).statusCode).toBe(200);
    expect((await item(pub.id)).status).toBe('unpublished');
  });

  it('untrusting keeps what’s public, and moves the club’s queue back to the site’s', async () => {
    await trust(true);
    const pub = (await share(max, await clubModule('Show corner'))).json() as { id: string };
    const waiting = (await share(mel, await clubModule('Bench'))).json() as { id: string };
    await trust(false);
    expect((await item(pub.id)).status).toBe('public');
    const site = await siteQueue();
    expect(site.queue.map((q) => q.itemId)).toEqual([waiting.id]);
    expect(site.trustedQueue).toEqual([]);
    expect((await clubQueue()).statusCode).toBe(403);
    // New submissions go back to site review, even from the admin.
    expect((await share(ada, await clubModule('Gate'))).json()).toMatchObject({ status: 'in_review' });
    expect((await share(mel, await clubModule('Fence'))).statusCode).toBe(403);
  });

  it('a trusted club’s public collection: text published at once; untrusted: reviewed', async () => {
    await settings({ catalogReview: 'none' });
    const m = await clubModule('Show corner');
    const yardItem = ((await share(out, ((await req('POST', '/api/modules', out, { title: 'Yard' })).json() as { id: string }).id)).json() as { id: string }).id;
    await settings({ catalogReview: 'moderators' });
    await trust(true);
    const c = await req('POST', '/api/catalog/collections', max, {
      title: 'Show standards',
      clubSlug: 'arklug',
      audience: 'everyone',
      entries: [{ source: 'catalog', id: yardItem }, { source: 'library', kind: 'module', id: m }],
    });
    // Its text, and its own module, are published at once by the club's manager.
    expect(c.json()).toMatchObject({ status: 'public', submitted: [m] });
    const id = (c.json() as { id: string }).id;
    expect((await item(((await db.select().from(schema.catalogItems).where(eq(schema.catalogItems.sourceId, m)).get())!).id)).status).toBe('public');
    expect((await req('PATCH', `/api/catalog/collections/${id}`, max, { title: 'Show standards 2026' })).json()).toMatchObject({ status: 'public', pending: false });
    const listed = ((await req('GET', '/api/catalog/collections', out)).json() as { collections: { id: string; trustedClub: boolean; itemCount: number }[] }).collections;
    expect(listed).toEqual([expect.objectContaining({ id, trustedClub: true, itemCount: 2 })]);
    await trust(false);
    expect((await req('PATCH', `/api/catalog/collections/${id}`, max, { title: 'Again' })).json()).toMatchObject({ pending: true });
    const site = (await req('GET', '/api/moderation/collections', mod)).json() as { queue: { id: string }[]; trustedQueue: unknown[] };
    expect(site.queue.map((q) => q.id)).toEqual([id]);
  });

  it('a waiting collection text of a trusted club is in its queue, and the club decides it', async () => {
    const yardItem = await (async () => {
      await settings({ catalogReview: 'none' });
      const s = (await share(out, ((await req('POST', '/api/modules', out, { title: 'Yard' })).json() as { id: string }).id)).json() as { id: string };
      await settings({ catalogReview: 'moderators' });
      return s.id;
    })();
    // Submitted before the club was trusted: it waits.
    const id = ((await req('POST', '/api/catalog/collections', max, { title: 'Waiting', clubSlug: 'arklug', audience: 'everyone', entries: [{ source: 'catalog', id: yardItem }] })).json() as { id: string }).id;
    expect(((await req('GET', '/api/moderation/collections', mod)).json() as { queue: { id: string }[] }).queue.map((q) => q.id)).toEqual([id]);
    await trust(true);
    const site = (await req('GET', '/api/moderation/collections', mod)).json() as { queue: unknown[]; trustedQueue: { id: string }[] };
    expect(site.queue).toEqual([]);
    expect(site.trustedQueue.map((q) => q.id)).toEqual([id]);
    expect(((await clubQueue()).json() as { collections: { id: string }[] }).collections.map((q) => q.id)).toEqual([id]);
    expect((await req('POST', `/api/orgs/arklug/review/collections/${id}/approve`, mel, {})).statusCode).toBe(403);
    // Another trusted club's admin can't decide it through their own queue.
    await req('POST', '/api/orgs', out, { name: 'Other', slug: 'other' });
    await req('POST', '/api/moderation/clubs/other/trust', mod, { trusted: true });
    for (const act of ['approve', 'decline', 'unpublish']) {
      expect([act, (await req('POST', `/api/orgs/other/review/collections/${id}/${act}`, out, {})).statusCode]).toEqual([act, 404]);
    }
    expect((await db.select().from(schema.catalogCollections).where(eq(schema.catalogCollections.id, id)).get())!.status).toBe('in_review');
    expect((await req('POST', `/api/orgs/arklug/review/collections/${id}/approve`, max, {})).statusCode).toBe(200);
    const row = (await db.select().from(schema.catalogCollections).where(eq(schema.catalogCollections.id, id)).get())!;
    expect(row.status).toBe('public');
    expect((await req('POST', `/api/orgs/arklug/review/collections/${id}/unpublish`, ada, { reason: 'Old' })).statusCode).toBe(200);
    expect((await db.select().from(schema.catalogCollections).where(and(eq(schema.catalogCollections.id, id))).get())!.status).toBe('unpublished');
  });

  it('with site review off, nothing changes: shares publish at once', async () => {
    await settings({ catalogReview: 'none' });
    expect((await share(ada, await clubModule('A'))).json()).toMatchObject({ status: 'public' });
    await trust(true);
    expect((await share(mel, await clubModule('B'))).json()).toMatchObject({ status: 'public' });
  });
});

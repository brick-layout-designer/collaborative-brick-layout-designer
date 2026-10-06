// "Delete my account" (routes/privacy.ts, privacy/accountDeletion.ts):
// the summary, the typed confirmation, the guided steps (last club admin,
// last site admin), the waiting time (signed out, desktop refused, signing
// in cancels), and the erasure after it with fake time.

import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { eq } from 'drizzle-orm';
import { db, issueToken, loginAs, resetDb, schema } from '../../test/helpers.js';
import { sqlite } from '../../db/index.js';
import { attachUser } from '../../auth/cookie.js';
import { passwordRoutes } from '../auth/password.js';
import { deviceRoutes } from '../auth/device.js';
import { layoutRoutes } from '../layouts.js';
import { orgRoutes } from '../orgs.js';
import { adminRoutes } from '../admin.js';
import { auditRoutes } from '../audit.js';
import { collaboratorRoutes } from '../collaborators.js';
import { warningRoutes } from '../warnings.js';
import { privacyRoutes } from '../privacy.js';
import { invalidatePrivacyCache } from '../../privacy/settings.js';
import { privacyTick } from '../../privacy/tick.js';
import { settleExports } from '../../privacy/exports.js';

const DAY = 86_400_000;

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ bodyLimit: 20 * 1024 * 1024 });
  await app.register(cookie);
  app.addHook('preHandler', attachUser);
  await app.register(passwordRoutes);
  await app.register(deviceRoutes);
  await app.register(layoutRoutes);
  await app.register(orgRoutes);
  await app.register(adminRoutes);
  await app.register(auditRoutes);
  await app.register(collaboratorRoutes);
  await app.register(warningRoutes);
  await app.register(privacyRoutes);
  return app;
}

type Who = { cookie: string; id: string };
const h = (w: Who) => ({ cookie: w.cookie });

async function summary(app: FastifyInstance, w: Who) {
  const res = await app.inject({ method: 'GET', url: '/api/me/deletion', headers: h(w) });
  expect(res.statusCode).toBe(200);
  return res.json();
}

async function askToDelete(app: FastifyInstance, w: Who, confirm: string) {
  return app.inject({ method: 'POST', url: '/api/me/deletion', headers: h(w), payload: { confirm } });
}

describe('Delete my account', () => {
  let app: FastifyInstance;
  let ann: Who;
  let bob: Who;

  beforeEach(async () => {
    resetDb();
    sqlite.exec('DELETE FROM data_exports; DELETE FROM erasures;');
    invalidatePrivacyCache();
    app = await buildApp();
    ann = await loginAs(app, 'ann@example.com');
    bob = await loginAs(app, 'bob@example.com');
    // A site admin always exists (the last one can't go).
    const admin = await loginAs(app, 'root@example.com');
    await db.update(schema.users).set({ isGlobalAdmin: true }).where(eq(schema.users.id, admin.id));
  });
  afterEach(async () => {
    await settleExports();
    await app.close();
  });

  it('summarises what happens to each thing, in plain lists', async () => {
    await app.inject({ method: 'POST', url: '/api/layouts', headers: h(ann), payload: { title: 'Mine' } });
    await app.inject({ method: 'POST', url: '/api/orgs', headers: h(bob), payload: { name: 'Train Club' } });
    const org = await db.select().from(schema.orgs).where(eq(schema.orgs.slug, 'train-club')).get();
    await db.insert(schema.orgMembers).values({ orgId: org!.id, userId: ann.id, role: 'member', joinedAt: new Date() });
    await app.inject({ method: 'POST', url: '/api/layouts', headers: h(ann), payload: { title: 'Club yard', orgSlug: 'train-club' } });
    const bobs = (await app.inject({ method: 'POST', url: '/api/layouts', headers: h(bob), payload: { title: 'Bob’s' } })).json().id;
    await db.insert(schema.layoutCollaborators).values({ layoutId: bobs, userId: ann.id, role: 'editor', addedAt: new Date() });

    const s = await summary(app, ann);
    expect(s.ownedAlone.layouts.map((l: { name: string }) => l.name)).toEqual(['Mine']);
    expect(s.madeForClubs).toBe(1);
    expect(s.sharedWithThem).toBe(1);
    expect(s.clubs).toEqual([expect.objectContaining({ name: 'Train Club', role: 'member', onlyMember: false, lastAdmin: false })]);
    expect(s.blockers).toEqual([]);
    expect(s.graceDays).toBe(14);
    expect(s.erasedAs).toMatch(/^Deleted user #[0-9a-z]{6}$/);
    expect(s.pending).toBeNull();
  });

  it('needs the email or the name typed, then waits 14 days, signed out', async () => {
    expect((await askToDelete(app, ann, 'nope')).statusCode).toBe(400);
    const res = await askToDelete(app, ann, '  ANN@example.com ');
    expect(res.statusCode).toBe(202);
    const due = res.json().dueAt as number;
    expect(due).toBeGreaterThan(Date.now() + 13.9 * DAY);
    expect(due).toBeLessThan(Date.now() + 14.1 * DAY);
    // Signed out everywhere.
    expect(await db.select().from(schema.sessions).where(eq(schema.sessions.userId, ann.id)).all()).toHaveLength(0);
    expect((await app.inject({ method: 'GET', url: '/api/me/deletion', headers: h(ann) })).statusCode).toBe(401);
    // Recorded.
    const audit = await db.select().from(schema.auditEvents).where(eq(schema.auditEvents.eventType, 'deletion_request')).all();
    expect(audit).toHaveLength(1);

    // The name works too.
    expect((await askToDelete(app, bob, 'bob')).statusCode).toBe(202);
  });

  it('refuses the desktop app while waiting, with a reason it can show', async () => {
    const token = await issueToken(app, ann.cookie);
    expect((await app.inject({ method: 'GET', url: '/api/layouts', headers: { authorization: `Bearer ${token}` } })).statusCode).toBe(200);
    await askToDelete(app, ann, 'ann@example.com');
    const res = await app.inject({ method: 'GET', url: '/api/layouts', headers: { authorization: `Bearer ${token}` } });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe('account_pending_deletion');
    expect(res.json().message).toContain('sign in on the website');
  });

  it('signing back in cancels it and says so; the desktop works again', async () => {
    const token = await issueToken(app, ann.cookie);
    await askToDelete(app, ann, 'ann@example.com');
    const login = await app.inject({ method: 'POST', url: '/api/auth/password/login', payload: { email: 'ann@example.com', password: 'correct horse battery' } });
    expect(login.statusCode).toBe(200);
    const user = await db.select().from(schema.users).where(eq(schema.users.id, ann.id)).get();
    expect(user!.deletionDueAt).toBeNull();
    const notes = await db.select().from(schema.warnings).where(eq(schema.warnings.subjectUserId, ann.id)).all();
    expect(notes.some((n) => n.reason.includes('will not be deleted'))).toBe(true);
    expect((await app.inject({ method: 'GET', url: '/api/layouts', headers: { authorization: `Bearer ${token}` } })).statusCode).toBe(200);
    // Nothing is erased when the time comes.
    expect((await privacyTick(new Date(Date.now() + 20 * DAY))).accountsErased).toBe(0);
    expect(await db.select().from(schema.users).where(eq(schema.users.id, ann.id)).get()).toBeDefined();
  });

  it('guides the last admin of a club to hand it over first', async () => {
    await app.inject({ method: 'POST', url: '/api/orgs', headers: h(ann), payload: { name: 'Ann Club' } });
    const org = await db.select().from(schema.orgs).where(eq(schema.orgs.slug, 'ann-club')).get();
    await db.insert(schema.orgMembers).values({ orgId: org!.id, userId: bob.id, role: 'member', joinedAt: new Date() });

    const s = await summary(app, ann);
    expect(s.blockers).toEqual([expect.objectContaining({ kind: 'last_club_admin', club: { name: 'Ann Club', slug: 'ann-club' } })]);
    const blocked = await askToDelete(app, ann, 'ann@example.com');
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json().blockers[0].club.slug).toBe('ann-club');

    // Hand it over (the existing step), then it goes ahead.
    expect((await app.inject({ method: 'POST', url: '/api/orgs/ann-club/hand-over', headers: h(ann), payload: { userId: bob.id } })).statusCode).toBe(200);
    expect((await askToDelete(app, ann, 'ann@example.com')).statusCode).toBe(202);
  });

  it('never deletes the last site admin', async () => {
    const root = await db.select().from(schema.users).where(eq(schema.users.email, 'root@example.com')).get();
    // Ann becomes the only admin.
    await db.update(schema.users).set({ isGlobalAdmin: false }).where(eq(schema.users.id, root!.id));
    await db.update(schema.users).set({ isGlobalAdmin: true }).where(eq(schema.users.id, ann.id));
    const s = await summary(app, ann);
    expect(s.blockers.map((b: { kind: string }) => b.kind)).toEqual(['last_site_admin']);
    expect((await askToDelete(app, ann, 'ann@example.com')).statusCode).toBe(409);

    // Asked while there were two, then the other stepped down: the clean-up leaves it.
    await db.update(schema.users).set({ isGlobalAdmin: true }).where(eq(schema.users.id, root!.id));
    expect((await askToDelete(app, ann, 'ann@example.com')).statusCode).toBe(202);
    await db.update(schema.users).set({ isGlobalAdmin: false }).where(eq(schema.users.id, root!.id));
    expect((await privacyTick(new Date(Date.now() + 20 * DAY))).accountsErased).toBe(0);
    expect(await db.select().from(schema.users).where(eq(schema.users.id, ann.id)).get()).toBeDefined();
  });

  it('erases the account after the wait (fake time): own things go, club things stay credited, the log forgets who', async () => {
    const mine = (await app.inject({ method: 'POST', url: '/api/layouts', headers: h(ann), payload: { title: 'Mine' } })).json().id as string;
    await app.inject({ method: 'POST', url: '/api/orgs', headers: h(bob), payload: { name: 'Train Club' } });
    const org = await db.select().from(schema.orgs).where(eq(schema.orgs.slug, 'train-club')).get();
    await db.insert(schema.orgMembers).values({ orgId: org!.id, userId: ann.id, role: 'member', joinedAt: new Date() });
    const clubs = (await app.inject({ method: 'POST', url: '/api/layouts', headers: h(ann), payload: { title: 'Club yard', orgSlug: 'train-club' } })).json().id as string;
    const bobs = (await app.inject({ method: 'POST', url: '/api/layouts', headers: h(bob), payload: { title: 'Bob’s' } })).json().id as string;
    // Bob invited Ann by email: the audit row names her address.
    await app.inject({ method: 'POST', url: `/api/layouts/${bobs}/invites`, headers: h(bob), payload: { email: 'ann@example.com', role: 'editor' } });
    await db.insert(schema.layoutCollaborators).values({ layoutId: bobs, userId: ann.id, role: 'editor', addedAt: new Date() });
    // A background picture on disk for her own layout.
    const bgDir = join(dirname(process.env.DB_PATH!), 'bgimages');
    mkdirSync(bgDir, { recursive: true });
    const bg = join(bgDir, `${mine}.png`);
    writeFileSync(bg, 'png');

    expect((await askToDelete(app, ann, 'ann@example.com')).statusCode).toBe(202);
    // Thirteen days on: still there.
    expect((await privacyTick(new Date(Date.now() + 13 * DAY))).accountsErased).toBe(0);
    expect(await db.select().from(schema.users).where(eq(schema.users.id, ann.id)).get()).toBeDefined();
    // Fifteen days on: gone.
    expect((await privacyTick(new Date(Date.now() + 15 * DAY))).accountsErased).toBe(1);
    expect(await db.select().from(schema.users).where(eq(schema.users.id, ann.id)).get()).toBeUndefined();

    // Her own layout and its picture went.
    expect(await db.select().from(schema.layouts).where(eq(schema.layouts.id, mine)).get()).toBeUndefined();
    expect(existsSync(bg)).toBe(false);
    // The club's layout stays, credited to "Builder #…".
    const kept = await db.select().from(schema.layouts).where(eq(schema.layouts.id, clubs)).get();
    expect(kept!.deletedAuthorId).toBe(ann.id);
    expect(kept!.createdBy).toBe(bob.id);
    // Bob's layout stays; she's off its share list.
    expect(await db.select().from(schema.layouts).where(eq(schema.layouts.id, bobs)).get()).toBeDefined();
    expect(await db.select().from(schema.layoutCollaborators).where(eq(schema.layoutCollaborators.userId, ann.id)).all()).toHaveLength(0);
    // The invite to her address is gone.
    expect(await db.select().from(schema.layoutInvites).where(eq(schema.layoutInvites.invitedEmail, 'ann@example.com')).all()).toHaveLength(0);

    // The audit log: what happened stays, who it was doesn't.
    const all = await db.select().from(schema.auditEvents).all();
    expect(all.some((a) => a.payload.includes('ann@example.com'))).toBe(false);
    const hers = all.filter((a) => a.actorLabel);
    expect(hers.length).toBeGreaterThan(0);
    expect(hers.every((a) => a.userId === null && /^Deleted user #/.test(a.actorLabel!))).toBe(true);
    // An admin sees "Deleted user #…" in the log.
    const root = await db.select().from(schema.users).where(eq(schema.users.email, 'root@example.com')).get();
    const rootLogin = await app.inject({ method: 'POST', url: '/api/auth/password/login', payload: { email: 'root@example.com', password: 'correct horse battery' } });
    const sc = rootLogin.headers['set-cookie'];
    const log = await app.inject({ method: 'GET', url: '/api/admin/audit?limit=200', headers: { cookie: Array.isArray(sc) ? sc.join('; ') : sc! } });
    expect(root).toBeDefined();
    expect(log.json().events.some((e: { userName: string | null }) => e.userName?.startsWith('Deleted user #'))).toBe(true);

    // The erasure record: a pseudonym and counts, nothing personal.
    const er = await db.select().from(schema.erasures).all();
    expect(er).toHaveLength(1);
    expect(er[0]!).toMatchObject({ kind: 'user', how: 'self' });
    expect(JSON.parse(er[0]!.counts)).toMatchObject({ layouts: 1 });
    expect(JSON.stringify(er[0])).not.toContain('ann');
  });

  it('a club she was the only member of goes with her; one with others gets a new admin', async () => {
    await app.inject({ method: 'POST', url: '/api/orgs', headers: h(ann), payload: { name: 'Solo' } });
    await app.inject({ method: 'POST', url: '/api/orgs', headers: h(ann), payload: { name: 'Shared' } });
    const shared = await db.select().from(schema.orgs).where(eq(schema.orgs.slug, 'shared')).get();
    await db.insert(schema.orgMembers).values({ orgId: shared!.id, userId: bob.id, role: 'member', joinedAt: new Date() });
    // An admin erases her straight away (Admin › Users › Delete).
    const root = await app.inject({ method: 'POST', url: '/api/auth/password/login', payload: { email: 'root@example.com', password: 'correct horse battery' } });
    const sc = root.headers['set-cookie'];
    const res = await app.inject({ method: 'DELETE', url: `/api/admin/users/${ann.id}`, headers: { cookie: Array.isArray(sc) ? sc.join('; ') : sc! } });
    expect(res.statusCode).toBe(200);
    expect(await db.select().from(schema.orgs).where(eq(schema.orgs.slug, 'solo')).get()).toBeUndefined();
    const bobRole = await db.select().from(schema.orgMembers).where(eq(schema.orgMembers.userId, bob.id)).get();
    expect(bobRole!.role).toBe('admin');
    const notes = await db.select().from(schema.warnings).where(eq(schema.warnings.subjectUserId, bob.id)).all();
    expect(notes.some((n) => n.reason.includes('now its admin'))).toBe(true);
    expect((await db.select().from(schema.erasures).all())[0]!.how).toBe('admin');
  });

  it('only the person can delete their own account; strangers and members can’t erase others', async () => {
    // There's no "delete someone else" route for non-admins.
    const res = await app.inject({ method: 'DELETE', url: `/api/admin/users/${ann.id}`, headers: h(bob) });
    expect(res.statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: '/api/me/deletion', payload: { confirm: 'ann@example.com' } })).statusCode).toBe(401);
    // Typing someone else's email does nothing to them, or to you.
    expect((await askToDelete(app, bob, 'ann@example.com')).statusCode).toBe(400);
    const a = await db.select().from(schema.users).where(eq(schema.users.id, ann.id)).get();
    expect(a!.deletionDueAt).toBeNull();
  });
});

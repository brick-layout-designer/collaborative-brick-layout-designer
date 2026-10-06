// Admin › Privacy requests (routes/privacyAdmin.ts), restriction, record
// keeping (privacy/retention.ts), the privacy page, and who sees the
// email addresses on a share list.

import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db, loginAs, resetDb, schema } from '../../test/helpers.js';
import { sqlite } from '../../db/index.js';
import { attachUser } from '../../auth/cookie.js';
import { passwordRoutes } from '../auth/password.js';
import { layoutRoutes } from '../layouts.js';
import { adminRoutes } from '../admin.js';
import { collaboratorRoutes } from '../collaborators.js';
import { warningRoutes } from '../warnings.js';
import { privacyRoutes } from '../privacy.js';
import { privacyAdminRoutes } from '../privacyAdmin.js';
import { invalidatePrivacyCache } from '../../privacy/settings.js';
import { settleExports } from '../../privacy/exports.js';
import { privacyTick } from '../../privacy/tick.js';
import { scrubPayload } from '../../privacy/retention.js';
import { readZip } from '../../test/zip.js';

const DAY = 86_400_000;

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ bodyLimit: 20 * 1024 * 1024 });
  await app.register(cookie);
  app.addHook('preHandler', attachUser);
  await app.register(passwordRoutes);
  await app.register(layoutRoutes);
  await app.register(adminRoutes);
  await app.register(collaboratorRoutes);
  await app.register(warningRoutes);
  await app.register(privacyRoutes);
  await app.register(privacyAdminRoutes);
  return app;
}

type Who = { cookie: string; id: string };
const h = (w: Who) => ({ cookie: w.cookie });

describe('Admin › Privacy requests', () => {
  let app: FastifyInstance;
  let admin: Who;
  let ann: Who;
  let bob: Who;

  beforeEach(async () => {
    resetDb();
    sqlite.exec('DELETE FROM privacy_request_events; DELETE FROM privacy_requests; DELETE FROM data_exports; DELETE FROM erasures;');
    invalidatePrivacyCache();
    delete process.env.PRIVACY_CONTACT;
    app = await buildApp();
    admin = await loginAs(app, 'root@example.com');
    await db.update(schema.users).set({ isGlobalAdmin: true }).where(eq(schema.users.id, admin.id));
    ann = await loginAs(app, 'ann@example.com');
    bob = await loginAs(app, 'bob@example.com');
  });
  afterEach(async () => {
    await settleExports();
    delete process.env.PRIVACY_CONTACT;
    await app.close();
  });

  async function log(payload: object) {
    const res = await app.inject({ method: 'POST', url: '/api/admin/privacy/requests', headers: h(admin), payload });
    expect(res.statusCode).toBe(201);
    return res.json().request as { id: string; dueAt: number; receivedAt: number; due: string; status: string };
  }

  it('only site admins can see or act on requests', async () => {
    const r = await log({ type: 'access', subjectUserId: ann.id, receivedVia: 'email' });
    const routes: [string, string][] = [
      ['GET', '/api/admin/privacy/requests'],
      ['GET', '/api/admin/privacy/summary'],
      ['POST', '/api/admin/privacy/requests'],
      ['GET', `/api/admin/privacy/requests/${r.id}`],
      ['PATCH', `/api/admin/privacy/requests/${r.id}`],
      ['POST', `/api/admin/privacy/requests/${r.id}/export`],
      ['POST', `/api/admin/privacy/requests/${r.id}/erase`],
      ['POST', `/api/admin/privacy/requests/${r.id}/restrict`],
    ];
    for (const [method, url] of routes) {
      const payload = { type: 'access', subjectText: 'x', confirm: 'ann@example.com', restricted: true, addNote: 'x' };
      const m = method as 'GET' | 'POST' | 'PATCH';
      const as = (headers: Record<string, string>) => app.inject(m === 'GET' ? { method: m, url, headers } : { method: m, url, headers, payload });
      expect((await as(h(ann))).statusCode, `${method} ${url}`).toBe(403);
      expect((await as({})).statusCode, `${method} ${url}`).toBe(401);
    }
    // Nothing happened to Ann.
    const a = await db.select().from(schema.users).where(eq(schema.users.id, ann.id)).get();
    expect(a!.restrictedAt).toBeNull();
  });

  it('logs a request with a due date one month on, keeps its history, and closes it', async () => {
    const r = await log({ type: 'access', subjectUserId: ann.id, receivedVia: 'letter', notes: 'Posted to the club' });
    expect(r.dueAt - r.receivedAt).toBe(30 * DAY);
    expect(r.status).toBe('open');
    // A request from someone with no account.
    const free = await log({ type: 'objection', subjectText: 'Sam (no account), sam@example.org', receivedVia: 'email' });
    expect(free.id).toBeTruthy();
    expect((await app.inject({ method: 'POST', url: '/api/admin/privacy/requests', headers: h(admin), payload: { type: 'access' } })).statusCode).toBe(400);

    const note = await app.inject({ method: 'PATCH', url: `/api/admin/privacy/requests/${r.id}`, headers: h(admin), payload: { addNote: 'Replied asking for ID' } });
    expect(note.statusCode).toBe(200);
    const done = await app.inject({ method: 'PATCH', url: `/api/admin/privacy/requests/${r.id}`, headers: h(admin), payload: { status: 'done' } });
    expect(done.json().request.closedAt).toBeGreaterThan(0);
    const detail = (await app.inject({ method: 'GET', url: `/api/admin/privacy/requests/${r.id}`, headers: h(admin) })).json();
    expect(detail.history.map((e: { kind: string }) => e.kind)).toEqual(['logged', 'note', 'status']);
    expect(detail.history[1].text).toBe('Replied asking for ID');
    // Closed ones leave the open list.
    const open = (await app.inject({ method: 'GET', url: '/api/admin/privacy/requests', headers: h(admin) })).json();
    expect(open.requests.map((x: { id: string }) => x.id)).toEqual([free.id]);
    const all = (await app.inject({ method: 'GET', url: '/api/admin/privacy/requests?status=all', headers: h(admin) })).json();
    expect(all.requests).toHaveLength(2);
    // Audit-logged.
    const audit = await db.select().from(schema.auditEvents).where(eq(schema.auditEvents.eventType, 'privacy_request')).all();
    expect(audit.length).toBeGreaterThanOrEqual(3);
  });

  it('counts overdue and nearly-due requests for the badges', async () => {
    await log({ type: 'access', subjectUserId: ann.id, receivedVia: 'email', receivedAt: Date.now() - 40 * DAY });
    await log({ type: 'erasure', subjectUserId: bob.id, receivedVia: 'email', receivedAt: Date.now() - 25 * DAY });
    await log({ type: 'other', subjectText: 'Someone', receivedVia: 'email' });
    const s = (await app.inject({ method: 'GET', url: '/api/admin/privacy/summary', headers: h(admin) })).json();
    expect(s).toMatchObject({ open: 3, overdue: 1, dueSoon: 1, noticeMissing: true, contactMissing: true });
  });

  it('exports the person’s data for the admin, who alone can download it', async () => {
    const r = await log({ type: 'access', subjectUserId: ann.id, receivedVia: 'email' });
    expect((await app.inject({ method: 'POST', url: `/api/admin/privacy/requests/${r.id}/export`, headers: h(admin) })).statusCode).toBe(202);
    await settleExports();
    const detail = (await app.inject({ method: 'GET', url: `/api/admin/privacy/requests/${r.id}`, headers: h(admin) })).json();
    const url = detail.exports[0].downloadUrl as string;
    expect(url).toBeTruthy();
    const dl = await app.inject({ method: 'GET', url, headers: h(admin) });
    expect(dl.statusCode).toBe(200);
    expect(readZip(dl.rawPayload).get('data/account.json')!.toString()).toContain('ann@example.com');
    // Ann can't fetch the admin's copy; Bob can't either.
    expect((await app.inject({ method: 'GET', url, headers: h(ann) })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url, headers: h(bob) })).statusCode).toBe(404);
    expect(detail.history.map((e: { kind: string }) => e.kind)).toContain('export');
  });

  it('restrict freezes the account and what it owns; lifting it unfreezes', async () => {
    const mine = (await app.inject({ method: 'POST', url: '/api/layouts', headers: h(ann), payload: { title: 'Mine' } })).json().id as string;
    await db.insert(schema.layoutCollaborators).values({ layoutId: mine, userId: bob.id, role: 'editor', addedAt: new Date() });
    const r = await log({ type: 'restriction', subjectUserId: ann.id, receivedVia: 'email' });
    expect((await app.inject({ method: 'POST', url: `/api/admin/privacy/requests/${r.id}/restrict`, headers: h(admin), payload: { restricted: true } })).statusCode).toBe(200);

    // She's told, and stays signed in.
    const held = await db.select().from(schema.warnings).where(eq(schema.warnings.subjectUserId, ann.id)).all();
    expect(held.some((n) => n.reason.includes('on hold (read only)'))).toBe(true);
    expect((await app.inject({ method: 'GET', url: '/api/layouts', headers: h(ann) })).statusCode).toBe(200);
    // Ann reads, but can't change anything...
    const ann2 = await app.inject({ method: 'POST', url: '/api/auth/password/login', payload: { email: 'ann@example.com', password: 'correct horse battery' } });
    const sc = ann2.headers['set-cookie'];
    const annCookie = { cookie: Array.isArray(sc) ? sc.join('; ') : sc! };
    expect((await app.inject({ method: 'GET', url: '/api/layouts', headers: annCookie })).statusCode).toBe(200);
    const write = await app.inject({ method: 'POST', url: '/api/layouts', headers: annCookie, payload: { title: 'New' } });
    expect(write.statusCode).toBe(403);
    expect(write.json().error).toBe('account_restricted');
    // ...except asking for her data.
    expect((await app.inject({ method: 'POST', url: '/api/me/privacy/exports', headers: annCookie })).statusCode).toBe(202);
    // Bob, an editor on her layout, now only views it.
    const rename = await app.inject({ method: 'PATCH', url: `/api/layouts/${mine}`, headers: h(bob), payload: { title: 'Changed' } });
    expect(rename.statusCode).toBe(403);
    expect((await app.inject({ method: 'GET', url: `/api/layouts/${mine}`, headers: h(bob) })).statusCode).toBe(200);

    await app.inject({ method: 'POST', url: `/api/admin/privacy/requests/${r.id}/restrict`, headers: h(admin), payload: { restricted: false } });
    expect((await app.inject({ method: 'PATCH', url: `/api/layouts/${mine}`, headers: h(bob), payload: { title: 'Changed' } })).statusCode).toBe(200);
    expect((await app.inject({ method: 'POST', url: '/api/layouts', headers: annCookie, payload: { title: 'New' } })).statusCode).toBe(201);
  });

  it('erase now needs the email typed, erases at once, and keeps only a pseudonym on the request', async () => {
    const r = await log({ type: 'erasure', subjectUserId: ann.id, receivedVia: 'email' });
    expect((await app.inject({ method: 'POST', url: `/api/admin/privacy/requests/${r.id}/erase`, headers: h(admin), payload: { confirm: 'ann' } })).statusCode).toBe(400);
    expect(await db.select().from(schema.users).where(eq(schema.users.id, ann.id)).get()).toBeDefined();
    const res = await app.inject({ method: 'POST', url: `/api/admin/privacy/requests/${r.id}/erase`, headers: h(admin), payload: { confirm: 'ANN@example.com' } });
    expect(res.statusCode).toBe(200);
    expect(await db.select().from(schema.users).where(eq(schema.users.id, ann.id)).get()).toBeUndefined();
    const row = await db.select().from(schema.privacyRequests).where(eq(schema.privacyRequests.id, r.id)).get();
    expect(row!.subjectUserId).toBeNull();
    expect(row!.subjectText).toMatch(/^Deleted user #/);
    expect((await db.select().from(schema.erasures).all())[0]!.how).toBe('request');
  });

  it('the privacy page shows the notice and contact the admin set; the env var forces the contact', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/privacy' })).json()).toEqual({ notice: null, contact: null });
    expect((await app.inject({ method: 'PATCH', url: '/api/admin/settings', headers: h(admin), payload: { privacyContact: 'not a contact' } })).statusCode).toBe(400);
    const ok = await app.inject({
      method: 'PATCH',
      url: '/api/admin/settings',
      headers: h(admin),
      payload: { privacyNotice: '# Privacy\n\nWe keep your layouts.', privacyContact: 'privacy@club.example' },
    });
    expect(ok.statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/api/privacy' })).json()).toEqual({ notice: '# Privacy\n\nWe keep your layouts.', contact: 'privacy@club.example' });
    process.env.PRIVACY_CONTACT = 'https://club.example/privacy';
    expect((await app.inject({ method: 'GET', url: '/api/privacy' })).json().contact).toBe('https://club.example/privacy');
    const settings = (await app.inject({ method: 'GET', url: '/api/admin/settings', headers: h(admin) })).json();
    expect(settings.privacy.contact).toEqual({ value: 'https://club.example/privacy', setting: 'privacy@club.example', forcedBy: 'PRIVACY_CONTACT' });
    expect(settings.privacy.notice).toContain('We keep your layouts');
    const s = (await app.inject({ method: 'GET', url: '/api/admin/privacy/summary', headers: h(admin) })).json();
    expect(s.noticeMissing).toBe(false);
  });
});

describe('record keeping (fake time)', () => {
  let app: FastifyInstance;
  beforeEach(async () => {
    resetDb();
    sqlite.exec('DELETE FROM privacy_request_events; DELETE FROM privacy_requests; DELETE FROM data_exports; DELETE FROM erasures;');
    invalidatePrivacyCache();
    app = await buildApp();
  });
  afterEach(async () => {
    await app.close();
  });

  it('deletes old sign-ins, invites and records, scrubs old audit addresses, and sweeps orphan pictures', async () => {
    const ann = await loginAs(app, 'ann@example.com');
    const now = Date.now();
    const old = new Date(now - 40 * DAY);
    // A session that expired 40 days ago, and one still valid.
    await db.insert(schema.sessions).values({ id: 'old-session', userId: ann.id, expiresAt: old });
    // A revoked desktop sign-in.
    await db.insert(schema.apiTokens).values({ id: 'tok', userId: ann.id, name: 'Laptop', tokenHash: 'h', prefix: 'p', last4: '1234', scopes: 'layouts:read', createdAt: old, expiresAt: new Date(now + DAY), revokedAt: old });
    // An invite nobody accepted.
    const layout = (await app.inject({ method: 'POST', url: '/api/layouts', headers: h(ann), payload: { title: 'L' } })).json().id as string;
    await db.insert(schema.layoutInvites).values({ id: 'inv', layoutId: layout, invitedEmail: 'x@example.com', role: 'viewer', token: 't', expiresAt: old, acceptedAt: null });
    // Audit rows: one old with an address and an ip, one recent.
    await db.insert(schema.auditEvents).values({ layoutId: layout, userId: ann.id, eventType: 'share', payload: JSON.stringify({ invitedEmail: 'x@example.com', ip: '10.0.0.1', role: 'viewer' }), createdAt: new Date(now - 400 * DAY) });
    await db.insert(schema.auditEvents).values({ layoutId: layout, userId: ann.id, eventType: 'share', payload: JSON.stringify({ invitedEmail: 'y@example.com' }), createdAt: new Date(now - DAY) });
    // An old erasure record and an old closed request.
    await db.insert(schema.erasures).values({ id: randomUUID(), kind: 'user', ref: 'Deleted user #aaaaaa', how: 'self', requestedAt: null, erasedAt: new Date(now - 1200 * DAY), counts: '{}' });
    await db.insert(schema.privacyRequests).values({ id: 'req', type: 'access', subjectUserId: null, subjectText: 'Sam', receivedVia: 'email', receivedAt: new Date(now - 1300 * DAY), dueAt: new Date(now - 1270 * DAY), status: 'done', notes: '', createdBy: null, createdAt: new Date(now - 1300 * DAY), updatedAt: new Date(now - 1200 * DAY), closedAt: new Date(now - 1200 * DAY) });
    // A background picture whose layout is long gone.
    const bgDir = join(dirname(process.env.DB_PATH!), 'bgimages');
    mkdirSync(bgDir, { recursive: true });
    const orphan = join(bgDir, `${randomUUID()}.png`);
    writeFileSync(orphan, 'png');
    const kept = join(bgDir, `${layout}.png`);
    writeFileSync(kept, 'png');

    const { retention } = await privacyTick(new Date(now));
    expect(retention.sessions).toBe(1);
    expect(retention.apiTokens).toBe(1);
    expect(retention.invites).toBe(1);
    expect(retention.auditScrubbed).toBe(1);
    expect(retention.erasures).toBe(1);
    expect(retention.requests).toBe(1);
    expect(retention.pictures).toBe(1);
    expect(existsSync(orphan)).toBe(false);
    expect(existsSync(kept)).toBe(true);
    // Ann's live session stays.
    expect(await db.select().from(schema.sessions).where(eq(schema.sessions.userId, ann.id)).all()).toHaveLength(1);
    const audit = await db.select().from(schema.auditEvents).where(eq(schema.auditEvents.eventType, 'share')).all();
    const scrubbed = audit.find((a) => a.createdAt.getTime() < now - 300 * DAY)!;
    expect(JSON.parse(scrubbed.payload)).toEqual({ invitedEmail: '(removed)', role: 'viewer' });
    expect(audit.find((a) => a.createdAt.getTime() > now - 300 * DAY)!.payload).toContain('y@example.com');
  });

  it('scrubs addresses anywhere in a payload, and leaves one without any alone', () => {
    expect(scrubPayload(JSON.stringify({ a: { b: ['me@x.org'] }, userAgent: 'Firefox' }))).toBe(JSON.stringify({ a: { b: ['(removed)'] } }));
    expect(scrubPayload(JSON.stringify({ title: 'Train @ show' }))).toBeNull();
  });
});

describe('email addresses on share lists', () => {
  let app: FastifyInstance;
  beforeEach(async () => {
    resetDb();
    app = await buildApp();
  });
  afterEach(async () => {
    await app.close();
  });

  it('show only to the person, the owners and site admins; others see names', async () => {
    const owner = await loginAs(app, 'own@example.com');
    const viewer = await loginAs(app, 'view@example.com');
    const editor = await loginAs(app, 'edit@example.com');
    const admin = await loginAs(app, 'root@example.com');
    await db.update(schema.users).set({ isGlobalAdmin: true }).where(eq(schema.users.id, admin.id));
    const id = (await app.inject({ method: 'POST', url: '/api/layouts', headers: h(owner), payload: { title: 'L' } })).json().id as string;
    await db.insert(schema.layoutCollaborators).values([
      { layoutId: id, userId: viewer.id, role: 'viewer', addedAt: new Date() },
      { layoutId: id, userId: editor.id, role: 'editor', addedAt: new Date() },
    ]);
    await app.inject({ method: 'POST', url: `/api/layouts/${id}/invites`, headers: h(owner), payload: { email: 'new@example.com', role: 'viewer' } });
    type C = { userId: string; email: string; displayName: string };
    const list = async (w: Who) => (await app.inject({ method: 'GET', url: `/api/layouts/${id}/collaborators`, headers: h(w) })).json() as { collaborators: C[]; invites: unknown[] };

    const asViewer = await list(viewer);
    expect(asViewer.collaborators.find((c) => c.userId === editor.id)!.email).toBe('');
    expect(asViewer.collaborators.find((c) => c.userId === editor.id)!.displayName).toBe('edit');
    expect(asViewer.collaborators.find((c) => c.userId === viewer.id)!.email).toBe('view@example.com');
    expect(asViewer.invites).toEqual([]);
    expect((await list(editor)).collaborators.find((c) => c.userId === viewer.id)!.email).toBe('');
    expect((await list(owner)).collaborators.find((c) => c.userId === viewer.id)!.email).toBe('view@example.com');
    expect((await list(owner)).invites).toHaveLength(1);
    // A site admin with access sees addresses too.
    await db.insert(schema.layoutCollaborators).values({ layoutId: id, userId: admin.id, role: 'viewer', addedAt: new Date() });
    expect((await list(admin)).collaborators.find((c) => c.userId === editor.id)!.email).toBe('edit@example.com');
  });
});

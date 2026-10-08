// Moderation at scale: one list a page at a time (waiting, trusted clubs'
// queues, public, unpublished) with filters, the counts for the badges,
// and approving / declining / unpublishing several at once.

import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, resetDb, schema } from '../../test/helpers.js';
import { attachUser } from '../../auth/cookie.js';
import { passwordRoutes } from '../auth/password.js';
import { sessionRoutes } from '../auth/session.js';
import { orgRoutes } from '../orgs.js';
import { catalogRoutes } from '../catalog.js';
import { collectionRoutes } from '../collections.js';

async function login(app: FastifyInstance, email: string): Promise<string> {
  await app.inject({ method: 'POST', url: '/api/auth/password/register', payload: { email, password: 'correct horse battery', displayName: email.split('@')[0] } });
  const user = await db.select().from(schema.users).where(eq(schema.users.email, email)).get();
  const v = await db.select().from(schema.emailVerifications).where(eq(schema.emailVerifications.userId, user!.id)).get();
  const res = await app.inject({ method: 'POST', url: `/api/auth/password/verify-email/${v!.token}` });
  const c = res.headers['set-cookie'];
  return Array.isArray(c) ? c.join('; ') : (c ?? '');
}
const userId = async (email: string) => (await db.select().from(schema.users).where(eq(schema.users.email, email)).get())!.id;

type Page = { total: number; nextOffset: number | null; rows: { title: string; versionId?: string; id?: string; kind: string }[] };

describe('moderation paging', () => {
  let app: FastifyInstance;
  let mod: string;
  let ada: string;
  const get = async (url: string, who = mod) => {
    const r = await app.inject({ method: 'GET', url, headers: { cookie: who } });
    return { status: r.statusCode, body: r.json() as Page & Record<string, number> };
  };
  const bulk = (payload: Record<string, unknown>) => app.inject({ method: 'POST', url: '/api/moderation/bulk', headers: { cookie: mod }, payload });

  beforeEach(async () => {
    resetDb();
    app = Fastify();
    await app.register(cookie);
    await app.register(rateLimit, { global: false });
    app.addHook('preHandler', attachUser);
    await app.register(passwordRoutes);
    await app.register(sessionRoutes);
    await app.register(orgRoutes);
    await app.register(catalogRoutes);
    await app.register(collectionRoutes);
    mod = await login(app, 'mod@example.com');
    ada = await login(app, 'ada@example.com');
    await db.update(schema.users).set({ isModerator: true }).where(eq(schema.users.id, await userId('mod@example.com')));
    const orgId = ((await app.inject({ method: 'POST', url: '/api/orgs', headers: { cookie: ada }, payload: { name: 'ArkLUG', slug: 'arklug' } })).json() as { id: string }).id;
    await db.update(schema.orgs).set({ trusted: true }).where(eq(schema.orgs.id, orgId));
    const owner = await userId('ada@example.com');
    const base = Date.now() - 100_000;
    // 30 waiting (25 modules, 5 parts), 3 waiting in the trusted club's queue, 4 public, 2 unpublished.
    const add = async (i: number, kind: 'module' | 'part', status: 'in_review' | 'public' | 'unpublished', org: string | null = null) => {
      const id = randomUUID();
      const at = new Date(base + i * 1000);
      await db.insert(schema.catalogItems).values({
        id, kind, sourceId: randomUUID(), ownerUserId: org ? null : owner, ownerOrgId: org, title: `${status} ${kind} ${i}`,
        status, publicVersion: status === 'in_review' ? 0 : 1, reason: status === 'unpublished' ? 'spam' : null, createdAt: at, updatedAt: at,
      });
      await db.insert(schema.catalogItemVersions).values({ id: `v-${status}-${i}-${org ? 't' : 'x'}`, itemId: id, version: 1, status: status === 'in_review' ? 'in_review' : 'public', submittedBy: owner, createdAt: at });
    };
    for (let i = 0; i < 30; i++) await add(i, i < 25 ? 'module' : 'part', 'in_review');
    for (let i = 0; i < 3; i++) await add(100 + i, 'module', 'in_review', orgId);
    for (let i = 0; i < 4; i++) await add(200 + i, 'module', 'public');
    for (let i = 0; i < 2; i++) await add(300 + i, 'part', 'unpublished');
  });
  afterEach(async () => {
    await app.close();
  });

  it('only moderators', async () => {
    expect((await get('/api/moderation/catalog', ada)).status).toBe(403);
    expect((await get('/api/moderation/counts', ada)).status).toBe(403);
    expect((await get('/api/moderation/covers', ada)).status).toBe(403);
    expect((await get('/api/moderation/covers')).body).toEqual({ covers: [], trustedCovers: [] });
  });

  it('counts each list', async () => {
    expect((await get('/api/moderation/counts')).body).toMatchObject({ waiting: 30, trusted: 3, public: 4, unpublished: 2, covers: 0, collections: 0 });
  });

  it('pages through the queue oldest first, with filters', async () => {
    const a = await get('/api/moderation/catalog?view=waiting&limit=20');
    expect(a.body.total).toBe(30);
    expect(a.body.rows).toHaveLength(20);
    expect(a.body.rows[0]!.title).toBe('in_review module 0');
    expect(a.body.nextOffset).toBe(20);
    const b = await get('/api/moderation/catalog?view=waiting&limit=20&offset=20');
    expect(b.body.rows).toHaveLength(10);
    expect(b.body.nextOffset).toBeNull();
    expect((await get('/api/moderation/catalog?view=waiting&kind=part')).body.total).toBe(5);
    expect((await get('/api/moderation/catalog?view=waiting&q=module%2012')).body.rows.map((r) => r.title)).toEqual(['in_review module 12']);
    expect((await get('/api/moderation/catalog?view=waiting&sort=newest&limit=1')).body.rows[0]!.title).toBe('in_review part 29');
    expect((await get('/api/moderation/catalog?view=trusted')).body.total).toBe(3);
    expect((await get('/api/moderation/catalog?view=unpublished&q=spam')).body.total).toBe(2);
    expect((await get('/api/moderation/catalog?view=public')).body.rows[0]!.title).toBe('public module 203');
    expect((await get('/api/moderation/catalog?view=nope')).status).toBe(400);
  });

  it('approves, declines and unpublishes several at once', async () => {
    const page = (await get('/api/moderation/catalog?view=waiting&limit=3')).body.rows;
    const r = await bulk({ action: 'approve', ids: page.map((p) => p.versionId) });
    expect(r.json()).toEqual({ done: 3, failed: [] });
    const next = (await get('/api/moderation/catalog?view=waiting&limit=2')).body.rows;
    expect((await bulk({ action: 'decline', ids: [...next.map((p) => p.versionId), 'nope'], reason: 'blurry' })).json()).toEqual({ done: 2, failed: [{ id: 'nope', error: 'not_found' }] });
    const pub = (await get('/api/moderation/catalog?view=public')).body;
    expect(pub.total).toBe(7);
    expect((await bulk({ action: 'unpublish', ids: pub.rows.slice(0, 2).map((p) => p.id), reason: 'tidy' })).json()).toMatchObject({ done: 2 });
    expect((await get('/api/moderation/counts')).body).toMatchObject({ waiting: 25, public: 5, unpublished: 4 });
    expect((await bulk({ action: 'delete', ids: ['x'] })).statusCode).toBe(400);
    expect((await bulk({ action: 'approve', ids: [] })).statusCode).toBe(400);
  });
});

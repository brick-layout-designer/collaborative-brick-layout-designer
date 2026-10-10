// Collection moderation at scale: each list a page at a time with search,
// several approved / declined / unpublished / removed at once, and the
// trusted-clubs list a page at a time.

import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, resetDb, schema } from '../../test/helpers.js';
import { attachUser } from '../../auth/cookie.js';
import { passwordRoutes } from '../auth/password.js';
import { sessionRoutes } from '../auth/session.js';
import { orgRoutes } from '../orgs.js';
import { catalogRoutes } from '../catalog.js';
import { collectionRoutes } from '../collections.js';
import { clubReviewRoutes } from '../clubReview.js';
import { getPlatformSettings, PLATFORM_SETTINGS_ID } from '../../auth/platformSettings.js';

async function login(app: FastifyInstance, email: string): Promise<string> {
  await app.inject({ method: 'POST', url: '/api/auth/password/register', payload: { email, password: 'correct horse battery', displayName: email.split('@')[0] } });
  const user = await db.select().from(schema.users).where(eq(schema.users.email, email)).get();
  const v = await db.select().from(schema.emailVerifications).where(eq(schema.emailVerifications.userId, user!.id)).get();
  const res = await app.inject({ method: 'POST', url: `/api/auth/password/verify-email/${v!.token}` });
  const c = res.headers['set-cookie'];
  return Array.isArray(c) ? c.join('; ') : (c ?? '');
}
const userId = async (email: string) => (await db.select().from(schema.users).where(eq(schema.users.email, email)).get())!.id;
type Page = { total: number; nextOffset: number | null; rows: { id: string; title: string }[] };

describe('collection moderation paging', () => {
  let app: FastifyInstance;
  let mod: string;
  let ada: string;
  const get = async (url: string, who = mod) => {
    const r = await app.inject({ method: 'GET', url, headers: { cookie: who } });
    return { status: r.statusCode, body: r.json() as Page };
  };
  const bulk = (payload: Record<string, unknown>) => app.inject({ method: 'POST', url: '/api/moderation/collections/bulk', headers: { cookie: mod }, payload });

  beforeEach(async () => {
    resetDb();
    app = Fastify();
    await app.register(cookie);
    await app.register(rateLimit, { global: false });
    app.addHook('preHandler', attachUser);
    for (const r of [passwordRoutes, sessionRoutes, orgRoutes, catalogRoutes, collectionRoutes, clubReviewRoutes]) await app.register(r);
    await getPlatformSettings();
    await db.update(schema.platformSettings).set({ moduleCatalogEnabled: true }).where(eq(schema.platformSettings.id, PLATFORM_SETTINGS_ID));
    mod = await login(app, 'mod@example.com');
    ada = await login(app, 'ada@example.com');
    await db.update(schema.users).set({ isModerator: true }).where(eq(schema.users.id, await userId('mod@example.com')));
    const orgId = ((await app.inject({ method: 'POST', url: '/api/orgs', headers: { cookie: ada }, payload: { name: 'ArkLUG', slug: 'arklug' } })).json() as { id: string }).id;
    const owner = await userId('ada@example.com');
    const base = Date.now() - 100_000;
    const add = async (i: number, status: 'in_review' | 'public', audience: 'everyone' | 'private' = 'everyone') => {
      const at = new Date(base + i * 1000);
      await db.insert(schema.catalogCollections).values({
        id: `c-${i}`, title: `${audience === 'private' ? 'club' : status} picks ${i}`, ownerUserId: owner, orgId: audience === 'private' ? orgId : null,
        status, audience, createdAt: at, updatedAt: at,
      });
    };
    for (let i = 0; i < 60; i++) await add(i, 'in_review');
    for (let i = 100; i < 105; i++) await add(i, 'public');
    for (let i = 200; i < 203; i++) await add(i, 'public', 'private');
    for (let i = 0; i < 70; i++) await db.insert(schema.orgs).values({ id: `o-${i}`, slug: `club-${i}`, name: `Club ${String(i).padStart(2, '0')}`, trusted: i < 55, createdAt: new Date() } as typeof schema.orgs.$inferInsert);
  });
  afterEach(async () => {
    await app.close();
  });

  it('pages each list, with search; only moderators', async () => {
    expect((await get('/api/moderation/collections/list', ada)).status).toBe(403);
    const a = (await get('/api/moderation/collections/list?view=queue&limit=50')).body;
    expect(a.total).toBe(60);
    expect(a.rows).toHaveLength(50);
    expect(a.rows[0]!.title).toBe('in_review picks 0');
    expect(a.nextOffset).toBe(50);
    expect((await get('/api/moderation/collections/list?view=queue&offset=50')).body.rows).toHaveLength(10);
    expect((await get('/api/moderation/collections/list?view=queue&q=picks%2042')).body.rows.map((r) => r.title)).toEqual(['in_review picks 42']);
    expect((await get('/api/moderation/collections/list?view=listed')).body.total).toBe(5);
    expect((await get('/api/moderation/collections/list?view=club')).body.total).toBe(3);
    expect((await get('/api/moderation/collections/list?view=nope')).status).toBe(400);
  });

  it('approves, declines, unpublishes and removes several at once', async () => {
    expect((await bulk({ action: 'approve', ids: ['c-0', 'c-1', 'c-2'] })).json()).toEqual({ done: 3, failed: [] });
    expect((await bulk({ action: 'decline', ids: ['c-3', 'nope'], reason: 'blurry' })).json()).toEqual({ done: 1, failed: [{ id: 'nope', error: 'not_found' }] });
    expect((await get('/api/moderation/collections/list?view=queue')).body.total).toBe(56);
    expect((await bulk({ action: 'unpublish', ids: ['c-100', 'c-101'] })).json()).toMatchObject({ done: 2 });
    // Remove is for clubs' private ones only.
    expect((await bulk({ action: 'remove', ids: ['c-200', 'c-102'], reason: 'spam' })).json()).toEqual({ done: 1, failed: [{ id: 'c-102', error: 'not_found' }] });
    expect((await get('/api/moderation/collections/list?view=club')).body.total).toBe(2);
    expect((await bulk({ action: 'feature', ids: ['c-1'] })).statusCode).toBe(400);
  });

  it('pages the trusted clubs, and finds others by name', async () => {
    const t = (await app.inject({ method: 'GET', url: '/api/moderation/clubs?limit=50', headers: { cookie: mod } })).json() as { clubs: unknown[]; total: number; nextOffset: number };
    expect(t).toMatchObject({ total: 55, nextOffset: 50 });
    expect(t.clubs).toHaveLength(50);
    const f = (await app.inject({ method: 'GET', url: '/api/moderation/clubs?q=club%206', headers: { cookie: mod } })).json() as { total: number };
    expect(f.total).toBe(10);
    // A % or _ is a plain character, not "anything".
    const w = (await app.inject({ method: 'GET', url: '/api/moderation/clubs?q=%25', headers: { cookie: mod } })).json() as { total: number };
    expect(w.total).toBe(0);
    const u = (await app.inject({ method: 'GET', url: '/api/moderation/clubs?q=_', headers: { cookie: mod } })).json() as { total: number };
    expect(u.total).toBe(0);
  });
});

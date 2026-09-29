// Extended integration tests for venue routes:
//   PATCH  /api/venues/:id  — rename (Venue Library "Rename") / update data
// (Create, read, delete, org-scoped already covered in venues.test.ts)

import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, resetDb, schema } from '../../test/helpers.js';
import { attachUser } from '../../auth/cookie.js';
import { passwordRoutes } from '../auth/password.js';
import { sessionRoutes } from '../auth/session.js';
import { orgRoutes } from '../orgs.js';
import { venueRoutes } from '../venues.js';

const SAMPLE_VENUE = { name: 'Test Hall', enabled: true, edges: [], obstacles: [], minWalkwayStuds: 0 };
const UPDATED_VENUE = { name: 'Updated Hall', enabled: false, edges: [{ x: 0, y: 0 }], obstacles: [], minWalkwayStuds: 2 };

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ bodyLimit: 10 * 1024 * 1024 });
  await app.register(cookie);
  app.addHook('preHandler', attachUser);
  await app.register(passwordRoutes);
  await app.register(sessionRoutes);
  await app.register(orgRoutes);
  await app.register(venueRoutes);
  return app;
}

async function registerAndLogin(app: FastifyInstance, email: string): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/password/register',
    payload: { email, password: 'correct horse battery', displayName: email },
  });
  expect(res.statusCode).toBe(200);
  const user = await db.select().from(schema.users).where(eq(schema.users.email, email)).get();
  const verification = await db
    .select()
    .from(schema.emailVerifications)
    .where(eq(schema.emailVerifications.userId, user!.id))
    .get();
  const verifyRes = await app.inject({
    method: 'POST',
    url: `/api/auth/password/verify-email/${verification!.token}`,
  });
  expect(verifyRes.statusCode).toBe(200);
  const setCookie = verifyRes.headers['set-cookie'];
  return Array.isArray(setCookie) ? setCookie.join('; ') : (setCookie ?? '');
}

async function createVenue(app: FastifyInstance, cookieStr: string, name = 'Hall A'): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/venues',
    headers: { cookie: cookieStr },
    payload: { name, data: SAMPLE_VENUE },
  });
  expect(res.statusCode).toBe(201);
  return (res.json() as { id: string }).id;
}

describe('venues — update (PATCH)', () => {
  let app: FastifyInstance;
  beforeEach(async () => { resetDb(); app = await buildApp(); });
  afterEach(async () => { await app.close(); });

  it('owner can update the venue name', async () => {
    const cookie = await registerAndLogin(app, 'alice@example.com');
    const id = await createVenue(app, cookie);

    const patch = await app.inject({
      method: 'PATCH',
      url: `/api/venues/${id}`,
      headers: { cookie },
      payload: { name: 'New Name' },
    });
    expect(patch.statusCode).toBe(200);
    expect((patch.json() as { name: string }).name).toBe('New Name');
    const get = await app.inject({ method: 'GET', url: `/api/venues/${id}`, headers: { cookie } });
    expect((get.json() as { name: string }).name).toBe('New Name');
    // The venue data is untouched by a rename.
    expect((get.json() as { data: typeof SAMPLE_VENUE }).data).toEqual(SAMPLE_VENUE);
    const list = await app.inject({ method: 'GET', url: '/api/venues', headers: { cookie } });
    expect((list.json() as { venues: { name: string }[] }).venues.map((v) => v.name)).toEqual(['New Name']);
  });

  it('rejects a blank name', async () => {
    const cookie = await registerAndLogin(app, 'alice@example.com');
    const id = await createVenue(app, cookie);
    const patch = await app.inject({
      method: 'PATCH',
      url: `/api/venues/${id}`,
      headers: { cookie },
      payload: { name: '   ' },
    });
    expect(patch.statusCode).toBe(400);
  });

  it('returns 404 for an unknown venue', async () => {
    const cookie = await registerAndLogin(app, 'alice@example.com');
    const patch = await app.inject({
      method: 'PATCH',
      url: '/api/venues/00000000-0000-0000-0000-000000000000',
      headers: { cookie },
      payload: { name: 'X' },
    });
    expect(patch.statusCode).toBe(404);
  });

  it('requires a session', async () => {
    const cookie = await registerAndLogin(app, 'alice@example.com');
    const id = await createVenue(app, cookie);
    const patch = await app.inject({ method: 'PATCH', url: `/api/venues/${id}`, payload: { name: 'X' } });
    expect(patch.statusCode).toBe(401);
  });

  it('owner can update the venue data', async () => {
    const cookie = await registerAndLogin(app, 'alice@example.com');
    const id = await createVenue(app, cookie);

    const patch = await app.inject({
      method: 'PATCH',
      url: `/api/venues/${id}`,
      headers: { cookie },
      payload: { data: UPDATED_VENUE },
    });
    expect(patch.statusCode).toBe(200);
    const get = await app.inject({ method: 'GET', url: `/api/venues/${id}`, headers: { cookie } });
    const body = get.json() as { data: typeof UPDATED_VENUE };
    expect(body.data.minWalkwayStuds).toBe(2);
  });

  it('non-owner cannot update venue', async () => {
    const aliceCookie = await registerAndLogin(app, 'alice@example.com');
    const bobCookie = await registerAndLogin(app, 'bob@example.com');
    const id = await createVenue(app, aliceCookie);

    const patch = await app.inject({
      method: 'PATCH',
      url: `/api/venues/${id}`,
      headers: { cookie: bobCookie },
      payload: { name: 'Stolen Name' },
    });
    expect(patch.statusCode).toBe(403);
    const get = await app.inject({ method: 'GET', url: `/api/venues/${id}`, headers: { cookie: aliceCookie } });
    expect((get.json() as { name: string }).name).toBe('Hall A');
  });
});

describe('venues — PATCH validation', () => {
  let app: FastifyInstance;
  beforeEach(async () => { resetDb(); app = await buildApp(); });
  afterEach(async () => { await app.close(); });

  it('rejects an empty body and non-object data', async () => {
    const cookie = await registerAndLogin(app, 'alice@example.com');
    const id = await createVenue(app, cookie);
    const empty = await app.inject({ method: 'PATCH', url: `/api/venues/${id}`, headers: { cookie }, payload: {} });
    expect(empty.statusCode).toBe(400);
    const bad = await app.inject({ method: 'PATCH', url: `/api/venues/${id}`, headers: { cookie }, payload: { data: 'nope' } });
    expect(bad.statusCode).toBe(400);
    const get = await app.inject({ method: 'GET', url: `/api/venues/${id}`, headers: { cookie } });
    expect((get.json() as { name: string; data: unknown }).data).toEqual(SAMPLE_VENUE);
  });

  it('trims the new name', async () => {
    const cookie = await registerAndLogin(app, 'alice@example.com');
    const id = await createVenue(app, cookie);
    const res = await app.inject({ method: 'PATCH', url: `/api/venues/${id}`, headers: { cookie }, payload: { name: '  Annex  ' } });
    expect(res.json()).toEqual({ ok: true, id, name: 'Annex' });
  });

  it('a non-member cannot rename an org venue', async () => {
    const aliceCookie = await registerAndLogin(app, 'alice@example.com');
    const eveCookie = await registerAndLogin(app, 'eve@example.com');
    await app.inject({ method: 'POST', url: '/api/orgs', headers: { cookie: aliceCookie }, payload: { name: 'Acme', slug: 'acme' } });
    const create = await app.inject({
      method: 'POST', url: '/api/venues', headers: { cookie: aliceCookie },
      payload: { name: 'Org Hall', data: SAMPLE_VENUE, orgSlug: 'acme' },
    });
    const id = (create.json() as { id: string }).id;
    const res = await app.inject({ method: 'PATCH', url: `/api/venues/${id}`, headers: { cookie: eveCookie }, payload: { name: 'X' } });
    expect(res.statusCode).toBe(403);
  });
});

describe('venues — duplicate name', () => {
  let app: FastifyInstance;
  beforeEach(async () => { resetDb(); app = await buildApp(); });
  afterEach(async () => { await app.close(); });

  it('allows two venues with the same name for different users', async () => {
    const aliceCookie = await registerAndLogin(app, 'alice@example.com');
    const bobCookie = await registerAndLogin(app, 'bob@example.com');
    const r1 = await app.inject({ method: 'POST', url: '/api/venues', headers: { cookie: aliceCookie }, payload: { name: 'Hall', data: SAMPLE_VENUE } });
    const r2 = await app.inject({ method: 'POST', url: '/api/venues', headers: { cookie: bobCookie }, payload: { name: 'Hall', data: SAMPLE_VENUE } });
    expect(r1.statusCode).toBe(201);
    expect(r2.statusCode).toBe(201);
    expect((r1.json() as { id: string }).id).not.toBe((r2.json() as { id: string }).id);
  });

  it('refuses a rename onto another of the same owner\'s venues, ignoring case (VenueLibraryPanel.cpp:249-252)', async () => {
    const cookie = await registerAndLogin(app, 'alice@example.com');
    await createVenue(app, cookie, 'Main Hall');
    const id = await createVenue(app, cookie, 'Annex');
    const res = await app.inject({ method: 'PATCH', url: `/api/venues/${id}`, headers: { cookie }, payload: { name: ' main hall ' } });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ error: 'name_taken' });
    // Its own name in another case is fine.
    const self = await app.inject({ method: 'PATCH', url: `/api/venues/${id}`, headers: { cookie }, payload: { name: 'ANNEX' } });
    expect(self.statusCode).toBe(200);
  });

  it('checks names per owner: other users and orgs don\'t clash', async () => {
    const aliceCookie = await registerAndLogin(app, 'alice@example.com');
    const bobCookie = await registerAndLogin(app, 'bob@example.com');
    await createVenue(app, bobCookie, 'Main Hall');
    await app.inject({ method: 'POST', url: '/api/orgs', headers: { cookie: aliceCookie }, payload: { name: 'Acme', slug: 'acme' } });
    await app.inject({ method: 'POST', url: '/api/venues', headers: { cookie: aliceCookie }, payload: { name: 'Org Hall', data: SAMPLE_VENUE, orgSlug: 'acme' } });
    const id = await createVenue(app, aliceCookie, 'Annex');
    for (const name of ['Main Hall', 'Org Hall']) {
      const res = await app.inject({ method: 'PATCH', url: `/api/venues/${id}`, headers: { cookie: aliceCookie }, payload: { name } });
      expect(res.statusCode, name).toBe(200);
    }
  });

  it('refuses a clash between two venues of one org', async () => {
    const cookie = await registerAndLogin(app, 'alice@example.com');
    await app.inject({ method: 'POST', url: '/api/orgs', headers: { cookie }, payload: { name: 'Acme', slug: 'acme' } });
    const make = async (name: string) =>
      ((await app.inject({ method: 'POST', url: '/api/venues', headers: { cookie }, payload: { name, data: SAMPLE_VENUE, orgSlug: 'acme' } })).json() as { id: string }).id;
    await make('Org Hall');
    const id = await make('Org Annex');
    const res = await app.inject({ method: 'PATCH', url: `/api/venues/${id}`, headers: { cookie }, payload: { name: 'org hall' } });
    expect(res.statusCode).toBe(409);
  });
});

describe('venues — org admin can update org venue', () => {
  let app: FastifyInstance;
  beforeEach(async () => { resetDb(); app = await buildApp(); });
  afterEach(async () => { await app.close(); });

  it('org admin can rename an org venue', async () => {
    const aliceCookie = await registerAndLogin(app, 'alice@example.com');
    await app.inject({ method: 'POST', url: '/api/orgs', headers: { cookie: aliceCookie }, payload: { name: 'Acme', slug: 'acme' } });
    const create = await app.inject({
      method: 'POST',
      url: '/api/venues',
      headers: { cookie: aliceCookie },
      payload: { name: 'Org Hall', data: SAMPLE_VENUE, orgSlug: 'acme' },
    });
    const id = (create.json() as { id: string }).id;

    const patch = await app.inject({
      method: 'PATCH',
      url: `/api/venues/${id}`,
      headers: { cookie: aliceCookie },
      payload: { name: 'Admin Update' },
    });
    expect(patch.statusCode).toBe(200);
  });

  it('org member (non-admin) gets 403 on update', async () => {
    const aliceCookie = await registerAndLogin(app, 'alice@example.com');
    const bobCookie = await registerAndLogin(app, 'bob@example.com');
    await app.inject({ method: 'POST', url: '/api/orgs', headers: { cookie: aliceCookie }, payload: { name: 'Acme', slug: 'acme' } });

    const create = await app.inject({
      method: 'POST',
      url: '/api/venues',
      headers: { cookie: aliceCookie },
      payload: { name: 'Org Hall', data: SAMPLE_VENUE, orgSlug: 'acme' },
    });
    const id = (create.json() as { id: string }).id;

    const bob = await db.select().from(schema.users).where(eq(schema.users.email, 'bob@example.com')).get();
    const acme = await db.select().from(schema.orgs).where(eq(schema.orgs.slug, 'acme')).get();
    await db.insert(schema.orgMembers).values({ orgId: acme!.id, userId: bob!.id, role: 'member', joinedAt: new Date() });

    const patch = await app.inject({
      method: 'PATCH',
      url: `/api/venues/${id}`,
      headers: { cookie: bobCookie },
      payload: { name: 'Member Update' },
    });
    expect(patch.statusCode).toBe(403);
  });
});

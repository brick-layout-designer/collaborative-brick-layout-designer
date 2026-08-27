import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, resetDb, schema } from '../test/helpers.js';
import { attachUser } from '../auth/cookie.js';
import { passwordRoutes } from './auth/password.js';
import { sessionRoutes } from './auth/session.js';
import { orgRoutes } from './orgs.js';
import { venueRoutes } from './venues.js';

const SAMPLE_VENUE = { name: 'Test Hall', enabled: true, edges: [], obstacles: [], minWalkwayStuds: 0 };

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
  const setCookie = res.headers['set-cookie'];
  return Array.isArray(setCookie) ? setCookie.join('; ') : (setCookie ?? '');
}

describe('venues', () => {
  let app: FastifyInstance;
  beforeEach(async () => {
    resetDb();
    app = await buildApp();
  });
  afterEach(async () => {
    await app.close();
  });

  it('unauthenticated requests are rejected', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/venues' });
    expect(res.statusCode).toBe(401);
  });

  it('creates a personal venue and lists it', async () => {
    const aliceCookie = await registerAndLogin(app, 'alice@example.com');

    const create = await app.inject({
      method: 'POST',
      url: '/api/venues',
      headers: { cookie: aliceCookie },
      payload: { name: 'Test Hall', data: SAMPLE_VENUE },
    });
    expect(create.statusCode).toBe(201);
    const { id } = create.json() as { id: string };
    expect(typeof id).toBe('string');

    const list = await app.inject({
      method: 'GET',
      url: '/api/venues',
      headers: { cookie: aliceCookie },
    });
    expect(list.statusCode).toBe(200);
    const venues = (list.json() as { venues: { id: string }[] }).venues;
    expect(venues.some((v) => v.id === id)).toBe(true);
  });

  it('GET /api/venues/:id returns venue data to owner', async () => {
    const aliceCookie = await registerAndLogin(app, 'alice@example.com');
    const create = await app.inject({
      method: 'POST',
      url: '/api/venues',
      headers: { cookie: aliceCookie },
      payload: { name: 'Hall A', data: SAMPLE_VENUE },
    });
    const { id } = create.json() as { id: string };

    const get = await app.inject({
      method: 'GET',
      url: `/api/venues/${id}`,
      headers: { cookie: aliceCookie },
    });
    expect(get.statusCode).toBe(200);
    const body = get.json() as { id: string; name: string; data: unknown };
    expect(body.id).toBe(id);
    expect(body.name).toBe('Hall A');
  });

  it('GET /api/venues/:id returns 403 for non-owner', async () => {
    const aliceCookie = await registerAndLogin(app, 'alice@example.com');
    const bobCookie = await registerAndLogin(app, 'bob@example.com');
    const create = await app.inject({
      method: 'POST',
      url: '/api/venues',
      headers: { cookie: aliceCookie },
      payload: { name: 'Private Hall', data: SAMPLE_VENUE },
    });
    const { id } = create.json() as { id: string };

    const res = await app.inject({
      method: 'GET',
      url: `/api/venues/${id}`,
      headers: { cookie: bobCookie },
    });
    expect(res.statusCode).toBe(403);
  });

  it('owner can delete their venue', async () => {
    const aliceCookie = await registerAndLogin(app, 'alice@example.com');
    const create = await app.inject({
      method: 'POST',
      url: '/api/venues',
      headers: { cookie: aliceCookie },
      payload: { name: 'Temp Hall', data: SAMPLE_VENUE },
    });
    const { id } = create.json() as { id: string };

    const del = await app.inject({
      method: 'DELETE',
      url: `/api/venues/${id}`,
      headers: { cookie: aliceCookie },
    });
    expect(del.statusCode).toBe(200);

    const get = await app.inject({
      method: 'GET',
      url: `/api/venues/${id}`,
      headers: { cookie: aliceCookie },
    });
    expect(get.statusCode).toBe(404);
  });

  it('non-owner cannot delete a personal venue', async () => {
    const aliceCookie = await registerAndLogin(app, 'alice@example.com');
    const bobCookie = await registerAndLogin(app, 'bob@example.com');
    const create = await app.inject({
      method: 'POST',
      url: '/api/venues',
      headers: { cookie: aliceCookie },
      payload: { name: 'Alice Hall', data: SAMPLE_VENUE },
    });
    const { id } = create.json() as { id: string };

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/venues/${id}`,
      headers: { cookie: bobCookie },
    });
    expect(res.statusCode).toBe(403);
  });

  it('POST returns 400 when name or data is missing', async () => {
    const aliceCookie = await registerAndLogin(app, 'alice@example.com');

    const noName = await app.inject({
      method: 'POST',
      url: '/api/venues',
      headers: { cookie: aliceCookie },
      payload: { data: SAMPLE_VENUE },
    });
    expect(noName.statusCode).toBe(400);

    const noData = await app.inject({
      method: 'POST',
      url: '/api/venues',
      headers: { cookie: aliceCookie },
      payload: { name: 'Hall' },
    });
    expect(noData.statusCode).toBe(400);
  });

  it('org-scoped venue: org members can read, non-members cannot', async () => {
    const aliceCookie = await registerAndLogin(app, 'alice@example.com');
    const bobCookie = await registerAndLogin(app, 'bob@example.com');
    await registerAndLogin(app, 'carol@example.com');

    await app.inject({
      method: 'POST',
      url: '/api/orgs',
      headers: { cookie: aliceCookie },
      payload: { name: 'Acme', slug: 'acme' },
    });

    const create = await app.inject({
      method: 'POST',
      url: '/api/venues',
      headers: { cookie: aliceCookie },
      payload: { name: 'Org Hall', data: SAMPLE_VENUE, orgSlug: 'acme' },
    });
    expect(create.statusCode).toBe(201);
    const { id } = create.json() as { id: string };

    // Alice (org admin) can read.
    const aliceGet = await app.inject({
      method: 'GET',
      url: `/api/venues/${id}`,
      headers: { cookie: aliceCookie },
    });
    expect(aliceGet.statusCode).toBe(200);

    // Add Bob as org member.
    const bob = await db.select().from(schema.users).where(eq(schema.users.email, 'bob@example.com')).get();
    const acme = await db.select().from(schema.orgs).where(eq(schema.orgs.slug, 'acme')).get();
    await db.insert(schema.orgMembers).values({ orgId: acme!.id, userId: bob!.id, role: 'member', joinedAt: new Date() });

    const bobGet = await app.inject({
      method: 'GET',
      url: `/api/venues/${id}`,
      headers: { cookie: bobCookie },
    });
    expect(bobGet.statusCode).toBe(200);

    // Carol is not a member — 403.
    const carolCookie = (await app.inject({
      method: 'POST',
      url: '/api/auth/password/login',
      payload: { email: 'carol@example.com', password: 'correct horse battery' },
    })).headers['set-cookie'];
    const carolGet = await app.inject({
      method: 'GET',
      url: `/api/venues/${id}`,
      headers: { cookie: Array.isArray(carolCookie) ? carolCookie.join('; ') : (carolCookie ?? '') },
    });
    expect(carolGet.statusCode).toBe(403);
  });

  it('org-scoped venue: only org admin can delete', async () => {
    const aliceCookie = await registerAndLogin(app, 'alice@example.com');
    const bobCookie = await registerAndLogin(app, 'bob@example.com');

    await app.inject({
      method: 'POST',
      url: '/api/orgs',
      headers: { cookie: aliceCookie },
      payload: { name: 'Acme', slug: 'acme' },
    });
    const create = await app.inject({
      method: 'POST',
      url: '/api/venues',
      headers: { cookie: aliceCookie },
      payload: { name: 'Org Hall', data: SAMPLE_VENUE, orgSlug: 'acme' },
    });
    const { id } = create.json() as { id: string };

    // Add Bob as non-admin org member.
    const bob = await db.select().from(schema.users).where(eq(schema.users.email, 'bob@example.com')).get();
    const acme = await db.select().from(schema.orgs).where(eq(schema.orgs.slug, 'acme')).get();
    await db.insert(schema.orgMembers).values({ orgId: acme!.id, userId: bob!.id, role: 'member', joinedAt: new Date() });

    // Bob (member, not admin) cannot delete.
    const bobDel = await app.inject({
      method: 'DELETE',
      url: `/api/venues/${id}`,
      headers: { cookie: bobCookie },
    });
    expect(bobDel.statusCode).toBe(403);

    // Alice (admin) can delete.
    const aliceDel = await app.inject({
      method: 'DELETE',
      url: `/api/venues/${id}`,
      headers: { cookie: aliceCookie },
    });
    expect(aliceDel.statusCode).toBe(200);
  });

  it('non-member cannot save to org', async () => {
    const aliceCookie = await registerAndLogin(app, 'alice@example.com');
    const bobCookie = await registerAndLogin(app, 'bob@example.com');

    await app.inject({
      method: 'POST',
      url: '/api/orgs',
      headers: { cookie: aliceCookie },
      payload: { name: 'Acme', slug: 'acme' },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/venues',
      headers: { cookie: bobCookie },
      payload: { name: 'Sneaky Hall', data: SAMPLE_VENUE, orgSlug: 'acme' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('org venues appear in the list for org members', async () => {
    const aliceCookie = await registerAndLogin(app, 'alice@example.com');
    const bobCookie = await registerAndLogin(app, 'bob@example.com');

    await app.inject({
      method: 'POST',
      url: '/api/orgs',
      headers: { cookie: aliceCookie },
      payload: { name: 'Acme', slug: 'acme' },
    });
    await app.inject({
      method: 'POST',
      url: '/api/venues',
      headers: { cookie: aliceCookie },
      payload: { name: 'Shared Hall', data: SAMPLE_VENUE, orgSlug: 'acme' },
    });

    const bob = await db.select().from(schema.users).where(eq(schema.users.email, 'bob@example.com')).get();
    const acme = await db.select().from(schema.orgs).where(eq(schema.orgs.slug, 'acme')).get();
    await db.insert(schema.orgMembers).values({ orgId: acme!.id, userId: bob!.id, role: 'member', joinedAt: new Date() });

    const list = await app.inject({
      method: 'GET',
      url: '/api/venues',
      headers: { cookie: bobCookie },
    });
    expect(list.statusCode).toBe(200);
    const venues = (list.json() as { venues: { name: string }[] }).venues;
    expect(venues.some((v) => v.name === 'Shared Hall')).toBe(true);
  });

  it('POST /api/venues returns 404 when orgSlug does not exist', async () => {
    const alice = await registerAndLogin(app, 'alice@example.com');
    const res = await app.inject({
      method: 'POST',
      url: '/api/venues',
      headers: { cookie: alice },
      payload: { name: 'Venue X', data: SAMPLE_VENUE, orgSlug: 'no-such-org' },
    });
    expect(res.statusCode).toBe(404);
  });

  it('DELETE /api/venues/:id returns 404 for an unknown id', async () => {
    const alice = await registerAndLogin(app, 'alice@example.com');
    const res = await app.inject({
      method: 'DELETE',
      url: '/api/venues/no-such-id',
      headers: { cookie: alice },
    });
    expect(res.statusCode).toBe(404);
  });

  it('deduplicates venues that appear in both personal and org lists', async () => {
    // This should not happen in practice but the code guards against it.
    // Create a personal venue and then make it org-visible at the same time
    // by assigning the user's personal + org membership so both queries return it.
    // Simplest path: just verify the list has no duplicates even when the user
    // is both the owner and an org member for the same org-owned venue (which
    // can't happen), so we settle for testing that a user with both personal
    // and org venues sees each at most once.
    const alice = await registerAndLogin(app, 'alice@example.com');
    await app.inject({
      method: 'POST',
      url: '/api/orgs',
      headers: { cookie: alice },
      payload: { name: 'DedupOrg' },
    });
    await app.inject({
      method: 'POST',
      url: '/api/venues',
      headers: { cookie: alice },
      payload: { name: 'Personal Hall', data: SAMPLE_VENUE },
    });
    const orgList = await app.inject({ method: 'GET', url: '/api/orgs', headers: { cookie: alice } });
    const orgSlug = (orgList.json() as { orgs: Array<{ slug: string }> }).orgs[0]!.slug;
    await app.inject({
      method: 'POST',
      url: '/api/venues',
      headers: { cookie: alice },
      payload: { name: 'Org Hall', data: SAMPLE_VENUE, orgSlug },
    });

    const list = await app.inject({ method: 'GET', url: '/api/venues', headers: { cookie: alice } });
    const { venues } = list.json() as { venues: Array<{ id: string }> };
    const ids = venues.map((v) => v.id);
    const unique = new Set(ids);
    expect(ids.length).toBe(unique.size); // no duplicates
    expect(ids.length).toBe(2);
  });
});

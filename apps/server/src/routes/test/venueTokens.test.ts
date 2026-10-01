// The desktop app reaches the venue library with an API token:
// venues:read lists and downloads, venues:write saves, renames and
// deletes, and a token without a venue scope gets nothing.

import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { issueToken, loginAs, resetDb } from '../../test/helpers.js';
import { attachUser } from '../../auth/cookie.js';
import { passwordRoutes } from '../auth/password.js';
import { deviceRoutes } from '../auth/device.js';
import { venueRoutes } from '../venues.js';

const HALL = { name: 'Grand Lobby', enabled: true, edges: [], obstacles: [], minWalkwayStuds: 0 };

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ bodyLimit: 10 * 1024 * 1024 });
  await app.register(cookie);
  app.addHook('preHandler', attachUser);
  await app.register(passwordRoutes);
  await app.register(deviceRoutes);
  await app.register(venueRoutes);
  return app;
}

describe('venue routes with API tokens', () => {
  let app: FastifyInstance;
  let user: { cookie: string; id: string };
  beforeEach(async () => {
    resetDb();
    app = await buildApp();
    user = await loginAs(app, 'desk@example.com');
  });
  afterEach(async () => {
    await app.close();
  });

  const bearer = (t: string) => ({ authorization: `Bearer ${t}` });

  it('venues:write saves, renames and deletes; venues:read lists and downloads', async () => {
    const writer = await issueToken(app, user.cookie, 'venues:write');
    const saved = await app.inject({ method: 'POST', url: '/api/venues', headers: bearer(writer), payload: { name: 'Grand Lobby', data: HALL } });
    expect(saved.statusCode).toBe(201);
    const id = (saved.json() as { id: string }).id;

    const reader = await issueToken(app, user.cookie, 'venues:read');
    const list = await app.inject({ method: 'GET', url: '/api/venues', headers: bearer(reader) });
    expect(list.statusCode).toBe(200);
    expect((list.json() as { venues: { id: string; name: string }[] }).venues).toMatchObject([{ id, name: 'Grand Lobby', ownerOrgId: null }]);
    const one = await app.inject({ method: 'GET', url: `/api/venues/${id}`, headers: bearer(reader) });
    expect(one.statusCode).toBe(200);
    expect((one.json() as { data: unknown }).data).toEqual(HALL);

    // Read alone can't change anything.
    expect((await app.inject({ method: 'PATCH', url: `/api/venues/${id}`, headers: bearer(reader), payload: { name: 'X' } })).statusCode).toBe(403);
    expect((await app.inject({ method: 'DELETE', url: `/api/venues/${id}`, headers: bearer(reader) })).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: '/api/venues', headers: bearer(reader), payload: { name: 'Y', data: HALL } })).statusCode).toBe(403);

    // Write implies read, and can rename and delete.
    expect((await app.inject({ method: 'GET', url: '/api/venues', headers: bearer(writer) })).statusCode).toBe(200);
    const renamed = await app.inject({ method: 'PATCH', url: `/api/venues/${id}`, headers: bearer(writer), payload: { name: 'Grand Lobby (east)' } });
    expect(renamed.statusCode).toBe(200);
    expect((await app.inject({ method: 'DELETE', url: `/api/venues/${id}`, headers: bearer(writer) })).statusCode).toBe(200);
  });

  it('a token without a venue scope is refused', async () => {
    const layoutsOnly = await issueToken(app, user.cookie, 'layouts:write parts:write');
    const res = await app.inject({ method: 'GET', url: '/api/venues', headers: bearer(layoutsOnly) });
    expect(res.statusCode).toBe(403);
  });
});

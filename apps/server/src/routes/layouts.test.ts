import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { db, resetDb, schema } from '../test/helpers.js';
import { attachUser } from '../auth/cookie.js';
import { passwordRoutes } from './auth/password.js';
import { sessionRoutes } from './auth/session.js';
import { layoutRoutes } from './layouts.js';

// Path to the vendored corpus inside packages/bbm. Tests import the same
// fixtures the bbm package's round-trip tests do.
const FIXTURES = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../../packages/bbm/tests/fixtures',
);

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ bodyLimit: 10 * 1024 * 1024 });
  await app.register(cookie);
  app.addHook('preHandler', attachUser);
  await app.register(passwordRoutes);
  await app.register(sessionRoutes);
  await app.register(layoutRoutes);
  return app;
}

async function registerAndLogin(
  app: FastifyInstance,
  email: string,
): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/password/register',
    payload: { email, password: 'correct horse battery', displayName: email },
  });
  expect(res.statusCode).toBe(200);
  const setCookie = res.headers['set-cookie'];
  return Array.isArray(setCookie) ? setCookie.join('; ') : (setCookie ?? '');
}

describe('layout routes', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    resetDb();
    app = await buildApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it('rejects unauthenticated /api/layouts', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/layouts' });
    expect(res.statusCode).toBe(401);
  });

  it('creates an empty layout, lists it, gets it', async () => {
    const cookieStr = await registerAndLogin(app, 'alice@example.com');

    const create = await app.inject({
      method: 'POST',
      url: '/api/layouts',
      headers: { cookie: cookieStr },
      payload: { title: 'My First Layout' },
    });
    expect(create.statusCode).toBe(201);
    const created = create.json() as { id: string; title: string };
    expect(created.title).toBe('My First Layout');

    const list = await app.inject({
      method: 'GET',
      url: '/api/layouts',
      headers: { cookie: cookieStr },
    });
    const listBody = list.json() as { layouts: { id: string; title: string }[] };
    expect(listBody.layouts).toHaveLength(1);
    expect(listBody.layouts[0]?.title).toBe('My First Layout');

    const get = await app.inject({
      method: 'GET',
      url: `/api/layouts/${created.id}`,
      headers: { cookie: cookieStr },
    });
    expect(get.statusCode).toBe(200);
    expect((get.json() as { role: string }).role).toBe('owner');
  });

  it('creates a layout from a real .bbm fixture and exports it back', async () => {
    const cookieStr = await registerAndLogin(app, 'bob@example.com');
    const bbm = readFileSync(resolve(FIXTURES, 'tight-corner.bbm'), 'utf8');

    const create = await app.inject({
      method: 'POST',
      url: '/api/layouts',
      headers: { cookie: cookieStr },
      payload: { title: 'Tight Corner', bbm },
    });
    expect(create.statusCode).toBe(201);
    const id = (create.json() as { id: string }).id;

    const exp = await app.inject({
      method: 'GET',
      url: `/api/layouts/${id}/export.bbm`,
      headers: { cookie: cookieStr },
    });
    expect(exp.statusCode).toBe(200);
    expect(exp.headers['content-type']).toContain('application/xml');
    expect(exp.headers['content-disposition']).toContain('Tight Corner.bbm');

    // Round-trip: the exported XML must parse back into the same model.
    const exported = exp.body;
    const { readBbm } = await import('@cld/bbm');
    const reparsed = readBbm(exported);
    const original = readBbm(bbm);
    expect(reparsed.map).toEqual(original.map);
  });

  it('rejects garbage .bbm payloads with 400', async () => {
    const cookieStr = await registerAndLogin(app, 'carol@example.com');
    const res = await app.inject({
      method: 'POST',
      url: '/api/layouts',
      headers: { cookie: cookieStr },
      payload: { title: 'broken', bbm: '<not-a-bbm/>' },
    });
    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: string }).error).toBe('bbm_parse_failed');
  });

  it('renames a layout (PATCH)', async () => {
    const cookieStr = await registerAndLogin(app, 'dave@example.com');
    const create = await app.inject({
      method: 'POST',
      url: '/api/layouts',
      headers: { cookie: cookieStr },
      payload: { title: 'Old Name' },
    });
    const id = (create.json() as { id: string }).id;

    const patch = await app.inject({
      method: 'PATCH',
      url: `/api/layouts/${id}`,
      headers: { cookie: cookieStr },
      payload: { title: 'New Name' },
    });
    expect(patch.statusCode).toBe(200);

    const get = await app.inject({
      method: 'GET',
      url: `/api/layouts/${id}`,
      headers: { cookie: cookieStr },
    });
    expect((get.json() as { layout: { title: string } }).layout.title).toBe('New Name');
  });

  it('rejects empty rename payloads', async () => {
    const cookieStr = await registerAndLogin(app, 'evie@example.com');
    const create = await app.inject({
      method: 'POST',
      url: '/api/layouts',
      headers: { cookie: cookieStr },
      payload: { title: 'Layout' },
    });
    const id = (create.json() as { id: string }).id;
    const patch = await app.inject({
      method: 'PATCH',
      url: `/api/layouts/${id}`,
      headers: { cookie: cookieStr },
      payload: { title: '   ' },
    });
    expect(patch.statusCode).toBe(400);
  });

  it('deletes a layout (DELETE)', async () => {
    const cookieStr = await registerAndLogin(app, 'frank@example.com');
    const create = await app.inject({
      method: 'POST',
      url: '/api/layouts',
      headers: { cookie: cookieStr },
      payload: { title: 'Delete me' },
    });
    const id = (create.json() as { id: string }).id;

    const del = await app.inject({
      method: 'DELETE',
      url: `/api/layouts/${id}`,
      headers: { cookie: cookieStr },
    });
    expect(del.statusCode).toBe(200);

    const get = await app.inject({
      method: 'GET',
      url: `/api/layouts/${id}`,
      headers: { cookie: cookieStr },
    });
    expect(get.statusCode).toBe(404);
  });

  it('does not leak existence: another user gets 404, not 403', async () => {
    // Security invariant: a non-collaborator must not learn that a layout
    // exists. Both `not_found` (no row) and `unauthorized` (row but no
    // role) MUST return 404 with the same body. A 403 here would leak
    // existence to an attacker probing IDs.
    const aliceCookie = await registerAndLogin(app, 'alice@example.com');
    const create = await app.inject({
      method: 'POST',
      url: '/api/layouts',
      headers: { cookie: aliceCookie },
      payload: { title: "Alice's Layout" },
    });
    const id = (create.json() as { id: string }).id;

    const bobCookie = await registerAndLogin(app, 'bob@example.com');
    const get = await app.inject({
      method: 'GET',
      url: `/api/layouts/${id}`,
      headers: { cookie: bobCookie },
    });
    expect(get.statusCode).toBe(404);
  });

  it('a viewer collaborator can read but cannot delete', async () => {
    const aliceCookie = await registerAndLogin(app, 'alice@example.com');
    const bobCookie = await registerAndLogin(app, 'bob@example.com');
    const create = await app.inject({
      method: 'POST',
      url: '/api/layouts',
      headers: { cookie: aliceCookie },
      payload: { title: "Alice's Layout" },
    });
    const id = (create.json() as { id: string }).id;

    // Manually grant Bob the 'viewer' role (no share API yet — Phase 5).
    const { eq } = await import('drizzle-orm');
    const bob = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.email, 'bob@example.com'))
      .get();
    expect(bob).toBeDefined();
    await db.insert(schema.layoutCollaborators).values({
      layoutId: id,
      userId: bob!.id,
      role: 'viewer',
      addedAt: new Date(),
    });

    // Bob can GET.
    const get = await app.inject({
      method: 'GET',
      url: `/api/layouts/${id}`,
      headers: { cookie: bobCookie },
    });
    expect(get.statusCode).toBe(200);
    expect((get.json() as { role: string }).role).toBe('viewer');

    // Bob cannot DELETE.
    const del = await app.inject({
      method: 'DELETE',
      url: `/api/layouts/${id}`,
      headers: { cookie: bobCookie },
    });
    expect(del.statusCode).toBe(403);
  });
});

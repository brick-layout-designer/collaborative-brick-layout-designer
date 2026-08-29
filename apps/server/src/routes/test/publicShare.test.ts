// Integration tests for public-share workflow:
//   POST   /api/layouts/:id/public-share   — enable (owner-only, idempotent)
//   DELETE /api/layouts/:id/public-share   — disable (owner-only)
//   GET    /api/public-layouts/:token      — anonymous metadata
//   GET    /api/public-layouts/:token/snapshot — anonymous binary download

import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import * as Y from 'yjs';
import { db, resetDb, schema } from '../../test/helpers.js';
import { attachUser } from '../../auth/cookie.js';
import { passwordRoutes } from '../auth/password.js';
import { sessionRoutes } from '../auth/session.js';
import { layoutRoutes } from '../layouts.js';
import { collaboratorRoutes } from '../collaborators.js';

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ bodyLimit: 10 * 1024 * 1024 });
  await app.register(cookie);
  app.addHook('preHandler', attachUser);
  await app.register(passwordRoutes);
  await app.register(sessionRoutes);
  await app.register(layoutRoutes);
  await app.register(collaboratorRoutes);
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

async function createLayout(app: FastifyInstance, cookieStr: string, title = 'My Layout'): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/layouts',
    headers: { cookie: cookieStr },
    payload: { title },
  });
  expect(res.statusCode).toBe(201);
  return (res.json() as { id: string }).id;
}

describe('public-share — enable', () => {
  let app: FastifyInstance;
  beforeEach(async () => { resetDb(); app = await buildApp(); });
  afterEach(async () => { await app.close(); });

  it('mints a token and returns it to the owner', async () => {
    const cookie = await registerAndLogin(app, 'alice@example.com');
    const id = await createLayout(app, cookie);

    const res = await app.inject({
      method: 'POST',
      url: `/api/layouts/${id}/public-share`,
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    const { token } = res.json() as { token: string };
    expect(token).toBeTruthy();
    expect(token.length).toBeGreaterThanOrEqual(16);
  });

  it('is idempotent — repeated enables return the same token', async () => {
    const cookie = await registerAndLogin(app, 'alice@example.com');
    const id = await createLayout(app, cookie);

    const r1 = await app.inject({ method: 'POST', url: `/api/layouts/${id}/public-share`, headers: { cookie } });
    const r2 = await app.inject({ method: 'POST', url: `/api/layouts/${id}/public-share`, headers: { cookie } });
    expect((r1.json() as { token: string }).token).toBe((r2.json() as { token: string }).token);
  });

  it('rejects a non-owner (editor) with 403', async () => {
    const ownerCookie = await registerAndLogin(app, 'alice@example.com');
    const editorCookie = await registerAndLogin(app, 'bob@example.com');
    const id = await createLayout(app, ownerCookie);
    const bob = await db.select().from(schema.users).where(eq(schema.users.email, 'bob@example.com')).get();
    await db.insert(schema.layoutCollaborators).values({ layoutId: id, userId: bob!.id, role: 'editor', addedAt: new Date() });

    const res = await app.inject({ method: 'POST', url: `/api/layouts/${id}/public-share`, headers: { cookie: editorCookie } });
    expect(res.statusCode).toBe(403);
  });

  it('returns 404 to a non-collaborator (existence-leak prevention)', async () => {
    const ownerCookie = await registerAndLogin(app, 'alice@example.com');
    const strangeCookie = await registerAndLogin(app, 'eve@example.com');
    const id = await createLayout(app, ownerCookie);

    const res = await app.inject({ method: 'POST', url: `/api/layouts/${id}/public-share`, headers: { cookie: strangeCookie } });
    expect(res.statusCode).toBe(404);
  });

  it('requires authentication', async () => {
    const cookie = await registerAndLogin(app, 'alice@example.com');
    const id = await createLayout(app, cookie);
    const res = await app.inject({ method: 'POST', url: `/api/layouts/${id}/public-share` });
    expect(res.statusCode).toBe(401);
  });
});

describe('public-share — disable', () => {
  let app: FastifyInstance;
  beforeEach(async () => { resetDb(); app = await buildApp(); });
  afterEach(async () => { await app.close(); });

  it('clears the token so anonymous access stops working', async () => {
    const cookie = await registerAndLogin(app, 'alice@example.com');
    const id = await createLayout(app, cookie);

    const { token } = (await app.inject({ method: 'POST', url: `/api/layouts/${id}/public-share`, headers: { cookie } })).json() as { token: string };
    expect(token).toBeTruthy();

    const del = await app.inject({ method: 'DELETE', url: `/api/layouts/${id}/public-share`, headers: { cookie } });
    expect(del.statusCode).toBe(200);

    // Anonymous access must now return 404.
    const anon = await app.inject({ method: 'GET', url: `/api/public-layouts/${token}` });
    expect(anon.statusCode).toBe(404);
  });

  it('rejects a non-owner with 403', async () => {
    const ownerCookie = await registerAndLogin(app, 'alice@example.com');
    const editorCookie = await registerAndLogin(app, 'bob@example.com');
    const id = await createLayout(app, ownerCookie);
    await app.inject({ method: 'POST', url: `/api/layouts/${id}/public-share`, headers: { cookie: ownerCookie } });
    const bob = await db.select().from(schema.users).where(eq(schema.users.email, 'bob@example.com')).get();
    await db.insert(schema.layoutCollaborators).values({ layoutId: id, userId: bob!.id, role: 'editor', addedAt: new Date() });

    const res = await app.inject({ method: 'DELETE', url: `/api/layouts/${id}/public-share`, headers: { cookie: editorCookie } });
    expect(res.statusCode).toBe(403);
  });
});

describe('public-share — anonymous viewer', () => {
  let app: FastifyInstance;
  beforeEach(async () => { resetDb(); app = await buildApp(); });
  afterEach(async () => { await app.close(); });

  it('GET /api/public-layouts/:token returns title, docVersion, hasSidecar', async () => {
    const cookie = await registerAndLogin(app, 'alice@example.com');
    const id = await createLayout(app, cookie, 'Public Layout');
    const { token } = (await app.inject({ method: 'POST', url: `/api/layouts/${id}/public-share`, headers: { cookie } })).json() as { token: string };

    const res = await app.inject({ method: 'GET', url: `/api/public-layouts/${token}` });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { layout: { title: string; docVersion: number; hasSidecar: boolean } };
    expect(body.layout.title).toBe('Public Layout');
    expect(typeof body.layout.docVersion).toBe('number');
    expect(body.layout.hasSidecar).toBe(false);
    // Response must not contain owner identifiers.
    expect((body.layout as Record<string, unknown>).ownerUserId).toBeUndefined();
  });

  it('returns 404 for an unknown or revoked token', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/public-layouts/totally-made-up-token' });
    expect(res.statusCode).toBe(404);
  });

  it('GET /api/public-layouts/:token/snapshot returns octet-stream', async () => {
    const cookie = await registerAndLogin(app, 'alice@example.com');
    const id = await createLayout(app, cookie, 'Snap Layout');
    const { token } = (await app.inject({ method: 'POST', url: `/api/layouts/${id}/public-share`, headers: { cookie } })).json() as { token: string };

    const res = await app.inject({ method: 'GET', url: `/api/public-layouts/${token}/snapshot` });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('application/octet-stream');
    expect(res.rawPayload.length).toBeGreaterThan(0);
    // Must be a valid Y.Doc.
    const doc = new Y.Doc();
    Y.applyUpdate(doc, new Uint8Array(res.rawPayload));
  });

  it('snapshot returns 404 for unknown token', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/public-layouts/bad-token/snapshot' });
    expect(res.statusCode).toBe(404);
  });

  it('GET /api/public-layouts/:token sets Cache-Control: no-store', async () => {
    const cookie = await registerAndLogin(app, 'alice@example.com');
    const id = await createLayout(app, cookie);
    const { token } = (await app.inject({ method: 'POST', url: `/api/layouts/${id}/public-share`, headers: { cookie } })).json() as { token: string };

    const res = await app.inject({ method: 'GET', url: `/api/public-layouts/${token}` });
    expect(res.headers['cache-control']).toBe('no-store');
  });
});

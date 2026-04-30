import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import * as Y from 'yjs';
import { db, resetDb, schema } from '../test/helpers.js';
import { attachUser } from '../auth/cookie.js';
import { passwordRoutes } from './auth/password.js';
import { sessionRoutes } from './auth/session.js';
import { orgRoutes } from './orgs.js';
import { moduleRoutes } from './modules.js';

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ bodyLimit: 10 * 1024 * 1024 });
  await app.register(cookie);
  app.addHook('preHandler', attachUser);
  await app.register(passwordRoutes);
  await app.register(sessionRoutes);
  await app.register(orgRoutes);
  await app.register(moduleRoutes);
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

describe('modules', () => {
  let app: FastifyInstance;
  beforeEach(async () => {
    resetDb();
    app = await buildApp();
  });
  afterEach(async () => {
    await app.close();
  });

  it('creates a module with a fresh Y.Doc snapshot', async () => {
    const aliceCookie = await registerAndLogin(app, 'alice@example.com');
    const create = await app.inject({
      method: 'POST',
      url: '/api/modules',
      headers: { cookie: aliceCookie },
      payload: { title: 'Crossover' },
    });
    expect(create.statusCode).toBe(201);
    const id = (create.json() as { id: string }).id;

    const snap = await app.inject({
      method: 'GET',
      url: `/api/modules/${id}/snapshot`,
      headers: { cookie: aliceCookie },
    });
    expect(snap.statusCode).toBe(200);
    expect(snap.headers['content-type']).toBe('application/octet-stream');
    expect(snap.rawPayload.length).toBeGreaterThan(0);
    // Bytes should be a valid Y.Doc snapshot (decodes without error).
    const doc = new Y.Doc();
    Y.applyUpdate(doc, new Uint8Array(snap.rawPayload));
  });

  it('PUT /snapshot bumps doc-version and persists bytes', async () => {
    const aliceCookie = await registerAndLogin(app, 'alice@example.com');
    const create = await app.inject({
      method: 'POST',
      url: '/api/modules',
      headers: { cookie: aliceCookie },
      payload: { title: 'M' },
    });
    const id = (create.json() as { id: string }).id;

    const initial = await app.inject({
      method: 'GET',
      url: `/api/modules/${id}/snapshot`,
      headers: { cookie: aliceCookie },
    });
    const doc = new Y.Doc();
    Y.applyUpdate(doc, new Uint8Array(initial.rawPayload));
    doc.getMap('meta').set('event', 'edited');
    const updated = Y.encodeStateAsUpdate(doc);

    const put = await app.inject({
      method: 'PUT',
      url: `/api/modules/${id}/snapshot`,
      headers: { cookie: aliceCookie, 'content-type': 'application/octet-stream' },
      payload: Buffer.from(updated),
    });
    expect(put.statusCode).toBe(200);

    const after = await app.inject({
      method: 'GET',
      url: `/api/modules/${id}/snapshot`,
      headers: { cookie: aliceCookie },
    });
    expect(after.headers['x-doc-version']).toBe('1');
    const reread = new Y.Doc();
    Y.applyUpdate(reread, new Uint8Array(after.rawPayload));
    expect(reread.getMap('meta').get('event')).toBe('edited');
  });

  it('viewers cannot PUT snapshot but can GET', async () => {
    const aliceCookie = await registerAndLogin(app, 'alice@example.com');
    const bobCookie = await registerAndLogin(app, 'bob@example.com');
    const create = await app.inject({
      method: 'POST',
      url: '/api/modules',
      headers: { cookie: aliceCookie },
      payload: { title: 'M' },
    });
    const id = (create.json() as { id: string }).id;
    const bob = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.email, 'bob@example.com'))
      .get();
    await db.insert(schema.moduleCollaborators).values({
      moduleId: id,
      userId: bob!.id,
      role: 'viewer',
      addedAt: new Date(),
    });

    const get = await app.inject({
      method: 'GET',
      url: `/api/modules/${id}/snapshot`,
      headers: { cookie: bobCookie },
    });
    expect(get.statusCode).toBe(200);

    const put = await app.inject({
      method: 'PUT',
      url: `/api/modules/${id}/snapshot`,
      headers: { cookie: bobCookie, 'content-type': 'application/octet-stream' },
      payload: Buffer.from([1]),
    });
    expect(put.statusCode).toBe(403);
  });

  it('demo accounts cannot invite to modules', async () => {
    const aliceCookie = await registerAndLogin(app, 'alice@example.com');
    const create = await app.inject({
      method: 'POST',
      url: '/api/modules',
      headers: { cookie: aliceCookie },
      payload: { title: 'M' },
    });
    const id = (create.json() as { id: string }).id;
    await db
      .update(schema.users)
      .set({ isDemoAccount: true })
      .where(eq(schema.users.email, 'alice@example.com'));
    const res = await app.inject({
      method: 'POST',
      url: `/api/modules/${id}/invites`,
      headers: { cookie: aliceCookie },
      payload: { email: 'bob@example.com', role: 'editor' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('non-owner cannot delete', async () => {
    const aliceCookie = await registerAndLogin(app, 'alice@example.com');
    const bobCookie = await registerAndLogin(app, 'bob@example.com');
    const create = await app.inject({
      method: 'POST',
      url: '/api/modules',
      headers: { cookie: aliceCookie },
      payload: { title: 'M' },
    });
    const id = (create.json() as { id: string }).id;
    const bob = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.email, 'bob@example.com'))
      .get();
    await db.insert(schema.moduleCollaborators).values({
      moduleId: id,
      userId: bob!.id,
      role: 'editor',
      addedAt: new Date(),
    });
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/modules/${id}`,
      headers: { cookie: bobCookie },
    });
    expect(res.statusCode).toBe(403);
  });

  it('org-owned modules: org admins are owners, members are editors', async () => {
    const aliceCookie = await registerAndLogin(app, 'alice@example.com');
    await app.inject({
      method: 'POST',
      url: '/api/orgs',
      headers: { cookie: aliceCookie },
      payload: { name: 'Acme', slug: 'acme' },
    });
    const create = await app.inject({
      method: 'POST',
      url: '/api/modules',
      headers: { cookie: aliceCookie },
      payload: { title: 'OrgMod', orgSlug: 'acme' },
    });
    const id = (create.json() as { id: string }).id;

    const aliceGet = await app.inject({
      method: 'GET',
      url: `/api/modules/${id}`,
      headers: { cookie: aliceCookie },
    });
    expect((aliceGet.json() as { role: string }).role).toBe('owner');

    // Add Bob as member.
    const bobCookie = await registerAndLogin(app, 'bob@example.com');
    const bob = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.email, 'bob@example.com'))
      .get();
    const acme = await db.select().from(schema.orgs).where(eq(schema.orgs.slug, 'acme')).get();
    await db.insert(schema.orgMembers).values({
      orgId: acme!.id,
      userId: bob!.id,
      role: 'member',
      joinedAt: new Date(),
    });
    const bobGet = await app.inject({
      method: 'GET',
      url: `/api/modules/${id}`,
      headers: { cookie: bobCookie },
    });
    expect((bobGet.json() as { role: string }).role).toBe('editor');
  });
});

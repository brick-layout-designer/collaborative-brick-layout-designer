import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import * as Y from 'yjs';
import { exportBbmFromDoc } from '@cld/ydoc';
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

  it('a new module opens ready for parts: it has a brick layer', async () => {
    const aliceCookie = await registerAndLogin(app, 'alice@example.com');
    const create = await app.inject({ method: 'POST', url: '/api/modules', headers: { cookie: aliceCookie }, payload: { title: 'Fresh' } });
    const id = (create.json() as { id: string }).id;
    const snap = await app.inject({ method: 'GET', url: `/api/modules/${id}/snapshot`, headers: { cookie: aliceCookie } });
    const doc = new Y.Doc();
    Y.applyUpdate(doc, new Uint8Array(snap.rawPayload));
    expect(exportBbmFromDoc(doc)?.layers.map((l) => l.type)).toContain('brick');
  });

  describe('thumbnails', () => {
    const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(40, 7)]);
    async function setup() {
      const aliceCookie = await registerAndLogin(app, 'alice@example.com');
      const create = await app.inject({ method: 'POST', url: '/api/modules', headers: { cookie: aliceCookie }, payload: { title: 'Pic' } });
      return { aliceCookie, id: (create.json() as { id: string }).id };
    }

    it('lists no picture until one is uploaded, then serves it with caching', async () => {
      const { aliceCookie, id } = await setup();
      let list = (await app.inject({ method: 'GET', url: '/api/modules', headers: { cookie: aliceCookie } })).json() as { modules: { id: string; thumbnailAt: number | null }[] };
      expect(list.modules[0]!.thumbnailAt).toBeNull();
      expect((await app.inject({ method: 'GET', url: `/api/modules/${id}/thumbnail`, headers: { cookie: aliceCookie } })).statusCode).toBe(404);

      const put = await app.inject({
        method: 'PUT',
        url: `/api/modules/${id}/thumbnail`,
        headers: { cookie: aliceCookie },
        payload: { mime: 'image/png', data: PNG.toString('base64') },
      });
      expect(put.statusCode).toBe(200);
      list = (await app.inject({ method: 'GET', url: '/api/modules', headers: { cookie: aliceCookie } })).json() as typeof list;
      expect(list.modules[0]!.thumbnailAt).toBe((put.json() as { thumbnailAt: number }).thumbnailAt);

      const got = await app.inject({ method: 'GET', url: `/api/modules/${id}/thumbnail`, headers: { cookie: aliceCookie } });
      expect(got.statusCode).toBe(200);
      expect(got.headers['content-type']).toBe('image/png');
      expect(got.headers['cache-control']).toContain('max-age');
      expect(Buffer.compare(got.rawPayload, PNG)).toBe(0);
      const again = await app.inject({ method: 'GET', url: `/api/modules/${id}/thumbnail`, headers: { cookie: aliceCookie, 'if-none-match': got.headers.etag as string } });
      expect(again.statusCode).toBe(304);
    });

    it('refuses a file that is not the picture it claims to be, and octet-stream', async () => {
      const { aliceCookie, id } = await setup();
      const bad = await app.inject({ method: 'PUT', url: `/api/modules/${id}/thumbnail`, headers: { cookie: aliceCookie }, payload: { mime: 'image/png', data: Buffer.from('<svg/>').toString('base64') } });
      expect(bad.statusCode).toBe(400);
      const wrongType = await app.inject({ method: 'PUT', url: `/api/modules/${id}/thumbnail`, headers: { cookie: aliceCookie }, payload: { mime: 'image/svg+xml', data: PNG.toString('base64') } });
      expect(wrongType.statusCode).toBe(400);
      const big = await app.inject({ method: 'PUT', url: `/api/modules/${id}/thumbnail`, headers: { cookie: aliceCookie }, payload: { mime: 'image/png', data: Buffer.concat([PNG, Buffer.alloc(600 * 1024)]).toString('base64') } });
      expect(big.statusCode).toBe(413);
      const raw = await app.inject({ method: 'PUT', url: `/api/modules/${id}/thumbnail`, headers: { cookie: aliceCookie, 'content-type': 'application/octet-stream' }, payload: PNG });
      expect(raw.statusCode).toBe(400);
    });

    it('only editors can set the picture; strangers cannot see it', async () => {
      const { aliceCookie, id } = await setup();
      const bobCookie = await registerAndLogin(app, 'bob@example.com');
      const stranger = await app.inject({ method: 'PUT', url: `/api/modules/${id}/thumbnail`, headers: { cookie: bobCookie }, payload: { mime: 'image/png', data: PNG.toString('base64') } });
      expect(stranger.statusCode).toBe(404);
      await app.inject({ method: 'POST', url: `/api/modules/${id}/invites`, headers: { cookie: aliceCookie }, payload: { email: 'bob@example.com', role: 'viewer' } });
      const viewer = await app.inject({ method: 'PUT', url: `/api/modules/${id}/thumbnail`, headers: { cookie: bobCookie }, payload: { mime: 'image/png', data: PNG.toString('base64') } });
      expect(viewer.statusCode).toBe(403);
    });

    it('counts the picture in storage', async () => {
      const { aliceCookie, id } = await setup();
      const { usageOf } = await import('../limits/limits.js');
      const alice = await db.select().from(schema.users).where(eq(schema.users.email, 'alice@example.com')).get();
      const before = usageOf({ kind: "user", id: alice!.id }).storageBytes;
      await app.inject({ method: 'PUT', url: `/api/modules/${id}/thumbnail`, headers: { cookie: aliceCookie }, payload: { mime: 'image/png', data: PNG.toString('base64') } });
      const after = usageOf({ kind: "user", id: alice!.id }).storageBytes;
      expect(after - before).toBe(PNG.length);
    });
  });

  it('club members only view club modules when the club keeps adding to admins', async () => {
    const aliceCookie = await registerAndLogin(app, 'alice@example.com');
    await app.inject({ method: 'POST', url: '/api/orgs', headers: { cookie: aliceCookie }, payload: { name: 'Acme', slug: 'acme' } });
    const id = ((await app.inject({ method: 'POST', url: '/api/modules', headers: { cookie: aliceCookie }, payload: { title: 'OrgMod', orgSlug: 'acme' } })).json() as { id: string }).id;
    const bobCookie = await registerAndLogin(app, 'bob@example.com');
    const bob = await db.select().from(schema.users).where(eq(schema.users.email, 'bob@example.com')).get();
    const acme = await db.select().from(schema.orgs).where(eq(schema.orgs.slug, 'acme')).get();
    await db.insert(schema.orgMembers).values({ orgId: acme!.id, userId: bob!.id, role: 'member', joinedAt: new Date() });
    await db.update(schema.orgs).set({ membersCanCreate: false }).where(eq(schema.orgs.id, acme!.id));
    const get = (await app.inject({ method: 'GET', url: `/api/modules/${id}`, headers: { cookie: bobCookie } })).json() as { role: string };
    expect(get.role).toBe('viewer');
    const list = (await app.inject({ method: 'GET', url: '/api/modules', headers: { cookie: bobCookie } })).json() as { modules: { id: string; role: string }[] };
    expect(list.modules.find((m) => m.id === id)?.role).toBe('viewer');
    const put = await app.inject({ method: 'PUT', url: `/api/modules/${id}/snapshot`, headers: { cookie: bobCookie, 'content-type': 'application/octet-stream' }, payload: Buffer.from([0, 0]) });
    expect(put.statusCode).toBe(403);
    // A manager still owns them.
    await db.update(schema.orgMembers).set({ role: 'manager' }).where(eq(schema.orgMembers.userId, bob!.id));
    expect(((await app.inject({ method: 'GET', url: `/api/modules/${id}`, headers: { cookie: bobCookie } })).json() as { role: string }).role).toBe('owner');
  });

  describe('versions', () => {
    async function setup() {
      const aliceCookie = await registerAndLogin(app, 'alice@example.com');
      const create = await app.inject({ method: 'POST', url: '/api/modules', headers: { cookie: aliceCookie }, payload: { title: 'Yard' } });
      return { aliceCookie, id: (create.json() as { id: string }).id };
    }
    const save = (cookie: string, id: string, bytes: Buffer, note?: string) =>
      app.inject({
        method: 'PUT',
        url: `/api/modules/${id}/snapshot${note === undefined ? '' : `?note=${encodeURIComponent(note)}`}`,
        headers: { cookie, 'content-type': 'application/octet-stream' },
        payload: bytes,
      });
    const versions = async (cookie: string, id: string) =>
      ((await app.inject({ method: 'GET', url: `/api/modules/${id}/versions`, headers: { cookie } })).json() as {
        versions: { version: number; note: string | null; author: string | null }[];
      }).versions;

    it('each save is a numbered version with its note and author; the list shows the newest', async () => {
      const { aliceCookie, id } = await setup();
      expect(await versions(aliceCookie, id)).toEqual([]);
      expect((await save(aliceCookie, id, Buffer.from([1, 1]), 'First go')).json()).toMatchObject({ version: 1 });
      expect((await save(aliceCookie, id, Buffer.from([2, 2]))).json()).toMatchObject({ version: 2 });
      const v = await versions(aliceCookie, id);
      expect(v.map((x) => x.version)).toEqual([2, 1]);
      expect(v[1]).toMatchObject({ note: 'First go', author: 'alice@example.com' });
      expect(v[0]!.note).toBeNull();
      const list = (await app.inject({ method: 'GET', url: '/api/modules', headers: { cookie: aliceCookie } })).json() as { modules: { latestVersion: number }[] };
      expect(list.modules[0]!.latestVersion).toBe(2);
      const one = await app.inject({ method: 'GET', url: `/api/modules/${id}/versions/1/snapshot`, headers: { cookie: aliceCookie } });
      expect(one.statusCode).toBe(200);
      expect([...one.rawPayload]).toEqual([1, 1]);
      expect((await save(aliceCookie, id, Buffer.from([3]), 'x'.repeat(301))).statusCode).toBe(400);
    });

    it('restoring makes the old contents current as a new version', async () => {
      const { aliceCookie, id } = await setup();
      await save(aliceCookie, id, Buffer.from([1, 1]));
      await save(aliceCookie, id, Buffer.from([2, 2]));
      const r = await app.inject({ method: 'POST', url: `/api/modules/${id}/versions/1/restore`, headers: { cookie: aliceCookie }, payload: {} });
      expect(r.json()).toMatchObject({ ok: true, version: 3 });
      const snap = await app.inject({ method: 'GET', url: `/api/modules/${id}/snapshot`, headers: { cookie: aliceCookie } });
      expect([...snap.rawPayload]).toEqual([1, 1]);
      expect((await versions(aliceCookie, id))[0]).toMatchObject({ version: 3, note: 'Restored version 1' });
    });

    it('keeps only the newest versions', async () => {
      const { aliceCookie, id } = await setup();
      const { MODULE_VERSIONS_KEPT } = await import('./modules.js');
      for (let i = 0; i < MODULE_VERSIONS_KEPT + 3; i++) await save(aliceCookie, id, Buffer.from([i + 1]));
      const v = await versions(aliceCookie, id);
      expect(v).toHaveLength(MODULE_VERSIONS_KEPT);
      expect(v.at(-1)!.version).toBe(4);
    });

    it('viewers see the history but cannot restore; strangers see nothing', async () => {
      const { aliceCookie, id } = await setup();
      await save(aliceCookie, id, Buffer.from([1]));
      const bobCookie = await registerAndLogin(app, 'bob@example.com');
      expect((await app.inject({ method: 'GET', url: `/api/modules/${id}/versions`, headers: { cookie: bobCookie } })).statusCode).toBe(404);
      expect((await app.inject({ method: 'GET', url: `/api/modules/${id}/versions/1/snapshot`, headers: { cookie: bobCookie } })).statusCode).toBe(404);
      await app.inject({ method: 'POST', url: `/api/modules/${id}/invites`, headers: { cookie: aliceCookie }, payload: { email: 'bob@example.com', role: 'viewer' } });
      expect(await versions(bobCookie, id)).toHaveLength(1);
      const r = await app.inject({ method: 'POST', url: `/api/modules/${id}/versions/1/restore`, headers: { cookie: bobCookie }, payload: {} });
      expect(r.statusCode).toBe(403);
    });

    it('versions count in storage', async () => {
      const { aliceCookie, id } = await setup();
      const { usageOf } = await import('../limits/limits.js');
      const alice = await db.select().from(schema.users).where(eq(schema.users.email, 'alice@example.com')).get();
      await save(aliceCookie, id, Buffer.alloc(1000, 1));
      const before = usageOf({ kind: 'user', id: alice!.id }).storageBytes;
      // Same-size contents again: the module's size stays, the new version adds its copy.
      await save(aliceCookie, id, Buffer.alloc(1000, 2));
      expect(usageOf({ kind: 'user', id: alice!.id }).storageBytes - before).toBe(1000);
    });

    it('the newest version gets the picture that is uploaded after the save', async () => {
      const { aliceCookie, id } = await setup();
      await save(aliceCookie, id, Buffer.from([1]));
      const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(20, 3)]);
      await app.inject({ method: 'PUT', url: `/api/modules/${id}/thumbnail`, headers: { cookie: aliceCookie }, payload: { mime: 'image/png', data: PNG.toString('base64') } });
      const pic = await app.inject({ method: 'GET', url: `/api/modules/${id}/versions/1/thumbnail`, headers: { cookie: aliceCookie } });
      expect(pic.statusCode).toBe(200);
      expect(pic.headers['content-type']).toBe('image/png');
    });
  });
});

import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, issueToken, resetDb, schema } from '../test/helpers.js';
import { attachUser } from '../auth/cookie.js';
import { passwordRoutes } from './auth/password.js';
import { sessionRoutes } from './auth/session.js';
import { orgRoutes } from './orgs.js';
import { moduleRoutes } from './modules.js';
import { catalogRoutes } from './catalog.js';
import { deviceRoutes } from './auth/device.js';
import { getPlatformSettings, PLATFORM_SETTINGS_ID } from '../auth/platformSettings.js';

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ bodyLimit: 10 * 1024 * 1024 });
  await app.register(cookie);
  await app.register(rateLimit, { global: false });
  app.addHook('preHandler', attachUser);
  await app.register(passwordRoutes);
  await app.register(sessionRoutes);
  await app.register(orgRoutes);
  await app.register(moduleRoutes);
  await app.register(catalogRoutes);
  await app.register(deviceRoutes);
  return app;
}

async function login(app: FastifyInstance, email: string): Promise<string> {
  await app.inject({ method: 'POST', url: '/api/auth/password/register', payload: { email, password: 'correct horse battery', displayName: email.split('@')[0] } });
  const user = await db.select().from(schema.users).where(eq(schema.users.email, email)).get();
  const v = await db.select().from(schema.emailVerifications).where(eq(schema.emailVerifications.userId, user!.id)).get();
  const res = await app.inject({ method: 'POST', url: `/api/auth/password/verify-email/${v!.token}` });
  const c = res.headers['set-cookie'];
  return Array.isArray(c) ? c.join('; ') : (c ?? '');
}

async function settings(patch: Partial<typeof schema.platformSettings.$inferInsert>) {
  await getPlatformSettings();
  await db.update(schema.platformSettings).set(patch).where(eq(schema.platformSettings.id, PLATFORM_SETTINGS_ID));
}

const userId = async (email: string) => (await db.select().from(schema.users).where(eq(schema.users.email, email)).get())!.id;

describe('public catalogs', () => {
  let app: FastifyInstance;
  let alice: string;
  let moduleId: string;
  beforeEach(async () => {
    resetDb();
    app = await buildApp();
    alice = await login(app, 'alice@example.com');
    moduleId = ((await app.inject({ method: 'POST', url: '/api/modules', headers: { cookie: alice }, payload: { title: 'Yard' } })).json() as { id: string }).id;
  });
  afterEach(async () => {
    await app.close();
  });

  const share = (cookie: string, extra: Record<string, unknown> = {}) =>
    app.inject({
      method: 'POST',
      url: '/api/catalog/submissions',
      headers: { cookie },
      payload: { kind: 'module', sourceId: moduleId, title: 'Freight yard', description: 'Six sidings', tags: ['Yard', 'freight', 'yard'], ...extra },
    });
  const list = async (cookie?: string, q = '') =>
    app.inject({ method: 'GET', url: `/api/catalog/items?kind=module${q}`, headers: cookie ? { cookie } : {} });
  async function moderator(email = 'mod@example.com') {
    const c = await login(app, email);
    await db.update(schema.users).set({ isModerator: true }).where(eq(schema.users.id, await userId(email)));
    return c;
  }
  const queue = async (cookie: string) =>
    ((await app.inject({ method: 'GET', url: '/api/moderation/items', headers: { cookie } })).json() as {
      queue: { versionId: string; itemId: string; submitter: { name: string; email?: string } | null; isUpdate: boolean }[];
      items: { id: string; status: string }[];
    });

  it('is off by default: every catalog route answers not found', async () => {
    const s = (await app.inject({ method: 'GET', url: '/api/catalog/settings' })).json() as Record<string, unknown>;
    expect(s).toMatchObject({ modules: false, parts: false, review: 'moderators', anonymousBrowse: true });
    expect((await list(alice)).statusCode).toBe(404);
    expect((await share(alice)).statusCode).toBe(404);
  });

  describe('with the module catalog on and review by moderators', () => {
    beforeEach(async () => settings({ moduleCatalogEnabled: true }));

    it("a moderator sees who sent it by name; only a site admin sees the address", async () => {
      expect((await share(alice)).statusCode).toBe(201);
      const q = await queue(await moderator());
      expect(q.queue[0]!.submitter).toEqual({ name: 'alice' });
      const admin = await login(app, 'admin@example.com');
      await db.update(schema.users).set({ isGlobalAdmin: true }).where(eq(schema.users.id, await userId('admin@example.com')));
      expect((await queue(admin)).queue[0]!.submitter).toEqual({ name: 'alice', email: 'alice@example.com' });
    });

    it('a submission waits for a moderator, who sees who sent it, and approves it', async () => {
      const r = await share(alice);
      expect(r.statusCode).toBe(201);
      expect(r.json()).toMatchObject({ status: 'in_review', version: 1 });
      expect((await list(alice)).json()).toEqual({ items: [] });
      // Alice isn't a moderator.
      expect((await app.inject({ method: 'GET', url: '/api/moderation/items', headers: { cookie: alice } })).statusCode).toBe(403);
      const mod = await moderator();
      const q = await queue(mod);
      expect(q.queue).toHaveLength(1);
      expect(q.queue[0]!.submitter?.name).toBe('alice');
      const ok = await app.inject({ method: 'POST', url: `/api/moderation/versions/${q.queue[0]!.versionId}/approve`, headers: { cookie: mod }, payload: {} });
      expect(ok.statusCode).toBe(200);
      const items = (await list(alice)).json() as { items: { title: string; tags: string[]; by: string }[] };
      expect(items.items).toHaveLength(1);
      expect(items.items[0]).toMatchObject({ title: 'Freight yard', tags: ['yard', 'freight'], by: 'alice' });
      const audit = await db.select().from(schema.auditEvents).where(eq(schema.auditEvents.eventType, 'catalog_approve')).all();
      expect(audit).toHaveLength(1);
    });

    it('a global admin moderates too: decline with a reason, then unpublish', async () => {
      const admin = await login(app, 'admin@example.com');
      await db.update(schema.users).set({ isGlobalAdmin: true }).where(eq(schema.users.id, await userId('admin@example.com')));
      await share(alice);
      let q = await queue(admin);
      await app.inject({ method: 'POST', url: `/api/moderation/versions/${q.queue[0]!.versionId}/decline`, headers: { cookie: admin }, payload: { reason: 'Picture missing' } });
      const mine = (await app.inject({ method: 'GET', url: '/api/catalog/mine', headers: { cookie: alice } })).json() as { items: { status: string; reason: string }[] };
      expect(mine.items[0]).toMatchObject({ status: 'declined', reason: 'Picture missing' });
      // Share again; approve; then take it down.
      await share(alice);
      q = await queue(admin);
      await app.inject({ method: 'POST', url: `/api/moderation/versions/${q.queue[0]!.versionId}/approve`, headers: { cookie: admin }, payload: {} });
      expect(((await list(alice)).json() as { items: unknown[] }).items).toHaveLength(1);
      const itemId = q.queue[0]!.itemId;
      expect((await app.inject({ method: 'POST', url: `/api/moderation/items/${itemId}/unpublish`, headers: { cookie: admin }, payload: { reason: 'Copyright' } })).statusCode).toBe(200);
      expect(((await list(alice)).json() as { items: unknown[] }).items).toHaveLength(0);
      expect((await app.inject({ method: 'POST', url: `/api/catalog/items/${itemId}/add`, headers: { cookie: alice }, payload: {} })).statusCode).toBe(404);
    });

    it('an update waits for review while the old version stays public; copies see "Update available" and get it', async () => {
      const mod = await moderator();
      await share(alice);
      let q = await queue(mod);
      await app.inject({ method: 'POST', url: `/api/moderation/versions/${q.queue[0]!.versionId}/approve`, headers: { cookie: mod }, payload: {} });
      const itemId = q.queue[0]!.itemId;
      // Bob adds it.
      const bob = await login(app, 'bob@example.com');
      const added = await app.inject({ method: 'POST', url: `/api/catalog/items/${itemId}/add`, headers: { cookie: bob }, payload: {} });
      expect(added.statusCode).toBe(201);
      const copyId = (added.json() as { id: string }).id;
      const bobsModules = (await app.inject({ method: 'GET', url: '/api/modules', headers: { cookie: bob } })).json() as { modules: { id: string; title: string }[] };
      expect(bobsModules.modules.map((m) => m.title)).toEqual(['Freight yard']);
      expect(((await list(bob)).json() as { items: { uses: number }[] }).items[0]!.uses).toBe(1);
      // Alice changes her module and shares the update.
      await app.inject({ method: 'PUT', url: `/api/modules/${moduleId}/snapshot`, headers: { cookie: alice, 'content-type': 'application/octet-stream' }, payload: Buffer.from([9, 9]) });
      expect(
        (
          await app.inject({ method: 'POST', url: '/api/catalog/submissions', headers: { cookie: alice }, payload: { kind: 'module', sourceId: moduleId, title: 'Freight yard', note: 'Longer' } })
        ).json(),
      ).toMatchObject({ version: 2, status: 'in_review' });
      // The update kept the description and tags it wasn't given.
      const shared = await db.select().from(schema.catalogItems).where(eq(schema.catalogItems.id, itemId)).get();
      expect(shared).toMatchObject({ description: 'Six sidings', tags: JSON.stringify(['yard', 'freight']) });
      // Still version 1 in the catalog until approved.
      expect(((await list(bob)).json() as { items: { version: number }[] }).items[0]!.version).toBe(1);
      q = await queue(mod);
      expect(q.queue[0]!.isUpdate).toBe(true);
      await app.inject({ method: 'POST', url: `/api/moderation/versions/${q.queue[0]!.versionId}/approve`, headers: { cookie: mod }, payload: {} });
      const copies = (await app.inject({ method: 'GET', url: '/api/catalog/copies', headers: { cookie: bob } })).json() as { copies: { copyId: string; updateAvailable: boolean }[] };
      expect(copies.copies[0]).toMatchObject({ copyId, updateAvailable: true });
      expect((await app.inject({ method: 'POST', url: `/api/catalog/copies/${copyId}/update`, headers: { cookie: bob }, payload: {} })).json()).toMatchObject({ version: 2 });
      const snap = await app.inject({ method: 'GET', url: `/api/modules/${copyId}/snapshot`, headers: { cookie: bob } });
      expect([...snap.rawPayload]).toEqual([9, 9]);
    });

    it('only the owner, or a club admin or manager, may share; the owner may withdraw', async () => {
      const bob = await login(app, 'bob@example.com');
      expect((await share(bob)).statusCode).toBe(403);
      // A club module: a plain member can't share it, a manager can.
      await app.inject({ method: 'POST', url: '/api/orgs', headers: { cookie: alice }, payload: { name: 'Acme', slug: 'acme' } });
      const club = (await app.inject({ method: 'POST', url: '/api/modules', headers: { cookie: alice }, payload: { title: 'Club yard', orgSlug: 'acme' } })).json() as { id: string };
      const acme = (await db.select().from(schema.orgs).where(eq(schema.orgs.slug, 'acme')).get())!;
      await db.insert(schema.orgMembers).values({ orgId: acme.id, userId: await userId('bob@example.com'), role: 'member', joinedAt: new Date() });
      const shareClub = (c: string) => app.inject({ method: 'POST', url: '/api/catalog/submissions', headers: { cookie: c }, payload: { kind: 'module', sourceId: club.id, title: 'Club yard' } });
      expect((await shareClub(bob)).statusCode).toBe(403);
      await db.update(schema.orgMembers).set({ role: 'manager' }).where(eq(schema.orgMembers.userId, await userId('bob@example.com')));
      const r = await shareClub(bob);
      expect(r.statusCode).toBe(201);
      const itemId = (r.json() as { id: string }).id;
      expect((await app.inject({ method: 'POST', url: `/api/catalog/items/${itemId}/withdraw`, headers: { cookie: alice }, payload: {} })).statusCode).toBe(200);
      const mod = await moderator();
      expect((await queue(mod)).queue.filter((x) => x.itemId === itemId)).toHaveLength(0);
    });

    it('anonymous visitors browse only when the setting allows, and can never add', async () => {
      await settings({ catalogReview: 'none' });
      const itemId = ((await share(alice)).json() as { id: string }).id;
      expect((await list()).statusCode).toBe(200);
      expect((await app.inject({ method: 'POST', url: `/api/catalog/items/${itemId}/add`, payload: {} })).statusCode).toBe(401);
      await settings({ catalogAnonymousBrowse: false });
      expect((await list()).statusCode).toBe(401);
      expect((await list(alice)).statusCode).toBe(200);
    });

    it('rejects bad input and rate-limits submissions', async () => {
      expect((await share(alice, { tags: Array.from({ length: 9 }, (_, i) => `t${i}`) })).statusCode).toBe(400);
      expect((await share(alice, { title: 'x'.repeat(81) })).statusCode).toBe(400);
      const codes: number[] = [];
      for (let i = 0; i < 12; i++) codes.push((await share(alice)).statusCode);
      expect(codes).toContain(429);
    });
  });

  it('the desktop app shares with its API token and sees what it shared', async () => {
    await settings({ moduleCatalogEnabled: true, catalogReview: 'none' });
    const token = await issueToken(app, alice);
    const auth = { authorization: `Bearer ${token}` };
    const r = await app.inject({ method: 'POST', url: '/api/catalog/submissions', headers: auth, payload: { kind: 'module', sourceId: moduleId, title: 'Freight yard' } });
    expect(r.statusCode).toBe(201);
    expect(r.json()).toMatchObject({ status: 'public' });
    const mine = await app.inject({ method: 'GET', url: '/api/catalog/mine', headers: auth });
    expect(mine.statusCode).toBe(200);
    expect((mine.json() as { items: { sourceId: string }[] }).items.map((i) => i.sourceId)).toEqual([moduleId]);
    // A token that may only read can't share.
    const reader = await issueToken(app, alice, 'layouts:read');
    const refused = await app.inject({ method: 'POST', url: '/api/catalog/submissions', headers: { authorization: `Bearer ${reader}` }, payload: { kind: 'module', sourceId: moduleId, title: 'Again' } });
    expect(refused.statusCode).toBe(403);
  });

  it('what is shared counts in the owner’s storage', async () => {
    await settings({ moduleCatalogEnabled: true });
    const { usageOf } = await import('../limits/limits.js');
    const subject = { kind: 'user' as const, id: await userId('alice@example.com') };
    const before = usageOf(subject).storageBytes;
    await share(alice);
    const doc = (await db.select().from(schema.modules).where(eq(schema.modules.id, moduleId)).get())!.docSnapshot as Uint8Array;
    expect(usageOf(subject).storageBytes - before).toBe(doc.length);
  });

  it('"Publish straight away" skips the queue, and moderators can still unpublish', async () => {
    await settings({ moduleCatalogEnabled: true, catalogReview: 'none' });
    const r = await share(alice);
    expect(r.json()).toMatchObject({ status: 'public' });
    expect(((await list(alice)).json() as { items: unknown[] }).items).toHaveLength(1);
    const mod = await moderator();
    expect((await queue(mod)).queue).toHaveLength(0);
    const itemId = (r.json() as { id: string }).id;
    await app.inject({ method: 'POST', url: `/api/moderation/items/${itemId}/unpublish`, headers: { cookie: mod }, payload: {} });
    expect(((await list(alice)).json() as { items: unknown[] }).items).toHaveLength(0);
  });

  it('lists give a picture address only for a version that has one (no 404s to ask for)', async () => {
    await settings({ moduleCatalogEnabled: true, catalogReview: 'none' });
    const bare = (await share(alice)).json() as { id: string };
    type Out = { id: string; previewUrl: string; coverUrl: string };
    const out = async () => ((await list()).json() as { items: Out[] }).items.find((i) => i.id === bare.id)!;
    expect(await out()).toMatchObject({ previewUrl: '', coverUrl: '' });
    // A picture arrives with the next version.
    const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
    expect((await app.inject({ method: 'PUT', url: `/api/modules/${moduleId}/thumbnail`, headers: { cookie: alice }, payload: { mime: 'image/png', data: png } })).statusCode).toBe(200);
    await share(alice);
    const pictured = await out();
    expect(pictured.previewUrl).toMatch(new RegExp(`^/api/catalog/items/${bare.id}/preview\\?v=2$`));
    expect(pictured.coverUrl).toBe(pictured.previewUrl);
    expect((await app.inject({ method: 'GET', url: pictured.previewUrl })).statusCode).toBe(200);
    // Its owner's list says the same.
    const mine = (await app.inject({ method: 'GET', url: '/api/catalog/mine', headers: { cookie: alice } })).json() as { items: { id: string; drawnUrl: string }[] };
    expect(mine.items.find((i) => i.id === bare.id)!.drawnUrl).toBe(pictured.previewUrl);
  });

  it('parts: share a custom part and add a copy; a taken part number is refused', async () => {
    await settings({ partsCatalogEnabled: true, catalogReview: 'none' });
    const now = new Date();
    const partId = 'p-1';
    await db.insert(schema.customParts).values({
      id: partId,
      partNumber: 'MY.1',
      displayName: 'My signal',
      ownerUserId: await userId('alice@example.com'),
      createdBy: await userId('alice@example.com'),
      xmlBlob: Buffer.from('<part/>'),
      spriteBlob: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1]),
      spriteMime: 'image/png',
      createdAt: now,
      updatedAt: now,
    });
    const r = await app.inject({ method: 'POST', url: '/api/catalog/submissions', headers: { cookie: alice }, payload: { kind: 'part', sourceId: partId, title: 'Signal' } });
    expect(r.statusCode).toBe(201);
    const itemId = (r.json() as { id: string }).id;
    const preview = await app.inject({ method: 'GET', url: `/api/catalog/items/${itemId}/preview` });
    expect(preview.headers['content-type']).toBe('image/png');
    const bob = await login(app, 'bob@example.com');
    expect((await app.inject({ method: 'POST', url: `/api/catalog/items/${itemId}/add`, headers: { cookie: bob }, payload: {} })).statusCode).toBe(201);
    const bobParts = await db.select().from(schema.customParts).where(eq(schema.customParts.ownerUserId, await userId('bob@example.com'))).all();
    expect(bobParts.map((p) => p.partNumber)).toEqual(['MY.1']);
    expect((await app.inject({ method: 'POST', url: `/api/catalog/items/${itemId}/add`, headers: { cookie: bob }, payload: {} })).statusCode).toBe(409);
  });
});

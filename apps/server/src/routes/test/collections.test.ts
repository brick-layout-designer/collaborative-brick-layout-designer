import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { db, resetDb, schema } from '../../test/helpers.js';
import { attachUser } from '../../auth/cookie.js';
import { passwordRoutes } from '../auth/password.js';
import { sessionRoutes } from '../auth/session.js';
import { orgRoutes } from '../orgs.js';
import { moduleRoutes } from '../modules.js';
import { catalogRoutes } from '../catalog.js';
import { collectionRoutes, coverOf, parseDraft } from '../collections.js';
import { getPlatformSettings, PLATFORM_SETTINGS_ID } from '../../auth/platformSettings.js';

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
  await app.register(collectionRoutes);
  return app;
}

async function login(app: FastifyInstance, email: string): Promise<string> {
  await app.inject({ method: 'POST', url: '/api/auth/password/register', payload: { email, password: 'correct horse battery', displayName: email } });
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

type Listed = { id: string; title: string; featured: boolean; official: boolean; itemCount: number; coverUrl: string | null };

describe('catalog collections', () => {
  let app: FastifyInstance;
  let alice: string;
  let bob: string;
  let mod: string;
  let yard: string; // public module items
  let shed: string;
  let signal: string; // a public part item

  const req = (method: 'GET' | 'POST' | 'PATCH', url: string, cookie?: string, payload?: unknown) =>
    app.inject({ method, url, headers: cookie ? { cookie } : {}, ...(payload !== undefined ? { payload: payload as Record<string, unknown> } : {}) });
  const list = async (cookie?: string) => (await req('GET', '/api/catalog/collections', cookie)).json() as { collections: Listed[] };
  const mine = async (cookie: string) =>
    ((await req('GET', '/api/catalog/collections/mine', cookie)).json() as {
      collections: { id: string; title: string; status: string; reason: string | null; pending: boolean; curatorNote: string | null; itemCount: number }[];
    }).collections;
  const create = (cookie: string, body: Record<string, unknown>) => req('POST', '/api/catalog/collections', cookie, body);
  const queue = async (cookie: string) =>
    ((await req('GET', '/api/moderation/collections', cookie)).json() as { queue: { id: string; title: string; isUpdate: boolean; email: string | null }[] }).queue;

  async function shareModule(cookie: string, title: string): Promise<string> {
    const m = (await req('POST', '/api/modules', cookie, { title })).json() as { id: string };
    const r = await req('POST', '/api/catalog/submissions', cookie, { kind: 'module', sourceId: m.id, title });
    return (r.json() as { id: string }).id;
  }

  beforeEach(async () => {
    resetDb();
    app = await buildApp();
    alice = await login(app, 'alice@example.com');
    bob = await login(app, 'bob@example.com');
    mod = await login(app, 'mod@example.com');
    await db.update(schema.users).set({ isModerator: true }).where(eq(schema.users.id, await userId('mod@example.com')));
    // Three public items, shared straight away; then review goes back on.
    await settings({ moduleCatalogEnabled: true, partsCatalogEnabled: true, catalogReview: 'none' });
    yard = await shareModule(alice, 'Freight yard');
    shed = await shareModule(alice, 'Engine shed');
    const now = new Date();
    await db.insert(schema.customParts).values({
      id: 'p-1',
      partNumber: 'MY.1',
      displayName: 'Signal',
      ownerUserId: await userId('alice@example.com'),
      createdBy: await userId('alice@example.com'),
      xmlBlob: Buffer.from('<part/>'),
      spriteBlob: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1]),
      spriteMime: 'image/png',
      createdAt: now,
      updatedAt: now,
    });
    signal = ((await req('POST', '/api/catalog/submissions', alice, { kind: 'part', sourceId: 'p-1', title: 'Signal' })).json() as { id: string }).id;
    await settings({ catalogReview: 'moderators' });
  });
  afterEach(async () => {
    await app.close();
  });

  it('with both catalogs off, collections are off too', async () => {
    await settings({ moduleCatalogEnabled: false, partsCatalogEnabled: false });
    expect((await req('GET', '/api/catalog/collections', alice)).statusCode).toBe(404);
    expect((await create(mod, { title: 'Town', itemIds: [yard] })).statusCode).toBe(404);
  });

  it('a moderator’s collection is official and public at once, and can be featured', async () => {
    const r = await create(mod, { title: 'Starter town', description: 'Begin here', itemIds: [signal, yard, shed] });
    expect(r.statusCode).toBe(201);
    expect(r.json()).toMatchObject({ status: 'public' });
    const id = (r.json() as { id: string }).id;
    const l = await list(bob);
    expect(l.collections).toHaveLength(1);
    // The cover is the first module's picture, not the part that comes first.
    expect(l.collections[0]).toMatchObject({ title: 'Starter town', official: true, featured: false, itemCount: 3, coverUrl: `/api/catalog/items/${yard}/preview?v=1` });
    expect((await req('POST', `/api/moderation/collections/${id}/feature`, mod, { featured: true })).statusCode).toBe(200);
    expect((await list(bob)).collections[0]!.featured).toBe(true);
    const audit = await db.select().from(schema.auditEvents).where(eq(schema.auditEvents.resourceId, id)).all();
    expect(audit.map((a) => a.eventType).sort()).toEqual(['collection_feature', 'collection_submit']);
  });

  it('featured collections come first', async () => {
    await settings({ catalogReview: 'none' });
    const user = (await (await create(bob, { title: 'Bob’s picks', itemIds: [yard] })).json()) as { id: string };
    const off = (await (await create(mod, { title: 'Official', itemIds: [shed] })).json()) as { id: string };
    const feat = (await (await create(mod, { title: 'Featured', itemIds: [shed] })).json()) as { id: string };
    await req('POST', `/api/moderation/collections/${feat.id}/feature`, mod, { featured: true });
    expect((await list(bob)).collections.map((c) => c.id)).toEqual([feat.id, off.id, user.id]);
  });

  it('only moderators feature, and only official collections', async () => {
    await settings({ catalogReview: 'none' });
    const own = ((await create(bob, { title: 'Bob’s picks', itemIds: [yard] })).json() as { id: string }).id;
    const off = ((await create(mod, { title: 'Official', itemIds: [yard] })).json() as { id: string }).id;
    expect((await req('POST', `/api/moderation/collections/${off}/feature`, bob, { featured: true })).statusCode).toBe(403);
    expect((await req('POST', `/api/moderation/collections/${own}/feature`, mod, { featured: true })).statusCode).toBe(409);
    expect((await list(bob)).collections.every((c) => !c.featured)).toBe(true);
    // A global admin moderates too.
    const admin = await login(app, 'admin@example.com');
    await db.update(schema.users).set({ isGlobalAdmin: true }).where(eq(schema.users.id, await userId('admin@example.com')));
    expect((await req('POST', `/api/moderation/collections/${off}/feature`, admin, { featured: true })).statusCode).toBe(200);
  });

  it('review by moderators: a submission waits, is approved, and each edit is reviewed again', async () => {
    const r = await create(bob, { title: 'Yard basics', itemIds: [yard, shed] });
    expect(r.json()).toMatchObject({ status: 'in_review' });
    const id = (r.json() as { id: string }).id;
    expect((await list(alice)).collections).toEqual([]);
    expect((await req('GET', `/api/catalog/collections/${id}`, alice)).statusCode).toBe(404);
    expect((await mine(bob))[0]).toMatchObject({ status: 'in_review' });
    // Bob can't approve his own; the moderator sees it with his email.
    expect((await req('POST', `/api/moderation/collections/${id}/approve`, bob, {})).statusCode).toBe(403);
    const q = await queue(mod);
    expect(q).toEqual([expect.objectContaining({ id, title: 'Yard basics', isUpdate: false, email: 'bob@example.com' })]);
    expect((await req('POST', `/api/moderation/collections/${id}/approve`, mod, {})).statusCode).toBe(200);
    expect((await list(alice)).collections.map((c) => c.title)).toEqual(['Yard basics']);

    // An edit waits; the public collection stays as it was meanwhile.
    const e = await req('PATCH', `/api/catalog/collections/${id}`, bob, { title: 'Yard essentials', itemIds: [shed] });
    expect(e.json()).toMatchObject({ status: 'public', pending: true });
    expect((await list(alice)).collections[0]).toMatchObject({ title: 'Yard basics', itemCount: 2 });
    expect((await queue(mod))[0]).toMatchObject({ id, title: 'Yard essentials', isUpdate: true });
    // Declined: still public as before, and Bob sees why.
    await req('POST', `/api/moderation/collections/${id}/decline`, mod, { reason: 'Keep the yard in it' });
    expect((await mine(bob))[0]).toMatchObject({ status: 'public', pending: false, reason: 'Keep the yard in it', title: 'Yard basics' });
    // Edit again; approved this time.
    await req('PATCH', `/api/catalog/collections/${id}`, bob, { title: 'Yard essentials' });
    await req('POST', `/api/moderation/collections/${id}/approve`, mod, {});
    expect((await list(alice)).collections[0]).toMatchObject({ title: 'Yard essentials', itemCount: 2 });
    expect((await mine(bob))[0]).toMatchObject({ reason: null, pending: false });
  });

  it('a declined first submission says why; editing it sends it back for review', async () => {
    const id = ((await create(bob, { title: 'Stuff', itemIds: [yard] })).json() as { id: string }).id;
    await req('POST', `/api/moderation/collections/${id}/decline`, mod, { reason: 'Say what it is for' });
    expect((await mine(bob))[0]).toMatchObject({ status: 'declined', reason: 'Say what it is for' });
    expect((await req('PATCH', `/api/catalog/collections/${id}`, bob, { description: 'A goods yard' })).json()).toMatchObject({ status: 'in_review', pending: false });
    expect(await queue(mod)).toHaveLength(1);
  });

  it('review off: a submission and its edits publish at once', async () => {
    await settings({ catalogReview: 'none' });
    const r = await create(bob, { title: 'Yard basics', itemIds: [yard] });
    expect(r.json()).toMatchObject({ status: 'public' });
    const id = (r.json() as { id: string }).id;
    expect((await list(alice)).collections[0]).toMatchObject({ title: 'Yard basics', official: false });
    await req('PATCH', `/api/catalog/collections/${id}`, bob, { title: 'Yard essentials' });
    expect((await list(alice)).collections[0]!.title).toBe('Yard essentials');
    expect(await queue(mod)).toEqual([]);
  });

  it('review off still reviews a collection a moderator unpublished', async () => {
    await settings({ catalogReview: 'none' });
    const id = ((await create(bob, { title: 'Yard basics', itemIds: [yard] })).json() as { id: string }).id;
    await req('POST', `/api/moderation/collections/${id}/unpublish`, mod, { reason: 'Spam' });
    expect((await list(alice)).collections).toEqual([]);
    expect((await req('PATCH', `/api/catalog/collections/${id}`, bob, { title: 'Again' })).json()).toMatchObject({ status: 'in_review' });
    expect((await list(alice)).collections).toEqual([]);
  });

  it('only the curator edits; only public items go in', async () => {
    const id = ((await create(bob, { title: 'Mine', itemIds: [yard] })).json() as { id: string }).id;
    expect((await req('PATCH', `/api/catalog/collections/${id}`, alice, { title: 'Hijacked' })).statusCode).toBe(403);
    // A moderator can't rewrite someone's own collection either (only official ones).
    expect((await req('PATCH', `/api/catalog/collections/${id}`, mod, { title: 'Hijacked' })).statusCode).toBe(403);
    // An item still in review can't go in.
    const m = (await req('POST', '/api/modules', alice, { title: 'Waiting' })).json() as { id: string };
    const waiting = ((await req('POST', '/api/catalog/submissions', alice, { kind: 'module', sourceId: m.id })).json() as { id: string }).id;
    const bad = await create(bob, { title: 'Bad', itemIds: [yard, waiting] });
    expect(bad.statusCode).toBe(400);
    expect(bad.json()).toMatchObject({ error: 'item_not_public', itemId: waiting });
    expect((await create(bob, { title: 'Empty', itemIds: [] })).json()).toMatchObject({ error: 'collection_empty' });
    expect((await create(bob, { title: 'Cover', itemIds: [yard], coverItemId: shed })).statusCode).toBe(400);
  });

  it('the demo account can’t submit or edit collections', async () => {
    await db.update(schema.users).set({ isDemoAccount: true }).where(eq(schema.users.id, await userId('bob@example.com')));
    const r = await create(bob, { title: 'Demo', itemIds: [yard] });
    expect(r.statusCode).toBe(403);
    expect(r.json()).toMatchObject({ error: 'demo_account_cannot_submit' });
    expect(await db.select().from(schema.catalogCollections).all()).toEqual([]);
    const id = ((await create(mod, { title: 'Official', itemIds: [yard] })).json() as { id: string }).id;
    await db.update(schema.users).set({ isDemoAccount: true }).where(eq(schema.users.id, await userId('mod@example.com')));
    expect((await req('PATCH', `/api/catalog/collections/${id}`, mod, { title: 'Demo edit' })).statusCode).toBe(403);
  });

  it('an item that leaves the catalog drops out of every collection; the curator is told; an empty one is hidden', async () => {
    await settings({ catalogReview: 'none' });
    const a = ((await create(bob, { title: 'Two things', itemIds: [yard, shed], coverItemId: shed })).json() as { id: string }).id;
    const b = ((await create(mod, { title: 'Just the shed', itemIds: [shed] })).json() as { id: string }).id;
    // A moderator unpublishes the shed.
    await req('POST', `/api/moderation/items/${shed}/unpublish`, mod, { reason: 'Copied' });
    const l = await list(alice);
    expect(l.collections.map((c) => c.id)).toEqual([a]);
    expect(l.collections[0]).toMatchObject({ itemCount: 1, coverUrl: `/api/catalog/items/${yard}/preview?v=1` });
    expect((await req('GET', `/api/catalog/collections/${b}`, alice)).statusCode).toBe(404);
    const note = (await mine(bob))[0]!.curatorNote;
    expect(note).toContain('“Engine shed” was unpublished');
    expect(await db.select().from(schema.catalogCollectionItems).where(eq(schema.catalogCollectionItems.itemId, shed)).all()).toEqual([]);
    // The note can be put away.
    await req('POST', `/api/catalog/collections/${a}/dismiss-note`, bob, {});
    expect((await mine(bob))[0]!.curatorNote).toBeNull();
    // Its owner withdraws the yard: the last one, so the collection is hidden.
    await req('POST', `/api/catalog/items/${yard}/withdraw`, alice, {});
    expect((await list(alice)).collections).toEqual([]);
    expect((await mine(bob))[0]!.curatorNote).toContain('“Freight yard” was withdrawn');
    const removed = await db.select().from(schema.auditEvents).where(eq(schema.auditEvents.eventType, 'collection_item_removed')).all();
    expect(removed).toHaveLength(3);
  });

  it('an item that leaves is also taken out of a change waiting for review', async () => {
    const id = ((await create(mod, { title: 'Official', itemIds: [yard] })).json() as { id: string }).id;
    await req('PATCH', `/api/catalog/collections/${id}`, bob, { title: 'x' }); // not his: refused
    await db.update(schema.catalogCollections).set({ ownerUserId: await userId('bob@example.com'), official: false }).where(eq(schema.catalogCollections.id, id));
    await req('PATCH', `/api/catalog/collections/${id}`, bob, { itemIds: [yard, shed] });
    await req('POST', `/api/moderation/items/${shed}/unpublish`, mod, {});
    const row = await db.select().from(schema.catalogCollections).where(eq(schema.catalogCollections.id, id)).get();
    expect(parseDraft(row!.pending)?.itemIds).toEqual([yard]);
  });

  it('collections follow the catalog switches', async () => {
    await settings({ catalogReview: 'none' });
    const id = ((await create(bob, { title: 'Mixed', itemIds: [signal, yard] })).json() as { id: string }).id;
    await settings({ partsCatalogEnabled: false });
    const detail = (await req('GET', `/api/catalog/collections/${id}`, alice)).json() as { items: { id: string }[] };
    expect(detail.items.map((i) => i.id)).toEqual([yard]);
    await settings({ partsCatalogEnabled: true, moduleCatalogEnabled: false });
    expect((await list(alice)).collections[0]).toMatchObject({ itemCount: 1, coverUrl: `/api/catalog/items/${signal}/preview?v=1` });
    // A parts-free collection disappears with the module catalog.
    await settings({ moduleCatalogEnabled: true });
    const onlyModules = ((await create(bob, { title: 'Modules', itemIds: [yard] })).json() as { id: string }).id;
    await settings({ moduleCatalogEnabled: false });
    expect((await list(alice)).collections.map((c) => c.id)).toEqual([id]);
    expect((await req('GET', `/api/catalog/collections/${onlyModules}`, alice)).statusCode).toBe(404);
  });

  it('Add all copies every item once: what you already have is skipped', async () => {
    await settings({ catalogReview: 'none' });
    const id = ((await create(mod, { title: 'Starter', itemIds: [yard, shed, signal] })).json() as { id: string }).id;
    // Bob already added the yard by itself.
    expect((await req('POST', `/api/catalog/items/${yard}/add`, bob, {})).statusCode).toBe(201);
    const r = await req('POST', `/api/catalog/collections/${id}/add`, bob, {});
    expect(r.statusCode).toBe(201);
    const out = r.json() as { added: { itemId: string; kind: string }[]; skipped: string[]; failed: unknown[] };
    expect(out.added.map((a) => a.itemId).sort()).toEqual([shed, signal].sort());
    expect(out.skipped).toEqual([yard]);
    expect(out.failed).toEqual([]);
    const again = (await req('POST', `/api/catalog/collections/${id}/add`, bob, {})).json() as { added: unknown[]; skipped: string[] };
    expect(again.added).toEqual([]);
    expect(again.skipped).toHaveLength(3);
    const bobId = await userId('bob@example.com');
    expect(await db.select().from(schema.modules).where(eq(schema.modules.ownerUserId, bobId)).all()).toHaveLength(2);
    expect(await db.select().from(schema.customParts).where(eq(schema.customParts.ownerUserId, bobId)).all()).toHaveLength(1);
    // A copy Bob deleted no longer counts: Add all brings it back.
    const shedCopy = (await db.select().from(schema.catalogCopies).where(and(eq(schema.catalogCopies.itemId, shed), eq(schema.catalogCopies.userId, bobId))).get())!;
    await db.delete(schema.modules).where(eq(schema.modules.id, shedCopy.copyId));
    const third = (await req('POST', `/api/catalog/collections/${id}/add`, bob, {})).json() as { added: { itemId: string }[] };
    expect(third.added.map((a) => a.itemId)).toEqual([shed]);
  });

  it('Add all to a club skips what the club has, not what you have', async () => {
    await settings({ catalogReview: 'none' });
    const id = ((await create(mod, { title: 'Starter', itemIds: [yard] })).json() as { id: string }).id;
    await req('POST', `/api/catalog/items/${yard}/add`, bob, {});
    const club = (await req('POST', '/api/orgs', bob, { name: 'Bob club', slug: 'bob-club' })).json() as { slug: string };
    const r = (await req('POST', `/api/catalog/collections/${id}/add`, bob, { orgSlug: club.slug })).json() as { added: unknown[] };
    expect(r.added).toHaveLength(1);
    // Alice isn't in the club.
    expect((await req('POST', `/api/catalog/collections/${id}/add`, alice, { orgSlug: club.slug })).statusCode).toBe(403);
  });

  it('a hidden collection can’t be added', async () => {
    const id = ((await create(bob, { title: 'Waiting', itemIds: [yard] })).json() as { id: string }).id;
    expect((await req('POST', `/api/catalog/collections/${id}/add`, alice, {})).statusCode).toBe(404);
  });

  it('withdrawing takes it down; owners see their items are in collections', async () => {
    await settings({ catalogReview: 'none' });
    const id = ((await create(bob, { title: 'Picks', itemIds: [yard] })).json() as { id: string }).id;
    const items = ((await req('GET', '/api/catalog/mine', alice)).json() as { items: { id: string; collections: number }[] }).items;
    expect(items.find((i) => i.id === yard)?.collections).toBe(1);
    expect(items.find((i) => i.id === shed)?.collections).toBe(0);
    expect((await req('POST', `/api/catalog/collections/${id}/withdraw`, alice, {})).statusCode).toBe(403);
    expect((await req('POST', `/api/catalog/collections/${id}/withdraw`, bob, {})).statusCode).toBe(200);
    expect((await list(alice)).collections).toEqual([]);
    expect((await mine(bob))[0]!.status).toBe('withdrawn');
  });

  it('coverOf: the chosen item, else the first module, else the first item', () => {
    const items = [
      { id: 'p', kind: 'part' as const, publicVersion: 1 },
      { id: 'm', kind: 'module' as const, publicVersion: 2 },
    ];
    expect(coverOf(null, items)).toBe('/api/catalog/items/m/preview?v=2');
    expect(coverOf('p', items)).toBe('/api/catalog/items/p/preview?v=1');
    expect(coverOf(null, [items[0]!])).toBe('/api/catalog/items/p/preview?v=1');
    expect(coverOf(null, [])).toBeNull();
  });
});

// Club and private collections, and items reviewed apart from the
// collection's text. The site-wide flow is in collections.test.ts.

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
import { moduleTransferRoutes } from '../moduleTransfers.js';
import { customPartRoutes } from '../customParts.js';
import { catalogRoutes } from '../catalog.js';
import { collectionRoutes } from '../collections.js';
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
  await app.register(moduleTransferRoutes);
  await app.register(customPartRoutes);
  await app.register(catalogRoutes);
  await app.register(collectionRoutes);
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

type Detail = {
  collection: { id: string; title: string; audience: string; status: string; canEdit: boolean; pending: unknown; clubInfo: { name: string } | null; curatorNote: string | null; canRemove: boolean };
  items: { id: string; source: string; kind: string; review?: { state: string } | null }[];
};
type ClubList = { clubs: { slug: string; canCurate: boolean; collections: { id: string; title: string; pinned: boolean; itemCount: number }[] }[] };

describe('club and private collections', () => {
  let app: FastifyInstance;
  let ada: string; // ArkLUG admin
  let max: string; // ArkLUG manager
  let mel: string; // ArkLUG member
  let out: string; // not in the club
  let mod: string; // site moderator, not in the club
  let yard: string; // a public catalog item (out's)
  let clubMod: string; // a module in ArkLUG's library
  let orgId: string;

  const req = (method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, cookie?: string, payload?: unknown) =>
    app.inject({ method, url, headers: cookie ? { cookie } : {}, ...(payload !== undefined ? { payload: payload as Record<string, unknown> } : {}) });
  const create = (cookie: string, body: Record<string, unknown>) => req('POST', '/api/catalog/collections', cookie, body);
  const detail = async (cookie: string, id: string) => (await req('GET', `/api/catalog/collections/${id}`, cookie)).json() as Detail;
  const publicList = async (cookie: string) => ((await req('GET', '/api/catalog/collections', cookie)).json() as { collections: { id: string; itemCount: number; by: string }[] }).collections;
  const clubList = async (cookie: string, slug?: string) => (await req('GET', `/api/catalog/collections/clubs${slug ? `?club=${slug}` : ''}`, cookie)).json() as ClubList;
  const itemQueue = async () => ((await req('GET', '/api/moderation/items', mod)).json() as { queue: { itemId: string; versionId: string; title: string }[] }).queue;
  const collectionQueue = async () => ((await req('GET', '/api/moderation/collections', mod)).json() as { queue: { id: string; title: string; old: { title: string } | null }[] }).queue;
  const clubEntries = (moduleId = clubMod) => [
    { source: 'catalog', id: yard },
    { source: 'library', id: moduleId },
  ];
  const newClubCollection = async (body: Record<string, unknown> = {}) => {
    const r = await create(ada, { title: 'ArkLUG show standards', clubSlug: 'arklug', audience: 'private', entries: clubEntries(), ...body });
    expect(r.statusCode).toBe(201);
    return (r.json() as { id: string }).id;
  };

  beforeEach(async () => {
    resetDb();
    app = await buildApp();
    ada = await login(app, 'ada@example.com');
    max = await login(app, 'max@example.com');
    mel = await login(app, 'mel@example.com');
    out = await login(app, 'out@example.com');
    mod = await login(app, 'mod@example.com');
    await db.update(schema.users).set({ isModerator: true }).where(eq(schema.users.id, await userId('mod@example.com')));
    await settings({ moduleCatalogEnabled: true, partsCatalogEnabled: true, catalogReview: 'none' });
    const m = (await req('POST', '/api/modules', out, { title: 'Freight yard' })).json() as { id: string };
    yard = ((await req('POST', '/api/catalog/submissions', out, { kind: 'module', sourceId: m.id, title: 'Freight yard' })).json() as { id: string }).id;
    await settings({ catalogReview: 'moderators' });
    orgId = ((await req('POST', '/api/orgs', ada, { name: 'ArkLUG', slug: 'arklug' })).json() as { id: string }).id;
    const now = new Date();
    for (const [email, role] of [
      ['max@example.com', 'manager'],
      ['mel@example.com', 'member'],
    ] as const) {
      await db.insert(schema.orgMembers).values({ orgId, userId: await userId(email), role, joinedAt: now });
    }
    clubMod = ((await req('POST', '/api/modules', ada, { title: 'Show corner', orgSlug: 'arklug' })).json() as { id: string }).id;
  });
  afterEach(async () => {
    await app.close();
  });

  it('a private club collection: no review of its text or its items, and only members see it', async () => {
    const id = await newClubCollection();
    const row = (await db.select().from(schema.catalogCollections).where(eq(schema.catalogCollections.id, id)).get())!;
    expect(row).toMatchObject({ orgId, audience: 'private', status: 'public', official: false, pending: null });
    // Nothing went for review: no catalog item for the club's module, nothing queued.
    expect(await db.select().from(schema.catalogItems).where(eq(schema.catalogItems.sourceId, clubMod)).all()).toEqual([]);
    expect(await collectionQueue()).toEqual([]);
    expect(await itemQueue()).toEqual([]);
    expect(await publicList(out)).toEqual([]);
    // A member sees both items, in order, by the club's name.
    const d = await detail(mel, id);
    expect(d.collection).toMatchObject({ audience: 'private', canEdit: false, clubInfo: { name: 'ArkLUG' } });
    expect(d.items.map((i) => [i.source, i.id])).toEqual([
      ['catalog', yard],
      ['library', clubMod],
    ]);
    // Members don't see review states in a private collection.
    expect(d.items[1]!.review).toBeUndefined();
    expect((await clubList(mel)).clubs).toEqual([expect.objectContaining({ slug: 'arklug', canCurate: false, collections: [expect.objectContaining({ id, itemCount: 2 })] })]);
    // Outsiders: not found, everywhere.
    expect((await req('GET', `/api/catalog/collections/${id}`, out)).statusCode).toBe(404);
    expect((await clubList(out)).clubs).toEqual([]);
    expect((await req('GET', '/api/catalog/collections/clubs?club=arklug', out)).statusCode).toBe(404);
  });

  it('adding an item to a private collection creates no review', async () => {
    const id = await newClubCollection({ entries: [{ source: 'catalog', id: yard }] });
    const r = await req('PATCH', `/api/catalog/collections/${id}`, max, { entries: clubEntries() });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ status: 'public', audience: 'private', pending: false, submitted: [] });
    expect(await db.select().from(schema.catalogItems).where(eq(schema.catalogItems.sourceId, clubMod)).all()).toEqual([]);
    expect(await itemQueue()).toEqual([]);
    expect(await collectionQueue()).toEqual([]);
    // A personal private collection likewise.
    const own = ((await req('POST', '/api/modules', mel, { title: 'My bridge' })).json() as { id: string }).id;
    const p = await create(mel, { title: 'For me', audience: 'private', entries: [{ source: 'library', id: own }] });
    expect(p.statusCode).toBe(201);
    expect(p.json()).toMatchObject({ status: 'public', audience: 'private', submitted: [] });
    expect(await db.select().from(schema.catalogItems).where(eq(schema.catalogItems.sourceId, own)).all()).toEqual([]);
  });

  it('non-members get 404 on every route; members get 403 on the curators’ ones', async () => {
    const id = await newClubCollection();
    for (const [method, url, body] of [
      ['GET', `/api/catalog/collections/${id}`, undefined],
      ['PATCH', `/api/catalog/collections/${id}`, { title: 'Hijacked' }],
      ['POST', `/api/catalog/collections/${id}/items`, { itemId: yard }],
      ['POST', `/api/catalog/collections/${id}/add`, {}],
      ['POST', `/api/catalog/collections/${id}/withdraw`, {}],
      ['POST', `/api/catalog/collections/${id}/dismiss-note`, {}],
      ['DELETE', `/api/catalog/collections/${id}`, undefined],
    ] as const) {
      expect([method, url, (await req(method, url, out, body)).statusCode]).toEqual([method, url, 404]);
    }
    expect((await create(out, { title: 'Sneaky', clubSlug: 'arklug', audience: 'private', entries: [{ source: 'catalog', id: yard }] })).statusCode).toBe(404);
    // A member sees it but can't curate it.
    for (const [method, url, body] of [
      ['PATCH', `/api/catalog/collections/${id}`, { title: 'Hijacked' }],
      ['PATCH', `/api/catalog/collections/${id}`, { pinned: true }],
      ['POST', `/api/catalog/collections/${id}/items`, { itemId: yard }],
      ['DELETE', `/api/catalog/collections/${id}`, undefined],
    ] as const) {
      expect([method, url, (await req(method, url, mel, body)).statusCode]).toEqual([method, url, 403]);
    }
    expect((await create(mel, { title: 'Mine', clubSlug: 'arklug', audience: 'private', entries: [{ source: 'catalog', id: yard }] })).statusCode).toBe(403);
    expect((await req('POST', `/api/catalog/collections/${id}/dismiss-note`, mel, {})).statusCode).toBe(404);
    // Nothing changed.
    expect((await detail(ada, id)).collection.title).toBe('ArkLUG show standards');
    // Someone else's module can't go in, and a club module can't go in a personal one.
    const outMod = ((await req('POST', '/api/modules', out, { title: 'Not theirs' })).json() as { id: string }).id;
    expect((await req('PATCH', `/api/catalog/collections/${id}`, ada, { entries: clubEntries(outMod) })).json()).toMatchObject({ error: 'module_not_in_club', itemId: outMod });
    expect((await create(ada, { title: 'Mine', audience: 'private', entries: [{ source: 'library', id: clubMod }] })).json()).toMatchObject({ error: 'module_not_yours' });
  });

  it('managers curate and pin; pinned ones come first; a member who leaves loses it', async () => {
    const a = await newClubCollection({ title: 'Older' });
    await new Promise((r) => setTimeout(r, 5));
    const b = await newClubCollection({ title: 'Newer' });
    expect((await clubList(mel)).clubs[0]!.collections.map((c) => c.id)).toEqual([b, a]);
    expect((await req('PATCH', `/api/catalog/collections/${a}`, max, { pinned: true })).statusCode).toBe(200);
    expect((await clubList(mel, 'arklug')).clubs[0]!.collections.map((c) => [c.id, c.pinned])).toEqual([
      [a, true],
      [b, false],
    ]);
    expect((await req('PATCH', `/api/catalog/collections/${b}`, max, { title: 'Show standards' })).statusCode).toBe(200);
    const audit = await db.select().from(schema.auditEvents).where(eq(schema.auditEvents.resourceId, a)).all();
    expect(audit.map((e) => e.eventType)).toContain('collection_pin');
    // A personal collection can't be pinned.
    const own = ((await create(mel, { title: 'Mine', audience: 'private', entries: [{ source: 'catalog', id: yard }] })).json() as { id: string }).id;
    expect((await req('PATCH', `/api/catalog/collections/${own}`, mel, { pinned: true })).statusCode).toBe(400);
    // Mel leaves the club.
    await db.delete(schema.orgMembers).where(and(eq(schema.orgMembers.orgId, orgId), eq(schema.orgMembers.userId, await userId('mel@example.com'))));
    expect((await req('GET', `/api/catalog/collections/${a}`, mel)).statusCode).toBe(404);
    expect((await req('POST', `/api/catalog/collections/${a}/add`, mel, {})).statusCode).toBe(404);
    expect((await clubList(mel)).clubs).toEqual([]);
  });

  it('Add all: a member gets the club’s modules and the catalog items once; the club skips its own', async () => {
    const id = await newClubCollection();
    const r = await req('POST', `/api/catalog/collections/${id}/add`, mel, {});
    expect(r.statusCode).toBe(201);
    const first = r.json() as { added: { itemId: string; kind: string; id: string }[]; skipped: string[]; failed: unknown[] };
    expect(first.added.map((a) => a.itemId).sort()).toEqual([yard, clubMod].sort());
    const melId = await userId('mel@example.com');
    const copy = await db.select().from(schema.modules).where(and(eq(schema.modules.ownerUserId, melId), eq(schema.modules.copiedFromId, clubMod))).get();
    expect(copy?.title).toBe('Show corner');
    const again = (await req('POST', `/api/catalog/collections/${id}/add`, mel, {})).json() as { added: unknown[]; skipped: string[] };
    expect(again.added).toEqual([]);
    expect(again.skipped.sort()).toEqual([yard, clubMod].sort());
    // To the club: its own module is already there; the catalog item is copied once.
    const toClub = (await req('POST', `/api/catalog/collections/${id}/add`, max, { orgSlug: 'arklug' })).json() as { added: { itemId: string }[]; skipped: string[] };
    expect(toClub.added.map((a) => a.itemId)).toEqual([yard]);
    expect(toClub.skipped).toEqual([clubMod]);
    expect(((await req('POST', `/api/catalog/collections/${id}/add`, max, { orgSlug: 'arklug' })).json() as { added: unknown[] }).added).toEqual([]);
  });

  it('a club module that is deleted or moves to another club drops out, and the curators are told', async () => {
    const id = await newClubCollection({ coverModuleId: clubMod });
    const other = ((await req('POST', '/api/modules', ada, { title: 'Second', orgSlug: 'arklug' })).json() as { id: string }).id;
    await req('PATCH', `/api/catalog/collections/${id}`, ada, { entries: [...clubEntries(), { source: 'library', id: other }] });
    expect((await req('DELETE', `/api/modules/${clubMod}`, ada)).statusCode).toBe(200);
    let d = await detail(max, id);
    expect(d.items.map((i) => i.id)).toEqual([yard, other]);
    expect(d.collection.curatorNote).toContain('“Show corner” was deleted');
    expect((await db.select().from(schema.catalogCollections).where(eq(schema.catalogCollections.id, id)).get())!.coverModuleId).toBeNull();
    // Moved to another club Ada runs.
    await req('POST', '/api/orgs', ada, { name: 'Other club', slug: 'other-club' });
    expect((await req('POST', `/api/modules/${other}/transfer`, ada, { recipientOrgSlug: 'other-club' })).statusCode).toBe(200);
    d = await detail(max, id);
    expect(d.items.map((i) => i.id)).toEqual([yard]);
    expect(d.collection.curatorNote).toContain('“Second” was moved to another club');
    // Members don't see the note.
    expect((await detail(mel, id)).collection.curatorNote).toBeNull();
    // A module that's no longer the club's, however it left, isn't shown.
    const third = ((await req('POST', '/api/modules', ada, { title: 'Third', orgSlug: 'arklug' })).json() as { id: string }).id;
    await req('PATCH', `/api/catalog/collections/${id}`, ada, { entries: [{ source: 'catalog', id: yard }, { source: 'library', id: third }] });
    expect((await detail(mel, id)).items.map((i) => i.id)).toEqual([yard, third]);
    await db.update(schema.modules).set({ ownerOrgId: null, ownerUserId: await userId('ada@example.com') }).where(eq(schema.modules.id, third));
    expect((await detail(mel, id)).items.map((i) => i.id)).toEqual([yard]);
  });

  it('site moderators see and remove club collections (audit-logged), but can’t unpublish or feature a private one', async () => {
    const id = await newClubCollection();
    const d = await detail(mod, id);
    expect(d.collection).toMatchObject({ canEdit: false, canRemove: true });
    const listed = (await req('GET', '/api/moderation/collections', mod)).json() as { clubCollections: { id: string; by: string }[] };
    expect(listed.clubCollections).toEqual([expect.objectContaining({ id, by: 'ArkLUG' })]);
    expect((await req('GET', '/api/moderation/collections', ada)).statusCode).toBe(403);
    expect((await req('POST', `/api/moderation/collections/${id}/remove`, ada, { reason: 'x' })).statusCode).toBe(403);
    expect((await req('POST', `/api/moderation/collections/${id}/unpublish`, mod, { reason: 'x' })).statusCode).toBe(409);
    expect((await req('POST', `/api/moderation/collections/${id}/feature`, mod, { featured: true })).statusCode).toBe(409);
    expect((await req('PATCH', `/api/catalog/collections/${id}`, mod, { title: 'Moderated' })).statusCode).toBe(403);
    // Only club collections are removed this way (others are unpublished).
    const own = ((await create(mel, { title: 'Mel’s', audience: 'private', entries: [{ source: 'catalog', id: yard }] })).json() as { id: string }).id;
    expect((await req('POST', `/api/moderation/collections/${own}/remove`, mod, { reason: 'x' })).statusCode).toBe(404);
    expect((await req('POST', `/api/moderation/collections/${id}/remove`, mod, { reason: 'Abuse' })).statusCode).toBe(200);
    expect(await db.select().from(schema.catalogCollections).where(eq(schema.catalogCollections.id, id)).get()).toBeUndefined();
    const audit = await db.select().from(schema.auditEvents).where(and(eq(schema.auditEvents.resourceId, id), eq(schema.auditEvents.eventType, 'collection_remove'))).get();
    expect(audit?.payload).toContain('Abuse');
  });

  it('made public: the text goes for review, and each module not in the catalog goes for its own', async () => {
    const id = await newClubCollection();
    const r = await req('PATCH', `/api/catalog/collections/${id}`, ada, { audience: 'everyone' });
    expect(r.json()).toMatchObject({ status: 'in_review', audience: 'everyone', submitted: [clubMod] });
    // Two separate reviews: the collection's text, and the module as a catalog item.
    expect(await collectionQueue()).toEqual([expect.objectContaining({ id, title: 'ArkLUG show standards', old: null })]);
    const iq = await itemQueue();
    expect(iq.map((q) => q.title)).toEqual(['Show corner']);
    const item = (await db.select().from(schema.catalogItems).where(eq(schema.catalogItems.sourceId, clubMod)).get())!;
    expect(item).toMatchObject({ ownerOrgId: orgId, status: 'in_review' });
    expect(await publicList(out)).toEqual([]);
    // The curator sees the module waiting.
    expect((await detail(max, id)).items[1]!.review).toEqual({ state: 'in_review', reason: null });
    // The text is approved: public, with only the item that's public itself.
    await req('POST', `/api/moderation/collections/${id}/approve`, mod, {});
    expect(await publicList(out)).toEqual([expect.objectContaining({ id, itemCount: 1, by: 'ArkLUG' })]);
    expect((await detail(out, id)).items.map((i) => i.id)).toEqual([yard]);
    // The module is approved: now it shows too, as its catalog item.
    await req('POST', `/api/moderation/versions/${iq[0]!.versionId}/approve`, mod, {});
    expect((await detail(out, id)).items.map((i) => [i.source, i.id])).toEqual([
      ['catalog', yard],
      ['catalog', item.id],
    ]);
    // Members still see the club's own module.
    expect((await detail(mel, id)).items[1]).toMatchObject({ source: 'library', id: clubMod });
    // Made private again: out of the catalog at once.
    expect((await req('PATCH', `/api/catalog/collections/${id}`, max, { audience: 'private' })).json()).toMatchObject({ status: 'public', audience: 'private' });
    expect(await publicList(out)).toEqual([]);
    expect((await req('GET', `/api/catalog/collections/${id}`, out)).statusCode).toBe(404);
    // Public again: back through review.
    expect((await req('PATCH', `/api/catalog/collections/${id}`, max, { audience: 'everyone' })).json()).toMatchObject({ status: 'in_review', submitted: [] });
  });

  it('a module a moderator declined isn’t shared again when the collection goes public; its curators see why', async () => {
    const r = (await req('POST', '/api/catalog/submissions', ada, { kind: 'module', sourceId: clubMod })).json() as { id: string };
    const q = (await itemQueue()).find((x) => x.itemId === r.id)!;
    await req('POST', `/api/moderation/versions/${q.versionId}/decline`, mod, { reason: 'Too blurry' });
    const id = await newClubCollection();
    expect((await req('PATCH', `/api/catalog/collections/${id}`, ada, { audience: 'everyone' })).json()).toMatchObject({ submitted: [] });
    expect(await itemQueue()).toEqual([]);
    expect((await detail(max, id)).items[1]!.review).toEqual({ state: 'declined', reason: 'Too blurry' });
  });

  it('in a public collection, adding or reordering items never re-reviews it; changing its text does', async () => {
    const id = await newClubCollection({ audience: 'everyone', entries: [{ source: 'catalog', id: yard }] });
    await req('POST', `/api/moderation/collections/${id}/approve`, mod, {});
    const extra = await (async () => {
      await settings({ catalogReview: 'none' });
      const m = (await req('POST', '/api/modules', out, { title: 'Engine shed' })).json() as { id: string };
      const sid = ((await req('POST', '/api/catalog/submissions', out, { kind: 'module', sourceId: m.id })).json() as { id: string }).id;
      await settings({ catalogReview: 'moderators' });
      return sid;
    })();
    const added = await req('POST', `/api/catalog/collections/${id}/items`, max, { itemId: extra });
    expect(added.statusCode).toBe(200);
    expect(added.json()).toMatchObject({ status: 'public', pending: false });
    expect((await req('POST', `/api/catalog/collections/${id}/items`, max, { itemId: extra })).statusCode).toBe(409);
    const reordered = await req('PATCH', `/api/catalog/collections/${id}`, max, { entries: [{ source: 'catalog', id: extra }, { source: 'catalog', id: yard }] });
    expect(reordered.json()).toMatchObject({ status: 'public', pending: false });
    let row = (await db.select().from(schema.catalogCollections).where(eq(schema.catalogCollections.id, id)).get())!;
    expect(row).toMatchObject({ status: 'public', pending: null });
    expect(await collectionQueue()).toEqual([]);
    expect((await detail(out, id)).items.map((i) => i.id)).toEqual([extra, yard]);
    // A new title waits for review; the public one stays meanwhile.
    expect((await req('PATCH', `/api/catalog/collections/${id}`, max, { title: 'Show standards 2026' })).json()).toMatchObject({ status: 'public', pending: true });
    row = (await db.select().from(schema.catalogCollections).where(eq(schema.catalogCollections.id, id)).get())!;
    expect(row.title).toBe('ArkLUG show standards');
    expect(await collectionQueue()).toEqual([expect.objectContaining({ id, title: 'Show standards 2026', old: expect.objectContaining({ title: 'ArkLUG show standards' }) })]);
    // So does a new cover.
    await req('POST', `/api/moderation/collections/${id}/approve`, mod, {});
    expect((await req('PATCH', `/api/catalog/collections/${id}`, max, { coverItemId: yard })).json()).toMatchObject({ pending: true });
    // Adding a club module to a public collection shares it for its own review.
    const more = await req('PATCH', `/api/catalog/collections/${id}`, max, { entries: [{ source: 'catalog', id: extra }, { source: 'catalog', id: yard }, { source: 'library', id: clubMod }] });
    expect(more.json()).toMatchObject({ submitted: [clubMod] });
    expect((await detail(out, id)).items.map((i) => i.id)).toEqual([extra, yard]);
  });

  it('a personal private collection is only its curator’s', async () => {
    const own = ((await req('POST', '/api/modules', mel, { title: 'My bridge' })).json() as { id: string }).id;
    const id = ((await create(mel, { title: 'Just mine', audience: 'private', entries: [{ source: 'library', id: own }, { source: 'catalog', id: yard }] })).json() as { id: string }).id;
    expect((await detail(mel, id)).items.map((i) => i.source)).toEqual(['library', 'catalog']);
    expect((await req('GET', `/api/catalog/collections/${id}`, ada)).statusCode).toBe(404);
    expect((await req('PATCH', `/api/catalog/collections/${id}`, ada, { title: 'x' })).statusCode).toBe(404);
    expect((await req('POST', `/api/catalog/collections/${id}/add`, ada, {})).statusCode).toBe(404);
    expect(await publicList(out)).toEqual([]);
    const mine = ((await req('GET', '/api/catalog/collections/mine', mel)).json() as { collections: { id: string; audience: string }[] }).collections;
    expect(mine).toEqual([expect.objectContaining({ id, audience: 'private' })]);
    // Club collections aren't in "mine".
    await newClubCollection();
    expect(((await req('GET', '/api/catalog/collections/mine', ada)).json() as { collections: unknown[] }).collections).toEqual([]);
  });

  it('a club’s own custom parts go in too: private, no review; public, each shared for its own review', async () => {
    const now = new Date();
    await db.insert(schema.customParts).values({
      id: 'club-part',
      partNumber: 'ARK.1',
      displayName: 'Show sign',
      ownerOrgId: orgId,
      createdBy: await userId('ada@example.com'),
      xmlBlob: Buffer.from('<part/>'),
      spriteBlob: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1]),
      spriteMime: 'image/png',
      createdAt: now,
      updatedAt: now,
    });
    const id = await newClubCollection();
    // "Add to a collection…" with the club's part: no review, it's private.
    const added = await req('POST', `/api/catalog/collections/${id}/items`, max, { source: 'library', kind: 'part', id: 'club-part' });
    expect(added.statusCode).toBe(200);
    expect(added.json()).toMatchObject({ audience: 'private', submitted: [] });
    expect((await req('POST', `/api/catalog/collections/${id}/items`, max, { source: 'library', kind: 'part', id: 'club-part' })).statusCode).toBe(409);
    expect(await itemQueue()).toEqual([]);
    const d = await detail(mel, id);
    expect(d.items.map((i) => [i.source, i.kind, i.id])).toEqual([
      ['catalog', 'module', yard],
      ['library', 'module', clubMod],
      ['library', 'part', 'club-part'],
    ]);
    // Mel adds them all: the part comes too, once.
    const first = (await req('POST', `/api/catalog/collections/${id}/add`, mel, {})).json() as { added: { itemId: string; kind: string }[] };
    expect(first.added.map((a) => a.kind).sort()).toEqual(['module', 'module', 'part']);
    const again = (await req('POST', `/api/catalog/collections/${id}/add`, mel, {})).json() as { added: unknown[]; skipped: string[] };
    expect(again.added).toEqual([]);
    expect(again.skipped).toContain('club-part');
    // Someone else's part can't go in.
    expect((await req('POST', `/api/catalog/collections/${id}/items`, max, { source: 'library', kind: 'part', id: 'nope' })).json()).toMatchObject({ error: 'part_not_in_club' });
    // Made public: the module and the part each go for their own review.
    const pub = (await req('PATCH', `/api/catalog/collections/${id}`, ada, { audience: 'everyone' })).json() as { submitted: string[] };
    expect(pub.submitted.sort()).toEqual([clubMod, 'club-part'].sort());
    expect((await itemQueue()).map((q) => q.title).sort()).toEqual(['Show corner', 'Show sign']);
    // Deleting the part takes it out, with a note.
    expect((await req('DELETE', '/api/custom-parts/club-part', ada)).statusCode).toBe(200);
    const after = await detail(max, id);
    expect(after.items.map((i) => i.id)).toEqual([yard, clubMod]);
    expect(after.collection.curatorNote).toContain('“Show sign” was deleted');
  });

  it('deleting a club deletes its collections; a curator can delete one', async () => {
    const a = await newClubCollection();
    const b = await newClubCollection({ title: 'Second' });
    expect((await req('DELETE', `/api/catalog/collections/${a}`, max)).statusCode).toBe(200);
    expect(await db.select().from(schema.catalogCollections).where(eq(schema.catalogCollections.id, a)).get()).toBeUndefined();
    await db.delete(schema.orgs).where(eq(schema.orgs.id, orgId));
    expect(await db.select().from(schema.catalogCollections).where(eq(schema.catalogCollections.id, b)).get()).toBeUndefined();
    expect(await db.select().from(schema.catalogCollectionModules).all()).toEqual([]);
  });
});

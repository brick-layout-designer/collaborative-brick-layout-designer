// Catalog collections: named, ordered sets of public catalog items
// ("Starter town", "Train yard basics").
//
// - Moderators and global admins make official collections: published at
//   once, and only they can be featured.
// - Anyone else signed in (not the demo account) submits one, reviewed like
//   catalog items (catalog_review 'moderators' or 'none'). Every edit is
//   reviewed again; while an edit to a public collection waits, the public
//   one stays as it was (`pending`).
// - Only public items go in. An item that's unpublished or withdrawn drops
//   out of every collection (dropFromCollections) and its curator gets a
//   note; a collection with no items left isn't shown.
// - Items show only while their catalog (modules, parts) is on.
// - "Add all" copies every item to the caller or a club, skipping the ones
//   they already have a copy of.
//
// All bodies are JSON. Every change is audit-logged.

import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { and, asc, desc, eq, inArray, isNotNull, like, or, sql } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import type { User } from '../db/schema.js';
import { requireUser } from '../auth/cookie.js';
import { isDemoUser } from '../demo/demoAccount.js';
import { getPlatformSettings } from '../auth/platformSettings.js';
import { writeAuditEvent } from '../audit/writeAuditEvent.js';
import { destinationOrg } from './owners.js';
import { canModerate, cleanText, copyItemTo, itemOut, mayBrowse, ownerNames } from './catalog.js';

type Kind = 'module' | 'part';
type Collection = typeof schema.catalogCollections.$inferSelect;
type Item = typeof schema.catalogItems.$inferSelect;

export const MAX_COLLECTION_ITEMS = 60;
const MAX_TITLE = 80;
const MAX_DESCRIPTION = 1000;
const MAX_REASON = 300;
const MAX_NOTE = 1500;
// The desktop app (an API token) browses collections and adds them.
const TOKEN_READ = { apiToken: 'layouts:read' } as const;

/** What a collection is made of: what's public, or a change waiting for review. */
export interface Draft {
  title: string;
  description: string;
  coverItemId: string | null;
  itemIds: string[];
}

/** The catalogs that are on. */
async function kindsOn(): Promise<Set<Kind>> {
  const s = await getPlatformSettings();
  const on = new Set<Kind>();
  if (s.moduleCatalogEnabled) on.add('module');
  if (s.partsCatalogEnabled) on.add('part');
  return on;
}

const isPublicItem = (i: Item, on: Set<Kind>) => i.status === 'public' && i.publicVersion > 0 && on.has(i.kind);

/** Each collection's items, in order (every one still in it, whatever its catalog). */
async function itemsOf(collectionIds: string[]): Promise<Map<string, Item[]>> {
  const out = new Map<string, Item[]>(collectionIds.map((id) => [id, []]));
  if (!collectionIds.length) return out;
  const rows = await db
    .select({ cid: schema.catalogCollectionItems.collectionId, item: schema.catalogItems })
    .from(schema.catalogCollectionItems)
    .innerJoin(schema.catalogItems, eq(schema.catalogItems.id, schema.catalogCollectionItems.itemId))
    .where(inArray(schema.catalogCollectionItems.collectionId, collectionIds))
    .orderBy(asc(schema.catalogCollectionItems.position));
  for (const r of rows) out.get(r.cid)?.push(r.item);
  return out;
}

/** The cover: the chosen item, else the first module, else the first item. */
export function coverOf(coverItemId: string | null, items: readonly Pick<Item, 'id' | 'kind' | 'publicVersion'>[]): string | null {
  const it = items.find((i) => i.id === coverItemId) ?? items.find((i) => i.kind === 'module') ?? items[0];
  return it ? `/api/catalog/items/${it.id}/preview?v=${it.publicVersion}` : null;
}

export function parseDraft(json: string | null): Draft | null {
  if (!json) return null;
  try {
    const v = JSON.parse(json) as Partial<Draft>;
    if (typeof v.title !== 'string' || !Array.isArray(v.itemIds)) return null;
    return {
      title: v.title,
      description: typeof v.description === 'string' ? v.description : '',
      coverItemId: typeof v.coverItemId === 'string' ? v.coverItemId : null,
      itemIds: v.itemIds.filter((x): x is string => typeof x === 'string'),
    };
  } catch {
    return null;
  }
}

type DraftResult = { ok: true; draft: Draft } | { ok: false; error: string; itemId?: string };

/**
 * A request body as a Draft. Fields left out keep `base`'s. Every item
 * must be public, in a catalog that's on.
 */
async function readDraft(body: Record<string, unknown>, base: Draft | null, on: Set<Kind>): Promise<DraftResult> {
  const title = cleanText(body.title === undefined ? base?.title : body.title, MAX_TITLE);
  if (!title) return { ok: false, error: 'invalid_input' };
  const description = body.description === undefined ? (base?.description ?? '') : cleanText(body.description, MAX_DESCRIPTION);
  if (description === undefined) return { ok: false, error: 'invalid_input' };
  let itemIds: string[];
  if (body.itemIds === undefined) itemIds = base?.itemIds ?? [];
  else {
    if (!Array.isArray(body.itemIds) || body.itemIds.some((x) => typeof x !== 'string')) return { ok: false, error: 'invalid_input' };
    itemIds = [...new Set(body.itemIds as string[])];
  }
  if (itemIds.length === 0) return { ok: false, error: 'collection_empty' };
  if (itemIds.length > MAX_COLLECTION_ITEMS) return { ok: false, error: 'collection_too_big' };
  const found = await db.select().from(schema.catalogItems).where(inArray(schema.catalogItems.id, itemIds));
  const byId = new Map(found.map((i) => [i.id, i]));
  for (const id of itemIds) {
    const it = byId.get(id);
    if (!it || !isPublicItem(it, on)) return { ok: false, error: 'item_not_public', itemId: id };
  }
  let coverItemId: string | null;
  if (body.coverItemId === undefined) coverItemId = base?.coverItemId && itemIds.includes(base.coverItemId) ? base.coverItemId : null;
  else if (body.coverItemId === null || body.coverItemId === '') coverItemId = null;
  else if (typeof body.coverItemId === 'string' && itemIds.includes(body.coverItemId)) coverItemId = body.coverItemId;
  else return { ok: false, error: 'invalid_input' };
  return { ok: true, draft: { title, description: description ?? '', coverItemId, itemIds } };
}

/** Make the collection's public contents `d`. */
async function applyDraft(id: string, d: Draft, now: Date): Promise<void> {
  await db
    .update(schema.catalogCollections)
    .set({ title: d.title, description: d.description, coverItemId: d.coverItemId, updatedAt: now })
    .where(eq(schema.catalogCollections.id, id));
  await db.delete(schema.catalogCollectionItems).where(eq(schema.catalogCollectionItems.collectionId, id));
  if (d.itemIds.length) {
    await db.insert(schema.catalogCollectionItems).values(d.itemIds.map((itemId, position) => ({ collectionId: id, itemId, position })));
  }
}

/** The curator (or, for an official collection, any moderator) may change it. */
function mayEdit(user: User, c: Collection): boolean {
  return c.ownerUserId === user.id || (c.official && canModerate(user));
}

/** The person who made it, by name. */
async function curatorNames(rows: readonly Collection[]): Promise<(c: Collection) => string> {
  const name = await ownerNames(rows.map((c) => ({ ownerUserId: c.ownerUserId, ownerOrgId: null })));
  return (c) => name({ ownerUserId: c.ownerUserId, ownerOrgId: null });
}

function listOut(c: Collection, items: Item[], by: string) {
  return {
    id: c.id,
    title: c.title,
    description: c.description,
    featured: c.featured,
    official: c.official,
    by,
    itemCount: items.length,
    modules: items.filter((i) => i.kind === 'module').length,
    parts: items.filter((i) => i.kind === 'part').length,
    coverUrl: coverOf(c.coverItemId, items),
    updatedAt: c.updatedAt.getTime(),
  };
}

/** A change waiting for review, with its items, for its curator and moderators. */
async function draftOut(d: Draft) {
  const rows = d.itemIds.length ? await db.select().from(schema.catalogItems).where(inArray(schema.catalogItems.id, d.itemIds)) : [];
  const byId = new Map(rows.map((r) => [r.id, r]));
  const items = d.itemIds.map((id) => byId.get(id)).filter((x): x is Item => !!x);
  return {
    title: d.title,
    description: d.description,
    coverItemId: d.coverItemId,
    coverUrl: coverOf(d.coverItemId, items),
    items: items.map((i) => ({ id: i.id, kind: i.kind, title: i.title, previewUrl: `/api/catalog/items/${i.id}/preview?v=${i.publicVersion}` })),
  };
}

/**
 * Take an item that left the catalog out of every collection (and every
 * change waiting for review), and leave each curator a note.
 */
export async function dropFromCollections(item: Pick<Item, 'id' | 'title'>, why: string, actorId: string | null): Promise<string[]> {
  const inPublic = await db
    .select({ id: schema.catalogCollectionItems.collectionId })
    .from(schema.catalogCollectionItems)
    .where(eq(schema.catalogCollectionItems.itemId, item.id));
  const withPending = await db
    .select()
    .from(schema.catalogCollections)
    .where(and(isNotNull(schema.catalogCollections.pending), like(schema.catalogCollections.pending, `%${item.id}%`)));
  const ids = [...new Set([...inPublic.map((r) => r.id), ...withPending.map((r) => r.id)])];
  if (!ids.length) return [];
  await db.delete(schema.catalogCollectionItems).where(eq(schema.catalogCollectionItems.itemId, item.id));
  const now = new Date();
  const line = `“${item.title}” was ${why}, so it was taken out of this collection.`;
  const rows = await db.select().from(schema.catalogCollections).where(inArray(schema.catalogCollections.id, ids));
  for (const c of rows) {
    const d = parseDraft(c.pending);
    const pending = d ? { ...d, itemIds: d.itemIds.filter((x) => x !== item.id), coverItemId: d.coverItemId === item.id ? null : d.coverItemId } : null;
    const note = (c.curatorNote ? `${c.curatorNote}\n${line}` : line).slice(-MAX_NOTE);
    await db
      .update(schema.catalogCollections)
      .set({
        curatorNote: note,
        coverItemId: c.coverItemId === item.id ? null : c.coverItemId,
        // A waiting change that has nothing left in it is dropped.
        pending: pending && pending.itemIds.length ? JSON.stringify(pending) : null,
        pendingAt: pending && pending.itemIds.length ? c.pendingAt : null,
        updatedAt: now,
      })
      .where(eq(schema.catalogCollections.id, c.id));
    await writeAuditEvent({
      resourceKind: 'catalog_collection',
      resourceId: c.id,
      userId: actorId,
      eventType: 'collection_item_removed',
      payload: { itemId: item.id, title: item.title, why },
    });
  }
  return ids;
}

function requireModerator(req: FastifyRequest): User {
  const user = requireUser(req);
  if (!canModerate(user)) {
    const err = new Error('forbidden');
    (err as Error & { statusCode?: number }).statusCode = 403;
    throw err;
  }
  return user;
}

const getCollection = (id: string) => db.select().from(schema.catalogCollections).where(eq(schema.catalogCollections.id, id)).get();

export async function collectionRoutes(app: FastifyInstance): Promise<void> {
  // ---- browse --------------------------------------------------------------
  // Public collections with at least one item showing, featured first.
  app.get('/api/catalog/collections', { config: TOKEN_READ }, async (req, reply) => {
    const on = await kindsOn();
    if (!on.size) return reply.code(404).send({ error: 'catalog_off' });
    if (!(await mayBrowse(req))) return reply.code(401).send({ error: 'unauthorized' });
    const rows = await db
      .select()
      .from(schema.catalogCollections)
      .where(eq(schema.catalogCollections.status, 'public'))
      .orderBy(desc(schema.catalogCollections.featured), desc(schema.catalogCollections.official), desc(schema.catalogCollections.updatedAt))
      .limit(200);
    const items = await itemsOf(rows.map((r) => r.id));
    const name = await curatorNames(rows);
    const out = [];
    for (const c of rows) {
      const shown = (items.get(c.id) ?? []).filter((i) => isPublicItem(i, on));
      if (shown.length) out.push(listOut(c, shown, name(c)));
    }
    return { collections: out };
  });

  // The caller's own collections and how they stand.
  app.get('/api/catalog/collections/mine', async (req) => {
    const user = requireUser(req);
    const on = await kindsOn();
    const rows = await db
      .select()
      .from(schema.catalogCollections)
      .where(eq(schema.catalogCollections.ownerUserId, user.id))
      .orderBy(desc(schema.catalogCollections.updatedAt));
    const items = await itemsOf(rows.map((r) => r.id));
    return {
      collections: rows.map((c) => {
        const shown = (items.get(c.id) ?? []).filter((i) => isPublicItem(i, on));
        return {
          ...listOut(c, shown, user.displayName),
          status: c.status,
          reason: c.reason,
          pending: c.pending !== null,
          curatorNote: c.curatorNote,
        };
      }),
    };
  });

  app.get<{ Params: { id: string } }>('/api/catalog/collections/:id', { config: TOKEN_READ }, async (req, reply) => {
    const on = await kindsOn();
    if (!on.size) return reply.code(404).send({ error: 'catalog_off' });
    const c = await getCollection(req.params.id);
    if (!c) return reply.code(404).send({ error: 'not_found' });
    const all = (await itemsOf([c.id])).get(c.id) ?? [];
    const shown = all.filter((i) => isPublicItem(i, on));
    const user = req.user ?? null;
    const curator = !!user && c.ownerUserId === user.id;
    const insider = !!user && (mayEdit(user, c) || canModerate(user));
    if (!insider && (c.status !== 'public' || shown.length === 0)) return reply.code(404).send({ error: 'not_found' });
    if (!(await mayBrowse(req))) return reply.code(401).send({ error: 'unauthorized' });
    const by = (await curatorNames([c]))(c);
    const itemBy = await ownerNames(shown);
    const pending = insider ? parseDraft(c.pending) : null;
    return {
      collection: {
        ...listOut(c, shown, by),
        coverItemId: c.coverItemId,
        status: c.status,
        reason: insider ? c.reason : null,
        pending: pending ? await draftOut(pending) : null,
        curatorNote: curator ? c.curatorNote : null,
        canEdit: !!user && mayEdit(user, c),
      },
      items: shown.map((i) => itemOut(i, itemBy(i))),
    };
  });

  // ---- make and change -----------------------------------------------------
  app.post<{ Body: Record<string, unknown> }>(
    '/api/catalog/collections',
    // codeql[js/missing-rate-limiting] - rate limited via Fastify config.rateLimit
    { config: { rateLimit: { max: 10, timeWindow: '1 hour' } } },
    async (req, reply) => {
      const user = requireUser(req);
      if (isDemoUser(user)) return reply.code(403).send({ error: 'demo_account_cannot_submit' });
      const on = await kindsOn();
      if (!on.size) return reply.code(404).send({ error: 'catalog_off' });
      const r = await readDraft(req.body ?? {}, null, on);
      if (!r.ok) return reply.code(400).send({ error: r.error, ...(r.itemId ? { itemId: r.itemId } : {}) });
      const staff = canModerate(user);
      const straight = staff || (await getPlatformSettings()).catalogReview === 'none';
      const id = randomUUID();
      const now = new Date();
      await db.insert(schema.catalogCollections).values({
        id,
        title: r.draft.title,
        description: r.draft.description,
        ownerUserId: user.id,
        official: staff,
        status: straight ? 'public' : 'in_review',
        createdAt: now,
        updatedAt: now,
      });
      await applyDraft(id, r.draft, now);
      await writeAuditEvent({
        resourceKind: 'catalog_collection',
        resourceId: id,
        userId: user.id,
        eventType: 'collection_submit',
        payload: { title: r.draft.title, items: r.draft.itemIds.length, official: staff, straight },
      });
      return reply.code(201).send({ id, status: straight ? 'public' : 'in_review' });
    },
  );

  // A change: published at once by moderators (or with review off),
  // otherwise reviewed again. A public collection stays as it is meanwhile.
  app.patch<{ Params: { id: string }; Body: Record<string, unknown> }>(
    '/api/catalog/collections/:id',
    // codeql[js/missing-rate-limiting] - rate limited via Fastify config.rateLimit
    { config: { rateLimit: { max: 30, timeWindow: '1 hour' } } },
    async (req, reply) => {
      const user = requireUser(req);
      if (isDemoUser(user)) return reply.code(403).send({ error: 'demo_account_cannot_submit' });
      const on = await kindsOn();
      if (!on.size) return reply.code(404).send({ error: 'catalog_off' });
      const c = await getCollection(req.params.id);
      if (!c) return reply.code(404).send({ error: 'not_found' });
      if (!mayEdit(user, c)) return reply.code(403).send({ error: 'forbidden' });
      const current: Draft = {
        title: c.title,
        description: c.description,
        coverItemId: c.coverItemId,
        itemIds: ((await itemsOf([c.id])).get(c.id) ?? []).map((i) => i.id),
      };
      const r = await readDraft(req.body ?? {}, parseDraft(c.pending) ?? current, on);
      if (!r.ok) return reply.code(400).send({ error: r.error, ...(r.itemId ? { itemId: r.itemId } : {}) });
      const staff = canModerate(user);
      // Something a moderator took down always goes back through review.
      const straight = staff || ((await getPlatformSettings()).catalogReview === 'none' && c.status !== 'unpublished');
      const now = new Date();
      let status = c.status;
      let pending = false;
      if (straight) {
        await applyDraft(c.id, r.draft, now);
        status = 'public';
        await db
          .update(schema.catalogCollections)
          .set({ status, reason: null, pending: null, pendingAt: null })
          .where(eq(schema.catalogCollections.id, c.id));
      } else if (c.status === 'public') {
        pending = true;
        await db
          .update(schema.catalogCollections)
          .set({ pending: JSON.stringify(r.draft), pendingAt: now, reason: null, updatedAt: now })
          .where(eq(schema.catalogCollections.id, c.id));
      } else {
        await applyDraft(c.id, r.draft, now);
        status = 'in_review';
        await db
          .update(schema.catalogCollections)
          .set({ status, reason: null, pending: null, pendingAt: null })
          .where(eq(schema.catalogCollections.id, c.id));
      }
      await writeAuditEvent({
        resourceKind: 'catalog_collection',
        resourceId: c.id,
        userId: user.id,
        eventType: 'collection_edit',
        payload: { title: r.draft.title, items: r.draft.itemIds.length, straight, pending },
      });
      return { id: c.id, status, pending };
    },
  );

  app.post<{ Params: { id: string } }>(
    '/api/catalog/collections/:id/withdraw',
    // codeql[js/missing-rate-limiting] - rate limited via Fastify config.rateLimit
    { config: { rateLimit: { max: 30, timeWindow: '1 hour' } } },
    async (req, reply) => {
      const user = requireUser(req);
      const c = await getCollection(req.params.id);
      if (!c) return reply.code(404).send({ error: 'not_found' });
      if (!mayEdit(user, c)) return reply.code(403).send({ error: 'forbidden' });
      await db
        .update(schema.catalogCollections)
        .set({ status: 'withdrawn', featured: false, pending: null, pendingAt: null, updatedAt: new Date() })
        .where(eq(schema.catalogCollections.id, c.id));
      await writeAuditEvent({ resourceKind: 'catalog_collection', resourceId: c.id, userId: user.id, eventType: 'collection_withdraw', payload: {} });
      return { ok: true };
    },
  );

  // The curator has read the note about items that left.
  app.post<{ Params: { id: string } }>('/api/catalog/collections/:id/dismiss-note', async (req, reply) => {
    const user = requireUser(req);
    const c = await getCollection(req.params.id);
    if (!c || c.ownerUserId !== user.id) return reply.code(404).send({ error: 'not_found' });
    await db.update(schema.catalogCollections).set({ curatorNote: null }).where(eq(schema.catalogCollections.id, c.id));
    return { ok: true };
  });

  // ---- add all -------------------------------------------------------------
  // Every item to the caller or a club; ones they already have a copy of
  // (from the catalog) are skipped, so nothing is duplicated.
  app.post<{ Params: { id: string }; Body: { orgSlug?: unknown } }>(
    '/api/catalog/collections/:id/add',
    // codeql[js/missing-rate-limiting] - rate limited via Fastify config.rateLimit
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' }, apiToken: ['layouts:write', 'parts:write'] as const } },
    async (req, reply) => {
      const user = requireUser(req);
      const on = await kindsOn();
      const c = await getCollection(req.params.id);
      const shown = c ? ((await itemsOf([c.id])).get(c.id) ?? []).filter((i) => isPublicItem(i, on)) : [];
      if (!c || c.status !== 'public' || !shown.length) return reply.code(404).send({ error: 'not_found' });
      const dest = await destinationOrg(user.id, req.body?.orgSlug);
      if (!dest.ok) return reply.code(dest.code).send({ error: dest.error });
      const have = await alreadyHave(
        shown.map((i) => i.id),
        dest.orgId ? { kind: 'org', id: dest.orgId } : { kind: 'user', id: user.id },
      );
      const added: { itemId: string; kind: Kind; id: string }[] = [];
      const skipped: string[] = [];
      const failed: { itemId: string; error: string }[] = [];
      for (const it of shown) {
        if (have.has(it.id)) {
          skipped.push(it.id);
          continue;
        }
        const r = await copyItemTo(user, it, dest.orgId);
        if (r.ok) added.push({ itemId: it.id, kind: it.kind, id: r.id });
        // A part with that number is already there: they have it.
        else if (r.code === 409) skipped.push(it.id);
        else failed.push({ itemId: it.id, error: (r.body as { error?: string })?.error ?? 'failed' });
      }
      await writeAuditEvent({
        resourceKind: 'catalog_collection',
        resourceId: c.id,
        userId: user.id,
        eventType: 'collection_add',
        payload: { orgId: dest.orgId, added: added.length, skipped: skipped.length, failed: failed.length },
      });
      return reply.code(201).send({ added, skipped, failed });
    },
  );

  // ---- moderation ----------------------------------------------------------
  app.get('/api/moderation/collections', async (req) => {
    requireModerator(req);
    const queueRows = await db
      .select()
      .from(schema.catalogCollections)
      .where(or(eq(schema.catalogCollections.status, 'in_review'), and(eq(schema.catalogCollections.status, 'public'), isNotNull(schema.catalogCollections.pending))))
      .orderBy(asc(schema.catalogCollections.updatedAt));
    const listed = await db
      .select()
      .from(schema.catalogCollections)
      .where(inArray(schema.catalogCollections.status, ['public', 'unpublished']))
      .orderBy(desc(schema.catalogCollections.featured), desc(schema.catalogCollections.updatedAt))
      .limit(500);
    const on = await kindsOn();
    const items = await itemsOf([...new Set([...queueRows, ...listed].map((c) => c.id))]);
    const name = await curatorNames([...queueRows, ...listed]);
    const ownerIds = [...new Set(queueRows.map((c) => c.ownerUserId).filter((x): x is string => !!x))];
    const emails = ownerIds.length
      ? new Map((await db.select({ id: schema.users.id, email: schema.users.email }).from(schema.users).where(inArray(schema.users.id, ownerIds))).map((u) => [u.id, u.email]))
      : new Map<string, string>();
    const queue = [];
    for (const c of queueRows) {
      const d = parseDraft(c.pending) ?? { title: c.title, description: c.description, coverItemId: c.coverItemId, itemIds: (items.get(c.id) ?? []).map((i) => i.id) };
      queue.push({
        id: c.id,
        isUpdate: c.pending !== null,
        by: name(c),
        email: c.ownerUserId ? (emails.get(c.ownerUserId) ?? null) : null,
        createdAt: (c.pendingAt ?? c.updatedAt).getTime(),
        owner: c.ownerUserId ? { kind: 'user' as const, id: c.ownerUserId } : null,
        ...(await draftOut(d)),
      });
    }
    return {
      queue,
      collections: listed.map((c) => ({
        ...listOut(c, (items.get(c.id) ?? []).filter((i) => isPublicItem(i, on)), name(c)),
        status: c.status,
        reason: c.reason,
        owner: c.ownerUserId ? { kind: 'user' as const, id: c.ownerUserId } : null,
      })),
    };
  });

  const decide = async (req: FastifyRequest<{ Params: { id: string }; Body: { reason?: unknown } }>, approve: boolean) => {
    const user = requireModerator(req);
    const c = await getCollection(req.params.id);
    const waiting = !!c && (c.status === 'in_review' || (c.status === 'public' && c.pending !== null));
    if (!c || !waiting) return { code: 404, body: { error: 'not_found' } };
    const reason = cleanText(req.body?.reason, MAX_REASON);
    if (reason === undefined) return { code: 400, body: { error: 'invalid_input' } };
    const now = new Date();
    const d = parseDraft(c.pending);
    if (approve) {
      if (d) {
        // Items may have left the catalog while it waited.
        const on = await kindsOn();
        const still = d.itemIds.length ? await db.select().from(schema.catalogItems).where(inArray(schema.catalogItems.id, d.itemIds)) : [];
        const ok = new Set(still.filter((i) => isPublicItem(i, on)).map((i) => i.id));
        await applyDraft(c.id, { ...d, itemIds: d.itemIds.filter((x) => ok.has(x)) }, now);
      }
      await db
        .update(schema.catalogCollections)
        .set({ status: 'public', reason: null, pending: null, pendingAt: null, updatedAt: now })
        .where(eq(schema.catalogCollections.id, c.id));
    } else if (d) {
      // A declined change: the public collection stays as it was.
      await db.update(schema.catalogCollections).set({ reason, pending: null, pendingAt: null, updatedAt: now }).where(eq(schema.catalogCollections.id, c.id));
    } else {
      await db.update(schema.catalogCollections).set({ status: 'declined', reason, updatedAt: now }).where(eq(schema.catalogCollections.id, c.id));
    }
    await writeAuditEvent({
      resourceKind: 'catalog_collection',
      resourceId: c.id,
      userId: user.id,
      eventType: approve ? 'collection_approve' : 'collection_decline',
      payload: { isUpdate: !!d, reason },
    });
    return { code: 200, body: { ok: true } };
  };
  app.post<{ Params: { id: string }; Body: { reason?: unknown } }>('/api/moderation/collections/:id/approve', async (req, reply) => {
    const r = await decide(req, true);
    return reply.code(r.code).send(r.body);
  });
  app.post<{ Params: { id: string }; Body: { reason?: unknown } }>('/api/moderation/collections/:id/decline', async (req, reply) => {
    const r = await decide(req, false);
    return reply.code(r.code).send(r.body);
  });

  app.post<{ Params: { id: string }; Body: { reason?: unknown } }>('/api/moderation/collections/:id/unpublish', async (req, reply) => {
    const user = requireModerator(req);
    const reason = cleanText(req.body?.reason, MAX_REASON);
    if (reason === undefined) return reply.code(400).send({ error: 'invalid_input' });
    const c = await getCollection(req.params.id);
    if (!c) return reply.code(404).send({ error: 'not_found' });
    await db
      .update(schema.catalogCollections)
      .set({ status: 'unpublished', featured: false, reason, pending: null, pendingAt: null, updatedAt: new Date() })
      .where(eq(schema.catalogCollections.id, c.id));
    await writeAuditEvent({ resourceKind: 'catalog_collection', resourceId: c.id, userId: user.id, eventType: 'collection_unpublish', payload: { reason } });
    return { ok: true };
  });

  // Featured: official collections only (moderators' and admins' own).
  app.post<{ Params: { id: string }; Body: { featured?: unknown } }>('/api/moderation/collections/:id/feature', async (req, reply) => {
    const user = requireModerator(req);
    if (typeof req.body?.featured !== 'boolean') return reply.code(400).send({ error: 'invalid_input' });
    const c = await getCollection(req.params.id);
    if (!c) return reply.code(404).send({ error: 'not_found' });
    if (req.body.featured && (!c.official || c.status !== 'public')) return reply.code(409).send({ error: 'not_featurable' });
    await db.update(schema.catalogCollections).set({ featured: req.body.featured, updatedAt: new Date() }).where(eq(schema.catalogCollections.id, c.id));
    await writeAuditEvent({
      resourceKind: 'catalog_collection',
      resourceId: c.id,
      userId: user.id,
      eventType: 'collection_feature',
      payload: { featured: req.body.featured },
    });
    return { ok: true, featured: req.body.featured };
  });
}

/**
 * Which of these items `owner` (a person, or a club) already has a copy
 * of, from the catalog: a copy row whose module or part still exists and
 * belongs to them.
 */
async function alreadyHave(itemIds: string[], owner: { kind: 'user' | 'org'; id: string }): Promise<Set<string>> {
  if (!itemIds.length) return new Set();
  const copies = await db
    .select({ itemId: schema.catalogCopies.itemId, copyId: schema.catalogCopies.copyId })
    .from(schema.catalogCopies)
    .where(inArray(schema.catalogCopies.itemId, itemIds));
  if (!copies.length) return new Set();
  const ids = copies.map((c) => c.copyId);
  const mods = await db
    .select({ id: schema.modules.id })
    .from(schema.modules)
    .where(and(inArray(schema.modules.id, ids), owner.kind === 'org' ? eq(schema.modules.ownerOrgId, owner.id) : eq(schema.modules.ownerUserId, owner.id)));
  const parts = await db
    .select({ id: schema.customParts.id })
    .from(schema.customParts)
    .where(and(inArray(schema.customParts.id, ids), owner.kind === 'org' ? eq(schema.customParts.ownerOrgId, owner.id) : eq(schema.customParts.ownerUserId, owner.id)));
  const owned = new Set([...mods.map((m) => m.id), ...parts.map((p) => p.id)]);
  return new Set(copies.filter((c) => owned.has(c.copyId)).map((c) => c.itemId));
}

/** How many public collections each item is in (for its owner's badge). */
export async function collectionCounts(itemIds: string[]): Promise<Map<string, number>> {
  if (!itemIds.length) return new Map();
  const rows = await db
    .select({ itemId: schema.catalogCollectionItems.itemId, n: sql<number>`count(*)`.mapWith(Number) })
    .from(schema.catalogCollectionItems)
    .innerJoin(schema.catalogCollections, eq(schema.catalogCollections.id, schema.catalogCollectionItems.collectionId))
    .where(and(inArray(schema.catalogCollectionItems.itemId, itemIds), eq(schema.catalogCollections.status, 'public')))
    .groupBy(schema.catalogCollectionItems.itemId);
  return new Map(rows.map((r) => [r.itemId, r.n]));
}

// Catalog collections: named, ordered sets of modules and parts
// ("Starter town", "Train yard basics", "ArkLUG show standards").
//
// Who curates it:
//   - a person (their own collection), or
//   - a club (`org_id`): its admins and managers curate, every member sees it.
//   Moderators and site admins make *official* collections (only those can
//   be featured).
//
// Who sees it (`audience`):
//   - 'private': only its curator, or only the club's members. Never
//     reviewed, of its text or its items.
//   - 'everyone': in the public catalog (under the person's or the club's
//     name). Its *text* (title, description, cover) is reviewed by site
//     moderators (catalog_review 'moderators'); with review off, or for a
//     moderator, it's public at once. A change to the text of a public
//     collection waits in `pending` while the public one stays up.
//
// Items are moderated on their own, never with the collection:
//   - catalog entries are public catalog items (catalog_collection_items);
//   - library entries are the curator's own modules, or the club's
//     (catalog_collection_modules). Insiders always see them; the public sees
//     one only once that module is itself public in the catalog. Making a
//     collection public (or adding a module to a public one) shares each
//     module that isn't in the catalog yet, for its own review.
//   Adding, taking out or reordering items never re-reviews the collection.
//
// An item that leaves the catalog, or a module that's deleted or leaves
// the club, drops out, and the curators get a note. A collection with
// nothing to show isn't listed. "Add all" copies every item to the caller
// or a club, skipping what they already have.
//
// All bodies are JSON. Every change is audit-logged.

import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { and, asc, desc, eq, inArray, isNotNull, isNull, like, ne, or, sql } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import type { User } from '../db/schema.js';
import { requireUser } from '../auth/cookie.js';
import { isDemoUser } from '../demo/demoAccount.js';
import { getPlatformSettings } from '../auth/platformSettings.js';
import { writeAuditEvent } from '../audit/writeAuditEvent.js';
import { atLeast, type ClubRole } from '../access/clubRoles.js';
import { destinationOrg } from './owners.js';
import { canModerate, cleanText, copyItemTo, itemOut, mayBrowse, ownerNames, submitToCatalog } from './catalog.js';
import { copyModuleTo } from './modules.js';

type Kind = 'module' | 'part';
type Audience = 'everyone' | 'private';
type Collection = typeof schema.catalogCollections.$inferSelect;
type Item = typeof schema.catalogItems.$inferSelect;
type ModuleRow = Pick<typeof schema.modules.$inferSelect, 'id' | 'title' | 'ownerUserId' | 'ownerOrgId' | 'thumbnailAt' | 'latestVersion' | 'updatedAt'>;

export const MAX_COLLECTION_ITEMS = 60;
const MAX_TITLE = 80;
const MAX_DESCRIPTION = 1000;
const MAX_REASON = 300;
const MAX_NOTE = 1500;
// The desktop app (an API token) browses collections and adds them.
const TOKEN_READ = { apiToken: 'layouts:read' } as const;

/** An entry: a public catalog item, or one of the curator's (or the club's) own modules. */
export interface Entry {
  source: 'catalog' | 'library';
  id: string;
}

/** A collection's text and presentation: what its review covers. */
export interface Text {
  title: string;
  description: string;
  coverItemId: string | null;
  coverModuleId: string | null;
}

/**
 * A change to a public collection's text waiting for review, as stored in
 * `pending`. Changes made before items were reviewed on their own also
 * carry `itemIds`; they're still honoured when approved.
 */
export interface Draft {
  title: string;
  description: string;
  coverItemId: string | null;
  coverModuleId?: string | null;
  itemIds?: string[];
}

const moduleCols = {
  id: schema.modules.id,
  title: schema.modules.title,
  ownerUserId: schema.modules.ownerUserId,
  ownerOrgId: schema.modules.ownerOrgId,
  thumbnailAt: schema.modules.thumbnailAt,
  latestVersion: schema.modules.latestVersion,
  updatedAt: schema.modules.updatedAt,
};

/** The catalogs that are on. */
async function kindsOn(): Promise<Set<Kind>> {
  const s = await getPlatformSettings();
  const on = new Set<Kind>();
  if (s.moduleCatalogEnabled) on.add('module');
  if (s.partsCatalogEnabled) on.add('part');
  return on;
}

const isPublicItem = (i: Item, on: Set<Kind>) => i.status === 'public' && i.publicVersion > 0 && on.has(i.kind);

/** Shown in the public catalog: an everyone-collection that passed its review. */
const isListed = (c: Collection) => c.audience === 'everyone' && c.status === 'public';

/** Each collection's catalog items, in order (every one still in it, whatever its catalog). */
async function itemsOf(collectionIds: string[]): Promise<Map<string, Item[]>> {
  const out = new Map<string, Item[]>(collectionIds.map((id) => [id, []]));
  for (const [cid, rows] of await itemRows(collectionIds)) out.set(cid, rows.map((r) => r.item));
  return out;
}

async function itemRows(collectionIds: string[]): Promise<Map<string, { pos: number; item: Item }[]>> {
  const out = new Map<string, { pos: number; item: Item }[]>(collectionIds.map((id) => [id, []]));
  if (!collectionIds.length) return out;
  const rows = await db
    .select({ cid: schema.catalogCollectionItems.collectionId, pos: schema.catalogCollectionItems.position, item: schema.catalogItems })
    .from(schema.catalogCollectionItems)
    .innerJoin(schema.catalogItems, eq(schema.catalogItems.id, schema.catalogCollectionItems.itemId))
    .where(inArray(schema.catalogCollectionItems.collectionId, collectionIds))
    .orderBy(asc(schema.catalogCollectionItems.position));
  for (const r of rows) out.get(r.cid)?.push({ pos: r.pos, item: r.item });
  return out;
}

async function moduleRows(collectionIds: string[]): Promise<Map<string, { pos: number; module: ModuleRow }[]>> {
  const out = new Map<string, { pos: number; module: ModuleRow }[]>(collectionIds.map((id) => [id, []]));
  if (!collectionIds.length) return out;
  const rows = await db
    .select({ cid: schema.catalogCollectionModules.collectionId, pos: schema.catalogCollectionModules.position, module: moduleCols })
    .from(schema.catalogCollectionModules)
    .innerJoin(schema.modules, eq(schema.modules.id, schema.catalogCollectionModules.moduleId))
    .where(inArray(schema.catalogCollectionModules.collectionId, collectionIds))
    .orderBy(asc(schema.catalogCollectionModules.position));
  for (const r of rows) out.get(r.cid)?.push({ pos: r.pos, module: r.module });
  return out;
}

/** A module belongs with the collection: the club's own for a club collection, else the curator's own. */
const ownsModule = (c: Pick<Collection, 'orgId' | 'ownerUserId'>, m: Pick<ModuleRow, 'ownerUserId' | 'ownerOrgId'>) =>
  c.orgId ? m.ownerOrgId === c.orgId : !!c.ownerUserId && m.ownerUserId === c.ownerUserId && !m.ownerOrgId;

/** One entry as a viewer sees it. */
export interface Shown {
  source: 'catalog' | 'library';
  /** The catalog item's id, or the module's. */
  id: string;
  kind: Kind;
  title: string;
  previewUrl: string;
  item?: Item;
  module?: ModuleRow;
  /** A library module's catalog item, if it was ever shared. */
  catalog?: Item | null;
}

const itemPreview = (i: Pick<Item, 'id' | 'publicVersion'>) => `/api/catalog/items/${i.id}/preview?v=${i.publicVersion}`;
const modulePreview = (m: Pick<ModuleRow, 'id' | 'thumbnailAt'>) => `/api/modules/${m.id}/thumbnail?v=${m.thumbnailAt?.getTime() ?? 0}`;

/** The catalog item shared from each of these modules, if any. */
async function catalogItemsFor(moduleIds: string[]): Promise<Map<string, Item>> {
  if (!moduleIds.length) return new Map();
  const rows = await db
    .select()
    .from(schema.catalogItems)
    .where(and(eq(schema.catalogItems.kind, 'module'), inArray(schema.catalogItems.sourceId, moduleIds)));
  return new Map(rows.map((r) => [r.sourceId, r]));
}

/**
 * What each collection shows, in order. `insider` (curators, club members,
 * moderators) sees every entry; anyone else sees public catalog items only,
 * and a library module only through its own public catalog item.
 */
async function shownOf(cs: readonly Collection[], on: Set<Kind>, insider: (c: Collection) => boolean): Promise<Map<string, Shown[]>> {
  const ids = cs.map((c) => c.id);
  const items = await itemRows(ids);
  const mods = await moduleRows(ids);
  const allMods = [...mods.values()].flat().map((r) => r.module.id);
  const shared = await catalogItemsFor(allMods);
  const out = new Map<string, Shown[]>();
  for (const c of cs) {
    const inside = insider(c);
    const rows: { pos: number; s: Shown }[] = [];
    for (const r of items.get(c.id) ?? []) {
      if (!isPublicItem(r.item, on)) continue;
      rows.push({ pos: r.pos, s: { source: 'catalog', id: r.item.id, kind: r.item.kind, title: r.item.title, previewUrl: itemPreview(r.item), item: r.item } });
    }
    for (const r of mods.get(c.id) ?? []) {
      if (!ownsModule(c, r.module)) continue;
      const item = shared.get(r.module.id) ?? null;
      if (inside) {
        rows.push({ pos: r.pos, s: { source: 'library', id: r.module.id, kind: 'module', title: r.module.title, previewUrl: modulePreview(r.module), module: r.module, catalog: item } });
      } else if (item && isPublicItem(item, on)) {
        rows.push({ pos: r.pos, s: { source: 'catalog', id: item.id, kind: 'module', title: item.title, previewUrl: itemPreview(item), item } });
      }
    }
    rows.sort((a, b) => a.pos - b.pos);
    out.set(c.id, rows.map((r) => r.s));
  }
  return out;
}

/** The cover: the chosen item, else the first module, else the first item. */
export function coverOf(coverItemId: string | null, items: readonly Pick<Item, 'id' | 'kind' | 'publicVersion'>[]): string | null {
  const it = items.find((i) => i.id === coverItemId) ?? items.find((i) => i.kind === 'module') ?? items[0];
  return it ? itemPreview(it) : null;
}

/** The cover among what's shown: the chosen entry, else the first module, else the first entry. */
export function coverFrom(t: Pick<Text, 'coverItemId' | 'coverModuleId'>, shown: readonly Pick<Shown, 'source' | 'id' | 'kind' | 'previewUrl' | 'module' | 'item'>[]): string | null {
  const chosen = shown.find(
    (s) =>
      (t.coverItemId && s.source === 'catalog' && s.id === t.coverItemId) ||
      (t.coverModuleId && ((s.source === 'library' && s.id === t.coverModuleId) || (s.source === 'catalog' && s.item?.sourceId === t.coverModuleId))),
  );
  const it = chosen ?? shown.find((s) => s.kind === 'module') ?? shown[0];
  return it ? it.previewUrl : null;
}

export function parseDraft(json: string | null): Draft | null {
  if (!json) return null;
  try {
    const v = JSON.parse(json) as Partial<Draft>;
    if (typeof v.title !== 'string') return null;
    return {
      title: v.title,
      description: typeof v.description === 'string' ? v.description : '',
      coverItemId: typeof v.coverItemId === 'string' ? v.coverItemId : null,
      coverModuleId: typeof v.coverModuleId === 'string' ? v.coverModuleId : null,
      ...(Array.isArray(v.itemIds) ? { itemIds: v.itemIds.filter((x): x is string => typeof x === 'string') } : {}),
    };
  } catch {
    return null;
  }
}

const textOf = (c: Collection): Text => ({ title: c.title, description: c.description, coverItemId: c.coverItemId, coverModuleId: c.coverModuleId });
const sameText = (a: Text, b: Text) =>
  a.title === b.title && a.description === b.description && a.coverItemId === b.coverItemId && a.coverModuleId === b.coverModuleId;

/** Every entry, in order, whatever its state (what an edit starts from). */
async function entriesOf(c: Collection): Promise<Entry[]> {
  const items = (await itemRows([c.id])).get(c.id) ?? [];
  const mods = (await moduleRows([c.id])).get(c.id) ?? [];
  return [
    ...items.map((r) => ({ pos: r.pos, e: { source: 'catalog' as const, id: r.item.id } })),
    ...mods.filter((r) => ownsModule(c, r.module)).map((r) => ({ pos: r.pos, e: { source: 'library' as const, id: r.module.id } })),
  ]
    .sort((a, b) => a.pos - b.pos)
    .map((r) => r.e);
}

type Fail = { ok: false; code: number; error: string; itemId?: string };

/**
 * Read the entries in a request: `entries` [{source, id}], or (as before)
 * `itemIds`, which are catalog items. Left out: `base`.
 */
function readEntries(body: Record<string, unknown>, base: Entry[]): Entry[] | null {
  if (body.entries !== undefined) {
    if (!Array.isArray(body.entries)) return null;
    const out: Entry[] = [];
    const seen = new Set<string>();
    for (const e of body.entries as unknown[]) {
      const x = e as { source?: unknown; id?: unknown } | null;
      if (!x || (x.source !== 'catalog' && x.source !== 'library') || typeof x.id !== 'string') return null;
      const key = `${x.source}:${x.id}`;
      if (!seen.has(key)) out.push({ source: x.source, id: x.id });
      seen.add(key);
    }
    return out;
  }
  if (body.itemIds !== undefined) {
    if (!Array.isArray(body.itemIds) || body.itemIds.some((x) => typeof x !== 'string')) return null;
    return [...new Set(body.itemIds as string[])].map((id) => ({ source: 'catalog' as const, id }));
  }
  return base;
}

/**
 * Check entries: catalog items new to the collection must be public (ones
 * already in it may stay while their catalog is off), and library modules
 * must be the curator's own (or the club's).
 */
async function checkEntries(entries: Entry[], c: Pick<Collection, 'orgId' | 'ownerUserId'>, on: Set<Kind>, had: Entry[]): Promise<Fail | null> {
  if (entries.length === 0) return { ok: false, code: 400, error: 'collection_empty' };
  if (entries.length > MAX_COLLECTION_ITEMS) return { ok: false, code: 400, error: 'collection_too_big' };
  const itemIds = entries.filter((e) => e.source === 'catalog').map((e) => e.id);
  const moduleIds = entries.filter((e) => e.source === 'library').map((e) => e.id);
  const kept = new Set(had.filter((e) => e.source === 'catalog').map((e) => e.id));
  const items = itemIds.length ? await db.select().from(schema.catalogItems).where(inArray(schema.catalogItems.id, itemIds)) : [];
  const byId = new Map(items.map((i) => [i.id, i]));
  for (const id of itemIds) {
    const it = byId.get(id);
    if (!it || (!isPublicItem(it, on) && !(kept.has(id) && it.status === 'public'))) return { ok: false, code: 400, error: 'item_not_public', itemId: id };
  }
  const mods = moduleIds.length ? await db.select(moduleCols).from(schema.modules).where(inArray(schema.modules.id, moduleIds)) : [];
  const modById = new Map(mods.map((m) => [m.id, m]));
  for (const id of moduleIds) {
    const m = modById.get(id);
    if (!m || !ownsModule(c, m)) return { ok: false, code: 400, error: c.orgId ? 'module_not_in_club' : 'module_not_yours', itemId: id };
  }
  return null;
}

/** Read the text in a request; fields left out keep `base`'s. The cover must be one of `entries`. */
function readText(body: Record<string, unknown>, base: Text | null, entries: Entry[]): Text | Fail {
  const title = cleanText(body.title === undefined ? base?.title : body.title, MAX_TITLE);
  if (!title) return { ok: false, code: 400, error: 'invalid_input' };
  const description = body.description === undefined ? (base?.description ?? '') : cleanText(body.description, MAX_DESCRIPTION);
  if (description === undefined) return { ok: false, code: 400, error: 'invalid_input' };
  const has = (source: Entry['source'], id: string) => entries.some((e) => e.source === source && e.id === id);
  let coverItemId = base?.coverItemId && has('catalog', base.coverItemId) ? base.coverItemId : null;
  let coverModuleId = base?.coverModuleId && has('library', base.coverModuleId) ? base.coverModuleId : null;
  if (body.coverItemId !== undefined || body.coverModuleId !== undefined) {
    coverItemId = null;
    coverModuleId = null;
    if (typeof body.coverItemId === 'string' && body.coverItemId) {
      if (!has('catalog', body.coverItemId)) return { ok: false, code: 400, error: 'invalid_input' };
      coverItemId = body.coverItemId;
    } else if (typeof body.coverModuleId === 'string' && body.coverModuleId) {
      if (!has('library', body.coverModuleId)) return { ok: false, code: 400, error: 'invalid_input' };
      coverModuleId = body.coverModuleId;
    } else if (![undefined, null, ''].includes(body.coverItemId as string) || ![undefined, null, ''].includes(body.coverModuleId as string)) {
      return { ok: false, code: 400, error: 'invalid_input' };
    }
  }
  return { title, description: description ?? '', coverItemId, coverModuleId };
}

const isFail = (x: unknown): x is Fail => !!x && typeof x === 'object' && (x as Fail).ok === false;

function readAudience(raw: unknown, base: Audience): Audience | null {
  if (raw === undefined) return base;
  return raw === 'everyone' || raw === 'private' ? raw : null;
}

/** Make the collection's public text `t`. */
async function applyText(id: string, t: Text, now: Date): Promise<void> {
  await db
    .update(schema.catalogCollections)
    .set({ title: t.title, description: t.description, coverItemId: t.coverItemId, coverModuleId: t.coverModuleId, updatedAt: now })
    .where(eq(schema.catalogCollections.id, id));
}

/** Make the collection's entries `entries`, in this order. */
async function applyEntries(id: string, entries: Entry[]): Promise<void> {
  await db.delete(schema.catalogCollectionItems).where(eq(schema.catalogCollectionItems.collectionId, id));
  await db.delete(schema.catalogCollectionModules).where(eq(schema.catalogCollectionModules.collectionId, id));
  const items = entries.map((e, position) => ({ ...e, position })).filter((e) => e.source === 'catalog');
  const mods = entries.map((e, position) => ({ ...e, position })).filter((e) => e.source === 'library');
  if (items.length) await db.insert(schema.catalogCollectionItems).values(items.map((e) => ({ collectionId: id, itemId: e.id, position: e.position })));
  if (mods.length) await db.insert(schema.catalogCollectionModules).values(mods.map((e) => ({ collectionId: id, moduleId: e.id, position: e.position })));
}

/**
 * A public collection's modules that aren't in the catalog yet are shared,
 * each for its own review. Ones that were declined or unpublished are left
 * for their owner to share again.
 */
async function shareModules(user: User, c: Pick<Collection, 'title'>, entries: Entry[]): Promise<{ submitted: string[]; notShared: { moduleId: string; error: string }[] }> {
  const ids = entries.filter((e) => e.source === 'library').map((e) => e.id);
  const submitted: string[] = [];
  const notShared: { moduleId: string; error: string }[] = [];
  if (!ids.length) return { submitted, notShared };
  const shared = await catalogItemsFor(ids);
  for (const id of ids) {
    const it = shared.get(id);
    if (it && it.status !== 'withdrawn') continue;
    const r = await submitToCatalog(user, 'module', id, { note: `Part of the collection “${c.title}”` });
    if (r.ok) submitted.push(id);
    else notShared.push({ moduleId: id, error: (r.body as { error?: string })?.error ?? 'failed' });
  }
  return { submitted, notShared };
}

async function roleIn(userId: string, orgId: string): Promise<ClubRole | null> {
  const m = await db
    .select({ role: schema.orgMembers.role })
    .from(schema.orgMembers)
    .where(and(eq(schema.orgMembers.orgId, orgId), eq(schema.orgMembers.userId, userId)))
    .get();
  return m?.role ?? null;
}

interface Access {
  /** The caller's role in the collection's club. */
  role: ClubRole | null;
  /** May change it: its person, the club's admins and managers, or (official) any moderator. */
  curator: boolean;
  /** Sees every entry: curators, club members, and moderators. */
  insider: boolean;
}

async function accessTo(user: User | null, c: Collection): Promise<Access> {
  if (!user) return { role: null, curator: false, insider: false };
  const role = c.orgId ? await roleIn(user.id, c.orgId) : null;
  const curator = c.orgId ? atLeast(role, 'manager') : c.ownerUserId === user.id || (c.official && canModerate(user));
  return { role, curator, insider: curator || !!role || canModerate(user) };
}

/** Who it's by: the club's name, or the curator's. */
async function byNames(rows: readonly Collection[]): Promise<(c: Collection) => string> {
  const owner = (c: Collection) => ({ ownerUserId: c.orgId ? null : c.ownerUserId, ownerOrgId: c.orgId });
  const name = await ownerNames(rows.map(owner));
  return (c) => name(owner(c));
}

function listOut(c: Collection, shown: Shown[], by: string) {
  return {
    id: c.id,
    title: c.title,
    description: c.description,
    featured: c.featured,
    official: c.official,
    by,
    audience: c.audience,
    club: c.orgId !== null,
    itemCount: shown.length,
    modules: shown.filter((i) => i.kind === 'module').length,
    parts: shown.filter((i) => i.kind === 'part').length,
    coverUrl: coverFrom(c, shown),
    updatedAt: c.updatedAt.getTime(),
  };
}

/** How a library module stands in the catalog, for its curators (in a public collection). */
function reviewOf(s: Shown, on: Set<Kind>): { state: 'public' | 'in_review' | 'declined' | 'unpublished' | 'not_shared' | 'catalog_off'; reason: string | null } | null {
  if (s.source !== 'library') return null;
  const it = s.catalog;
  if (it && isPublicItem(it, on)) return { state: 'public', reason: null };
  if (!on.has('module')) return { state: 'catalog_off', reason: null };
  if (!it || it.status === 'withdrawn') return { state: 'not_shared', reason: null };
  if (it.status === 'public' || it.status === 'in_review') return { state: 'in_review', reason: null };
  return { state: it.status === 'declined' ? 'declined' : 'unpublished', reason: it.reason };
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
    const pending = d
      ? { ...d, ...(d.itemIds ? { itemIds: d.itemIds.filter((x) => x !== item.id) } : {}), coverItemId: d.coverItemId === item.id ? null : d.coverItemId }
      : null;
    // A waiting change of items only that has nothing left in it is dropped.
    const keep = pending && !(pending.itemIds && pending.itemIds.length === 0);
    const note = (c.curatorNote ? `${c.curatorNote}\n${line}` : line).slice(-MAX_NOTE);
    await db
      .update(schema.catalogCollections)
      .set({
        curatorNote: note,
        coverItemId: c.coverItemId === item.id ? null : c.coverItemId,
        pending: keep ? JSON.stringify(pending) : null,
        pendingAt: keep ? c.pendingAt : null,
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

/**
 * A module that was deleted, or moved away from its club or person, leaves
 * the collections it no longer belongs in (all of them when `stillOrgId` is
 * null and it's being deleted), and their curators get a note. Returns the
 * collections it left.
 */
export async function dropModuleFromCollections(
  m: Pick<ModuleRow, 'id' | 'title'>,
  why: string,
  stillOrgId: string | null,
  actorId: string | null,
): Promise<{ id: string; orgId: string | null; ownerUserId: string | null }[]> {
  const rows = await db
    .select({ c: schema.catalogCollections })
    .from(schema.catalogCollectionModules)
    .innerJoin(schema.catalogCollections, eq(schema.catalogCollections.id, schema.catalogCollectionModules.collectionId))
    .where(eq(schema.catalogCollectionModules.moduleId, m.id));
  const leaving = rows.map((r) => r.c).filter((c) => !stillOrgId || c.orgId !== stillOrgId);
  if (!leaving.length) return [];
  const now = new Date();
  const line = `“${m.title}” was ${why}, so it was taken out of this collection.`;
  for (const c of leaving) {
    await db
      .delete(schema.catalogCollectionModules)
      .where(and(eq(schema.catalogCollectionModules.collectionId, c.id), eq(schema.catalogCollectionModules.moduleId, m.id)));
    const d = parseDraft(c.pending);
    await db
      .update(schema.catalogCollections)
      .set({
        curatorNote: (c.curatorNote ? `${c.curatorNote}\n${line}` : line).slice(-MAX_NOTE),
        coverModuleId: c.coverModuleId === m.id ? null : c.coverModuleId,
        ...(d && d.coverModuleId === m.id ? { pending: JSON.stringify({ ...d, coverModuleId: null }) } : {}),
        updatedAt: now,
      })
      .where(eq(schema.catalogCollections.id, c.id));
    await writeAuditEvent({
      resourceKind: 'catalog_collection',
      resourceId: c.id,
      userId: actorId,
      eventType: 'collection_item_removed',
      payload: { moduleId: m.id, title: m.title, why },
    });
  }
  return leaving.map((c) => ({ id: c.id, orgId: c.orgId, ownerUserId: c.ownerUserId }));
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

/** Not there, or not for the caller's eyes: the same answer. */
const NOT_FOUND = { code: 404, body: { error: 'not_found' } } as const;

/** The caller may not change this collection: 404 to outsiders, 403 to those who can see it. */
async function refuseEdit(user: User, c: Collection): Promise<{ code: number; body: unknown } | null> {
  const a = await accessTo(user, c);
  if (a.curator) return null;
  if (a.insider || isListed(c)) return { code: 403, body: { error: 'forbidden' } };
  return NOT_FOUND;
}

type Outcome = { code: number; body: unknown };

/**
 * A change to a collection: its text, its entries, who sees it, and (club
 * collections) whether it's pinned. Only text and audience are reviewed.
 */
async function editCollection(user: User, c: Collection, body: Record<string, unknown>): Promise<Outcome> {
  if (isDemoUser(user)) return { code: 403, body: { error: 'demo_account_cannot_submit' } };
  const refused = await refuseEdit(user, c);
  if (refused) return refused;
  const on = await kindsOn();
  const now = new Date();

  // Pinning (club collections) changes nothing else.
  if (body.pinned !== undefined) {
    if (typeof body.pinned !== 'boolean' || !c.orgId) return { code: 400, body: { error: 'invalid_input' } };
    await db.update(schema.catalogCollections).set({ pinned: body.pinned, updatedAt: now }).where(eq(schema.catalogCollections.id, c.id));
    await writeAuditEvent({ resourceKind: 'catalog_collection', resourceId: c.id, userId: user.id, eventType: 'collection_pin', payload: { pinned: body.pinned } });
    if (Object.keys(body).length === 1) return { code: 200, body: { id: c.id, status: c.status, audience: c.audience, pending: c.pending !== null, pinned: body.pinned } };
  }

  const had = await entriesOf(c);
  const entries = readEntries(body, had);
  if (!entries) return { code: 400, body: { error: 'invalid_input' } };
  const bad = await checkEntries(entries, c, on, had);
  if (bad) return { code: bad.code, body: { error: bad.error, ...(bad.itemId ? { itemId: bad.itemId } : {}) } };
  const waiting = parseDraft(c.pending);
  const shownText: Text = waiting
    ? { title: waiting.title, description: waiting.description, coverItemId: waiting.coverItemId, coverModuleId: waiting.coverModuleId ?? null }
    : textOf(c);
  const text = readText(body, shownText, entries);
  if (isFail(text)) return { code: text.code, body: { error: text.error } };
  const audience = readAudience(body.audience, c.audience);
  if (!audience) return { code: 400, body: { error: 'invalid_input' } };
  if (audience === 'everyone' && !on.size) return { code: 404, body: { error: 'catalog_off' } };

  // Items are never reviewed with the collection.
  await applyEntries(c.id, entries);
  const straight = canModerate(user) || (await getPlatformSettings()).catalogReview === 'none';
  let status = c.status;
  let reviewed = false;
  if (audience === 'private') {
    // Private: no review. It's live for its curator or club.
    await applyText(c.id, text, now);
    status = 'public';
    await db
      .update(schema.catalogCollections)
      .set({ audience, status, featured: false, reason: null, pending: null, pendingAt: null })
      .where(eq(schema.catalogCollections.id, c.id));
  } else if (c.audience === 'private' || c.status === 'withdrawn') {
    // Made public (again): its text goes for review.
    await applyText(c.id, text, now);
    status = straight ? 'public' : 'in_review';
    reviewed = !straight;
    await db
      .update(schema.catalogCollections)
      .set({ audience, status, reason: null, pending: null, pendingAt: null })
      .where(eq(schema.catalogCollections.id, c.id));
  } else if (straight && !(c.status === 'unpublished' && !canModerate(user))) {
    // A moderator's change, or review is off: public at once.
    await applyText(c.id, text, now);
    status = 'public';
    await db
      .update(schema.catalogCollections)
      .set({ status, reason: null, pending: null, pendingAt: null })
      .where(eq(schema.catalogCollections.id, c.id));
  } else if (c.status === 'public') {
    if (sameText(text, textOf(c))) {
      // Back to what's public: nothing waits any more.
      if (waiting) await db.update(schema.catalogCollections).set({ pending: null, pendingAt: null, updatedAt: now }).where(eq(schema.catalogCollections.id, c.id));
      else await db.update(schema.catalogCollections).set({ updatedAt: now }).where(eq(schema.catalogCollections.id, c.id));
    } else if (!waiting || !sameText(text, shownText)) {
      reviewed = true;
      await db
        .update(schema.catalogCollections)
        .set({ pending: JSON.stringify(text), pendingAt: now, reason: null, updatedAt: now })
        .where(eq(schema.catalogCollections.id, c.id));
    } else {
      await db.update(schema.catalogCollections).set({ updatedAt: now }).where(eq(schema.catalogCollections.id, c.id));
    }
  } else {
    // Waiting, declined or taken down (which, even with review off, only
    // goes back up through review): a change to its text is reviewed again.
    const changed = !sameText(text, textOf(c));
    await applyText(c.id, text, now);
    if (changed || c.status === 'in_review') {
      status = 'in_review';
      reviewed = changed;
      await db.update(schema.catalogCollections).set({ status, reason: null }).where(eq(schema.catalogCollections.id, c.id));
    }
  }
  const pending = (await getCollection(c.id))?.pending != null;
  const shared = audience === 'everyone' ? await shareModules(user, { title: text.title }, entries) : { submitted: [], notShared: [] };
  await writeAuditEvent({
    resourceKind: 'catalog_collection',
    resourceId: c.id,
    userId: user.id,
    eventType: 'collection_edit',
    payload: { title: text.title, items: entries.length, audience, reviewed, pending, shared: shared.submitted.length },
  });
  return { code: 200, body: { id: c.id, status, audience, pending, ...shared } };
}

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
      .where(and(eq(schema.catalogCollections.status, 'public'), eq(schema.catalogCollections.audience, 'everyone')))
      .orderBy(desc(schema.catalogCollections.featured), desc(schema.catalogCollections.official), desc(schema.catalogCollections.updatedAt))
      .limit(200);
    const shown = await shownOf(rows, on, () => false);
    const name = await byNames(rows);
    const out = [];
    for (const c of rows) {
      const s = shown.get(c.id) ?? [];
      if (s.length) out.push(listOut(c, s, name(c)));
    }
    return { collections: out };
  });

  // The caller's own collections (not their clubs') and how they stand.
  app.get('/api/catalog/collections/mine', async (req) => {
    const user = requireUser(req);
    const on = await kindsOn();
    const rows = await db
      .select()
      .from(schema.catalogCollections)
      .where(and(eq(schema.catalogCollections.ownerUserId, user.id), isNull(schema.catalogCollections.orgId)))
      .orderBy(desc(schema.catalogCollections.updatedAt));
    const shown = await shownOf(rows, on, () => true);
    return {
      collections: rows.map((c) => ({
        ...listOut(c, shown.get(c.id) ?? [], user.displayName),
        status: c.status,
        reason: c.reason,
        pending: c.pending !== null,
        curatorNote: c.curatorNote,
      })),
    };
  });

  // The collections of the caller's clubs (or of one club, `?club=slug`),
  // pinned ones first. Members see them all; curators also see empty ones.
  app.get<{ Querystring: { club?: string } }>('/api/catalog/collections/clubs', async (req, reply) => {
    const user = requireUser(req);
    const on = await kindsOn();
    const mine = await db
      .select({ id: schema.orgs.id, slug: schema.orgs.slug, name: schema.orgs.name, role: schema.orgMembers.role })
      .from(schema.orgMembers)
      .innerJoin(schema.orgs, eq(schema.orgs.id, schema.orgMembers.orgId))
      .where(eq(schema.orgMembers.userId, user.id))
      .orderBy(asc(schema.orgs.name));
    const wanted = typeof req.query?.club === 'string' && req.query.club ? req.query.club.trim().toLowerCase() : null;
    const clubs = wanted ? mine.filter((m) => m.slug === wanted) : mine;
    if (wanted && !clubs.length) return reply.code(404).send({ error: 'org_not_found' });
    const rows = clubs.length
      ? await db
          .select()
          .from(schema.catalogCollections)
          .where(inArray(schema.catalogCollections.orgId, clubs.map((c) => c.id)))
          .orderBy(desc(schema.catalogCollections.pinned), desc(schema.catalogCollections.updatedAt))
      : [];
    const shown = await shownOf(rows, on, () => true);
    const curators = await ownerNames(rows.map((c) => ({ ownerUserId: c.ownerUserId, ownerOrgId: null })));
    return {
      clubs: clubs.map((club) => {
        const curates = atLeast(club.role, 'manager');
        return {
          id: club.id,
          slug: club.slug,
          name: club.name,
          myRole: club.role,
          canCurate: curates,
          collections: rows
            .filter((c) => c.orgId === club.id && (curates || (shown.get(c.id) ?? []).length > 0))
            .map((c) => ({
              ...listOut(c, shown.get(c.id) ?? [], club.name),
              pinned: c.pinned,
              status: c.status,
              reason: curates ? c.reason : null,
              pending: c.pending !== null,
              curatorNote: curates ? c.curatorNote : null,
              curator: curators({ ownerUserId: c.ownerUserId, ownerOrgId: null }),
            })),
        };
      }),
    };
  });

  app.get<{ Params: { id: string } }>('/api/catalog/collections/:id', { config: TOKEN_READ }, async (req, reply) => {
    const on = await kindsOn();
    const c = await getCollection(req.params.id);
    if (!c) return reply.code(404).send({ error: 'not_found' });
    const user = req.user ?? null;
    const a = await accessTo(user, c);
    if (!a.insider && !on.size) return reply.code(404).send({ error: 'catalog_off' });
    const shown = (await shownOf([c], on, () => a.insider)).get(c.id) ?? [];
    if (!a.insider && (!isListed(c) || shown.length === 0)) return reply.code(404).send({ error: 'not_found' });
    if (!a.insider && !(await mayBrowse(req))) return reply.code(401).send({ error: 'unauthorized' });
    const by = (await byNames([c]))(c);
    const itemBy = await ownerNames(shown.flatMap((s) => (s.item ? [s.item] : [])));
    const club = c.orgId ? await db.select({ id: schema.orgs.id, slug: schema.orgs.slug, name: schema.orgs.name }).from(schema.orgs).where(eq(schema.orgs.id, c.orgId)).get() : null;
    const d = a.curator || (a.insider && canModerate(user)) ? parseDraft(c.pending) : null;
    const showReview = a.curator && c.audience === 'everyone';
    return {
      collection: {
        ...listOut(c, shown, by),
        coverItemId: c.coverItemId,
        coverModuleId: c.coverModuleId,
        status: c.status,
        reason: a.curator || (a.insider && canModerate(user)) ? c.reason : null,
        pending: d
          ? { title: d.title, description: d.description, coverItemId: d.coverItemId, coverModuleId: d.coverModuleId ?? null, coverUrl: coverFrom({ coverItemId: d.coverItemId, coverModuleId: d.coverModuleId ?? null }, shown) }
          : null,
        curatorNote: a.curator ? c.curatorNote : null,
        canEdit: a.curator,
        pinned: c.pinned,
        clubInfo: club ? { slug: club.slug, name: club.name } : null,
        myRole: a.role,
        // A site moderator may take a club collection down (abuse).
        canRemove: !!user && canModerate(user) && !!c.orgId,
      },
      items: shown.map((s) =>
        s.source === 'catalog' && s.item
          ? { ...itemOut(s.item, itemBy(s.item)), source: 'catalog' as const }
          : {
              id: s.id,
              kind: 'module' as const,
              source: 'library' as const,
              title: s.title,
              description: '',
              tags: [],
              by: club?.name ?? by,
              uses: 0,
              version: s.module?.latestVersion ?? 0,
              updatedAt: s.module?.updatedAt.getTime() ?? 0,
              previewUrl: s.previewUrl,
              ...(showReview ? { review: reviewOf(s, on) } : {}),
            },
      ),
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
      const body = req.body ?? {};
      const on = await kindsOn();
      const audience = readAudience(body.audience, 'everyone');
      if (!audience) return reply.code(400).send({ error: 'invalid_input' });
      if (audience === 'everyone' && !on.size) return reply.code(404).send({ error: 'catalog_off' });
      // A club collection: its admins and managers make them.
      let orgId: string | null = null;
      if (body.clubSlug !== undefined && body.clubSlug !== null && body.clubSlug !== '') {
        const org =
          typeof body.clubSlug === 'string'
            ? await db.select({ id: schema.orgs.id }).from(schema.orgs).where(eq(schema.orgs.slug, body.clubSlug.trim().toLowerCase())).get()
            : null;
        const role = org ? await roleIn(user.id, org.id) : null;
        if (!org || !role) return reply.code(404).send({ error: 'org_not_found' });
        if (!atLeast(role, 'manager')) return reply.code(403).send({ error: 'only_club_admins_can_curate' });
        orgId = org.id;
      }
      const owner = { orgId, ownerUserId: user.id };
      const entries = readEntries(body, []);
      if (!entries) return reply.code(400).send({ error: 'invalid_input' });
      const bad = await checkEntries(entries, owner, on, []);
      if (bad) return reply.code(bad.code).send({ error: bad.error, ...(bad.itemId ? { itemId: bad.itemId } : {}) });
      const text = readText(body, null, entries);
      if (isFail(text)) return reply.code(text.code).send({ error: text.error });
      const staff = canModerate(user);
      const straight = audience === 'private' || staff || (await getPlatformSettings()).catalogReview === 'none';
      const id = randomUUID();
      const now = new Date();
      const status = straight ? 'public' : 'in_review';
      await db.insert(schema.catalogCollections).values({
        id,
        title: text.title,
        description: text.description,
        ownerUserId: user.id,
        orgId,
        audience,
        // A moderator's own public collection is official (it may be featured).
        official: staff && !orgId && audience === 'everyone',
        status,
        createdAt: now,
        updatedAt: now,
      });
      await applyEntries(id, entries);
      await applyText(id, text, now);
      const shared = audience === 'everyone' ? await shareModules(user, text, entries) : { submitted: [], notShared: [] };
      await writeAuditEvent({
        resourceKind: 'catalog_collection',
        resourceId: id,
        userId: user.id,
        eventType: 'collection_submit',
        payload: { title: text.title, items: entries.length, official: staff, straight, audience, orgId, shared: shared.submitted.length },
      });
      return reply.code(201).send({ id, status, audience, ...shared });
    },
  );

  // A change. Text (and making it public) is reviewed; items never are.
  app.patch<{ Params: { id: string }; Body: Record<string, unknown> }>(
    '/api/catalog/collections/:id',
    // codeql[js/missing-rate-limiting] - rate limited via Fastify config.rateLimit
    { config: { rateLimit: { max: 30, timeWindow: '1 hour' } } },
    async (req, reply) => {
      const user = requireUser(req);
      const c = await getCollection(req.params.id);
      if (!c) return reply.code(404).send({ error: 'not_found' });
      const r = await editCollection(user, c, req.body ?? {});
      return reply.code(r.code).send(r.body);
    },
  );

  // "Add to a collection…": one more catalog item at the end. Never reviewed.
  app.post<{ Params: { id: string }; Body: { itemId?: unknown } }>(
    '/api/catalog/collections/:id/items',
    // codeql[js/missing-rate-limiting] - rate limited via Fastify config.rateLimit
    { config: { rateLimit: { max: 60, timeWindow: '1 hour' } } },
    async (req, reply) => {
      const user = requireUser(req);
      const c = await getCollection(req.params.id);
      if (!c) return reply.code(404).send({ error: 'not_found' });
      const itemId = req.body?.itemId;
      if (typeof itemId !== 'string' || !itemId) return reply.code(400).send({ error: 'invalid_input' });
      const refused = await refuseEdit(user, c);
      if (refused) return reply.code(refused.code).send(refused.body);
      const had = await entriesOf(c);
      if (had.some((e) => e.source === 'catalog' && e.id === itemId)) return reply.code(409).send({ error: 'already_in_collection' });
      const r = await editCollection(user, c, { entries: [...had, { source: 'catalog', id: itemId }] });
      return reply.code(r.code).send(r.body);
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
      const refused = await refuseEdit(user, c);
      if (refused) return reply.code(refused.code).send(refused.body);
      await db
        .update(schema.catalogCollections)
        .set({ status: 'withdrawn', featured: false, pending: null, pendingAt: null, updatedAt: new Date() })
        .where(eq(schema.catalogCollections.id, c.id));
      await writeAuditEvent({ resourceKind: 'catalog_collection', resourceId: c.id, userId: user.id, eventType: 'collection_withdraw', payload: {} });
      return { ok: true };
    },
  );

  // Delete it for good (its curators). Copies people added keep working.
  app.delete<{ Params: { id: string } }>(
    '/api/catalog/collections/:id',
    // codeql[js/missing-rate-limiting] - rate limited via Fastify config.rateLimit
    { config: { rateLimit: { max: 30, timeWindow: '1 hour' } } },
    async (req, reply) => {
      const user = requireUser(req);
      const c = await getCollection(req.params.id);
      if (!c) return reply.code(404).send({ error: 'not_found' });
      const refused = await refuseEdit(user, c);
      if (refused) return reply.code(refused.code).send(refused.body);
      await db.delete(schema.catalogCollections).where(eq(schema.catalogCollections.id, c.id));
      await writeAuditEvent({
        resourceKind: 'catalog_collection',
        resourceId: c.id,
        userId: user.id,
        eventType: 'collection_delete',
        payload: { title: c.title, orgId: c.orgId, audience: c.audience },
      });
      return { ok: true };
    },
  );

  // A curator has read the note about items that left.
  app.post<{ Params: { id: string } }>('/api/catalog/collections/:id/dismiss-note', async (req, reply) => {
    const user = requireUser(req);
    const c = await getCollection(req.params.id);
    if (!c || !(await accessTo(user, c)).curator) return reply.code(404).send({ error: 'not_found' });
    await db.update(schema.catalogCollections).set({ curatorNote: null }).where(eq(schema.catalogCollections.id, c.id));
    return { ok: true };
  });

  // ---- add all -------------------------------------------------------------
  // Every item the caller can see to them or a club; ones they already have
  // (a copy from the catalog, a copy of the module, or the module itself)
  // are skipped, so nothing is duplicated.
  app.post<{ Params: { id: string }; Body: { orgSlug?: unknown } }>(
    '/api/catalog/collections/:id/add',
    // codeql[js/missing-rate-limiting] - rate limited via Fastify config.rateLimit
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' }, apiToken: ['layouts:write', 'parts:write'] as const } },
    async (req, reply) => {
      const user = requireUser(req);
      const on = await kindsOn();
      const c = await getCollection(req.params.id);
      if (!c) return reply.code(404).send({ error: 'not_found' });
      const a = await accessTo(user, c);
      // Club members and the curator add from it; others only from a listed one.
      const member = a.curator || !!a.role;
      const shown = (await shownOf([c], on, () => member)).get(c.id) ?? [];
      if (!shown.length || (!member && !isListed(c))) return reply.code(404).send({ error: 'not_found' });
      const dest = await destinationOrg(user.id, req.body?.orgSlug);
      if (!dest.ok) return reply.code(dest.code).send({ error: dest.error });
      const owner = dest.orgId ? { kind: 'org' as const, id: dest.orgId } : { kind: 'user' as const, id: user.id };
      const haveItems = await alreadyHave(shown.filter((s) => s.source === 'catalog').map((s) => s.id), owner);
      const haveMods = await alreadyHaveModules(shown.flatMap((s) => (s.module ? [s.module] : [])), owner);
      const added: { itemId: string; kind: Kind; id: string }[] = [];
      const skipped: string[] = [];
      const failed: { itemId: string; error: string }[] = [];
      for (const s of shown) {
        if (s.source === 'catalog' && s.item) {
          if (haveItems.has(s.id)) {
            skipped.push(s.id);
            continue;
          }
          const r = await copyItemTo(user, s.item, dest.orgId);
          if (r.ok) added.push({ itemId: s.id, kind: s.item.kind, id: r.id });
          // A part with that number is already there: they have it.
          else if (r.code === 409) skipped.push(s.id);
          else failed.push({ itemId: s.id, error: (r.body as { error?: string })?.error ?? 'failed' });
        } else if (s.module) {
          if (haveMods.has(s.id)) {
            skipped.push(s.id);
            continue;
          }
          const src = await db.select().from(schema.modules).where(eq(schema.modules.id, s.id)).get();
          if (!src) continue;
          const r = await copyModuleTo(user, src, dest.orgId, src.title);
          if (r.ok) added.push({ itemId: s.id, kind: 'module', id: r.id });
          else failed.push({ itemId: s.id, error: (r.body as { error?: string })?.error ?? 'failed' });
        }
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
  // The queue holds only collection *text* (title, description, cover):
  // each item is reviewed on its own, in the catalog items queue.
  app.get('/api/moderation/collections', async (req) => {
    requireModerator(req);
    const everyone = eq(schema.catalogCollections.audience, 'everyone');
    const queueRows = await db
      .select()
      .from(schema.catalogCollections)
      .where(
        and(
          everyone,
          or(eq(schema.catalogCollections.status, 'in_review'), and(eq(schema.catalogCollections.status, 'public'), isNotNull(schema.catalogCollections.pending))),
        ),
      )
      .orderBy(asc(schema.catalogCollections.updatedAt));
    const listed = await db
      .select()
      .from(schema.catalogCollections)
      .where(and(everyone, inArray(schema.catalogCollections.status, ['public', 'unpublished'])))
      .orderBy(desc(schema.catalogCollections.featured), desc(schema.catalogCollections.updatedAt))
      .limit(500);
    // Club-only collections, for abuse handling: see and remove.
    const clubRows = await db
      .select()
      .from(schema.catalogCollections)
      .where(and(isNotNull(schema.catalogCollections.orgId), ne(schema.catalogCollections.audience, 'everyone')))
      .orderBy(desc(schema.catalogCollections.updatedAt))
      .limit(500);
    const on = await kindsOn();
    const all = [...queueRows, ...listed, ...clubRows];
    const shownAll = await shownOf([...new Map(all.map((c) => [c.id, c])).values()], on, () => true);
    const shownPublic = await shownOf([...new Map([...queueRows, ...listed].map((c) => [c.id, c])).values()], on, () => false);
    const name = await byNames(all);
    const ownerIds = [...new Set(queueRows.map((c) => c.ownerUserId).filter((x): x is string => !!x))];
    const emails = ownerIds.length
      ? new Map((await db.select({ id: schema.users.id, email: schema.users.email }).from(schema.users).where(inArray(schema.users.id, ownerIds))).map((u) => [u.id, u.email]))
      : new Map<string, string>();
    const ownerRef = (c: Collection) => (c.orgId ? { kind: 'org' as const, id: c.orgId } : c.ownerUserId ? { kind: 'user' as const, id: c.ownerUserId } : null);
    const queue = queueRows.map((c) => {
      const d = parseDraft(c.pending);
      const all = shownAll.get(c.id) ?? [];
      const current = { title: c.title, description: c.description, coverUrl: coverFrom(c, all) };
      const proposed = d ? { title: d.title, description: d.description, coverUrl: coverFrom({ coverItemId: d.coverItemId, coverModuleId: d.coverModuleId ?? null }, all) } : current;
      return {
        id: c.id,
        isUpdate: d !== null,
        by: name(c),
        email: c.ownerUserId ? (emails.get(c.ownerUserId) ?? null) : null,
        createdAt: (c.pendingAt ?? c.updatedAt).getTime(),
        owner: ownerRef(c),
        ...proposed,
        /** What's public now, for a change ("old vs new"). */
        old: d ? current : null,
        itemCount: all.length,
      };
    });
    return {
      queue,
      collections: listed.map((c) => ({ ...listOut(c, shownPublic.get(c.id) ?? [], name(c)), status: c.status, reason: c.reason, owner: ownerRef(c) })),
      clubCollections: clubRows.map((c) => ({ ...listOut(c, shownAll.get(c.id) ?? [], name(c)), owner: ownerRef(c) })),
    };
  });

  const decide = async (req: FastifyRequest<{ Params: { id: string }; Body: { reason?: unknown } }>, approve: boolean) => {
    const user = requireModerator(req);
    const c = await getCollection(req.params.id);
    const waiting = !!c && c.audience === 'everyone' && (c.status === 'in_review' || (c.status === 'public' && c.pending !== null));
    if (!c || !waiting) return { code: 404, body: { error: 'not_found' } };
    const reason = cleanText(req.body?.reason, MAX_REASON);
    if (reason === undefined) return { code: 400, body: { error: 'invalid_input' } };
    const now = new Date();
    const d = parseDraft(c.pending);
    if (approve) {
      if (d) {
        const entries = await entriesOf(c);
        const has = (s: Entry['source'], id: string | null | undefined) => !!id && entries.some((e) => e.source === s && e.id === id);
        await applyText(
          c.id,
          {
            title: d.title,
            description: d.description,
            coverItemId: has('catalog', d.coverItemId) ? d.coverItemId : null,
            coverModuleId: has('library', d.coverModuleId) ? (d.coverModuleId ?? null) : null,
          },
          now,
        );
        // A change from before items were reviewed on their own.
        if (d.itemIds) {
          const on = await kindsOn();
          const still = d.itemIds.length ? await db.select().from(schema.catalogItems).where(inArray(schema.catalogItems.id, d.itemIds)) : [];
          const ok = new Set(still.filter((i) => isPublicItem(i, on)).map((i) => i.id));
          const mods = entries.filter((e) => e.source === 'library');
          await applyEntries(c.id, [...d.itemIds.filter((x) => ok.has(x)).map((id) => ({ source: 'catalog' as const, id })), ...mods]);
        }
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
    // A private collection isn't in the catalog: it can only be removed.
    if (c.audience !== 'everyone') return reply.code(409).send({ error: 'not_public' });
    await db
      .update(schema.catalogCollections)
      .set({ status: 'unpublished', featured: false, reason, pending: null, pendingAt: null, updatedAt: new Date() })
      .where(eq(schema.catalogCollections.id, c.id));
    await writeAuditEvent({ resourceKind: 'catalog_collection', resourceId: c.id, userId: user.id, eventType: 'collection_unpublish', payload: { reason } });
    return { ok: true };
  });

  // Remove a club collection for good (abuse handling). Audit-logged.
  app.post<{ Params: { id: string }; Body: { reason?: unknown } }>('/api/moderation/collections/:id/remove', async (req, reply) => {
    const user = requireModerator(req);
    const reason = cleanText(req.body?.reason, MAX_REASON);
    if (reason === undefined) return reply.code(400).send({ error: 'invalid_input' });
    const c = await getCollection(req.params.id);
    if (!c || !c.orgId) return reply.code(404).send({ error: 'not_found' });
    await db.delete(schema.catalogCollections).where(eq(schema.catalogCollections.id, c.id));
    await writeAuditEvent({
      resourceKind: 'catalog_collection',
      resourceId: c.id,
      userId: user.id,
      eventType: 'collection_remove',
      payload: { reason, title: c.title, orgId: c.orgId, curator: c.ownerUserId },
    });
    return { ok: true };
  });

  // Featured: official collections only (moderators' and admins' own).
  app.post<{ Params: { id: string }; Body: { featured?: unknown } }>('/api/moderation/collections/:id/feature', async (req, reply) => {
    const user = requireModerator(req);
    if (typeof req.body?.featured !== 'boolean') return reply.code(400).send({ error: 'invalid_input' });
    const c = await getCollection(req.params.id);
    if (!c) return reply.code(404).send({ error: 'not_found' });
    if (req.body.featured && (!c.official || !isListed(c))) return reply.code(409).send({ error: 'not_featurable' });
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

/** Which of these modules `owner` already has: the module itself, or a copy made from it. */
async function alreadyHaveModules(mods: readonly Pick<ModuleRow, 'id' | 'ownerUserId' | 'ownerOrgId'>[], owner: { kind: 'user' | 'org'; id: string }): Promise<Set<string>> {
  if (!mods.length) return new Set();
  const own = mods.filter((m) => (owner.kind === 'org' ? m.ownerOrgId === owner.id : m.ownerUserId === owner.id && !m.ownerOrgId)).map((m) => m.id);
  const copies = await db
    .select({ from: schema.modules.copiedFromId })
    .from(schema.modules)
    .where(
      and(
        inArray(
          schema.modules.copiedFromId,
          mods.map((m) => m.id),
        ),
        owner.kind === 'org' ? eq(schema.modules.ownerOrgId, owner.id) : eq(schema.modules.ownerUserId, owner.id),
      ),
    );
  return new Set([...own, ...copies.map((c) => c.from).filter((x): x is string => !!x)]);
}

/** How many public collections each item is in (for its owner's badge). */
export async function collectionCounts(itemIds: string[]): Promise<Map<string, number>> {
  if (!itemIds.length) return new Map();
  const rows = await db
    .select({ itemId: schema.catalogCollectionItems.itemId, n: sql<number>`count(*)`.mapWith(Number) })
    .from(schema.catalogCollectionItems)
    .innerJoin(schema.catalogCollections, eq(schema.catalogCollections.id, schema.catalogCollectionItems.collectionId))
    .where(
      and(
        inArray(schema.catalogCollectionItems.itemId, itemIds),
        eq(schema.catalogCollections.status, 'public'),
        eq(schema.catalogCollections.audience, 'everyone'),
      ),
    )
    .groupBy(schema.catalogCollectionItems.itemId);
  return new Map(rows.map((r) => [r.itemId, r.n]));
}

export { itemsOf };

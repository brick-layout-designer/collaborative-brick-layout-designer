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
import { and, asc, desc, eq, inArray, isNotNull, isNull, like, ne, notInArray, or, sql } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import type { User } from '../db/schema.js';
import { requireUser } from '../auth/cookie.js';
import { isDemoUser } from '../demo/demoAccount.js';
import { getPlatformSettings } from '../auth/platformSettings.js';
import { writeAuditEvent } from '../audit/writeAuditEvent.js';
import { atLeast, type ClubRole } from '../access/clubRoles.js';
import { destinationOrg } from './owners.js';
import { canModerate, cleanText, copyItemTo, isTrustedClub, itemOut, mayBrowse, ownerNames, submitToCatalog, trustedClubs } from './catalog.js';
import { copyModuleTo } from './modules.js';
import { checkGrowth, type Subject } from '../limits/limits.js';
import { COVER_BODY_LIMIT, COVER_MIMES, coverMaxBytes, encodeCover, sniffCover, type CoverMime } from '../images/covers.js';

type Kind = 'module' | 'part';
type Audience = 'everyone' | 'private';
type Collection = typeof schema.catalogCollections.$inferSelect;
type Item = typeof schema.catalogItems.$inferSelect;
type ModuleRow = Pick<typeof schema.modules.$inferSelect, 'id' | 'title' | 'ownerUserId' | 'ownerOrgId' | 'thumbnailAt' | 'latestVersion' | 'updatedAt'>;
type PartRow = Pick<typeof schema.customParts.$inferSelect, 'id' | 'displayName' | 'partNumber' | 'ownerUserId' | 'ownerOrgId' | 'isGlobal' | 'updatedAt'>;

export const MAX_COLLECTION_ITEMS = 60;
const MAX_TITLE = 80;
const MAX_DESCRIPTION = 1000;
const MAX_REASON = 300;
const MAX_NOTE = 1500;
// The desktop app (an API token) browses collections and adds them.
const TOKEN_READ = { apiToken: 'layouts:read' } as const;

/**
 * An entry: a public catalog item, or one of the curator's (or the club's)
 * own modules or custom parts. Requests spell the last two
 * `{ source: 'library', kind: 'module' | 'part', id }`.
 */
export interface Entry {
  source: 'catalog' | 'module' | 'part';
  id: string;
}

/** A collection's text and presentation: what its review covers. */
export interface Text {
  title: string;
  description: string;
  coverItemId: string | null;
  coverModuleId: string | null;
  /** A picture its curators uploaded (catalog_collection_covers); it wins over the chosen item. */
  coverImageId: string | null;
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
  coverImageId?: string | null;
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

const partCols = {
  id: schema.customParts.id,
  displayName: schema.customParts.displayName,
  partNumber: schema.customParts.partNumber,
  ownerUserId: schema.customParts.ownerUserId,
  ownerOrgId: schema.customParts.ownerOrgId,
  isGlobal: schema.customParts.isGlobal,
  updatedAt: schema.customParts.updatedAt,
};

async function partRows(collectionIds: string[]): Promise<Map<string, { pos: number; part: PartRow }[]>> {
  const out = new Map<string, { pos: number; part: PartRow }[]>(collectionIds.map((id) => [id, []]));
  if (!collectionIds.length) return out;
  const rows = await db
    .select({ cid: schema.catalogCollectionParts.collectionId, pos: schema.catalogCollectionParts.position, part: partCols })
    .from(schema.catalogCollectionParts)
    .innerJoin(schema.customParts, eq(schema.customParts.id, schema.catalogCollectionParts.partId))
    .where(inArray(schema.catalogCollectionParts.collectionId, collectionIds))
    .orderBy(asc(schema.catalogCollectionParts.position));
  for (const r of rows) out.get(r.cid)?.push({ pos: r.pos, part: r.part });
  return out;
}

/**
 * A module or part belongs with the collection: the club's own for a club
 * collection, else the curator's own (never a site-wide part).
 */
const owns = (c: Pick<Collection, 'orgId' | 'ownerUserId'>, m: { ownerUserId: string | null; ownerOrgId: string | null; isGlobal?: boolean }) =>
  !m.isGlobal && (c.orgId ? m.ownerOrgId === c.orgId : !!c.ownerUserId && m.ownerUserId === c.ownerUserId && !m.ownerOrgId);

/** One entry as a viewer sees it. */
export interface Shown {
  source: 'catalog' | 'library';
  /** The catalog item's id, or the module's or part's. */
  id: string;
  kind: Kind;
  title: string;
  previewUrl: string;
  item?: Item;
  module?: ModuleRow;
  part?: PartRow;
  /** A library module's or part's catalog item, if it was ever shared. */
  catalog?: Item | null;
}

const itemPreview = (i: Pick<Item, 'id' | 'publicVersion'>) => `/api/catalog/items/${i.id}/preview?v=${i.publicVersion}`;
const modulePreview = (m: Pick<ModuleRow, 'id' | 'thumbnailAt'>) => `/api/modules/${m.id}/thumbnail?v=${m.thumbnailAt?.getTime() ?? 0}`;

const partPreview = (p: Pick<PartRow, 'id' | 'updatedAt'>) => `/api/custom-parts/${p.id}/sprite?v=${p.updatedAt.getTime()}`;

/** The catalog item shared from each of these modules (or parts), if any. */
async function catalogItemsFor(kind: Kind, sourceIds: string[]): Promise<Map<string, Item>> {
  if (!sourceIds.length) return new Map();
  const rows = await db
    .select()
    .from(schema.catalogItems)
    .where(and(eq(schema.catalogItems.kind, kind), inArray(schema.catalogItems.sourceId, sourceIds)));
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
  const parts = await partRows(ids);
  const shared = await catalogItemsFor('module', [...mods.values()].flat().map((r) => r.module.id));
  const sharedParts = await catalogItemsFor('part', [...parts.values()].flat().map((r) => r.part.id));
  const out = new Map<string, Shown[]>();
  for (const c of cs) {
    const inside = insider(c);
    const rows: { pos: number; s: Shown }[] = [];
    for (const r of items.get(c.id) ?? []) {
      if (!isPublicItem(r.item, on)) continue;
      rows.push({ pos: r.pos, s: { source: 'catalog', id: r.item.id, kind: r.item.kind, title: r.item.title, previewUrl: itemPreview(r.item), item: r.item } });
    }
    for (const r of mods.get(c.id) ?? []) {
      if (!owns(c, r.module)) continue;
      const item = shared.get(r.module.id) ?? null;
      if (inside) {
        rows.push({ pos: r.pos, s: { source: 'library', id: r.module.id, kind: 'module', title: r.module.title, previewUrl: modulePreview(r.module), module: r.module, catalog: item } });
      } else if (item && isPublicItem(item, on)) {
        rows.push({ pos: r.pos, s: { source: 'catalog', id: item.id, kind: 'module', title: item.title, previewUrl: itemPreview(item), item } });
      }
    }
    for (const r of parts.get(c.id) ?? []) {
      if (!owns(c, r.part)) continue;
      const item = sharedParts.get(r.part.id) ?? null;
      if (inside) {
        rows.push({ pos: r.pos, s: { source: 'library', id: r.part.id, kind: 'part', title: r.part.displayName, previewUrl: partPreview(r.part), part: r.part, catalog: item } });
      } else if (item && isPublicItem(item, on)) {
        rows.push({ pos: r.pos, s: { source: 'catalog', id: item.id, kind: 'part', title: item.title, previewUrl: itemPreview(item), item } });
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

/** An uploaded cover's address; `small` is the card-sized copy. */
export const coverImageUrl = (collectionId: string, imageId: string, small = false) =>
  `/api/catalog/collections/${collectionId}/cover?image=${imageId}${small ? '&size=small' : ''}`;

/**
 * The cover among what's shown: an uploaded picture (given the collection's
 * `id`), else the chosen entry, else the first module, else the first entry.
 */
export function coverFrom(
  t: Pick<Text, 'coverItemId' | 'coverModuleId'> & { id?: string; coverImageId?: string | null },
  shown: readonly Pick<Shown, 'source' | 'id' | 'kind' | 'previewUrl' | 'module' | 'item'>[],
  small = false,
): string | null {
  if (t.id && t.coverImageId) return coverImageUrl(t.id, t.coverImageId, small);
  const chosen = shown.find(
    (s) =>
      (t.coverItemId && s.source === 'catalog' && s.id === t.coverItemId) ||
      (t.coverModuleId && ((s.source === 'library' && s.kind === 'module' && s.id === t.coverModuleId) || (s.source === 'catalog' && s.item?.sourceId === t.coverModuleId))),
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
      coverImageId: typeof v.coverImageId === 'string' ? v.coverImageId : null,
      ...(Array.isArray(v.itemIds) ? { itemIds: v.itemIds.filter((x): x is string => typeof x === 'string') } : {}),
    };
  } catch {
    return null;
  }
}

const textOf = (c: Collection): Text => ({ title: c.title, description: c.description, coverItemId: c.coverItemId, coverModuleId: c.coverModuleId, coverImageId: c.coverImageId });
const sameText = (a: Text, b: Text) =>
  a.title === b.title && a.description === b.description && a.coverItemId === b.coverItemId && a.coverModuleId === b.coverModuleId && a.coverImageId === b.coverImageId;

/** Every entry, in order, whatever its state (what an edit starts from). */
async function entriesOf(c: Collection): Promise<Entry[]> {
  const items = (await itemRows([c.id])).get(c.id) ?? [];
  const mods = (await moduleRows([c.id])).get(c.id) ?? [];
  const parts = (await partRows([c.id])).get(c.id) ?? [];
  return [
    ...items.map((r) => ({ pos: r.pos, e: { source: 'catalog' as const, id: r.item.id } })),
    ...mods.filter((r) => owns(c, r.module)).map((r) => ({ pos: r.pos, e: { source: 'module' as const, id: r.module.id } })),
    ...parts.filter((r) => owns(c, r.part)).map((r) => ({ pos: r.pos, e: { source: 'part' as const, id: r.part.id } })),
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
      const x = e as { source?: unknown; kind?: unknown; id?: unknown } | null;
      if (!x || typeof x.id !== 'string' || !x.id) return null;
      let source: Entry['source'];
      if (x.source === 'catalog') source = 'catalog';
      else if (x.source === 'library' && (x.kind === undefined || x.kind === 'module')) source = 'module';
      else if (x.source === 'library' && x.kind === 'part') source = 'part';
      else return null;
      const key = `${source}:${x.id}`;
      if (!seen.has(key)) out.push({ source, id: x.id });
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
  const moduleIds = entries.filter((e) => e.source === 'module').map((e) => e.id);
  const partIds = entries.filter((e) => e.source === 'part').map((e) => e.id);
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
    if (!m || !owns(c, m)) return { ok: false, code: 400, error: c.orgId ? 'module_not_in_club' : 'module_not_yours', itemId: id };
  }
  const parts = partIds.length ? await db.select(partCols).from(schema.customParts).where(inArray(schema.customParts.id, partIds)) : [];
  const partById = new Map(parts.map((p) => [p.id, p]));
  for (const id of partIds) {
    const p = partById.get(id);
    if (!p || !owns(c, p)) return { ok: false, code: 400, error: c.orgId ? 'part_not_in_club' : 'part_not_yours', itemId: id };
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
  let coverModuleId = base?.coverModuleId && has('module', base.coverModuleId) ? base.coverModuleId : null;
  if (body.coverItemId !== undefined || body.coverModuleId !== undefined) {
    coverItemId = null;
    coverModuleId = null;
    if (typeof body.coverItemId === 'string' && body.coverItemId) {
      if (!has('catalog', body.coverItemId)) return { ok: false, code: 400, error: 'invalid_input' };
      coverItemId = body.coverItemId;
    } else if (typeof body.coverModuleId === 'string' && body.coverModuleId) {
      if (!has('module', body.coverModuleId)) return { ok: false, code: 400, error: 'invalid_input' };
      coverModuleId = body.coverModuleId;
    } else if (![undefined, null, ''].includes(body.coverItemId as string) || ![undefined, null, ''].includes(body.coverModuleId as string)) {
      return { ok: false, code: 400, error: 'invalid_input' };
    }
  }
  return { title, description: description ?? '', coverItemId, coverModuleId, coverImageId: base?.coverImageId ?? null };
}

/** An entry as requests spell it. */
const entryOut = (e: Entry) => (e.source === 'catalog' ? { source: 'catalog', id: e.id } : { source: 'library', kind: e.source, id: e.id });

const isFail = (x: unknown): x is Fail => !!x && typeof x === 'object' && (x as Fail).ok === false;

function readAudience(raw: unknown, base: Audience): Audience | null {
  if (raw === undefined) return base;
  return raw === 'everyone' || raw === 'private' ? raw : null;
}

/** Make the collection's public text `t`. */
async function applyText(id: string, t: Text, now: Date): Promise<void> {
  await db
    .update(schema.catalogCollections)
    .set({ title: t.title, description: t.description, coverItemId: t.coverItemId, coverModuleId: t.coverModuleId, coverImageId: t.coverImageId, updatedAt: now })
    .where(eq(schema.catalogCollections.id, id));
}

/** Make the collection's entries `entries`, in this order. */
async function applyEntries(id: string, entries: Entry[]): Promise<void> {
  await db.delete(schema.catalogCollectionItems).where(eq(schema.catalogCollectionItems.collectionId, id));
  await db.delete(schema.catalogCollectionModules).where(eq(schema.catalogCollectionModules.collectionId, id));
  await db.delete(schema.catalogCollectionParts).where(eq(schema.catalogCollectionParts.collectionId, id));
  const placed = entries.map((e, position) => ({ ...e, position }));
  const items = placed.filter((e) => e.source === 'catalog');
  const mods = placed.filter((e) => e.source === 'module');
  const parts = placed.filter((e) => e.source === 'part');
  if (items.length) await db.insert(schema.catalogCollectionItems).values(items.map((e) => ({ collectionId: id, itemId: e.id, position: e.position })));
  if (mods.length) await db.insert(schema.catalogCollectionModules).values(mods.map((e) => ({ collectionId: id, moduleId: e.id, position: e.position })));
  if (parts.length) await db.insert(schema.catalogCollectionParts).values(parts.map((e) => ({ collectionId: id, partId: e.id, position: e.position })));
}

/**
 * A public collection's own modules and parts that aren't in the catalog
 * yet are shared, each for its own review. Ones that were declined or
 * unpublished are left for their owner to share again.
 */
async function shareModules(user: User, c: Pick<Collection, 'title'>, entries: Entry[]): Promise<{ submitted: string[]; notShared: { id: string; error: string }[] }> {
  const submitted: string[] = [];
  const notShared: { id: string; error: string }[] = [];
  for (const kind of ['module', 'part'] as const) {
    const ids = entries.filter((e) => e.source === kind).map((e) => e.id);
    if (!ids.length) continue;
    const shared = await catalogItemsFor(kind, ids);
    for (const id of ids) {
      const it = shared.get(id);
      if (it && it.status !== 'withdrawn') continue;
      const r = await submitToCatalog(user, kind, id, { note: `Part of the collection “${c.title}”` });
      if (r.ok) submitted.push(id);
      else notShared.push({ id, error: (r.body as { error?: string })?.error ?? 'failed' });
    }
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
    coverUrl: coverFrom(c, shown, true),
    updatedAt: c.updatedAt.getTime(),
  };
}

/** How a library module or part stands in the catalog, for its curators (in a public collection). */
function reviewOf(s: Shown, on: Set<Kind>): { state: 'public' | 'in_review' | 'declined' | 'unpublished' | 'not_shared' | 'catalog_off'; reason: string | null } | null {
  if (s.source !== 'library') return null;
  const it = s.catalog;
  if (it && isPublicItem(it, on)) return { state: 'public', reason: null };
  if (!on.has(s.kind)) return { state: 'catalog_off', reason: null };
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
 * A module (or custom part) that was deleted, or moved away from its club,
 * leaves the collections it no longer belongs in (all of them when
 * `stillOrgId` is null), and their curators get a note. Returns the
 * collections it left.
 */
export async function dropModuleFromCollections(
  m: { id: string; title: string },
  why: string,
  stillOrgId: string | null,
  actorId: string | null,
  kind: Kind = 'module',
): Promise<{ id: string; orgId: string | null; ownerUserId: string | null }[]> {
  const table = kind === 'module' ? schema.catalogCollectionModules : schema.catalogCollectionParts;
  const col = kind === 'module' ? schema.catalogCollectionModules.moduleId : schema.catalogCollectionParts.partId;
  const rows = await db
    .select({ c: schema.catalogCollections })
    .from(table)
    .innerJoin(schema.catalogCollections, eq(schema.catalogCollections.id, table.collectionId))
    .where(eq(col, m.id));
  const leaving = rows.map((r) => r.c).filter((c) => !stillOrgId || c.orgId !== stillOrgId);
  if (!leaving.length) return [];
  const now = new Date();
  const line = `“${m.title}” was ${why}, so it was taken out of this collection.`;
  for (const c of leaving) {
    await db.delete(table).where(and(eq(table.collectionId, c.id), eq(col, m.id)));
    const d = parseDraft(c.pending);
    const wasCover = kind === 'module' && c.coverModuleId === m.id;
    await db
      .update(schema.catalogCollections)
      .set({
        curatorNote: (c.curatorNote ? `${c.curatorNote}\n${line}` : line).slice(-MAX_NOTE),
        coverModuleId: wasCover ? null : c.coverModuleId,
        ...(kind === 'module' && d && d.coverModuleId === m.id ? { pending: JSON.stringify({ ...d, coverModuleId: null }) } : {}),
        updatedAt: now,
      })
      .where(eq(schema.catalogCollections.id, c.id));
    await writeAuditEvent({
      resourceKind: 'catalog_collection',
      resourceId: c.id,
      userId: actorId,
      eventType: 'collection_item_removed',
      payload: { [kind === 'module' ? 'moduleId' : 'partId']: m.id, title: m.title, why },
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

/** `imageId` if it's one of this collection's uploaded covers, else null. */
async function ownCover(collectionId: string, imageId: string | null): Promise<string | null> {
  if (!imageId) return null;
  const row = await db
    .select({ id: schema.catalogCollectionCovers.id })
    .from(schema.catalogCollectionCovers)
    .where(and(eq(schema.catalogCollectionCovers.id, imageId), eq(schema.catalogCollectionCovers.collectionId, collectionId)))
    .get();
  return row ? row.id : null;
}

/**
 * Delete a collection's uploaded covers that are neither showing nor
 * waiting for review (replaced, removed, declined or withdrawn). A deleted
 * collection's go with it (the foreign key cascades, for a club's too).
 */
export async function pruneCovers(collectionId: string): Promise<void> {
  const c = await getCollection(collectionId);
  if (!c) return;
  const keep = [c.coverImageId, parseDraft(c.pending)?.coverImageId].filter((x): x is string => !!x);
  await db
    .delete(schema.catalogCollectionCovers)
    .where(
      and(
        eq(schema.catalogCollectionCovers.collectionId, collectionId),
        keep.length ? notInArray(schema.catalogCollectionCovers.id, keep) : undefined,
      ),
    );
}

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
async function editCollection(user: User, c: Collection, body: Record<string, unknown>, cover: { coverImageId?: string | null } = {}): Promise<Outcome> {
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
    ? { title: waiting.title, description: waiting.description, coverItemId: waiting.coverItemId, coverModuleId: waiting.coverModuleId ?? null, coverImageId: waiting.coverImageId ?? null }
    : textOf(c);
  const read = readText(body, shownText, entries);
  if (isFail(read)) return { code: read.code, body: { error: read.error } };
  // An uploaded cover (or taking it away) is part of the text, so it's reviewed with it.
  const text: Text = cover.coverImageId !== undefined ? { ...read, coverImageId: cover.coverImageId } : read;
  const audience = readAudience(body.audience, c.audience);
  if (!audience) return { code: 400, body: { error: 'invalid_input' } };
  if (audience === 'everyone' && !on.size) return { code: 404, body: { error: 'catalog_off' } };

  // Items are never reviewed with the collection.
  await applyEntries(c.id, entries);
  // A trusted club's curators (its admins and managers) publish its text at once.
  const straight = canModerate(user) || (await getPlatformSettings()).catalogReview === 'none' || (await isTrustedClub(c.orgId));
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
  await pruneCovers(c.id);
  const shared = audience === 'everyone' ? await shareModules(user, { title: text.title }, entries) : { submitted: [], notShared: [] };
  await writeAuditEvent({
    resourceKind: 'catalog_collection',
    resourceId: c.id,
    userId: user.id,
    eventType: 'collection_edit',
    payload: { title: text.title, items: entries.length, audience, reviewed, pending, shared: shared.submitted.length, ...(cover.coverImageId !== undefined ? { cover: cover.coverImageId ? 'uploaded' : 'removed' } : {}) },
  });
  return { code: 200, body: { id: c.id, status, audience, pending, ...shared } };
}

const collectionOwnerRef = (c: Collection) =>
  c.orgId ? { kind: 'org' as const, id: c.orgId } : c.ownerUserId ? { kind: 'user' as const, id: c.ownerUserId } : null;

/**
 * Collections' text waiting for review, as the queue shows it: the new text
 * and (for a change) what's public now. Split into the site's queue and
 * trusted clubs' own queues.
 */
export async function textQueue(queueRows: Collection[], shownAll: Map<string, Shown[]>, name: (c: Collection) => string) {
  const ownerIds = [...new Set(queueRows.map((c) => c.ownerUserId).filter((x): x is string => !!x))];
  const emails = ownerIds.length
    ? new Map((await db.select({ id: schema.users.id, email: schema.users.email }).from(schema.users).where(inArray(schema.users.id, ownerIds))).map((u) => [u.id, u.email]))
    : new Map<string, string>();
  const ownerRef = collectionOwnerRef;
  const trusted = await trustedClubs(queueRows.map((c) => c.orgId));
  const all = queueRows.map((c) => {
    const d = parseDraft(c.pending);
    const all = shownAll.get(c.id) ?? [];
    const current = { title: c.title, description: c.description, coverUrl: coverFrom(c, all) };
    const proposed = d
      ? { title: d.title, description: d.description, coverUrl: coverFrom({ id: c.id, coverItemId: d.coverItemId, coverModuleId: d.coverModuleId ?? null, coverImageId: d.coverImageId ?? null }, all) }
      : current;
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
      trustedClub: !!c.orgId && trusted.has(c.orgId),
      club: c.orgId,
    };
  });
  const inClub = (e: { club: string | null }) => !!e.club && trusted.has(e.club);
  return { queue: all.filter((e) => !inClub(e)), trustedQueue: all.filter(inClub) };
}

/**
 * Approve or decline a collection's text waiting for review: site
 * moderators (any), or a trusted club's admins and managers (`clubId`).
 */
export async function decideCollection(user: User, id: string, approve: boolean, rawReason: unknown, clubId: string | null = null) {
  const c = await getCollection(id);
  const waiting = !!c && c.audience === 'everyone' && (c.status === 'in_review' || (c.status === 'public' && c.pending !== null));
  if (!c || !waiting || (clubId && c.orgId !== clubId)) return { code: 404, body: { error: 'not_found' } };
  const reason = cleanText(rawReason, MAX_REASON);
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
          coverModuleId: has('module', d.coverModuleId) ? (d.coverModuleId ?? null) : null,
          // A change from before covers could be uploaded keeps the one showing.
          coverImageId: d.coverImageId === undefined ? c.coverImageId : await ownCover(c.id, d.coverImageId),
        },
        now,
      );
      // A change from before items were reviewed on their own.
      if (d.itemIds) {
        const on = await kindsOn();
        const still = d.itemIds.length ? await db.select().from(schema.catalogItems).where(inArray(schema.catalogItems.id, d.itemIds)) : [];
        const ok = new Set(still.filter((i) => isPublicItem(i, on)).map((i) => i.id));
        const mods = entries.filter((e) => e.source !== 'catalog');
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
    payload: { isUpdate: !!d, reason, ...(clubId ? { byClub: clubId } : {}) },
  });
  await pruneCovers(c.id);
  return { code: 200, body: { ok: true } };
}

/** Take a public collection out of the catalog: a site moderator, or (`clubId`) a trusted club's admin or manager. */
export async function unpublishCollection(user: User, id: string, rawReason: unknown, clubId: string | null = null) {
  const reason = cleanText(rawReason, MAX_REASON);
  if (reason === undefined) return { code: 400, body: { error: 'invalid_input' } };
  const c = await getCollection(id);
  if (!c || (clubId && c.orgId !== clubId)) return { code: 404, body: { error: 'not_found' } };
  // A private collection isn't in the catalog: it can only be removed.
  if (c.audience !== 'everyone') return { code: 409, body: { error: 'not_public' } };
  await db
    .update(schema.catalogCollections)
    .set({ status: 'unpublished', featured: false, reason, pending: null, pendingAt: null, updatedAt: new Date() })
    .where(eq(schema.catalogCollections.id, c.id));
  await writeAuditEvent({ resourceKind: 'catalog_collection', resourceId: c.id, userId: user.id, eventType: 'collection_unpublish', payload: { reason, ...(clubId ? { byClub: clubId } : {}) } });
  await pruneCovers(c.id);
  return { code: 200, body: { ok: true } };
}

/** Who each collection is by (its club's name, or its curator's). */
export const collectionOwnerNames = (rows: readonly Collection[]) => byNames(rows);

/** Every entry of these collections, as their curators see them (for review queues). */
export async function shownForQueue(rows: readonly Collection[]): Promise<Map<string, Shown[]>> {
  return shownOf(rows, await kindsOn(), () => true);
}

const BASE64_RE = /^[A-Za-z0-9+/]+={0,2}$/;

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
    const trusted = await trustedClubs(rows.map((c) => c.orgId));
    const out = [];
    for (const c of rows) {
      const s = shown.get(c.id) ?? [];
      if (s.length) out.push({ ...listOut(c, s, name(c)), trustedClub: !!c.orgId && trusted.has(c.orgId) });
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
        coverImageId: c.coverImageId,
        status: c.status,
        reason: a.curator || (a.insider && canModerate(user)) ? c.reason : null,
        pending: d
          ? {
              title: d.title,
              description: d.description,
              coverItemId: d.coverItemId,
              coverModuleId: d.coverModuleId ?? null,
              coverImageId: d.coverImageId ?? null,
              coverUrl: coverFrom({ id: c.id, coverItemId: d.coverItemId, coverModuleId: d.coverModuleId ?? null, coverImageId: d.coverImageId ?? null }, shown),
            }
          : null,
        curatorNote: a.curator ? c.curatorNote : null,
        canEdit: a.curator,
        pinned: c.pinned,
        clubInfo: club ? { id: club.id, slug: club.slug, name: club.name } : null,
        myRole: a.role,
        // A site moderator may take a club collection down (abuse).
        canRemove: !!user && canModerate(user) && !!c.orgId,
        trustedClub: await isTrustedClub(c.orgId),
      },
      items: shown.map((s) =>
        s.source === 'catalog' && s.item
          ? { ...itemOut(s.item, itemBy(s.item)), source: 'catalog' as const }
          : {
              id: s.id,
              kind: s.kind,
              source: 'library' as const,
              title: s.title,
              description: '',
              tags: [],
              by: club?.name ?? by,
              uses: 0,
              version: s.module?.latestVersion ?? 0,
              updatedAt: (s.module ?? s.part)?.updatedAt.getTime() ?? 0,
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
      const straight = audience === 'private' || staff || (await getPlatformSettings()).catalogReview === 'none' || (await isTrustedClub(orgId));
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

  // "Add to a collection…": one more item at the end: a catalog item
  // (`itemId`), or the curator's (or club's) own module or part
  // (`source: 'library'`, `kind`, `id`). The collection is never reviewed
  // for it; a module or part going into a public collection is shared for
  // its own review.
  app.post<{ Params: { id: string }; Body: { itemId?: unknown; source?: unknown; kind?: unknown; id?: unknown } }>(
    '/api/catalog/collections/:id/items',
    // codeql[js/missing-rate-limiting] - rate limited via Fastify config.rateLimit
    { config: { rateLimit: { max: 60, timeWindow: '1 hour' } } },
    async (req, reply) => {
      const user = requireUser(req);
      const c = await getCollection(req.params.id);
      if (!c) return reply.code(404).send({ error: 'not_found' });
      const b = req.body ?? {};
      const one = typeof b.itemId === 'string' ? readEntries({ entries: [{ source: 'catalog', id: b.itemId }] }, [])?.[0] : readEntries({ entries: [b] }, [])?.[0];
      if (!one) return reply.code(400).send({ error: 'invalid_input' });
      const refused = await refuseEdit(user, c);
      if (refused) return reply.code(refused.code).send(refused.body);
      const had = await entriesOf(c);
      if (had.some((e) => e.source === one.source && e.id === one.id)) return reply.code(409).send({ error: 'already_in_collection' });
      const r = await editCollection(user, c, { entries: [...had, one].map(entryOut) });
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
      await pruneCovers(c.id);
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
        } else if (s.part) {
          const r = await copyPartTo(user, s.part.id, dest.orgId);
          if (r.ok) added.push({ itemId: s.id, kind: 'part', id: r.id });
          // A part with that number is already there: they have it.
          else if (r.status === 409) skipped.push(s.id);
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

  // ---- cover picture -------------------------------------------------------
  // A curator uploads their own cover: JSON {mime, data} with the picture as
  // base64 (never an octet-stream body). PNG, JPEG or WebP, checked by its
  // first bytes, no bigger than Admin › Settings allows; it's re-encoded
  // (images/covers.ts) and the original is never kept. On a public
  // collection it's reviewed like the title, and the old cover stays up
  // until it's approved. DELETE takes it away (also reviewed).
  app.put<{ Params: { id: string }; Body: { mime?: unknown; data?: unknown } }>(
    '/api/catalog/collections/:id/cover',
    // codeql[js/missing-rate-limiting] - rate limited via Fastify config.rateLimit
    { bodyLimit: COVER_BODY_LIMIT, config: { rateLimit: { max: 30, timeWindow: '1 hour' } } },
    async (req, reply) => {
      const user = requireUser(req);
      const c = await getCollection(req.params.id);
      if (!c) return reply.code(404).send({ error: 'not_found' });
      const refused = await refuseEdit(user, c);
      if (refused) return reply.code(refused.code).send(refused.body);
      if (isDemoUser(user)) return reply.code(403).send({ error: 'demo_account_cannot_submit' });
      const mime = req.body?.mime;
      const data = req.body?.data;
      if (!COVER_MIMES.includes(mime as CoverMime) || typeof data !== 'string' || !BASE64_RE.test(data)) {
        return reply.code(400).send({ error: 'invalid_cover' });
      }
      const max = (await coverMaxBytes()).value;
      if (Math.floor((data.length * 3) / 4) - 2 > max) return reply.code(413).send({ error: 'cover_too_large', maxBytes: max });
      const bytes = Buffer.from(data, 'base64');
      if (bytes.length > max) return reply.code(413).send({ error: 'cover_too_large', maxBytes: max });
      if (!sniffCover(bytes)) return reply.code(400).send({ error: 'invalid_cover' });
      const enc = await encodeCover(bytes);
      if (!enc) return reply.code(400).send({ error: 'invalid_cover' });
      const owner: Subject = c.orgId ? { kind: 'org', id: c.orgId } : { kind: 'user', id: c.ownerUserId ?? user.id };
      const refusal = await checkGrowth({ actor: user, owner, add: { bytes: enc.image.length + enc.small.length }, uploadBytes: bytes.length });
      if (refusal) return reply.code(refusal.status).send(refusal.body);
      const imageId = randomUUID();
      await db.insert(schema.catalogCollectionCovers).values({ id: imageId, collectionId: c.id, image: enc.image, small: enc.small, createdBy: user.id, createdAt: new Date() });
      const r = await editCollection(user, c, {}, { coverImageId: imageId });
      if (r.code !== 200) await pruneCovers(c.id);
      return reply.code(r.code).send(r.code === 200 ? { ...(r.body as object), coverImageId: imageId } : r.body);
    },
  );

  app.delete<{ Params: { id: string } }>(
    '/api/catalog/collections/:id/cover',
    // codeql[js/missing-rate-limiting] - rate limited via Fastify config.rateLimit
    { config: { rateLimit: { max: 30, timeWindow: '1 hour' } } },
    async (req, reply) => {
      const user = requireUser(req);
      const c = await getCollection(req.params.id);
      if (!c) return reply.code(404).send({ error: 'not_found' });
      const r = await editCollection(user, c, {}, { coverImageId: null });
      return reply.code(r.code).send(r.body);
    },
  );

  // The picture: the one showing to whoever can see the collection; one
  // waiting for review only to its curators and moderators. `?size=small`
  // is the card-sized copy. A new picture has a new id, so it's cached.
  app.get<{ Params: { id: string }; Querystring: { image?: string; size?: string } }>(
    '/api/catalog/collections/:id/cover',
    { config: TOKEN_READ },
    async (req, reply) => {
      const c = await getCollection(req.params.id);
      if (!c) return reply.code(404).send({ error: 'not_found' });
      const user = req.user ?? null;
      const imageId = typeof req.query?.image === 'string' && req.query.image ? req.query.image : c.coverImageId;
      if (!imageId) return reply.code(404).send({ error: 'not_found' });
      const a = await accessTo(user, c);
      const showing = imageId === c.coverImageId;
      const waiting = imageId === parseDraft(c.pending)?.coverImageId;
      const allowed = showing ? a.insider || (isListed(c) && (await mayBrowse(req))) : waiting && (a.curator || canModerate(user));
      if (!allowed) return reply.code(404).send({ error: 'not_found' });
      const small = req.query?.size === 'small';
      const row = await db
        .select({ image: small ? schema.catalogCollectionCovers.small : schema.catalogCollectionCovers.image })
        .from(schema.catalogCollectionCovers)
        .where(and(eq(schema.catalogCollectionCovers.id, imageId), eq(schema.catalogCollectionCovers.collectionId, c.id)))
        .get();
      if (!row) return reply.code(404).send({ error: 'not_found' });
      const etag = `"${imageId}${small ? '-s' : ''}"`;
      reply.header('Cache-Control', 'private, max-age=86400');
      reply.header('ETag', etag);
      if (req.headers['if-none-match'] === etag) return reply.code(304).send();
      return reply.type('image/webp').send(Buffer.from(row.image as Uint8Array));
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
    const { queue, trustedQueue } = await textQueue(queueRows, shownAll, name);
    const ownerRef = collectionOwnerRef;
    return {
      queue,
      /** Waiting in trusted clubs' own queues (moderators can still act on them). */
      trustedQueue,
      collections: listed.map((c) => ({ ...listOut(c, shownPublic.get(c.id) ?? [], name(c)), status: c.status, reason: c.reason, owner: ownerRef(c) })),
      clubCollections: clubRows.map((c) => ({ ...listOut(c, shownAll.get(c.id) ?? [], name(c)), owner: ownerRef(c) })),
    };
  });

  const decide = (req: FastifyRequest<{ Params: { id: string }; Body: { reason?: unknown } }>, approve: boolean) =>
    decideCollection(requireModerator(req), req.params.id, approve, req.body?.reason);
  app.post<{ Params: { id: string }; Body: { reason?: unknown } }>('/api/moderation/collections/:id/approve', async (req, reply) => {
    const r = await decide(req, true);
    return reply.code(r.code).send(r.body);
  });
  app.post<{ Params: { id: string }; Body: { reason?: unknown } }>('/api/moderation/collections/:id/decline', async (req, reply) => {
    const r = await decide(req, false);
    return reply.code(r.code).send(r.body);
  });

  app.post<{ Params: { id: string }; Body: { reason?: unknown } }>('/api/moderation/collections/:id/unpublish', async (req, reply) => {
    const r = await unpublishCollection(requireModerator(req), req.params.id, req.body?.reason);
    return reply.code(r.code).send(r.body);
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

/**
 * Copy one of a collection's own custom parts to `user` or the club
 * `destOrgId`. A part with the same number there already: 409 (they have it).
 */
async function copyPartTo(user: User, partId: string, destOrgId: string | null): Promise<{ ok: true; id: string } | { ok: false; status: number; body: unknown }> {
  const src = await db.select().from(schema.customParts).where(eq(schema.customParts.id, partId)).get();
  if (!src) return { ok: false, status: 404, body: { error: 'not_found' } };
  const taken = await db
    .select({ id: schema.customParts.id })
    .from(schema.customParts)
    .where(and(eq(schema.customParts.partNumber, src.partNumber), destOrgId ? eq(schema.customParts.ownerOrgId, destOrgId) : eq(schema.customParts.ownerUserId, user.id)))
    .get();
  if (taken) return { ok: false, status: 409, body: { error: 'part_number_taken' } };
  const xml = Buffer.from(src.xmlBlob as Uint8Array);
  const sprite = Buffer.from(src.spriteBlob as Uint8Array);
  const owner: Subject = destOrgId ? { kind: 'org', id: destOrgId } : { kind: 'user', id: user.id };
  const refusal = await checkGrowth({ actor: user, owner, add: { customParts: 1, bytes: xml.length + sprite.length } });
  if (refusal) return { ok: false, status: refusal.status, body: refusal.body };
  const id = randomUUID();
  const now = new Date();
  await db.insert(schema.customParts).values({
    id,
    partNumber: src.partNumber,
    displayName: src.displayName,
    category: src.category,
    ownerUserId: destOrgId ? null : user.id,
    ownerOrgId: destOrgId,
    createdBy: user.id,
    xmlBlob: xml,
    spriteBlob: sprite,
    spriteMime: src.spriteMime,
    createdAt: now,
    updatedAt: now,
  });
  await writeAuditEvent({ resourceKind: 'custom_part', resourceId: id, userId: user.id, eventType: 'create', payload: { copiedFrom: src.id, owner } });
  return { ok: true, id };
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

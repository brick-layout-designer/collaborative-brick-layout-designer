// Public module and parts catalogs, with optional moderation.
//
// - Both catalogs are off until a global admin turns them on (Admin ›
//   Settings); while off, every catalog route answers 404 catalog_off.
// - Sharing makes a COPY (catalog_item_versions): later edits to the
//   original change nothing until its owner shares an update.
// - Review: 'moderators' (each submission waits in the queue) or 'none'
//   (published straight away). Moderators and global admins approve,
//   decline and unpublish; every action is audit-logged.
// - "Add to my modules / my parts" copies the public version to the
//   caller (or a club they can add to) and counts a use.
//
// All bodies are JSON (the site's firewall only lets octet-stream through
// on the two snapshot routes).

import { coverMaxBytes } from '../images/covers.js';
import { randomUUID } from 'node:crypto';
import { Buffer } from 'node:buffer';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { and, desc, eq, inArray, or, sql } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import type { User } from '../db/schema.js';
import { requireUser } from '../auth/cookie.js';
import { isDemoUser } from '../demo/demoAccount.js';
import { getPlatformSettings } from '../auth/platformSettings.js';
import { checkGrowth, type Subject } from '../limits/limits.js';
import { writeAuditEvent } from '../audit/writeAuditEvent.js';
import { destinationOrg } from './owners.js';
import { atLeast, type ClubRole } from '../access/clubRoles.js';
import { recordVersion } from './modules.js';
import { collectionCounts, dropFromCollections } from './collections.js';
import { publicName } from '../utils/publicName.js';
import { creditLookup } from './credits.js';
import { coverQueue, coverState, itemCoverUrl } from './itemCovers.js';

type Kind = 'module' | 'part';
// The desktop app (an API token) browses the catalog and adds from it:
// browsing needs layouts:read; adding a copy, layouts:write (a module) or
// parts:write (a part).
const TOKEN_READ = { apiToken: 'layouts:read' } as const;
const TOKEN_ADD = ['layouts:write', 'parts:write'] as const;
const MAX_TITLE = 80;
const MAX_DESCRIPTION = 1000;
const MAX_TAGS = 8;
const MAX_TAG = 24;
const MAX_REASON = 300;

/** A catalog item's owner, as a warning's subject. */
function ownerRef(i: { ownerUserId: string | null; ownerOrgId: string | null }): { kind: 'user' | 'org'; id: string } | null {
  return i.ownerOrgId ? { kind: 'org', id: i.ownerOrgId } : i.ownerUserId ? { kind: 'user', id: i.ownerUserId } : null;
}

export function canModerate(user: Pick<User, 'isGlobalAdmin' | 'isModerator'> | null | undefined): boolean {
  return !!user && (user.isGlobalAdmin || user.isModerator);
}

function isKind(v: unknown): v is Kind {
  return v === 'module' || v === 'part';
}

export async function catalogOn(kind: Kind): Promise<boolean> {
  const s = await getPlatformSettings();
  return kind === 'module' ? s.moduleCatalogEnabled : s.partsCatalogEnabled;
}

/** Lower-case, trimmed, unique tags; null when they're not acceptable. */
export function cleanTags(raw: unknown): string[] | null {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) return null;
  const out: string[] = [];
  for (const t of raw) {
    if (typeof t !== 'string') return null;
    const v = t.trim().toLowerCase();
    if (!v) continue;
    if (v.length > MAX_TAG) return null;
    if (!out.includes(v)) out.push(v);
  }
  return out.length > MAX_TAGS ? null : out;
}

export function cleanText(raw: unknown, max: number): string | null | undefined {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== 'string') return undefined;
  const t = raw.trim();
  if (t.length > max) return undefined;
  return t || null;
}

/** The club role the user has in `orgId`, if any. */
export async function clubRole(userId: string, orgId: string): Promise<ClubRole | null> {
  const m = await db
    .select({ role: schema.orgMembers.role })
    .from(schema.orgMembers)
    .where(and(eq(schema.orgMembers.orgId, orgId), eq(schema.orgMembers.userId, userId)))
    .get();
  return m?.role ?? null;
}

/** Which of these clubs are trusted (they review what's published under their name). */
export async function trustedClubs(orgIds: readonly (string | null | undefined)[]): Promise<Set<string>> {
  const ids = [...new Set(orgIds.filter((x): x is string => !!x))];
  if (!ids.length) return new Set();
  const rows = await db.select({ id: schema.orgs.id }).from(schema.orgs).where(and(inArray(schema.orgs.id, ids), eq(schema.orgs.trusted, true)));
  return new Set(rows.map((r) => r.id));
}

export async function isTrustedClub(orgId: string | null | undefined): Promise<boolean> {
  return !!orgId && (await trustedClubs([orgId])).has(orgId);
}

/** Whether `user` manages things owned by this person or club: the person themselves, or a club admin / manager. */
export async function manages(userId: string, owner: { ownerUserId: string | null; ownerOrgId: string | null }): Promise<boolean> {
  if (owner.ownerUserId) return owner.ownerUserId === userId;
  if (owner.ownerOrgId) return atLeast(await clubRole(userId, owner.ownerOrgId), 'manager');
  return false;
}

interface SourceSnapshot {
  ownerUserId: string | null;
  ownerOrgId: string | null;
  title: string;
  bytes: number;
  values: Partial<typeof schema.catalogItemVersions.$inferInsert>;
}

/** What gets shared: a copy of the module or custom part as it is now. */
async function snapshotSource(kind: Kind, sourceId: string): Promise<SourceSnapshot | null> {
  if (kind === 'module') {
    const m = await db.select().from(schema.modules).where(eq(schema.modules.id, sourceId)).get();
    if (!m) return null;
    const doc = Buffer.from(m.docSnapshot as Uint8Array);
    const thumb = m.thumbnail ? Buffer.from(m.thumbnail as Uint8Array) : null;
    return {
      ownerUserId: m.ownerUserId,
      ownerOrgId: m.ownerOrgId,
      title: m.title,
      bytes: doc.length + (thumb?.length ?? 0),
      values: { docSnapshot: doc, thumbnail: thumb, thumbnailMime: thumb ? m.thumbnailMime : null },
    };
  }
  const p = await db.select().from(schema.customParts).where(eq(schema.customParts.id, sourceId)).get();
  if (!p || p.isGlobal) return null;
  const xml = Buffer.from(p.xmlBlob as Uint8Array);
  const sprite = Buffer.from(p.spriteBlob as Uint8Array);
  return {
    ownerUserId: p.ownerUserId,
    ownerOrgId: p.ownerOrgId,
    title: p.displayName,
    bytes: xml.length + sprite.length,
    values: { partNumber: p.partNumber, category: p.category, xmlBlob: xml, spriteBlob: sprite, spriteMime: p.spriteMime },
  };
}

/**
 * Who shared it, for the catalog: the person's name, or for a club's
 * item, its author and the club ("Sam · in ArkLUG"). The author is the
 * catalog item's source module or part's author, read through the same
 * rules as every other credit (routes/credits.ts): a deleted account
 * reads "Builder #…", someone who left the club "a former member".
 */
export async function ownerNames(
  items: readonly { ownerUserId: string | null; ownerOrgId: string | null; kind?: Kind; sourceId?: string }[],
) {
  const userIds = [...new Set(items.map((i) => i.ownerUserId).filter((x): x is string => !!x))];
  const orgIds = [...new Set(items.map((i) => i.ownerOrgId).filter((x): x is string => !!x))];
  const users = userIds.length
    ? await db.select({ id: schema.users.id, name: schema.users.displayName }).from(schema.users).where(inArray(schema.users.id, userIds))
    : [];
  const orgs = orgIds.length
    ? await db.select({ id: schema.orgs.id, name: schema.orgs.name }).from(schema.orgs).where(inArray(schema.orgs.id, orgIds))
    : [];
  const u = new Map(users.map((x) => [x.id, publicName(x.id, x.name)]));
  const o = new Map(orgs.map((x) => [x.id, x.name]));
  // A club's items: who made the module or part it was shared from.
  const authorBy = new Map<string, string>();
  for (const kind of ['module', 'part'] as const) {
    const club = items.filter((i) => i.ownerOrgId && i.kind === kind && i.sourceId);
    if (!club.length) continue;
    const credits = await creditLookup(
      kind === 'module' ? 'module' : 'custom-part',
      club.map((i) => i.sourceId!),
      '',
    );
    for (const i of club) {
      const by = credits(i.sourceId!)?.by;
      if (by) authorBy.set(`${kind}:${i.sourceId}`, by);
    }
  }
  return (i: { ownerUserId: string | null; ownerOrgId: string | null; kind?: Kind; sourceId?: string }) => {
    if (!i.ownerOrgId) return u.get(i.ownerUserId ?? '') ?? 'Someone';
    const club = o.get(i.ownerOrgId) ?? 'A club';
    const author = i.kind && i.sourceId ? authorBy.get(`${i.kind}:${i.sourceId}`) : undefined;
    return author ? `${author} · in ${club}` : club;
  };
}

function parseTags(json: string): string[] {
  try {
    const v: unknown = JSON.parse(json);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

export function itemOut(i: typeof schema.catalogItems.$inferSelect, by: string) {
  return {
    id: i.id,
    kind: i.kind,
    title: i.title,
    description: i.description,
    tags: parseTags(i.tags),
    by,
    uses: i.uses,
    version: i.publicVersion,
    updatedAt: i.updatedAt.getTime(),
    previewUrl: `/api/catalog/items/${i.id}/preview?v=${i.publicVersion}`,
    /** The card's picture: one its owner uploaded (cropped to the card), else the drawn one. */
    coverUrl: i.coverImageId ? itemCoverUrl(i.id, i.coverImageId) : `/api/catalog/items/${i.id}/preview?v=${i.publicVersion}`,
    customCover: !!i.coverImageId,
  };
}

/** Anyone may browse when the setting allows; otherwise only people signed in. */
export async function mayBrowse(req: FastifyRequest): Promise<boolean> {
  if (req.user) return true;
  return (await getPlatformSettings()).catalogAnonymousBrowse;
}

type CopyResult = { ok: true; id: string; version: number } | { ok: false; code: number; body: unknown };

/**
 * Copy a public catalog item's public version to `user`, or to the club
 * `orgId`, and count a use. The caller checked the item is public and the
 * destination is one the user may add to.
 */
export async function copyItemTo(user: User, item: typeof schema.catalogItems.$inferSelect, orgId: string | null): Promise<CopyResult> {
  const v = await db
    .select()
    .from(schema.catalogItemVersions)
    .where(and(eq(schema.catalogItemVersions.itemId, item.id), eq(schema.catalogItemVersions.version, item.publicVersion)))
    .get();
  if (!v) return { ok: false, code: 404, body: { error: 'not_found' } };
  const dest = { orgId };
  const owner: Subject = dest.orgId ? { kind: 'org', id: dest.orgId } : { kind: 'user', id: user.id };
  const now = new Date();
  const id = randomUUID();
  if (item.kind === 'module') {
    const doc = Buffer.from(v.docSnapshot as Uint8Array);
    const thumb = v.thumbnail ? Buffer.from(v.thumbnail as Uint8Array) : null;
    const refusal = await checkGrowth({ actor: user, owner, add: { bytes: doc.length + (thumb?.length ?? 0) } });
    if (refusal) return { ok: false, code: refusal.status, body: refusal.body };
    await db.insert(schema.modules).values({
      id,
      title: item.title,
      ownerUserId: dest.orgId ? null : user.id,
      ownerOrgId: dest.orgId,
      createdBy: user.id,
      docSnapshot: doc,
      docVersion: 0,
      sidecarSnapshot: null,
      thumbnail: thumb,
      thumbnailMime: thumb ? (v.thumbnailMime as 'image/png' | 'image/webp') : null,
      thumbnailAt: thumb ? now : null,
      copiedFromId: item.sourceId,
      createdAt: now,
      updatedAt: now,
    });
    await recordVersion(id, doc, user.id, `From the catalog (version ${v.version})`, thumb, thumb ? (v.thumbnailMime as 'image/png' | 'image/webp') : null);
  } else {
    const partNumber = v.partNumber ?? '';
    const taken = await db
      .select({ id: schema.customParts.id })
      .from(schema.customParts)
      .where(
        and(
          eq(schema.customParts.partNumber, partNumber),
          dest.orgId ? eq(schema.customParts.ownerOrgId, dest.orgId) : eq(schema.customParts.ownerUserId, user.id),
        ),
      )
      .get();
    if (taken) return { ok: false, code: 409, body: { error: 'part_number_taken' } };
    const xml = Buffer.from(v.xmlBlob as Uint8Array);
    const sprite = Buffer.from(v.spriteBlob as Uint8Array);
    const refusal = await checkGrowth({ actor: user, owner, add: { customParts: 1, bytes: xml.length + sprite.length } });
    if (refusal) return { ok: false, code: refusal.status, body: refusal.body };
    await db.insert(schema.customParts).values({
      id,
      partNumber,
      displayName: item.title,
      category: v.category ?? 'Custom',
      ownerUserId: dest.orgId ? null : user.id,
      ownerOrgId: dest.orgId,
      createdBy: user.id,
      xmlBlob: xml,
      spriteBlob: sprite,
      spriteMime: (v.spriteMime ?? 'image/png') as 'image/gif' | 'image/png',
      copiedFromId: item.sourceId,
      createdAt: now,
      updatedAt: now,
    });
  }
  await db.insert(schema.catalogCopies).values({ itemId: item.id, copyId: id, version: v.version, userId: user.id, createdAt: now });
  await db.update(schema.catalogItems).set({ uses: sql`${schema.catalogItems.uses} + 1` }).where(eq(schema.catalogItems.id, item.id));
  await writeAuditEvent({
    resourceKind: 'catalog_item',
    resourceId: item.id,
    userId: user.id,
    eventType: 'catalog_add',
    payload: { copyId: id, version: v.version, owner },
  });
  return { ok: true, id, version: v.version };
}

/**
 * Share a module or custom part to the catalog (or a new version of one
 * already there): the share route, and a module going into a public
 * collection. The caller must manage the thing.
 */
export async function submitToCatalog(
  user: User,
  kind: Kind,
  sourceId: string,
  b: { title?: unknown; description?: unknown; tags?: unknown; note?: unknown },
): Promise<{ ok: boolean; code: number; body: unknown }> {
  const fail = (code: number, body: unknown) => ({ ok: false, code, body });
  if (isDemoUser(user)) return fail(403, { error: 'demo_account_cannot_submit' });
  if (!(await catalogOn(kind))) return fail(404, { error: 'catalog_off' });
  const src = await snapshotSource(kind, sourceId);
  if (!src) return fail(404, { error: 'not_found' });
  // A club's things: its admins and managers share them; in a trusted club,
  // members may too (for the club's own review).
  const role = src.ownerOrgId ? await clubRole(user.id, src.ownerOrgId) : null;
  const trusted = await isTrustedClub(src.ownerOrgId);
  const mayShare = src.ownerOrgId ? atLeast(role, 'manager') || (trusted && !!role) : src.ownerUserId === user.id;
  if (!mayShare) return fail(403, { error: 'forbidden' });
  const title = cleanText(b.title ?? src.title, MAX_TITLE);
  const description = cleanText(b.description, MAX_DESCRIPTION);
  const note = cleanText(b.note, MAX_REASON);
  const tags = cleanTags(b.tags);
  if (!title || description === undefined || note === undefined || !tags) return fail(400, { error: 'invalid_input' });
  const owner: Subject = src.ownerOrgId ? { kind: 'org', id: src.ownerOrgId } : { kind: 'user', id: src.ownerUserId ?? user.id };
  const refusal = await checkGrowth({ actor: user, owner, add: { bytes: src.bytes }, uploadBytes: src.bytes });
  if (refusal) return fail(refusal.status, refusal.body);

  const review = (await getPlatformSettings()).catalogReview;
  const now = new Date();
  // An item already shared from this source by the same owner gets a new version.
  let item = await db
    .select()
    .from(schema.catalogItems)
    .where(and(eq(schema.catalogItems.kind, kind), eq(schema.catalogItems.sourceId, sourceId)))
    .get();
  if (!item) {
    const id = randomUUID();
    await db.insert(schema.catalogItems).values({
      id,
      kind: kind,
      sourceId: sourceId,
      ownerUserId: src.ownerUserId,
      ownerOrgId: src.ownerOrgId,
      title,
      description: description ?? '',
      tags: JSON.stringify(tags),
      status: 'in_review',
      createdAt: now,
      updatedAt: now,
    });
    item = (await db.select().from(schema.catalogItems).where(eq(schema.catalogItems.id, id)).get())!;
  }
  const last = await db
    .select({ v: sql<number>`coalesce(max(${schema.catalogItemVersions.version}), 0)`.mapWith(Number) })
    .from(schema.catalogItemVersions)
    .where(eq(schema.catalogItemVersions.itemId, item.id))
    .get();
  const version = (last?.v ?? 0) + 1;
  // Review off, or a trusted club's admin or manager: public at once.
  const straight = review === 'none' || (trusted && atLeast(role, 'manager'));
  await db.insert(schema.catalogItemVersions).values({
    id: randomUUID(),
    itemId: item.id,
    version,
    status: straight ? 'public' : 'in_review',
    submittedBy: user.id,
    note,
    createdAt: now,
    ...src.values,
  });
  // Earlier versions still waiting are replaced by this one.
  await db
    .update(schema.catalogItemVersions)
    .set({ status: 'declined', reason: 'Replaced by a newer submission', decidedAt: now })
    .where(
      and(
        eq(schema.catalogItemVersions.itemId, item.id),
        eq(schema.catalogItemVersions.status, 'in_review'),
        sql`${schema.catalogItemVersions.version} < ${version}`,
      ),
    );
  const live = item.status === 'public' && item.publicVersion > 0;
  await db
    .update(schema.catalogItems)
    .set({
      title,
      // An update without a new description or tags keeps the ones it has.
      description: b.description === undefined ? item.description : (description ?? ''),
      tags: b.tags === undefined ? item.tags : JSON.stringify(tags),
      // Straight away: this version is public now. In review: a public
      // item stays public (on its old version) while the update waits.
      status: straight || live ? 'public' : 'in_review',
      publicVersion: straight ? version : item.publicVersion,
      reason: null,
      updatedAt: now,
    })
    .where(eq(schema.catalogItems.id, item.id));
  await writeAuditEvent({
    resourceKind: 'catalog_item',
    resourceId: item.id,
    userId: user.id,
    eventType: 'catalog_submit',
    payload: { kind, sourceId, version, title, straight, ...(trusted ? { clubReview: !straight } : {}) },
  });
  return { ok: true, code: 201, body: { id: item.id, version, status: straight ? 'public' : 'in_review' } };
}

/**
 * Approve or decline a waiting version: site moderators (any), or a trusted
 * club's admins and managers (`clubId`: only the club's own items).
 */
export async function decideVersion(user: User, versionId: string, approve: boolean, rawReason: unknown, clubId: string | null = null) {
  const v = await db.select().from(schema.catalogItemVersions).where(eq(schema.catalogItemVersions.id, versionId)).get();
  if (!v || v.status !== 'in_review') return { code: 404 as const, body: { error: 'not_found' } };
  const reason = cleanText(rawReason, MAX_REASON);
  if (reason === undefined) return { code: 400 as const, body: { error: 'invalid_input' } };
  const item = (await db.select().from(schema.catalogItems).where(eq(schema.catalogItems.id, v.itemId)).get())!;
  if (clubId && item.ownerOrgId !== clubId) return { code: 404 as const, body: { error: 'not_found' } };
  const now = new Date();
  await db
    .update(schema.catalogItemVersions)
    .set({ status: approve ? 'public' : 'declined', reason, decidedBy: user.id, decidedAt: now })
    .where(eq(schema.catalogItemVersions.id, v.id));
  if (approve) {
    await db
      .update(schema.catalogItems)
      .set({ status: 'public', publicVersion: v.version, reason: null, updatedAt: now })
      .where(eq(schema.catalogItems.id, item.id));
  } else if (item.publicVersion === 0) {
    // A first submission declined: the item says why. (A declined update
    // leaves the public version as it is.)
    await db.update(schema.catalogItems).set({ status: 'declined', reason, updatedAt: now }).where(eq(schema.catalogItems.id, item.id));
  }
  await writeAuditEvent({
    resourceKind: 'catalog_item',
    resourceId: item.id,
    userId: user.id,
    eventType: approve ? 'catalog_approve' : 'catalog_decline',
    payload: { version: v.version, reason, ...(clubId ? { byClub: clubId } : {}) },
  });
  return { code: 200 as const, body: { ok: true } };
}

/** Take an item out of the catalog at once: a site moderator, or (`clubId`) a trusted club's admin or manager. */
export async function unpublishItem(user: User, itemId: string, rawReason: unknown, clubId: string | null = null) {
  const reason = cleanText(rawReason, MAX_REASON);
  if (reason === undefined) return { code: 400, body: { error: 'invalid_input' } };
  const item = await db.select().from(schema.catalogItems).where(eq(schema.catalogItems.id, itemId)).get();
  if (!item || (clubId && item.ownerOrgId !== clubId)) return { code: 404, body: { error: 'not_found' } };
  await db.update(schema.catalogItems).set({ status: 'unpublished', reason, updatedAt: new Date() }).where(eq(schema.catalogItems.id, item.id));
  await writeAuditEvent({ resourceKind: 'catalog_item', resourceId: item.id, userId: user.id, eventType: 'catalog_unpublish', payload: { reason, ...(clubId ? { byClub: clubId } : {}) } });
  await dropFromCollections(item, clubId ? 'unpublished by the club' : 'unpublished by a moderator', user.id);
  return { code: 200, body: { ok: true } };
}

export async function catalogRoutes(app: FastifyInstance): Promise<void> {
  // ---- what's on (no sign-in needed) --------------------------------------
  app.get('/api/catalog/settings', { config: TOKEN_READ }, async (req) => {
    const s = await getPlatformSettings();
    return {
      modules: s.moduleCatalogEnabled,
      parts: s.partsCatalogEnabled,
      review: s.catalogReview,
      anonymousBrowse: s.catalogAnonymousBrowse,
      canModerate: canModerate(req.user),
      /** The biggest picture a curator can upload as a collection's cover. */
      coverMaxBytes: (await coverMaxBytes()).value,
    };
  });

  // ---- browse --------------------------------------------------------------
  app.get<{ Querystring: { kind?: string; q?: string; tag?: string; sort?: string } }>(
    '/api/catalog/items',
    { config: TOKEN_READ },
    async (req, reply) => {
      const kind = req.query.kind ?? 'module';
      if (!isKind(kind) || !(await catalogOn(kind))) return reply.code(404).send({ error: 'catalog_off' });
      if (!(await mayBrowse(req))) return reply.code(401).send({ error: 'unauthorized' });
      const q = (req.query.q ?? '').trim().toLowerCase().slice(0, 80);
      const tag = (req.query.tag ?? '').trim().toLowerCase().slice(0, MAX_TAG);
      const conds = [eq(schema.catalogItems.kind, kind), eq(schema.catalogItems.status, 'public'), sql`${schema.catalogItems.publicVersion} > 0`];
      if (q) {
        const like = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
        conds.push(
          or(
            sql`lower(${schema.catalogItems.title}) LIKE ${like} ESCAPE '\\'`,
            sql`lower(${schema.catalogItems.description}) LIKE ${like} ESCAPE '\\'`,
            sql`lower(${schema.catalogItems.tags}) LIKE ${like} ESCAPE '\\'`,
          )!,
        );
      }
      if (tag) conds.push(sql`EXISTS (SELECT 1 FROM json_each(${schema.catalogItems.tags}) WHERE value = ${tag})`);
      const rows = await db
        .select()
        .from(schema.catalogItems)
        .where(and(...conds))
        .orderBy(req.query.sort === 'popular' ? desc(schema.catalogItems.uses) : desc(schema.catalogItems.updatedAt))
        .limit(200);
      const name = await ownerNames(rows);
      const trusted = await trustedClubs(rows.map((r) => r.ownerOrgId));
      return { items: rows.map((r) => ({ ...itemOut(r, name(r)), trustedClub: !!r.ownerOrgId && trusted.has(r.ownerOrgId) })) };
    },
  );

  app.get<{ Params: { id: string } }>('/api/catalog/items/:id', { config: TOKEN_READ }, async (req, reply) => {
    const item = await db.select().from(schema.catalogItems).where(eq(schema.catalogItems.id, req.params.id)).get();
    if (!item || !(await catalogOn(item.kind))) return reply.code(404).send({ error: 'not_found' });
    const mine = req.user ? (await manages(req.user.id, item)) || canModerate(req.user) : false;
    if (!mine && (item.status !== 'public' || item.publicVersion === 0)) return reply.code(404).send({ error: 'not_found' });
    if (!(await mayBrowse(req))) return reply.code(401).send({ error: 'unauthorized' });
    const versions = await db
      .select({
        version: schema.catalogItemVersions.version,
        status: schema.catalogItemVersions.status,
        note: schema.catalogItemVersions.note,
        reason: schema.catalogItemVersions.reason,
        createdAt: schema.catalogItemVersions.createdAt,
      })
      .from(schema.catalogItemVersions)
      .where(eq(schema.catalogItemVersions.itemId, item.id))
      .orderBy(desc(schema.catalogItemVersions.version));
    const name = await ownerNames([item]);
    return {
      item: { ...itemOut(item, name(item)), status: item.status, reason: mine ? item.reason : null, trustedClub: await isTrustedClub(item.ownerOrgId) },
      versions: versions
        .filter((v) => mine || v.status === 'public')
        .map((v) => ({ ...v, reason: mine ? v.reason : null, createdAt: v.createdAt.getTime() })),
    };
  });

  // A version's picture: a module's thumbnail, or a part's sprite.
  app.get<{ Params: { id: string }; Querystring: { v?: string } }>('/api/catalog/items/:id/preview', { config: TOKEN_READ }, async (req, reply) => {
    const item = await db.select().from(schema.catalogItems).where(eq(schema.catalogItems.id, req.params.id)).get();
    if (!item || !(await catalogOn(item.kind))) return reply.code(404).send({ error: 'not_found' });
    const n = req.query.v ? Number(req.query.v) : item.publicVersion;
    const isPublic = item.status === 'public' && n === item.publicVersion && n > 0;
    const mine = req.user ? (await manages(req.user.id, item)) || canModerate(req.user) : false;
    if (!isPublic && !mine) return reply.code(404).send({ error: 'not_found' });
    if (!(await mayBrowse(req))) return reply.code(401).send({ error: 'unauthorized' });
    const v = await db
      .select()
      .from(schema.catalogItemVersions)
      .where(and(eq(schema.catalogItemVersions.itemId, item.id), eq(schema.catalogItemVersions.version, n)))
      .get();
    const bytes = item.kind === 'module' ? v?.thumbnail : v?.spriteBlob;
    const mime = item.kind === 'module' ? v?.thumbnailMime : v?.spriteMime;
    if (!bytes || !mime) return reply.code(404).send({ error: 'no_preview' });
    reply.header('Cache-Control', 'public, max-age=86400');
    reply.header('Content-Type', mime);
    reply.header('X-Content-Type-Options', 'nosniff');
    return reply.send(Buffer.from(bytes as Uint8Array));
  });

  // ---- share (submit, or submit an update) --------------------------------
  app.post<{
    Body: { kind?: unknown; sourceId?: unknown; title?: unknown; description?: unknown; tags?: unknown; note?: unknown };
  }>(
    '/api/catalog/submissions',
    // codeql[js/missing-rate-limiting] - rate limited via Fastify config.rateLimit
    // Ten shares an hour per person (counted after sign-in is read), not per
    // address: a whole club sharing from one venue's network isn't one person.
    { config: { rateLimit: { max: 10, timeWindow: '1 hour', hook: 'preHandler', keyGenerator: (req: FastifyRequest) => req.user?.id ?? req.ip } } },
    async (req, reply) => {
      const user = requireUser(req);
      const b = req.body ?? {};
      if (!isKind(b.kind) || typeof b.sourceId !== 'string') return reply.code(400).send({ error: 'invalid_input' });
      const r = await submitToCatalog(user, b.kind, b.sourceId, b);
      return reply.code(r.code).send(r.body);
    },
  );

  // The caller's shared items (their own, and their clubs'), for the status badges.
  app.get('/api/catalog/mine', async (req) => {
    const user = requireUser(req);
    const clubs = await db
      .select({ orgId: schema.orgMembers.orgId })
      .from(schema.orgMembers)
      .where(eq(schema.orgMembers.userId, user.id));
    const orgIds = clubs.map((c) => c.orgId);
    const rows = await db
      .select()
      .from(schema.catalogItems)
      .where(
        orgIds.length
          ? or(eq(schema.catalogItems.ownerUserId, user.id), inArray(schema.catalogItems.ownerOrgId, orgIds))
          : eq(schema.catalogItems.ownerUserId, user.id),
      );
    const ids = rows.map((r) => r.id);
    const pending = ids.length
      ? await db
          .select({ itemId: schema.catalogItemVersions.itemId, version: schema.catalogItemVersions.version })
          .from(schema.catalogItemVersions)
          .where(and(inArray(schema.catalogItemVersions.itemId, ids), eq(schema.catalogItemVersions.status, 'in_review')))
      : [];
    const waiting = new Map(pending.map((p) => [p.itemId, p.version]));
    const inCollections = await collectionCounts(ids);
    return {
      items: rows.map((r) => ({
        id: r.id,
        kind: r.kind,
        sourceId: r.sourceId,
        title: r.title,
        status: r.status,
        reason: r.reason,
        version: r.publicVersion,
        pendingVersion: waiting.get(r.id) ?? null,
        /** How many public collections it's in. */
        collections: inCollections.get(r.id) ?? 0,
        /** Its uploaded picture, one waiting for review, and why the last was declined. */
        ...coverState(r),
      })),
    };
  });

  app.post<{ Params: { id: string } }>('/api/catalog/items/:id/withdraw', async (req, reply) => {
    const user = requireUser(req);
    const item = await db.select().from(schema.catalogItems).where(eq(schema.catalogItems.id, req.params.id)).get();
    if (!item) return reply.code(404).send({ error: 'not_found' });
    if (!(await manages(user.id, item))) return reply.code(403).send({ error: 'forbidden' });
    const now = new Date();
    await db.update(schema.catalogItems).set({ status: 'withdrawn', updatedAt: now }).where(eq(schema.catalogItems.id, item.id));
    await db
      .update(schema.catalogItemVersions)
      .set({ status: 'declined', reason: 'Withdrawn', decidedAt: now })
      .where(and(eq(schema.catalogItemVersions.itemId, item.id), eq(schema.catalogItemVersions.status, 'in_review')));
    await writeAuditEvent({ resourceKind: 'catalog_item', resourceId: item.id, userId: user.id, eventType: 'catalog_withdraw', payload: {} });
    await dropFromCollections(item, 'withdrawn by its owner', user.id);
    return { ok: true };
  });

  // ---- add to my modules / my parts ---------------------------------------
  app.post<{ Params: { id: string }; Body: { orgSlug?: unknown } }>(
    '/api/catalog/items/:id/add',
    // codeql[js/missing-rate-limiting] - rate limited via Fastify config.rateLimit
    { config: { rateLimit: { max: 60, timeWindow: '1 minute' }, apiToken: TOKEN_ADD } },
    async (req, reply) => {
      const user = requireUser(req);
      const item = await db.select().from(schema.catalogItems).where(eq(schema.catalogItems.id, req.params.id)).get();
      if (!item || item.status !== 'public' || item.publicVersion === 0 || !(await catalogOn(item.kind))) {
        return reply.code(404).send({ error: 'not_found' });
      }
      const dest = await destinationOrg(user.id, req.body?.orgSlug);
      if (!dest.ok) return reply.code(dest.code).send({ error: dest.error });
      const r = await copyItemTo(user, item, dest.orgId);
      if (!r.ok) return reply.code(r.code).send(r.body);
      return reply.code(201).send({ kind: item.kind, id: r.id, version: r.version });
    },
  );

  // The caller's copies with a newer public version ("Update available").
  app.get('/api/catalog/copies', { config: TOKEN_READ }, async (req) => {
    const user = requireUser(req);
    const rows = await db
      .select({
        copyId: schema.catalogCopies.copyId,
        version: schema.catalogCopies.version,
        itemId: schema.catalogItems.id,
        kind: schema.catalogItems.kind,
        publicVersion: schema.catalogItems.publicVersion,
        status: schema.catalogItems.status,
      })
      .from(schema.catalogCopies)
      .innerJoin(schema.catalogItems, eq(schema.catalogItems.id, schema.catalogCopies.itemId))
      .where(eq(schema.catalogCopies.userId, user.id));
    return {
      copies: rows.map((r) => ({
        copyId: r.copyId,
        itemId: r.itemId,
        kind: r.kind,
        version: r.version,
        latest: r.publicVersion,
        updateAvailable: r.status === 'public' && r.publicVersion > r.version,
      })),
    };
  });

  // "Get the new version": the copy's contents become the public version.
  // Never automatic; the copy keeps its name, owner and history.
  app.post<{ Params: { copyId: string } }>('/api/catalog/copies/:copyId/update', async (req, reply) => {
    const user = requireUser(req);
    const copy = await db.select().from(schema.catalogCopies).where(eq(schema.catalogCopies.copyId, req.params.copyId)).get();
    if (!copy) return reply.code(404).send({ error: 'not_found' });
    const item = await db.select().from(schema.catalogItems).where(eq(schema.catalogItems.id, copy.itemId)).get();
    if (!item || item.status !== 'public' || item.publicVersion <= copy.version) return reply.code(409).send({ error: 'no_update' });
    const v = await db
      .select()
      .from(schema.catalogItemVersions)
      .where(and(eq(schema.catalogItemVersions.itemId, item.id), eq(schema.catalogItemVersions.version, item.publicVersion)))
      .get();
    if (!v) return reply.code(404).send({ error: 'not_found' });
    const now = new Date();
    if (item.kind === 'module') {
      const m = await db.select().from(schema.modules).where(eq(schema.modules.id, copy.copyId)).get();
      if (!m || !(await manages(user.id, m))) return reply.code(404).send({ error: 'not_found' });
      const doc = Buffer.from(v.docSnapshot as Uint8Array);
      const thumb = v.thumbnail ? Buffer.from(v.thumbnail as Uint8Array) : null;
      const mime = thumb ? (v.thumbnailMime as 'image/png' | 'image/webp') : null;
      await db
        .update(schema.modules)
        .set({ docSnapshot: doc, docVersion: m.docVersion + 1, thumbnail: thumb, thumbnailMime: mime, thumbnailAt: thumb ? now : null, updatedAt: now })
        .where(eq(schema.modules.id, m.id));
      await recordVersion(m.id, doc, user.id, `From the catalog (version ${v.version})`, thumb, mime);
    } else {
      const p = await db.select().from(schema.customParts).where(eq(schema.customParts.id, copy.copyId)).get();
      if (!p || !(await manages(user.id, p))) return reply.code(404).send({ error: 'not_found' });
      await db
        .update(schema.customParts)
        .set({
          xmlBlob: Buffer.from(v.xmlBlob as Uint8Array),
          spriteBlob: Buffer.from(v.spriteBlob as Uint8Array),
          spriteMime: (v.spriteMime ?? p.spriteMime) as 'image/gif' | 'image/png',
          updatedAt: now,
        })
        .where(eq(schema.customParts.id, p.id));
    }
    await db
      .update(schema.catalogCopies)
      .set({ version: v.version })
      .where(and(eq(schema.catalogCopies.itemId, item.id), eq(schema.catalogCopies.copyId, copy.copyId)));
    return { ok: true, version: v.version };
  });

  // ---- moderation (moderators and global admins) --------------------------
  const requireModerator = (req: FastifyRequest): User => {
    const user = requireUser(req);
    if (!canModerate(user)) {
      const err = new Error('forbidden');
      (err as Error & { statusCode?: number }).statusCode = 403;
      throw err;
    }
    return user;
  };

  app.get<{ Querystring: { status?: string } }>('/api/moderation/items', async (req) => {
    requireModerator(req);
    // The queue (versions waiting), and the items in the catalogs.
    const queue = await db
      .select({
        versionId: schema.catalogItemVersions.id,
        version: schema.catalogItemVersions.version,
        note: schema.catalogItemVersions.note,
        createdAt: schema.catalogItemVersions.createdAt,
        itemId: schema.catalogItems.id,
        kind: schema.catalogItems.kind,
        title: schema.catalogItems.title,
        description: schema.catalogItems.description,
        tags: schema.catalogItems.tags,
        publicVersion: schema.catalogItems.publicVersion,
        coverImageId: schema.catalogItems.coverImageId,
        submitterName: schema.users.displayName,
        submitterEmail: schema.users.email,
        ownerUserId: schema.catalogItems.ownerUserId,
        ownerOrgId: schema.catalogItems.ownerOrgId,
      })
      .from(schema.catalogItemVersions)
      .innerJoin(schema.catalogItems, eq(schema.catalogItems.id, schema.catalogItemVersions.itemId))
      .leftJoin(schema.users, eq(schema.users.id, schema.catalogItemVersions.submittedBy))
      .where(eq(schema.catalogItemVersions.status, 'in_review'))
      .orderBy(schema.catalogItemVersions.createdAt);
    const items = await db
      .select()
      .from(schema.catalogItems)
      .where(inArray(schema.catalogItems.status, ['public', 'unpublished']))
      .orderBy(desc(schema.catalogItems.updatedAt))
      .limit(500);
    const name = await ownerNames([...queue, ...items]);
    // A trusted club reviews what's published under its name: those wait in
    // its own queue (moderators can still see them, and act on them).
    const trusted = await trustedClubs([...queue, ...items].map((q) => q.ownerOrgId));
    const entry = (q: (typeof queue)[number]) => ({
        versionId: q.versionId,
        itemId: q.itemId,
        kind: q.kind,
        title: q.title,
        description: q.description,
        tags: parseTags(q.tags),
        version: q.version,
        isUpdate: q.publicVersion > 0,
        note: q.note,
        by: name(q),
        submitter: q.submitterEmail ? { name: q.submitterName || q.submitterEmail, email: q.submitterEmail } : null,
        createdAt: q.createdAt.getTime(),
        previewUrl: `/api/catalog/items/${q.itemId}/preview?v=${q.version}`,
        /** Its uploaded picture, when it has one (reviewed with it). */
        coverUrl: q.coverImageId ? itemCoverUrl(q.itemId, q.coverImageId) : null,
        // Whom a moderator would warn about it.
        owner: ownerRef(q),
        trustedClub: !!q.ownerOrgId && trusted.has(q.ownerOrgId),
      });
    const covers = await coverQueue();
    return {
      /** New pictures for public items, waiting for review: what shows now beside the new one. */
      covers: covers.filter((c) => !c.trustedClub),
      trustedCovers: covers.filter((c) => c.trustedClub),
      queue: queue.filter((q) => !(q.ownerOrgId && trusted.has(q.ownerOrgId))).map(entry),
      /** Waiting in trusted clubs' own queues. */
      trustedQueue: queue.filter((q) => q.ownerOrgId && trusted.has(q.ownerOrgId)).map(entry),
      items: items.map((i) => ({ ...itemOut(i, name(i)), status: i.status, reason: i.reason, owner: ownerRef(i), trustedClub: !!i.ownerOrgId && trusted.has(i.ownerOrgId) })),
    };
  });

  const decide = (req: FastifyRequest<{ Params: { versionId: string }; Body: { reason?: unknown } }>, approve: boolean) =>
    decideVersion(requireModerator(req), req.params.versionId, approve, req.body?.reason);
  app.post<{ Params: { versionId: string }; Body: { reason?: unknown } }>('/api/moderation/versions/:versionId/approve', async (req, reply) => {
    const r = await decide(req, true);
    return reply.code(r.code).send(r.body);
  });
  app.post<{ Params: { versionId: string }; Body: { reason?: unknown } }>('/api/moderation/versions/:versionId/decline', async (req, reply) => {
    const r = await decide(req, false);
    return reply.code(r.code).send(r.body);
  });

  // Take an item out of the catalog at once. Copies already in people's
  // layouts keep working: they're copies.
  app.post<{ Params: { id: string }; Body: { reason?: unknown } }>('/api/moderation/items/:id/unpublish', async (req, reply) => {
    const r = await unpublishItem(requireModerator(req), req.params.id, req.body?.reason);
    return reply.code(r.code).send(r.body);
  });
}

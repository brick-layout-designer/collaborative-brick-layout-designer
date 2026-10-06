// Catalog items' own cover pictures (modules and parts; the same rules as a
// collection's cover, routes/collections.ts):
//
//   - Who: whoever may share the item: its owner, a club's admins and
//     managers, and in a trusted club any member (for the club's review).
//   - The upload: JSON {mime, data} (base64, never an octet-stream body),
//     PNG, JPEG or WebP by its first bytes, no bigger than Admin › Settings
//     allows; re-encoded with no metadata (images/covers.ts). The web app
//     crops it and puts a background behind a see-through picture first.
//   - Review: while the item is public, a new picture waits for review
//     (`pending_cover_image_id`) and the old one stays up. Review off, a
//     trusted club's admins and managers, and moderators: it shows at once.
//     An item not public yet shows its picture with its next review.
//   - Removing the picture goes back to the drawn one at once.
//   - Counted in the owner's space; replaced and removed pictures are
//     deleted. Every change is audit-logged.

import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { and, eq, isNotNull, notInArray } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import type { User } from '../db/schema.js';
import { requireUser } from '../auth/cookie.js';
import { isDemoUser } from '../demo/demoAccount.js';
import { getPlatformSettings } from '../auth/platformSettings.js';
import { writeAuditEvent } from '../audit/writeAuditEvent.js';
import { atLeast } from '../access/clubRoles.js';
import { publicName } from '../utils/publicName.js';
import { checkGrowth, type Subject } from '../limits/limits.js';
import { COVER_BODY_LIMIT, readCoverBody } from '../images/covers.js';
import { canModerate, catalogOn, cleanText, clubRole, isTrustedClub, manages, mayBrowse, ownerNames, picturedVersions, previewUrlOf, trustedClubs } from './catalog.js';
import { perPerson } from '../utils/rateLimits.js';

type Item = typeof schema.catalogItems.$inferSelect;
type Outcome = { code: number; body: unknown };
const MAX_REASON = 300;
const TOKEN_READ = { apiToken: 'layouts:read' } as const;

/** An uploaded cover's address; `small` is the card-sized copy. */
export const itemCoverUrl = (itemId: string, imageId: string, small = true) => `/api/catalog/items/${itemId}/cover?image=${imageId}${small ? '&size=small' : ''}`;

/** Public in the catalog right now. */
const isLive = (i: Pick<Item, 'status' | 'publicVersion'>) => i.status === 'public' && i.publicVersion > 0;

/**
 * Whether `user` may change the item's picture, and whether it shows at
 * once. Not found when they can't see the item at all.
 */
async function coverAccess(user: User, item: Item): Promise<{ ok: true; straight: boolean } | { ok: false; out: Outcome }> {
  const role = item.ownerOrgId ? await clubRole(user.id, item.ownerOrgId) : null;
  const trusted = await isTrustedClub(item.ownerOrgId);
  const may = item.ownerOrgId ? atLeast(role, 'manager') || (trusted && !!role) : item.ownerUserId === user.id;
  if (!may) {
    const visible = isLive(item) || !!role || canModerate(user);
    return { ok: false, out: visible ? { code: 403, body: { error: 'forbidden' } } : { code: 404, body: { error: 'not_found' } } };
  }
  const review = (await getPlatformSettings()).catalogReview;
  const straight = !isLive(item) || review === 'none' || canModerate(user) || (trusted && atLeast(role, 'manager'));
  return { ok: true, straight };
}

/** Delete an item's pictures that are neither showing nor waiting. */
export async function pruneItemCovers(itemId: string): Promise<void> {
  const i = await db.select().from(schema.catalogItems).where(eq(schema.catalogItems.id, itemId)).get();
  if (!i) return;
  const keep = [i.coverImageId, i.pendingCoverImageId].filter((x): x is string => !!x);
  await db
    .delete(schema.catalogItemCovers)
    .where(and(eq(schema.catalogItemCovers.itemId, itemId), keep.length ? notInArray(schema.catalogItemCovers.id, keep) : undefined));
}

/** What the owner sees about the item's picture. */
export function coverState(i: Pick<Item, 'id' | 'coverImageId' | 'pendingCoverImageId' | 'coverReason'>) {
  return {
    customCoverUrl: i.coverImageId ? itemCoverUrl(i.id, i.coverImageId) : null,
    pendingCoverUrl: i.pendingCoverImageId ? itemCoverUrl(i.id, i.pendingCoverImageId) : null,
    coverReason: i.coverReason,
  };
}

/**
 * Approve or decline a waiting picture: site moderators (any), or a trusted
 * club's admins and managers (`clubId`: only the club's own items).
 */
export async function decideCover(user: User, itemId: string, approve: boolean, rawReason: unknown, clubId: string | null = null): Promise<Outcome> {
  const item = await db.select().from(schema.catalogItems).where(eq(schema.catalogItems.id, itemId)).get();
  if (!item || !item.pendingCoverImageId || (clubId && item.ownerOrgId !== clubId)) return { code: 404, body: { error: 'not_found' } };
  const reason = cleanText(rawReason, MAX_REASON);
  if (reason === undefined) return { code: 400, body: { error: 'invalid_input' } };
  await db
    .update(schema.catalogItems)
    .set(
      approve
        ? { coverImageId: item.pendingCoverImageId, pendingCoverImageId: null, coverReason: null, updatedAt: new Date() }
        : { pendingCoverImageId: null, coverReason: reason ?? 'Declined', updatedAt: new Date() },
    )
    .where(eq(schema.catalogItems.id, item.id));
  await pruneItemCovers(item.id);
  await writeAuditEvent({
    resourceKind: 'catalog_item',
    resourceId: item.id,
    userId: user.id,
    eventType: approve ? 'catalog_cover_approve' : 'catalog_cover_decline',
    payload: { reason, ...(clubId ? { byClub: clubId } : {}) },
  });
  return { code: 200, body: { ok: true } };
}

export interface CoverQueueEntry {
  itemId: string;
  kind: Item['kind'];
  title: string;
  by: string;
  /** What's showing now: the uploaded picture, or the drawn one. */
  oldUrl: string | null;
  newUrl: string;
  submitter: string | null;
  createdAt: number;
  owner: { kind: 'user' | 'org'; id: string } | null;
  trustedClub: boolean;
}

/** Items with a picture waiting for review (all of them, or one club's). */
export async function coverQueue(orgId: string | null = null): Promise<CoverQueueEntry[]> {
  const rows = await db
    .select({
      item: schema.catalogItems,
      createdAt: schema.catalogItemCovers.createdAt,
      submitter: schema.users.displayName,
      submitterId: schema.users.id,
    })
    .from(schema.catalogItems)
    .innerJoin(schema.catalogItemCovers, eq(schema.catalogItemCovers.id, schema.catalogItems.pendingCoverImageId))
    .leftJoin(schema.users, eq(schema.users.id, schema.catalogItemCovers.createdBy))
    .where(and(isNotNull(schema.catalogItems.pendingCoverImageId), orgId ? eq(schema.catalogItems.ownerOrgId, orgId) : undefined))
    .orderBy(schema.catalogItemCovers.createdAt);
  const name = await ownerNames(rows.map((r) => r.item));
  const trusted = await trustedClubs(rows.map((r) => r.item.ownerOrgId));
  const pictured = await picturedVersions(rows.map((r) => ({ id: r.item.id, version: r.item.publicVersion })));
  return rows.map(({ item: i, createdAt, submitter, submitterId }) => ({
    itemId: i.id,
    kind: i.kind,
    title: i.title,
    by: name(i),
    oldUrl: i.coverImageId ? itemCoverUrl(i.id, i.coverImageId) : previewUrlOf(i.id, i.publicVersion, pictured) || null,
    newUrl: itemCoverUrl(i.id, i.pendingCoverImageId!),
    // Club reviewers see this too: a name, never an address.
    submitter: submitterId ? publicName(submitterId, submitter) : null,
    createdAt: createdAt.getTime(),
    owner: i.ownerOrgId ? { kind: 'org' as const, id: i.ownerOrgId } : i.ownerUserId ? { kind: 'user' as const, id: i.ownerUserId } : null,
    trustedClub: !!i.ownerOrgId && trusted.has(i.ownerOrgId),
  }));
}

const loadItem = (id: string) => db.select().from(schema.catalogItems).where(eq(schema.catalogItems.id, id)).get();

export async function itemCoverRoutes(app: FastifyInstance): Promise<void> {
  app.put<{ Params: { id: string }; Body: { mime?: unknown; data?: unknown } }>(
    '/api/catalog/items/:id/cover',
    // codeql[js/missing-rate-limiting] - rate limited via Fastify config.rateLimit
    { bodyLimit: COVER_BODY_LIMIT, config: { rateLimit: perPerson(30, '1 hour') } },
    async (req, reply) => {
      const user = requireUser(req);
      const item = await loadItem(req.params.id);
      if (!item || !(await catalogOn(item.kind))) return reply.code(404).send({ error: 'not_found' });
      const access = await coverAccess(user, item);
      if (!access.ok) return reply.code(access.out.code).send(access.out.body);
      if (isDemoUser(user)) return reply.code(403).send({ error: 'demo_account_cannot_submit' });
      const read = await readCoverBody(req.body);
      if (!read.ok) return reply.code(read.code).send(read.body);
      const owner: Subject = item.ownerOrgId ? { kind: 'org', id: item.ownerOrgId } : { kind: 'user', id: item.ownerUserId ?? user.id };
      const refusal = await checkGrowth({ actor: user, owner, add: { bytes: read.image.length + read.small.length }, uploadBytes: read.bytes.length });
      if (refusal) return reply.code(refusal.status).send(refusal.body);
      const imageId = randomUUID();
      const now = new Date();
      await db.insert(schema.catalogItemCovers).values({ id: imageId, itemId: item.id, image: read.image, small: read.small, createdBy: user.id, createdAt: now });
      await db
        .update(schema.catalogItems)
        .set(access.straight ? { coverImageId: imageId, pendingCoverImageId: null, coverReason: null, updatedAt: now } : { pendingCoverImageId: imageId, coverReason: null })
        .where(eq(schema.catalogItems.id, item.id));
      await pruneItemCovers(item.id);
      await writeAuditEvent({
        resourceKind: 'catalog_item',
        resourceId: item.id,
        userId: user.id,
        eventType: 'catalog_cover',
        payload: { cover: 'uploaded', straight: access.straight },
      });
      const after = (await loadItem(item.id))!;
      return { status: access.straight ? 'public' : 'in_review', ...coverState(after) };
    },
  );

  // Back to the drawn picture, at once (a waiting one goes too).
  app.delete<{ Params: { id: string } }>(
    '/api/catalog/items/:id/cover',
    // codeql[js/missing-rate-limiting] - rate limited via Fastify config.rateLimit
    { config: { rateLimit: perPerson(30, '1 hour') } },
    async (req, reply) => {
      const user = requireUser(req);
      const item = await loadItem(req.params.id);
      if (!item || !(await catalogOn(item.kind))) return reply.code(404).send({ error: 'not_found' });
      const access = await coverAccess(user, item);
      if (!access.ok) return reply.code(access.out.code).send(access.out.body);
      await db
        .update(schema.catalogItems)
        .set({ coverImageId: null, pendingCoverImageId: null, coverReason: null, updatedAt: new Date() })
        .where(eq(schema.catalogItems.id, item.id));
      await pruneItemCovers(item.id);
      await writeAuditEvent({ resourceKind: 'catalog_item', resourceId: item.id, userId: user.id, eventType: 'catalog_cover', payload: { cover: 'removed' } });
      return { status: 'public', ...coverState((await loadItem(item.id))!) };
    },
  );

  // The picture: the one showing, to whoever can see the item; one waiting
  // for review, to those who manage it and to reviewers. `?size=small` is
  // the card-sized copy. A new picture has a new id, so it's cached.
  app.get<{ Params: { id: string }; Querystring: { image?: string; size?: string } }>(
    '/api/catalog/items/:id/cover',
    { config: TOKEN_READ },
    async (req, reply) => {
      const item = await loadItem(req.params.id);
      if (!item || !(await catalogOn(item.kind))) return reply.code(404).send({ error: 'not_found' });
      const imageId = typeof req.query?.image === 'string' && req.query.image ? req.query.image : item.coverImageId;
      if (!imageId) return reply.code(404).send({ error: 'not_found' });
      const user = req.user ?? null;
      const showing = imageId === item.coverImageId;
      const waiting = imageId === item.pendingCoverImageId;
      if (!showing && !waiting) return reply.code(404).send({ error: 'not_found' });
      const insider = !!user && ((await manages(user.id, item)) || canModerate(user));
      // A trusted club's members see what waits in its review.
      const clubReviewer = !!user && !!item.ownerOrgId && (await isTrustedClub(item.ownerOrgId)) && atLeast(await clubRole(user.id, item.ownerOrgId), 'member');
      const allowed = showing ? insider || clubReviewer || (isLive(item) && (await mayBrowse(req))) : insider || clubReviewer;
      if (!allowed) return reply.code(404).send({ error: 'not_found' });
      const small = req.query?.size === 'small';
      const row = await db
        .select({ image: small ? schema.catalogItemCovers.small : schema.catalogItemCovers.image })
        .from(schema.catalogItemCovers)
        .where(and(eq(schema.catalogItemCovers.id, imageId), eq(schema.catalogItemCovers.itemId, item.id)))
        .get();
      if (!row) return reply.code(404).send({ error: 'not_found' });
      const etag = `"${imageId}${small ? '-s' : ''}"`;
      reply.header('Cache-Control', 'private, max-age=86400');
      reply.header('ETag', etag);
      reply.header('X-Content-Type-Options', 'nosniff');
      if (req.headers['if-none-match'] === etag) return reply.code(304).send();
      return reply.type('image/webp').send(Buffer.from(row.image as Uint8Array));
    },
  );

  // ---- review: site moderators ---------------------------------------------
  type DecideReq = { Params: { id: string }; Body: { reason?: unknown } };
  const moderator = (u: User): Outcome | null => (canModerate(u) ? null : { code: 403, body: { error: 'forbidden' } });
  for (const approve of [true, false]) {
    app.post<DecideReq>(`/api/moderation/items/:id/cover/${approve ? 'approve' : 'decline'}`, async (req, reply) => {
      const user = requireUser(req);
      const refused = moderator(user);
      const r = refused ?? (await decideCover(user, req.params.id, approve, req.body?.reason));
      return reply.code(r.code).send(r.body);
    });
  }
}

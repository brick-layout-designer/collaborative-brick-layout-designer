// Trusted clubs. A site admin or moderator can mark a club as trusted
// (and take it back). For a trusted club, the club's own review replaces
// the site's for anything published under its name: modules, parts and
// collections.
//
//   - What its admins and managers publish goes public at once
//     (catalog.ts submitToCatalog, collections.ts editCollection).
//   - What a member submits under the club waits in the club's queue, which
//     its admins and managers work: approve, decline (with a reason),
//     unpublish. It isn't in the site moderators' queue (they can still
//     see it, and act on it, from Moderation).
//   - The queue is worked out from what's waiting, so untrusting a club
//     moves its queue back to the site's; what's public stays public.
//
// All bodies are JSON. Every change is audit-logged.

import type { FastifyInstance, FastifyRequest } from 'fastify';
import { and, asc, count, desc, eq, inArray, isNotNull, like, or } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import type { User } from '../db/schema.js';
import { requireUser } from '../auth/cookie.js';
import { writeAuditEvent } from '../audit/writeAuditEvent.js';
import { atLeast } from '../access/clubRoles.js';
import { canModerate, decideVersion, itemOut, ownerNames, unpublishItem } from './catalog.js';
import { decideCollection, textQueue, unpublishCollection, collectionOwnerNames, shownForQueue } from './collections.js';
import { publicName } from '../utils/publicName.js';
import { coverQueue, decideCover } from './itemCovers.js';

type Org = typeof schema.orgs.$inferSelect;
type Outcome = { code: number; body: unknown };

const loadOrg = (slug: string) => db.select().from(schema.orgs).where(eq(schema.orgs.slug, slug.trim().toLowerCase())).get();

/**
 * The club, for its admins and managers, when it's trusted: 404 to
 * non-members, 403 to members and to a club that isn't trusted.
 */
async function reviewer(req: FastifyRequest<{ Params: { slug: string } }>): Promise<{ user: User; org: Org } | Outcome> {
  const user = requireUser(req);
  const org = await loadOrg(req.params.slug);
  if (!org) return { code: 404, body: { error: 'not_found' } };
  const m = await db
    .select({ role: schema.orgMembers.role })
    .from(schema.orgMembers)
    .where(and(eq(schema.orgMembers.orgId, org.id), eq(schema.orgMembers.userId, user.id)))
    .get();
  if (!m) return { code: 404, body: { error: 'not_found' } };
  if (!atLeast(m.role, 'manager')) return { code: 403, body: { error: 'forbidden' } };
  if (!org.trusted) return { code: 403, body: { error: 'club_not_trusted' } };
  return { user, org };
}

/**
 * How much is waiting in a trusted club's review queue: members' shares
 * (new versions), collection texts and new cover pictures, the same
 * things its Review tab lists. Shown on "Manage the club", the Review tab
 * and the Clubs list, for its admins and managers.
 */
export async function clubReviewCount(orgId: string): Promise<number> {
  const versions = await db
    .select({ n: count() })
    .from(schema.catalogItemVersions)
    .innerJoin(schema.catalogItems, eq(schema.catalogItems.id, schema.catalogItemVersions.itemId))
    .where(and(eq(schema.catalogItemVersions.status, 'in_review'), eq(schema.catalogItems.ownerOrgId, orgId)))
    .get();
  const collections = await db
    .select({ n: count() })
    .from(schema.catalogCollections)
    .where(
      and(
        eq(schema.catalogCollections.orgId, orgId),
        eq(schema.catalogCollections.audience, 'everyone'),
        or(eq(schema.catalogCollections.status, 'in_review'), and(eq(schema.catalogCollections.status, 'public'), isNotNull(schema.catalogCollections.pending))),
      ),
    )
    .get();
  const covers = await db
    .select({ n: count() })
    .from(schema.catalogItems)
    .where(and(eq(schema.catalogItems.ownerOrgId, orgId), isNotNull(schema.catalogItems.pendingCoverImageId)))
    .get();
  return (versions?.n ?? 0) + (collections?.n ?? 0) + (covers?.n ?? 0);
}

const isOutcome = (x: unknown): x is Outcome => !!x && typeof x === 'object' && 'code' in x;

export async function clubReviewRoutes(app: FastifyInstance): Promise<void> {
  // ---- trust (site admins and moderators) --------------------------------
  app.post<{ Params: { slug: string }; Body: { trusted?: unknown } }>('/api/moderation/clubs/:slug/trust', async (req, reply) => {
    const user = requireUser(req);
    if (!canModerate(user)) return reply.code(403).send({ error: 'forbidden' });
    if (typeof req.body?.trusted !== 'boolean') return reply.code(400).send({ error: 'invalid_input' });
    const org = await loadOrg(req.params.slug);
    if (!org) return reply.code(404).send({ error: 'not_found' });
    const trusted = req.body.trusted;
    await db
      .update(schema.orgs)
      .set({ trusted, trustedAt: trusted ? new Date() : null })
      .where(eq(schema.orgs.id, org.id));
    await writeAuditEvent({ resourceKind: 'org', resourceId: org.id, userId: user.id, eventType: trusted ? 'club_trust' : 'club_untrust', payload: { slug: org.slug } });
    return { ok: true, trusted };
  });

  // Clubs, for the moderators' "Trusted clubs" list: the trusted ones, and
  // (with `q`) clubs whose name or address matches.
  app.get<{ Querystring: { q?: string } }>('/api/moderation/clubs', async (req, reply) => {
    const user = requireUser(req);
    if (!canModerate(user)) return reply.code(403).send({ error: 'forbidden' });
    const q = typeof req.query?.q === 'string' ? req.query.q.trim().toLowerCase().slice(0, 80) : '';
    const rows = await db
      .select({ id: schema.orgs.id, slug: schema.orgs.slug, name: schema.orgs.name, trusted: schema.orgs.trusted, trustedAt: schema.orgs.trustedAt })
      .from(schema.orgs)
      .where(q ? or(like(schema.orgs.name, `%${q}%`), like(schema.orgs.slug, `%${q}%`)) : eq(schema.orgs.trusted, true))
      .orderBy(desc(schema.orgs.trusted), asc(schema.orgs.name))
      .limit(50);
    return { clubs: rows.map((r) => ({ ...r, trustedAt: r.trustedAt?.getTime() ?? null })) };
  });

  // ---- the club's own review queue ---------------------------------------
  app.get<{ Params: { slug: string } }>('/api/orgs/:slug/review', async (req, reply) => {
    const r = await reviewer(req);
    if (isOutcome(r)) return reply.code(r.code).send(r.body);
    const { org } = r;
    const waiting = await db
      .select({
        versionId: schema.catalogItemVersions.id,
        version: schema.catalogItemVersions.version,
        note: schema.catalogItemVersions.note,
        createdAt: schema.catalogItemVersions.createdAt,
        item: schema.catalogItems,
        submitter: schema.users.displayName,
        submitterId: schema.users.id,
      })
      .from(schema.catalogItemVersions)
      .innerJoin(schema.catalogItems, eq(schema.catalogItems.id, schema.catalogItemVersions.itemId))
      .leftJoin(schema.users, eq(schema.users.id, schema.catalogItemVersions.submittedBy))
      .where(and(eq(schema.catalogItemVersions.status, 'in_review'), eq(schema.catalogItems.ownerOrgId, org.id)))
      .orderBy(asc(schema.catalogItemVersions.createdAt));
    const published = await db
      .select()
      .from(schema.catalogItems)
      .where(and(eq(schema.catalogItems.ownerOrgId, org.id), inArray(schema.catalogItems.status, ['public', 'unpublished'])))
      .orderBy(desc(schema.catalogItems.updatedAt))
      .limit(200);
    const collRows = await db
      .select()
      .from(schema.catalogCollections)
      .where(
        and(
          eq(schema.catalogCollections.orgId, org.id),
          eq(schema.catalogCollections.audience, 'everyone'),
          or(eq(schema.catalogCollections.status, 'in_review'), and(eq(schema.catalogCollections.status, 'public'), isNotNull(schema.catalogCollections.pending))),
        ),
      );
    const publicColls = await db
      .select()
      .from(schema.catalogCollections)
      .where(and(eq(schema.catalogCollections.orgId, org.id), eq(schema.catalogCollections.audience, 'everyone'), inArray(schema.catalogCollections.status, ['public', 'unpublished'])));
    const name = await ownerNames(published);
    const shown = await shownForQueue([...collRows, ...publicColls]);
    const collName = await collectionOwnerNames([...collRows, ...publicColls]);
    const texts = await textQueue(collRows, shown, collName);
    return {
      items: waiting.map((w) => ({
        versionId: w.versionId,
        itemId: w.item.id,
        kind: w.item.kind,
        title: w.item.title,
        description: w.item.description,
        version: w.version,
        isUpdate: w.item.publicVersion > 0,
        note: w.note,
        submitter: w.submitterId ? publicName(w.submitterId, w.submitter) : null,
        createdAt: w.createdAt.getTime(),
        previewUrl: `/api/catalog/items/${w.item.id}/preview?v=${w.version}`,
      })),
      collections: [...texts.queue, ...texts.trustedQueue],
      /** New pictures for the club's public items: what shows now beside the new one. */
      covers: await coverQueue(org.id),
      published: published.map((i) => ({ ...itemOut(i, name(i)), status: i.status, reason: i.reason })),
      publicCollections: publicColls.map((c) => ({ id: c.id, title: c.title, status: c.status, reason: c.reason })),
    };
  });

  const act = (fn: (user: User, org: Org, req: FastifyRequest<{ Params: { slug: string; id: string }; Body: { reason?: unknown } }>) => Promise<Outcome>) =>
    async (req: FastifyRequest<{ Params: { slug: string; id: string }; Body: { reason?: unknown } }>, reply: import('fastify').FastifyReply) => {
      const r = await reviewer(req);
      if (isOutcome(r)) return reply.code(r.code).send(r.body);
      const out = await fn(r.user, r.org, req);
      return reply.code(out.code).send(out.body);
    };
  type ActReq = { Params: { slug: string; id: string }; Body: { reason?: unknown } };
  app.post<ActReq>('/api/orgs/:slug/review/versions/:id/approve', act((u, o, req) => decideVersion(u, req.params.id, true, req.body?.reason, o.id)));
  app.post<ActReq>('/api/orgs/:slug/review/versions/:id/decline', act((u, o, req) => decideVersion(u, req.params.id, false, req.body?.reason, o.id)));
  app.post<ActReq>('/api/orgs/:slug/review/items/:id/cover/approve', act((u, o, req) => decideCover(u, req.params.id, true, req.body?.reason, o.id)));
  app.post<ActReq>('/api/orgs/:slug/review/items/:id/cover/decline', act((u, o, req) => decideCover(u, req.params.id, false, req.body?.reason, o.id)));
  app.post<ActReq>('/api/orgs/:slug/review/items/:id/unpublish', act((u, o, req) => unpublishItem(u, req.params.id, req.body?.reason, o.id)));
  app.post<ActReq>('/api/orgs/:slug/review/collections/:id/approve', act((u, o, req) => decideCollection(u, req.params.id, true, req.body?.reason, o.id)));
  app.post<ActReq>('/api/orgs/:slug/review/collections/:id/decline', act((u, o, req) => decideCollection(u, req.params.id, false, req.body?.reason, o.id)));
  app.post<ActReq>('/api/orgs/:slug/review/collections/:id/unpublish', act((u, o, req) => unpublishCollection(u, req.params.id, req.body?.reason, o.id)));
}

// Finding and joining a club without an invite.
//
// Each club's admins choose who can join (orgs.joinPolicy):
//   - 'invite'  only with an admin's invite link (the default)
//   - 'request' people ask, with an optional note; an admin approves or declines
//   - 'open'    anyone signed in joins with one click, as a member
// and whether the club is listed in the Clubs directory (orgs.listed).
//
// A club that isn't listed stays invisible to people outside it: every
// endpoint here answers 404 for it, exactly like GET /api/orgs/:slug.
// The one exception is cancelling your own request, which keeps working
// if the club is unlisted after you asked.
//
//   GET    /api/club-directory?q=            listed clubs, with your status in each
//   GET    /api/orgs/:slug/summary           a club's public summary (members, or listed clubs)
//   POST   /api/orgs/:slug/join              join an open club, or ask to join
//   DELETE /api/orgs/:slug/join              take back your request
//   GET    /api/orgs/:slug/join-requests     the requests waiting (managers and admins)
//   POST   /api/orgs/:slug/join-requests/:id/approve   (managers and admins)
//   POST   /api/orgs/:slug/join-requests/:id/decline   (managers and admins)
//   GET    /api/join-requests/count          requests waiting in the clubs you run

import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { and, count, eq, inArray, sql } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { requireUser } from '../auth/cookie.js';
import { isDemoUser } from '../demo/demoAccount.js';
import { checkGrowth } from '../limits/limits.js';
import { writeAuditEvent } from '../audit/writeAuditEvent.js';
import { escapeLike } from '../utils/validate.js';
import { getMembership, loadOrgBySlug } from './orgs.js';
import { atLeast, type ClubRole } from '../access/clubRoles.js';
import { publicName } from '../utils/publicName.js';
import { perPerson } from '../utils/rateLimits.js';

/** The longest note someone can send with a request. */
export const JOIN_MESSAGE_MAX = 300;
/** How many clubs one person may be waiting on at once. */
export const OPEN_REQUESTS_MAX = 20;
const DIRECTORY_PAGE = 50;

type Org = typeof schema.orgs.$inferSelect;

async function memberCount(orgId: string): Promise<number> {
  const row = await db.select({ n: count() }).from(schema.orgMembers).where(eq(schema.orgMembers.orgId, orgId)).get();
  return row?.n ?? 0;
}

async function myRequest(orgId: string, userId: string) {
  return (
    (await db
      .select()
      .from(schema.orgJoinRequests)
      .where(and(eq(schema.orgJoinRequests.orgId, orgId), eq(schema.orgJoinRequests.userId, userId)))
      .get()) ?? null
  );
}

/** What anyone signed in may see of a listed club. */
function summary(org: Org, members: number, status: ClubRole | 'requested' | null) {
  return {
    id: org.id,
    name: org.name,
    slug: org.slug,
    description: org.description ?? '',
    memberCount: members,
    joinPolicy: org.joinPolicy,
    listed: org.listed,
    /** You: your role when you're in it, 'requested' when you've asked. */
    myStatus: status,
  };
}

async function statusOf(orgId: string, userId: string) {
  const m = await getMembership(orgId, userId);
  if (m) return m.role;
  return (await myRequest(orgId, userId)) ? ('requested' as const) : null;
}

/** The club, as one of its managers or admins sees it; otherwise the reply has been sent. */
async function asManager(slug: string, userId: string, reply: { code: (n: number) => { send: (b: unknown) => unknown } }) {
  const org = await loadOrgBySlug(slug);
  if (!org) {
    reply.code(404).send({ error: 'not_found' });
    return null;
  }
  const mine = await getMembership(org.id, userId);
  if (!mine) {
    reply.code(404).send({ error: 'not_found' });
    return null;
  }
  if (!atLeast(mine.role, 'manager')) {
    reply.code(403).send({ error: 'forbidden' });
    return null;
  }
  return org;
}

export async function clubJoinRoutes(app: FastifyInstance): Promise<void> {
  // ---- the directory ---------------------------------------------------------
  app.get<{ Querystring: { q?: string } }>(
    '/api/club-directory',
    { config: { rateLimit: perPerson(60, '1 minute') } },
    async (req) => {
      const user = requireUser(req);
      const needle = (req.query.q ?? '').trim().slice(0, 80);
      const where = needle
        ? and(
            eq(schema.orgs.listed, true),
            sql`(${schema.orgs.name} LIKE ${`%${escapeLike(needle)}%`} ESCAPE '\\' OR ${schema.orgs.description} LIKE ${`%${escapeLike(needle)}%`} ESCAPE '\\')`,
          )
        : eq(schema.orgs.listed, true);
      const orgs = await db.select().from(schema.orgs).where(where).orderBy(sql`lower(${schema.orgs.name})`).limit(DIRECTORY_PAGE);
      if (orgs.length === 0) return { clubs: [] };
      const ids = orgs.map((o) => o.id);
      const counts = new Map(
        (
          await db
            .select({ orgId: schema.orgMembers.orgId, n: count() })
            .from(schema.orgMembers)
            .where(inArray(schema.orgMembers.orgId, ids))
            .groupBy(schema.orgMembers.orgId)
        ).map((r) => [r.orgId, r.n]),
      );
      const mine = new Map(
        (
          await db
            .select({ orgId: schema.orgMembers.orgId, role: schema.orgMembers.role })
            .from(schema.orgMembers)
            .where(and(eq(schema.orgMembers.userId, user.id), inArray(schema.orgMembers.orgId, ids)))
        ).map((r) => [r.orgId, r.role]),
      );
      const asked = new Set(
        (
          await db
            .select({ orgId: schema.orgJoinRequests.orgId })
            .from(schema.orgJoinRequests)
            .where(and(eq(schema.orgJoinRequests.userId, user.id), inArray(schema.orgJoinRequests.orgId, ids)))
        ).map((r) => r.orgId),
      );
      return {
        clubs: orgs.map((o) => summary(o, counts.get(o.id) ?? 0, mine.get(o.id) ?? (asked.has(o.id) ? 'requested' : null))),
      };
    },
  );

  // ---- one club's public summary ---------------------------------------------
  app.get<{ Params: { slug: string } }>(
    '/api/orgs/:slug/summary',
    { config: { rateLimit: perPerson(60, '1 minute') } },
    async (req, reply) => {
      const user = requireUser(req);
      const org = await loadOrgBySlug(req.params.slug);
      if (!org) return reply.code(404).send({ error: 'not_found' });
      const status = await statusOf(org.id, user.id);
      // Unlisted clubs stay hidden from everyone outside them.
      if (!org.listed && (status === null || status === 'requested')) return reply.code(404).send({ error: 'not_found' });
      return summary(org, await memberCount(org.id), status);
    },
  );

  // ---- join, or ask to join ----------------------------------------------------
  app.post<{ Params: { slug: string }; Body: { message?: unknown } }>(
    '/api/orgs/:slug/join',
    { config: { rateLimit: perPerson(10, '1 minute') } },
    async (req, reply) => {
      const user = requireUser(req);
      if (isDemoUser(user)) return reply.code(403).send({ error: 'demo_account_cannot_join_clubs' });
      const org = await loadOrgBySlug(req.params.slug);
      if (!org) return reply.code(404).send({ error: 'not_found' });
      if (await getMembership(org.id, user.id)) return reply.code(409).send({ error: 'already_member' });
      if (!org.listed) return reply.code(404).send({ error: 'not_found' });
      if (org.joinPolicy === 'invite') {
        return reply.code(403).send({ error: 'invite_only', message: 'This club takes new members by invite only. Ask one of its admins.' });
      }

      if (org.joinPolicy === 'open') {
        const refusal = await checkGrowth({ actor: user, owner: { kind: 'org', id: org.id }, add: { members: 1 } });
        if (refusal) return reply.code(refusal.status).send(refusal.body);
        await db
          .insert(schema.orgMembers)
          .values({ orgId: org.id, userId: user.id, role: 'member', joinedAt: new Date() })
          .onConflictDoNothing();
        await db
          .delete(schema.orgJoinRequests)
          .where(and(eq(schema.orgJoinRequests.orgId, org.id), eq(schema.orgJoinRequests.userId, user.id)));
        await writeAuditEvent({ resourceKind: 'org', resourceId: org.id, userId: user.id, eventType: 'join', payload: {} });
        return { status: 'member' as const, slug: org.slug };
      }

      // Ask to join.
      const raw = req.body?.message;
      if (raw !== undefined && raw !== null && typeof raw !== 'string') return reply.code(400).send({ error: 'invalid_message' });
      const message = typeof raw === 'string' ? raw.trim() : '';
      if (message.length > JOIN_MESSAGE_MAX) return reply.code(400).send({ error: 'message_too_long' });
      if (await myRequest(org.id, user.id)) return { status: 'requested' as const, slug: org.slug };
      const waiting = await db
        .select({ n: count() })
        .from(schema.orgJoinRequests)
        .where(eq(schema.orgJoinRequests.userId, user.id))
        .get();
      if ((waiting?.n ?? 0) >= OPEN_REQUESTS_MAX) {
        return reply.code(429).send({
          error: 'too_many_requests',
          message: `You’re waiting to hear from ${OPEN_REQUESTS_MAX} clubs already. Take some requests back, or wait for an answer.`,
        });
      }
      await db
        .insert(schema.orgJoinRequests)
        .values({ id: randomUUID(), orgId: org.id, userId: user.id, message: message || null, createdAt: new Date() })
        .onConflictDoNothing();
      return { status: 'requested' as const, slug: org.slug };
    },
  );

  // ---- take back your request ------------------------------------------------
  app.delete<{ Params: { slug: string } }>(
    '/api/orgs/:slug/join',
    { config: { rateLimit: perPerson(20, '1 minute') } },
    async (req, reply) => {
      const user = requireUser(req);
      const org = await loadOrgBySlug(req.params.slug);
      if (!org) return reply.code(404).send({ error: 'not_found' });
      await db
        .delete(schema.orgJoinRequests)
        .where(and(eq(schema.orgJoinRequests.orgId, org.id), eq(schema.orgJoinRequests.userId, user.id)));
      return { ok: true };
    },
  );

  // ---- requests waiting (admins) -----------------------------------------------
  app.get<{ Params: { slug: string } }>('/api/orgs/:slug/join-requests', async (req, reply) => {
    const user = requireUser(req);
    const org = await asManager(req.params.slug, user.id, reply);
    if (!org) return reply;
    const rows = await db
      .select({
        id: schema.orgJoinRequests.id,
        userId: schema.orgJoinRequests.userId,
        message: schema.orgJoinRequests.message,
        createdAt: schema.orgJoinRequests.createdAt,
        displayName: schema.users.displayName,
        avatarUrl: schema.users.avatarUrl,
      })
      .from(schema.orgJoinRequests)
      .innerJoin(schema.users, eq(schema.users.id, schema.orgJoinRequests.userId))
      .where(eq(schema.orgJoinRequests.orgId, org.id))
      .orderBy(schema.orgJoinRequests.createdAt);
    return {
      requests: rows.map((r) => ({
        id: r.id,
        userId: r.userId,
        displayName: publicName(r.userId, r.displayName),
        avatarUrl: r.avatarUrl,
        message: r.message ?? '',
        createdAt: r.createdAt.getTime(),
      })),
    };
  });

  // ---- approve (admins) --------------------------------------------------------
  app.post<{ Params: { slug: string; id: string } }>(
    '/api/orgs/:slug/join-requests/:id/approve',
    { config: { rateLimit: perPerson(60, '1 minute') } },
    async (req, reply) => {
      const user = requireUser(req);
      const org = await asManager(req.params.slug, user.id, reply);
      if (!org) return reply;
      const request = await db
        .select()
        .from(schema.orgJoinRequests)
        .where(and(eq(schema.orgJoinRequests.id, req.params.id), eq(schema.orgJoinRequests.orgId, org.id)))
        .get();
      if (!request) return reply.code(404).send({ error: 'request_not_found' });
      if (!(await getMembership(org.id, request.userId))) {
        const refusal = await checkGrowth({ actor: user, owner: { kind: 'org', id: org.id }, add: { members: 1 } });
        if (refusal) return reply.code(refusal.status).send(refusal.body);
        await db
          .insert(schema.orgMembers)
          .values({ orgId: org.id, userId: request.userId, role: 'member', joinedAt: new Date() })
          .onConflictDoNothing();
      }
      await db.delete(schema.orgJoinRequests).where(eq(schema.orgJoinRequests.id, request.id));
      await writeAuditEvent({
        resourceKind: 'org',
        resourceId: org.id,
        userId: user.id,
        eventType: 'join_approve',
        payload: { targetUserId: request.userId },
      });
      return { ok: true };
    },
  );

  // ---- decline (admins); the person isn't told ---------------------------------
  app.post<{ Params: { slug: string; id: string } }>(
    '/api/orgs/:slug/join-requests/:id/decline',
    { config: { rateLimit: perPerson(60, '1 minute') } },
    async (req, reply) => {
      const user = requireUser(req);
      const org = await asManager(req.params.slug, user.id, reply);
      if (!org) return reply;
      const request = await db
        .select()
        .from(schema.orgJoinRequests)
        .where(and(eq(schema.orgJoinRequests.id, req.params.id), eq(schema.orgJoinRequests.orgId, org.id)))
        .get();
      if (!request) return reply.code(404).send({ error: 'request_not_found' });
      await db.delete(schema.orgJoinRequests).where(eq(schema.orgJoinRequests.id, request.id));
      await writeAuditEvent({
        resourceKind: 'org',
        resourceId: org.id,
        userId: user.id,
        eventType: 'join_decline',
        payload: { targetUserId: request.userId },
      });
      return { ok: true };
    },
  );

  // ---- how many are waiting, in the clubs you run --------------------------------
  app.get('/api/join-requests/count', async (req) => {
    const user = requireUser(req);
    const rows = await db
      .select({ slug: schema.orgs.slug, n: count() })
      .from(schema.orgJoinRequests)
      .innerJoin(schema.orgs, eq(schema.orgs.id, schema.orgJoinRequests.orgId))
      .innerJoin(
        schema.orgMembers,
        and(eq(schema.orgMembers.orgId, schema.orgJoinRequests.orgId), eq(schema.orgMembers.userId, user.id)),
      )
      .where(inArray(schema.orgMembers.role, ['admin', 'manager']))
      .groupBy(schema.orgs.slug);
    return { count: rows.reduce((t, r) => t + r.n, 0), clubs: rows.map((r) => ({ slug: r.slug, count: r.n })) };
  });
}

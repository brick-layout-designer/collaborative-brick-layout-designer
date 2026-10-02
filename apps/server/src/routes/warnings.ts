// Warnings: formal notices about unacceptable activity.
//
//   POST /api/admin/warnings              site admin or moderator warns a person or a club
//   GET  /api/admin/warnings              the history for one person or club (admins, moderators)
//   POST /api/orgs/:slug/warnings         a club's admin or manager warns one of its members
//   GET  /api/orgs/:slug/warnings         the club's own warnings (its admins and managers)
//   GET  /api/notices                     the warnings I (or a club I run) received
//   POST /api/notices/:id/acknowledge     "I understand"
//
// Who sees what:
//   - a site warning to a person: that person, site admins and moderators
//   - a site warning to a club: the club's admins and managers, site admins and moderators
//   - a club warning to a member: that member, the club's admins and
//     managers, and site admins
// Managers warn members only; admins warn members and managers. Nobody
// warns themselves. Everything is audit-logged and rate-limited; the next
// steps (read-only, limits) stay with site admins, on the same pages.

import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { and, desc, eq, inArray, isNull, or } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { requireUser } from '../auth/cookie.js';
import { writeAuditEvent } from '../audit/writeAuditEvent.js';
import { atLeast, type ClubRole } from '../access/clubRoles.js';
import { canModerate } from './catalog.js';
import { getMembership, loadOrgBySlug } from './orgs.js';
import { sendWarningEmail } from '../email/sendWarning.js';

export const SEVERITIES = ['note', 'warning', 'final'] as const;
export type Severity = (typeof SEVERITIES)[number];
const MAX_REASON = 2000;
const MAX_LINK = 500;
/** Warnings one person may send in a minute (both kinds together). */
const RATE = { max: 20, timeWindow: '1 minute' } as const;

type Input = { severity: Severity; reason: string; link: string | null };

/** The reason, severity and optional link, checked. A link must be a path on this site. */
export function parseWarningInput(body: unknown): Input | { error: string } {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const severity = b.severity;
  if (typeof severity !== 'string' || !(SEVERITIES as readonly string[]).includes(severity)) return { error: 'invalid_severity' };
  const reason = typeof b.reason === 'string' ? b.reason.trim() : '';
  if (reason.length < 3 || reason.length > MAX_REASON) return { error: 'invalid_reason' };
  let link: string | null = null;
  if (b.link !== undefined && b.link !== null && b.link !== '') {
    if (typeof b.link !== 'string') return { error: 'invalid_link' };
    const l = b.link.trim();
    // A path on this site only: no other sites, no `//host`, no `javascript:`.
    if (l.length > MAX_LINK || !l.startsWith('/') || l.startsWith('//') || /[\s\\]/.test(l)) return { error: 'invalid_link' };
    link = l;
  }
  return { severity: severity as Severity, reason, link };
}

/** Who must see a warning: the person, or a club's admins and managers. */
export async function recipientsOf(w: Pick<schema.Warning, 'subjectUserId' | 'subjectOrgId'>): Promise<string[]> {
  if (w.subjectUserId) return [w.subjectUserId];
  if (!w.subjectOrgId) return [];
  const rows = await db
    .select({ u: schema.orgMembers.userId })
    .from(schema.orgMembers)
    .where(and(eq(schema.orgMembers.orgId, w.subjectOrgId), inArray(schema.orgMembers.role, ['admin', 'manager'])))
    .all();
  return rows.map((r) => r.u);
}

/** The club's admins and managers (for a club warning: they see what the club sent). */
export async function clubRunners(orgId: string): Promise<string[]> {
  return recipientsOf({ subjectUserId: null, subjectOrgId: orgId });
}

async function emailsOf(userIds: string[]): Promise<string[]> {
  if (userIds.length === 0) return [];
  const rows = await db.select({ e: schema.users.email }).from(schema.users).where(inArray(schema.users.id, userIds)).all();
  return rows.map((r) => r.e);
}

interface WarningOut {
  id: string;
  scope: 'site' | 'club';
  severity: Severity;
  reason: string;
  link: string | null;
  createdAt: number;
  acknowledgedAt: number | null;
  issuedBy: { id: string; name: string } | null;
  club: { id: string; name: string; slug: string } | null;
  to: { kind: 'user'; id: string; name: string } | { kind: 'org'; id: string; name: string; slug: string };
}

/** Rows with the names the pages show. `withIssuer`: who sent it (staff and club runners only). */
async function describe(rows: schema.Warning[], withIssuer: boolean): Promise<WarningOut[]> {
  const userIds = [...new Set(rows.flatMap((r) => [r.subjectUserId, withIssuer ? r.issuedBy : null]).filter((x): x is string => !!x))];
  const orgIds = [...new Set(rows.flatMap((r) => [r.subjectOrgId, r.clubOrgId]).filter((x): x is string => !!x))];
  const users = userIds.length
    ? new Map((await db.select({ id: schema.users.id, n: schema.users.displayName }).from(schema.users).where(inArray(schema.users.id, userIds)).all()).map((u) => [u.id, u.n]))
    : new Map<string, string>();
  const orgs = orgIds.length
    ? new Map((await db.select({ id: schema.orgs.id, n: schema.orgs.name, s: schema.orgs.slug }).from(schema.orgs).where(inArray(schema.orgs.id, orgIds)).all()).map((o) => [o.id, o]))
    : new Map<string, { id: string; n: string; s: string }>();
  return rows.map((r) => {
    const club = r.clubOrgId ? orgs.get(r.clubOrgId) : undefined;
    const org = r.subjectOrgId ? orgs.get(r.subjectOrgId) : undefined;
    return {
      id: r.id,
      scope: r.scope,
      severity: r.severity,
      reason: r.reason,
      link: r.link,
      createdAt: r.createdAt.getTime(),
      acknowledgedAt: r.acknowledgedAt ? r.acknowledgedAt.getTime() : null,
      issuedBy: withIssuer && r.issuedBy ? { id: r.issuedBy, name: users.get(r.issuedBy) ?? '' } : null,
      club: club ? { id: club.id, name: club.n, slug: club.s } : null,
      to: org
        ? { kind: 'org' as const, id: org.id, name: org.n, slug: org.s }
        : { kind: 'user' as const, id: r.subjectUserId ?? '', name: users.get(r.subjectUserId ?? '') ?? '' },
    };
  });
}

async function issue(args: {
  scope: 'site' | 'club';
  clubOrgId: string | null;
  subject: { kind: 'user' | 'org'; id: string };
  input: Input;
  issuer: { id: string; displayName: string };
  fromName: string;
}): Promise<schema.Warning> {
  const row: schema.Warning = {
    id: randomUUID(),
    scope: args.scope,
    clubOrgId: args.clubOrgId,
    subjectUserId: args.subject.kind === 'user' ? args.subject.id : null,
    subjectOrgId: args.subject.kind === 'org' ? args.subject.id : null,
    severity: args.input.severity,
    reason: args.input.reason,
    link: args.input.link,
    issuedBy: args.issuer.id,
    createdAt: new Date(),
    acknowledgedAt: null,
    acknowledgedBy: null,
  };
  await db.insert(schema.warnings).values(row);
  await writeAuditEvent({
    resourceKind: args.subject.kind,
    resourceId: args.subject.id,
    userId: args.issuer.id,
    eventType: args.scope === 'site' ? 'warn' : 'club_warn',
    payload: { warningId: row.id, severity: row.severity, reason: row.reason, link: row.link, ...(args.clubOrgId ? { clubOrgId: args.clubOrgId } : {}) },
  });
  // Email too, when the site can send it. Never fails the warning.
  try {
    const to = await emailsOf(await recipientsOf(row));
    for (const addr of to) await sendWarningEmail({ to: addr, severity: row.severity, reason: row.reason, fromName: args.fromName });
  } catch {
    // No SMTP or it failed: the notice in the app is what counts.
  }
  return row;
}

export async function warningRoutes(app: FastifyInstance): Promise<void> {
  // ---- site warnings ------------------------------------------------------
  app.post('/api/admin/warnings', { config: { rateLimit: RATE } }, async (req, reply) => {
    const user = requireUser(req);
    if (!canModerate(user)) return reply.code(403).send({ error: 'forbidden' });
    const b = (req.body ?? {}) as Record<string, unknown>;
    const kind = b.subjectKind;
    const id = typeof b.subjectId === 'string' ? b.subjectId : '';
    if ((kind !== 'user' && kind !== 'org') || !id) return reply.code(400).send({ error: 'invalid_subject' });
    const input = parseWarningInput(b);
    if ('error' in input) return reply.code(400).send(input);
    if (kind === 'user') {
      if (id === user.id) return reply.code(400).send({ error: 'cannot_warn_yourself' });
      const exists = await db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.id, id)).get();
      if (!exists) return reply.code(404).send({ error: 'not_found' });
    } else {
      const exists = await db.select({ id: schema.orgs.id }).from(schema.orgs).where(eq(schema.orgs.id, id)).get();
      if (!exists) return reply.code(404).send({ error: 'not_found' });
    }
    const row = await issue({ scope: 'site', clubOrgId: null, subject: { kind, id }, input, issuer: user, fromName: 'the site team' });
    return reply.code(201).send({ id: row.id });
  });

  app.get<{ Querystring: { subjectKind?: string; subjectId?: string } }>('/api/admin/warnings', async (req, reply) => {
    const user = requireUser(req);
    if (!canModerate(user)) return reply.code(403).send({ error: 'forbidden' });
    const { subjectKind, subjectId } = req.query;
    if ((subjectKind !== 'user' && subjectKind !== 'org') || !subjectId) return reply.code(400).send({ error: 'invalid_subject' });
    // Moderators see site warnings; admins also see clubs' own warnings.
    const siteOnly = !user.isGlobalAdmin;
    const about =
      subjectKind === 'user'
        ? eq(schema.warnings.subjectUserId, subjectId)
        : or(eq(schema.warnings.subjectOrgId, subjectId), eq(schema.warnings.clubOrgId, subjectId));
    const rows = await db
      .select()
      .from(schema.warnings)
      .where(siteOnly ? and(about, eq(schema.warnings.scope, 'site')) : about)
      .orderBy(desc(schema.warnings.createdAt))
      .all();
    return { warnings: await describe(rows, true) };
  });

  // ---- club warnings ------------------------------------------------------
  app.post<{ Params: { slug: string } }>('/api/orgs/:slug/warnings', { config: { rateLimit: RATE } }, async (req, reply) => {
    const user = requireUser(req);
    const org = await loadOrgBySlug(req.params.slug);
    if (!org) return reply.code(404).send({ error: 'not_found' });
    const mine = await getMembership(org.id, user.id);
    if (!mine) return reply.code(404).send({ error: 'not_found' });
    if (!atLeast(mine.role, 'manager')) return reply.code(403).send({ error: 'forbidden' });
    const b = (req.body ?? {}) as Record<string, unknown>;
    const target = typeof b.userId === 'string' ? b.userId : '';
    if (!target) return reply.code(400).send({ error: 'invalid_subject' });
    if (target === user.id) return reply.code(400).send({ error: 'cannot_warn_yourself' });
    const theirs = await getMembership(org.id, target);
    if (!theirs) return reply.code(404).send({ error: 'not_a_member' });
    if (!mayWarn(mine.role, theirs.role)) {
      return reply.code(403).send({
        error: 'forbidden',
        message: mine.role === 'manager' ? 'Managers can warn members only.' : "Admins can't warn other admins.",
      });
    }
    const input = parseWarningInput(b);
    if ('error' in input) return reply.code(400).send(input);
    const row = await issue({ scope: 'club', clubOrgId: org.id, subject: { kind: 'user', id: target }, input, issuer: user, fromName: org.name });
    return reply.code(201).send({ id: row.id });
  });

  app.get<{ Params: { slug: string } }>('/api/orgs/:slug/warnings', async (req, reply) => {
    const user = requireUser(req);
    const org = await loadOrgBySlug(req.params.slug);
    if (!org) return reply.code(404).send({ error: 'not_found' });
    const mine = await getMembership(org.id, user.id);
    if (!mine) return reply.code(404).send({ error: 'not_found' });
    if (!atLeast(mine.role, 'manager')) return reply.code(403).send({ error: 'forbidden' });
    const rows = await db
      .select()
      .from(schema.warnings)
      .where(and(eq(schema.warnings.scope, 'club'), eq(schema.warnings.clubOrgId, org.id)))
      .orderBy(desc(schema.warnings.createdAt))
      .all();
    return { warnings: await describe(rows, true) };
  });

  // ---- what I received ----------------------------------------------------
  app.get('/api/notices', async (req) => {
    const user = requireUser(req);
    const run = await db
      .select({ o: schema.orgMembers.orgId })
      .from(schema.orgMembers)
      .where(and(eq(schema.orgMembers.userId, user.id), inArray(schema.orgMembers.role, ['admin', 'manager'])))
      .all();
    const clubs = run.map((r) => r.o);
    const rows = await db
      .select()
      .from(schema.warnings)
      .where(
        or(
          eq(schema.warnings.subjectUserId, user.id),
          clubs.length ? and(eq(schema.warnings.scope, 'site'), inArray(schema.warnings.subjectOrgId, clubs)) : undefined,
        ),
      )
      .orderBy(desc(schema.warnings.createdAt))
      .limit(200)
      .all();
    // Who sent it stays with the site team or the club's runners.
    return { notices: await describe(rows, false) };
  });

  app.post<{ Params: { id: string } }>('/api/notices/:id/acknowledge', async (req, reply) => {
    const user = requireUser(req);
    const row = await db.select().from(schema.warnings).where(eq(schema.warnings.id, req.params.id)).get();
    if (!row || !(await recipientsOf(row)).includes(user.id)) return reply.code(404).send({ error: 'not_found' });
    if (row.acknowledgedAt) return { ok: true, acknowledgedAt: row.acknowledgedAt.getTime() };
    const now = new Date();
    await db
      .update(schema.warnings)
      .set({ acknowledgedAt: now, acknowledgedBy: user.id })
      .where(and(eq(schema.warnings.id, row.id), isNull(schema.warnings.acknowledgedAt)));
    await writeAuditEvent({
      resourceKind: row.subjectOrgId ? 'org' : 'user',
      resourceId: row.subjectOrgId ?? row.subjectUserId ?? user.id,
      userId: user.id,
      eventType: 'warn_ack',
      payload: { warningId: row.id },
    });
    return { ok: true, acknowledgedAt: now.getTime() };
  });
}

/** Managers warn members; admins warn members and managers; nobody warns an admin from inside the club. */
export function mayWarn(by: ClubRole, target: ClubRole): boolean {
  if (target === 'admin') return false;
  if (target === 'manager') return by === 'admin';
  return atLeast(by, 'manager');
}

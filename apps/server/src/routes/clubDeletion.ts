// Deleting a club, done properly (privacy/clubDeletion.ts holds the work).
//
// Before deleting (the club's admins):
//   GET  /api/orgs/:slug/deletion          what deleting it would take with it, in plain words
//   GET  /api/orgs/:slug/exports           the club's data downloads I asked for
//   POST /api/orgs/:slug/exports           download the club's data (a zip of everything it owns)
//   POST /api/orgs/:slug/move-all          move all its layouts or modules to a member or another club
// (DELETE /api/orgs/:slug itself is in orgs.ts.)
//
// While it waits:
//   GET  /api/orgs/deleting                clubs I was in that are being deleted
//   POST /api/orgs/:slug/restore           put it back (its admins at the time, or a site admin)
//
// Site admins (Admin › Clubs):
//   DELETE /api/admin/orgs/:id             delete with the same wait (in admin.ts)
//   POST   /api/admin/orgs/:id/restore     restore
//   POST   /api/admin/orgs/:id/erase       erase now, skipping the wait (typed name)

import type { FastifyInstance } from 'fastify';
import { and, eq } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { requireGlobalAdmin, requireUser } from '../auth/cookie.js';
import { writeAuditEvent } from '../audit/writeAuditEvent.js';
import { atLeast } from '../access/clubRoles.js';
import { docHub } from '../ws/docHub.js';
import { publish } from '../events/audience.js';
import { catalogChoice, getMembership, loadOrgBySlug } from './orgs.js';
import { dropModuleFromCollections } from './collections.js';
import { clubDeletionSummary, deletingClubsFor, eraseClub, mayRestore, restoreClub } from '../privacy/clubDeletion.js';
import { describeExport, listExports, nextExportAllowedAt, startExport } from '../privacy/exports.js';

export async function clubDeletionRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/orgs/deleting', async (req) => {
    const user = requireUser(req);
    return { clubs: await deletingClubsFor(user) };
  });

  app.get<{ Params: { slug: string } }>('/api/orgs/:slug/deletion', async (req, reply) => {
    const user = requireUser(req);
    const org = await loadOrgBySlug(req.params.slug);
    if (!org) return reply.code(404).send({ error: 'not_found' });
    const mine = await getMembership(org.id, user.id);
    if (!mine) return reply.code(404).send({ error: 'not_found' });
    if (mine.role !== 'admin') return reply.code(403).send({ error: 'forbidden' });
    return clubDeletionSummary(org);
  });

  // ---- the club's data ------------------------------------------------------
  app.get<{ Params: { slug: string } }>('/api/orgs/:slug/exports', async (req, reply) => {
    const user = requireUser(req);
    const org = await loadOrgBySlug(req.params.slug);
    if (!org) return reply.code(404).send({ error: 'not_found' });
    const mine = await getMembership(org.id, user.id);
    if (!mine) return reply.code(404).send({ error: 'not_found' });
    if (mine.role !== 'admin') return reply.code(403).send({ error: 'forbidden' });
    const subject = { kind: 'org' as const, id: org.id };
    return { exports: await listExports(user.id, subject), nextAllowedAt: await nextExportAllowedAt(user.id, subject) };
  });

  app.post<{ Params: { slug: string } }>('/api/orgs/:slug/exports', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) => {
    const user = requireUser(req);
    const org = await loadOrgBySlug(req.params.slug);
    if (!org) return reply.code(404).send({ error: 'not_found' });
    const mine = await getMembership(org.id, user.id);
    if (!mine) return reply.code(404).send({ error: 'not_found' });
    if (mine.role !== 'admin') return reply.code(403).send({ error: 'forbidden' });
    const subject = { kind: 'org' as const, id: org.id };
    const next = await nextExportAllowedAt(user.id, subject);
    if (next !== null) {
      return reply.code(429).send({ error: 'export_too_soon', nextAllowedAt: next, message: `You can ask for another download after ${new Date(next).toUTCString()}.` });
    }
    const row = await startExport({ subject, requestedBy: user.id, reason: 'club' });
    await writeAuditEvent({ resourceKind: 'org', resourceId: org.id, userId: user.id, eventType: 'data_export', payload: { exportId: row.id, reason: 'club' } });
    return reply.code(202).send({ export: describeExport(row) });
  });

  // ---- move everything out first ---------------------------------------------
  app.post<{ Params: { slug: string }; Body: { kind?: unknown; toUserId?: unknown; toOrgSlug?: unknown } }>(
    '/api/orgs/:slug/move-all',
    { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const user = requireUser(req);
      const org = await loadOrgBySlug(req.params.slug);
      if (!org) return reply.code(404).send({ error: 'not_found' });
      const mine = await getMembership(org.id, user.id);
      if (!mine) return reply.code(404).send({ error: 'not_found' });
      if (mine.role !== 'admin') return reply.code(403).send({ error: 'forbidden' });
      const kind = req.body?.kind;
      if (kind !== 'layouts' && kind !== 'modules') return reply.code(400).send({ error: 'invalid_input' });
      let to: { ownerUserId: string | null; ownerOrgId: string | null };
      if (typeof req.body?.toUserId === 'string' && req.body.toUserId) {
        // A member of this club.
        if (!(await getMembership(org.id, req.body.toUserId))) {
          return reply.code(400).send({ error: 'heir_not_member', message: 'Pick someone who is in the club.' });
        }
        to = { ownerUserId: req.body.toUserId, ownerOrgId: null };
      } else if (typeof req.body?.toOrgSlug === 'string' && req.body.toOrgSlug) {
        // Another club the admin can add things to.
        const dest = await loadOrgBySlug(req.body.toOrgSlug.trim().toLowerCase());
        if (!dest || dest.id === org.id) return reply.code(404).send({ error: 'org_not_found' });
        const there = await getMembership(dest.id, user.id);
        if (!there) return reply.code(403).send({ error: 'not_an_org_member' });
        if (!dest.membersCanCreate && !atLeast(there.role, 'manager')) return reply.code(403).send({ error: 'only_club_admins_can_add' });
        to = { ownerUserId: null, ownerOrgId: dest.id };
      } else {
        return reply.code(400).send({ error: 'invalid_input' });
      }
      const table = kind === 'layouts' ? schema.layouts : schema.modules;
      const rows = await db.select({ id: table.id, title: table.title }).from(table).where(eq(table.ownerOrgId, org.id)).all();
      for (const r of rows) {
        await db.update(table).set(to).where(and(eq(table.id, r.id), eq(table.ownerOrgId, org.id)));
        if (kind === 'modules') await dropModuleFromCollections({ id: r.id, title: r.title }, 'moved out of the club', to.ownerOrgId, user.id);
        await writeAuditEvent({
          ...(kind === 'layouts' ? { layoutId: r.id } : { resourceKind: 'module' as const, resourceId: r.id }),
          userId: user.id,
          eventType: 'transfer',
          payload: { from: { kind: 'org', orgId: org.id }, to: to.ownerOrgId ? { kind: 'org', orgId: to.ownerOrgId } : { kind: 'user', userId: to.ownerUserId }, reason: 'before_club_deletion' },
        });
      }
      if (kind === 'layouts') await docHub.closeMany(rows.map((r) => r.id), 'layout_moved');
      const hintKind = kind === 'layouts' ? 'layout' : 'module';
      void publish({ kind: hintKind, owner: { kind: 'org', id: org.id }, action: 'update:move' });
      void publish(
        { kind: hintKind, owner: to.ownerOrgId ? { kind: 'org', id: to.ownerOrgId } : { kind: 'user', id: to.ownerUserId! }, action: 'update:move' },
      );
      return { ok: true, moved: rows.length };
    },
  );

  // ---- restore ----------------------------------------------------------------
  app.post<{ Params: { slug: string } }>('/api/orgs/:slug/restore', async (req, reply) => {
    const user = requireUser(req);
    const org = await loadOrgBySlug(req.params.slug);
    // A club that isn't being deleted, or someone who can't restore it, gets "not found".
    if (!org?.deletionDueAt || !mayRestore(org, user)) return reply.code(404).send({ error: 'not_found' });
    const members = await restoreClub(org, user);
    return { ok: true, slug: org.slug, members };
  });

  // ---- site admins ----------------------------------------------------------------
  app.post<{ Params: { id: string } }>('/api/admin/orgs/:id/restore', async (req, reply) => {
    const admin = requireGlobalAdmin(req);
    const org = await db.select().from(schema.orgs).where(eq(schema.orgs.id, req.params.id)).get();
    if (!org?.deletionDueAt) return reply.code(404).send({ error: 'not_found' });
    const members = await restoreClub(org, admin);
    return { ok: true, members };
  });

  app.post<{ Params: { id: string }; Body: { confirm?: unknown; catalog?: unknown; heirUserId?: unknown } }>(
    '/api/admin/orgs/:id/erase',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const admin = requireGlobalAdmin(req);
      const org = await db.select().from(schema.orgs).where(eq(schema.orgs.id, req.params.id)).get();
      if (!org) return reply.code(404).send({ error: 'not_found' });
      const typed = typeof req.body?.confirm === 'string' ? req.body.confirm.trim().toLowerCase() : '';
      if (typed !== org.name.trim().toLowerCase()) return reply.code(400).send({ error: 'confirm_name_mismatch' });
      if (!org.deletionPlan) {
        // Erased without the wait: the same choice about its public catalog items.
        const choice = await catalogChoice(org.id, req.body?.catalog, req.body?.heirUserId, null);
        if ('error' in choice) return reply.code(400).send(choice);
        const members = await db.select().from(schema.orgMembers).where(eq(schema.orgMembers.orgId, org.id)).all();
        await db
          .update(schema.orgs)
          .set({
            deletionPlan: JSON.stringify({
              members: members.map((m) => ({ userId: m.userId, role: m.role, joinedAt: m.joinedAt.getTime() })),
              listed: org.listed,
              ...choice,
            }),
          })
          .where(eq(schema.orgs.id, org.id));
      }
      const done = await eraseClub(org.id, admin.id, 'admin');
      return { ok: true, ref: done?.ref ?? null };
    },
  );
}

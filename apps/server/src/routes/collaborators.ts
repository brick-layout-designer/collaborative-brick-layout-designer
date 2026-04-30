// Layout collaborator + invite endpoints.
//
// Roles cascade: an owner can invite + change roles + remove others;
// editors and viewers can only see who else has access.
//
// Existence-leak protection: every endpoint that takes a `:layoutId`
// returns 404 to non-collaborators, never 403. Same pattern as the
// rest of /api/layouts.

import { randomBytes, randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { and, eq } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { requireUser } from '../auth/cookie.js';
import { hasAtLeast, resolveResourceRole, type Role } from '../access/resolveResourceRole.js';
import { sendInviteEmail } from '../email/sendInvite.js';
import { writeAuditEvent } from '../audit/writeAuditEvent.js';
import { env } from '../env.js';

interface InviteBody {
  email: string;
  role: Exclude<Role, 'owner'>; // owners can only invite editors/viewers
}

interface ChangeRoleBody {
  role: Exclude<Role, 'owner'>;
}

const INVITE_TTL_MS = 14 * 24 * 60 * 60 * 1000;

export async function collaboratorRoutes(app: FastifyInstance): Promise<void> {
  // ---- list collaborators --------------------------------------------------
  app.get<{ Params: { id: string } }>(
    '/api/layouts/:id/collaborators',
    async (req, reply) => {
      const user = requireUser(req);
      const { role } = await resolveResourceRole(user.id, 'layout', req.params.id);
      if (role === null) return reply.code(404).send({ error: 'not_found' });
      // Anyone with at least viewer access can see the collaborator list.
      // Phase 6 may expose this only to editor+; for now transparency is
      // the friendlier default.

      const rows = await db
        .select({
          userId: schema.layoutCollaborators.userId,
          role: schema.layoutCollaborators.role,
          addedAt: schema.layoutCollaborators.addedAt,
          email: schema.users.email,
          displayName: schema.users.displayName,
          avatarUrl: schema.users.avatarUrl,
        })
        .from(schema.layoutCollaborators)
        .innerJoin(
          schema.users,
          eq(schema.users.id, schema.layoutCollaborators.userId),
        )
        .where(eq(schema.layoutCollaborators.layoutId, req.params.id));

      const pendingInvites = await db
        .select()
        .from(schema.layoutInvites)
        .where(
          and(
            eq(schema.layoutInvites.layoutId, req.params.id),
            // Pending = not-yet-accepted. Drizzle's isNull helper would be
            // nicer but we hit a TS-resolution bug earlier; use a raw
            // equality shim instead — accepted_at is null when pending.
          ),
        );

      return {
        collaborators: rows.map((r) => ({
          userId: r.userId,
          role: r.role,
          addedAt: r.addedAt.getTime(),
          email: r.email,
          displayName: r.displayName,
          avatarUrl: r.avatarUrl,
        })),
        // Filter pending in JS so we don't have to wire isNull through
        // Drizzle here. Cheap (typically 1-2 invites per layout).
        invites: pendingInvites
          .filter((i) => i.acceptedAt === null)
          .map((i) => ({
            id: i.id,
            invitedEmail: i.invitedEmail,
            role: i.role,
            expiresAt: i.expiresAt.getTime(),
          })),
      };
    },
  );

  // ---- create invite -------------------------------------------------------
  app.post<{ Params: { id: string }; Body: InviteBody }>(
    '/api/layouts/:id/invites',
    async (req, reply) => {
      const user = requireUser(req);
      if (user.isDemoAccount) {
        return reply.code(403).send({ error: 'demo_account_cannot_invite' });
      }
      const { role } = await resolveResourceRole(user.id, 'layout', req.params.id);
      if (role === null) return reply.code(404).send({ error: 'not_found' });
      if (!hasAtLeast(role, 'owner')) {
        return reply.code(403).send({ error: 'forbidden' });
      }

      const { email, role: inviteRole } = req.body;
      if (!email || !email.includes('@')) {
        return reply.code(400).send({ error: 'invalid_email' });
      }
      if (inviteRole !== 'viewer' && inviteRole !== 'editor') {
        return reply.code(400).send({ error: 'invalid_role' });
      }

      // If the recipient already has a user account AND already has access
      // (any role), short-circuit with a 409 — the inviter probably just
      // wants to change their role and should hit PATCH instead.
      const existingUser = await db
        .select()
        .from(schema.users)
        .where(eq(schema.users.email, email))
        .get();
      if (existingUser) {
        const existingRole = await resolveResourceRole(
          existingUser.id,
          'layout',
          req.params.id,
        );
        if (existingRole.role !== null) {
          return reply.code(409).send({ error: 'already_has_access' });
        }
      }

      const token = randomBytes(24).toString('hex');
      const id = randomUUID();
      const expiresAt = new Date(Date.now() + INVITE_TTL_MS);

      await db.insert(schema.layoutInvites).values({
        id,
        layoutId: req.params.id,
        invitedEmail: email,
        role: inviteRole,
        token,
        expiresAt,
        acceptedAt: null,
      });

      const inviteUrl = `${env.publicUrl}/invite/${token}`;

      // Email is best-effort: if SMTP is configured, send; otherwise the
      // owner copy-pastes the URL from the API response. Always returns
      // the URL so a configured SMTP can fail gracefully (the owner
      // still has a fallback).
      let emailDelivered = false;
      try {
        emailDelivered = await sendInviteEmail({
          to: email,
          inviteUrl,
          inviterName: user.displayName,
        });
      } catch {
        // Silenced: emailDelivered stays false, the owner gets the URL.
      }

      await writeAuditEvent({
        layoutId: req.params.id,
        userId: user.id,
        eventType: 'share',
        payload: { invitedEmail: email, role: inviteRole, inviteId: id },
      });

      return {
        id,
        token,
        inviteUrl,
        emailDelivered,
        expiresAt: expiresAt.getTime(),
      };
    },
  );

  // ---- revoke invite -------------------------------------------------------
  app.delete<{ Params: { id: string; inviteId: string } }>(
    '/api/layouts/:id/invites/:inviteId',
    async (req, reply) => {
      const user = requireUser(req);
      const { role } = await resolveResourceRole(user.id, 'layout', req.params.id);
      if (role === null) return reply.code(404).send({ error: 'not_found' });
      if (!hasAtLeast(role, 'owner')) {
        return reply.code(403).send({ error: 'forbidden' });
      }

      await db
        .delete(schema.layoutInvites)
        .where(
          and(
            eq(schema.layoutInvites.id, req.params.inviteId),
            eq(schema.layoutInvites.layoutId, req.params.id),
          ),
        );
      return { ok: true };
    },
  );

  // ---- change role ---------------------------------------------------------
  app.patch<{
    Params: { id: string; userId: string };
    Body: ChangeRoleBody;
  }>('/api/layouts/:id/collaborators/:userId', async (req, reply) => {
    const user = requireUser(req);
    const { role } = await resolveResourceRole(user.id, 'layout', req.params.id);
    if (role === null) return reply.code(404).send({ error: 'not_found' });
    if (!hasAtLeast(role, 'owner')) {
      return reply.code(403).send({ error: 'forbidden' });
    }

    const newRole = req.body.role;
    if (newRole !== 'viewer' && newRole !== 'editor') {
      return reply.code(400).send({ error: 'invalid_role' });
    }

    // Lookup previous role for the audit row.
    const prev = await db
      .select({ role: schema.layoutCollaborators.role })
      .from(schema.layoutCollaborators)
      .where(
        and(
          eq(schema.layoutCollaborators.layoutId, req.params.id),
          eq(schema.layoutCollaborators.userId, req.params.userId),
        ),
      )
      .get();
    if (!prev) return reply.code(404).send({ error: 'collaborator_not_found' });

    await db
      .update(schema.layoutCollaborators)
      .set({ role: newRole })
      .where(
        and(
          eq(schema.layoutCollaborators.layoutId, req.params.id),
          eq(schema.layoutCollaborators.userId, req.params.userId),
        ),
      );

    await writeAuditEvent({
      layoutId: req.params.id,
      userId: user.id,
      eventType: 'role_change',
      payload: { targetUserId: req.params.userId, fromRole: prev.role, toRole: newRole },
    });

    return { ok: true };
  });

  // ---- remove collaborator -------------------------------------------------
  app.delete<{ Params: { id: string; userId: string } }>(
    '/api/layouts/:id/collaborators/:userId',
    async (req, reply) => {
      const user = requireUser(req);
      const { role } = await resolveResourceRole(user.id, 'layout', req.params.id);
      if (role === null) return reply.code(404).send({ error: 'not_found' });
      // Allow self-removal even without owner role: a user can leave a
      // shared layout. Otherwise require owner.
      const isSelfRemoval = req.params.userId === user.id;
      if (!isSelfRemoval && !hasAtLeast(role, 'owner')) {
        return reply.code(403).send({ error: 'forbidden' });
      }

      const result = await db
        .delete(schema.layoutCollaborators)
        .where(
          and(
            eq(schema.layoutCollaborators.layoutId, req.params.id),
            eq(schema.layoutCollaborators.userId, req.params.userId),
          ),
        );
      void result;

      await writeAuditEvent({
        layoutId: req.params.id,
        userId: user.id,
        eventType: 'unshare',
        payload: { targetUserId: req.params.userId, selfRemoved: isSelfRemoval },
      });
      return { ok: true };
    },
  );
}

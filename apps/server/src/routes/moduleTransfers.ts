// Module ownership transfer (v1.x). Mirrors routes/transfers.ts for
// layouts: org-recipient transfers commit immediately, user→user
// transfers go through a pending-accept token. The previous owner
// is added back as an editor on user→user accept so they keep
// access to their own work after handing it off.

import { randomBytes, randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { and, eq, isNull, ne } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { requireUser } from '../auth/cookie.js';
import { hasAtLeast, resolveResourceRole } from '../access/resolveResourceRole.js';
import { writeAuditEvent } from '../audit/writeAuditEvent.js';
import { sendInviteEmail } from '../email/sendInvite.js';
import { env } from '../env.js';
import { hasVerifiedEmail } from '../auth/users.js';
import { sameEmail } from '../utils/validate.js';

interface InitiateTransferBody {
  recipientEmail?: string;
  recipientOrgSlug?: string;
}

const TRANSFER_TTL_MS = 14 * 24 * 60 * 60 * 1000;

export async function moduleTransferRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Params: { id: string }; Body: InitiateTransferBody }>(
    '/api/modules/:id/transfer',
    async (req, reply) => {
      const user = requireUser(req);
      const { role } = await resolveResourceRole(user.id, 'module', req.params.id);
      if (role === null) return reply.code(404).send({ error: 'not_found' });
      if (!hasAtLeast(role, 'owner')) {
        return reply.code(403).send({ error: 'forbidden' });
      }

      const recipientEmail = req.body.recipientEmail?.trim().toLowerCase();
      const recipientOrgSlug = req.body.recipientOrgSlug?.trim().toLowerCase();
      if (!!recipientEmail === !!recipientOrgSlug) {
        return reply.code(400).send({ error: 'specify_recipient_email_xor_org' });
      }

      // Org recipient → immediate.
      if (recipientOrgSlug) {
        const dest = await db
          .select()
          .from(schema.orgs)
          .where(eq(schema.orgs.slug, recipientOrgSlug))
          .get();
        if (!dest) return reply.code(404).send({ error: 'recipient_org_not_found' });
        const myDestMembership = await db
          .select()
          .from(schema.orgMembers)
          .where(
            and(
              eq(schema.orgMembers.orgId, dest.id),
              eq(schema.orgMembers.userId, user.id),
            ),
          )
          .get();
        if (!myDestMembership) {
          return reply.code(403).send({ error: 'not_a_member_of_recipient_org' });
        }
        // A club that lets only admins add things takes them only from an admin.
        if (!dest.membersCanCreate && myDestMembership.role !== 'admin') {
          return reply.code(403).send({ error: 'only_club_admins_can_add' });
        }

        const module = await db
          .select()
          .from(schema.modules)
          .where(eq(schema.modules.id, req.params.id))
          .get();
        if (!module) return reply.code(404).send({ error: 'not_found' });

        await db
          .update(schema.modules)
          .set({
            ownerUserId: null,
            ownerOrgId: dest.id,
            updatedAt: new Date(),
          })
          .where(eq(schema.modules.id, req.params.id));
        // Ownership changed: pending user->user transfers issued by the
        // previous owner must not be redeemable any more.
        await deletePendingModuleTransfers(req.params.id);

        await writeAuditEvent({
          resourceKind: 'module',
          resourceId: req.params.id,
          userId: user.id,
          eventType: 'transfer',
          payload: {
            from: module.ownerUserId
              ? { kind: 'user', userId: module.ownerUserId }
              : { kind: 'org', orgId: module.ownerOrgId },
            to: { kind: 'org', orgId: dest.id, slug: dest.slug },
          },
        });

        return reply.send({ transferred: true, ownerKind: 'org', ownerSlug: dest.slug });
      }

      // User recipient → pending acceptance.
      const module = await db
        .select()
        .from(schema.modules)
        .where(eq(schema.modules.id, req.params.id))
        .get();
      if (!module) return reply.code(404).send({ error: 'not_found' });
      if (!module.ownerUserId) {
        return reply
          .code(400)
          .send({ error: 'org_owned_modules_can_only_transfer_to_orgs' });
      }
      // Only the personal owner can hand a personal module away.
      if (module.ownerUserId !== user.id) {
        return reply.code(403).send({ error: 'forbidden' });
      }
      if (!recipientEmail || !recipientEmail.includes('@')) {
        return reply.code(400).send({ error: 'invalid_email' });
      }
      if (recipientEmail === user.email.toLowerCase()) {
        return reply.code(400).send({ error: 'cannot_transfer_to_self' });
      }

      const token = randomBytes(24).toString('hex');
      const id = randomUUID();
      const now = new Date();
      const expiresAt = new Date(now.getTime() + TRANSFER_TTL_MS);
      await db.insert(schema.moduleTransfers).values({
        id,
        moduleId: req.params.id,
        initiatedBy: user.id,
        recipientEmail,
        token,
        expiresAt,
        acceptedAt: null,
        createdAt: now,
      });

      const transferUrl = `${env.publicUrl}/module-transfer/${token}`;
      let emailDelivered = false;
      try {
        emailDelivered = await sendInviteEmail({
          to: recipientEmail,
          inviteUrl: transferUrl,
          inviterName: user.displayName,
        });
      } catch {
        /* ignored — caller hand-delivers the URL */
      }

      return reply.send({
        id,
        token,
        transferUrl,
        emailDelivered,
        expiresAt: expiresAt.getTime(),
      });
    },
  );

  app.get<{ Params: { token: string } }>(
    '/api/module-transfers/:token',
    async (req, reply) => {
      const transfer = await db
        .select()
        .from(schema.moduleTransfers)
        .where(eq(schema.moduleTransfers.token, req.params.token))
        .get();
      if (!transfer) return reply.code(404).send({ error: 'transfer_not_found' });
      if (transfer.acceptedAt) {
        return reply.code(410).send({ error: 'transfer_already_accepted' });
      }
      if (transfer.expiresAt.getTime() < Date.now()) {
        return reply.code(410).send({ error: 'transfer_expired' });
      }
      const module = await db
        .select({ title: schema.modules.title })
        .from(schema.modules)
        .where(eq(schema.modules.id, transfer.moduleId))
        .get();
      if (!module) return reply.code(404).send({ error: 'module_not_found' });
      return {
        recipientEmail: transfer.recipientEmail,
        moduleId: transfer.moduleId,
        moduleTitle: module.title,
        expiresAt: transfer.expiresAt.getTime(),
      };
    },
  );

  app.post<{ Params: { token: string } }>(
    '/api/module-transfers/:token',
    async (req, reply) => {
      const user = requireUser(req);
      const transfer = await db
        .select()
        .from(schema.moduleTransfers)
        .where(eq(schema.moduleTransfers.token, req.params.token))
        .get();
      if (!transfer) return reply.code(404).send({ error: 'transfer_not_found' });
      if (transfer.acceptedAt) {
        return reply.code(410).send({ error: 'transfer_already_accepted' });
      }
      if (transfer.expiresAt.getTime() < Date.now()) {
        return reply.code(410).send({ error: 'transfer_expired' });
      }
      if (!sameEmail(transfer.recipientEmail, user.email)) {
        return reply.code(403).send({ error: 'email_mismatch' });
      }
      // The email match only proves anything if the account has proven
      // it controls that mailbox.
      if (!(await hasVerifiedEmail(user))) {
        return reply.code(403).send({ error: 'email_not_verified' });
      }

      const now = new Date();
      // Only valid while the initiator still personally owns the module
      // (see the matching comment in routes/transfers.ts).
      const flipped = await db
        .update(schema.modules)
        .set({ ownerUserId: user.id, ownerOrgId: null, updatedAt: now })
        .where(
          and(
            eq(schema.modules.id, transfer.moduleId),
            eq(schema.modules.ownerUserId, transfer.initiatedBy),
            isNull(schema.modules.ownerOrgId),
          ),
        )
        .returning({ id: schema.modules.id });
      if (flipped.length === 0) {
        await db.delete(schema.moduleTransfers).where(eq(schema.moduleTransfers.id, transfer.id));
        return reply.code(409).send({ error: 'transfer_stale' });
      }

      await db
        .update(schema.moduleTransfers)
        .set({ acceptedAt: now })
        .where(eq(schema.moduleTransfers.id, transfer.id));
      await deletePendingModuleTransfers(transfer.moduleId, transfer.id);

      // Keep the previous owner as an editor (same as layout transfer).
      if (transfer.initiatedBy && transfer.initiatedBy !== user.id) {
        await db
          .insert(schema.moduleCollaborators)
          .values({
            moduleId: transfer.moduleId,
            userId: transfer.initiatedBy,
            role: 'editor',
            addedAt: now,
          })
          .onConflictDoNothing();
      }

      await writeAuditEvent({
        resourceKind: 'module',
        resourceId: transfer.moduleId,
        userId: user.id,
        eventType: 'transfer',
        payload: {
          from: { kind: 'user', userId: transfer.initiatedBy },
          to: { kind: 'user', userId: user.id, email: user.email },
          accepted: true,
        },
      });

      return { moduleId: transfer.moduleId };
    },
  );
}

/**
 * Delete every not-yet-accepted transfer for a module (optionally keeping
 * one). Call whenever the module's owner changes.
 */
async function deletePendingModuleTransfers(moduleId: string, exceptId?: string): Promise<void> {
  await db
    .delete(schema.moduleTransfers)
    .where(
      and(
        eq(schema.moduleTransfers.moduleId, moduleId),
        isNull(schema.moduleTransfers.acceptedAt),
        exceptId ? ne(schema.moduleTransfers.id, exceptId) : undefined,
      ),
    );
}

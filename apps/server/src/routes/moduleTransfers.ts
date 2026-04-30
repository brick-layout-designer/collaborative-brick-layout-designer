// Module ownership transfer (v1.x). Mirrors routes/transfers.ts for
// layouts: org-recipient transfers commit immediately, user→user
// transfers go through a pending-accept token. The previous owner
// is added back as an editor on user→user accept so they keep
// access to their own work after handing it off.

import { randomBytes, randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { and, eq } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { requireUser } from '../auth/cookie.js';
import { hasAtLeast, resolveResourceRole } from '../access/resolveResourceRole.js';
import { writeAuditEvent } from '../audit/writeAuditEvent.js';
import { sendInviteEmail } from '../email/sendInvite.js';
import { env } from '../env.js';

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
      if (transfer.recipientEmail.toLowerCase() !== user.email.toLowerCase()) {
        return reply.code(403).send({ error: 'email_mismatch' });
      }

      const now = new Date();
      await db
        .update(schema.modules)
        .set({ ownerUserId: user.id, ownerOrgId: null, updatedAt: now })
        .where(eq(schema.modules.id, transfer.moduleId));

      await db
        .update(schema.moduleTransfers)
        .set({ acceptedAt: now })
        .where(eq(schema.moduleTransfers.id, transfer.id));

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

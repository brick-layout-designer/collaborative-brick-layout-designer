// Layout ownership transfer (Phase 6 / PLAN.md §3.5).
//
// Two transfer paths:
//
//   Org-involving (user→org / org→org / org→user)
//     - Commits IMMEDIATELY in the same transaction.
//     - Caller must be the layout's `owner` and (if applicable) admin on
//       the source org. Destination-org admin not required — anyone with
//       the source-side authority can push a layout into an org they're
//       a member of.
//
//   User → user
//     - Writes a row to `layout_transfers` and emails the recipient (or
//       returns the URL).
//     - Recipient accepts via `POST /api/transfers/:token`, which
//       performs the email-match check (same shape as invite acceptance)
//       and flips ownership.
//
// On a successful transfer the audit log gets a `transfer` row and the
// layout's `expires_at` is cleared if the new owner is non-demo.

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
  /** Recipient kind. Exactly one of `recipientEmail` / `recipientOrgSlug` set. */
  recipientEmail?: string;
  recipientOrgSlug?: string;
}

const TRANSFER_TTL_MS = 14 * 24 * 60 * 60 * 1000;

export async function transferRoutes(app: FastifyInstance): Promise<void> {
  // ---- initiate -----------------------------------------------------------
  app.post<{ Params: { id: string }; Body: InitiateTransferBody }>(
    '/api/layouts/:id/transfer',
    async (req, reply) => {
      const user = requireUser(req);
      const { role } = await resolveResourceRole(user.id, 'layout', req.params.id);
      if (role === null) return reply.code(404).send({ error: 'not_found' });
      if (!hasAtLeast(role, 'owner')) {
        return reply.code(403).send({ error: 'forbidden' });
      }

      const recipientEmail = req.body.recipientEmail?.trim().toLowerCase();
      const recipientOrgSlug = req.body.recipientOrgSlug?.trim().toLowerCase();
      if (!!recipientEmail === !!recipientOrgSlug) {
        return reply.code(400).send({ error: 'specify_recipient_email_xor_org' });
      }

      // ---- org recipient: immediate transfer ------------------------------
      if (recipientOrgSlug) {
        const dest = await db
          .select()
          .from(schema.orgs)
          .where(eq(schema.orgs.slug, recipientOrgSlug))
          .get();
        if (!dest) return reply.code(404).send({ error: 'recipient_org_not_found' });
        // The caller must be a member of the destination org (you can't
        // dump a layout into an org you can't see). Any membership tier
        // is enough.
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

        const layout = await db
          .select()
          .from(schema.layouts)
          .where(eq(schema.layouts.id, req.params.id))
          .get();
        if (!layout) return reply.code(404).send({ error: 'not_found' });

        await db
          .update(schema.layouts)
          .set({
            ownerUserId: null,
            ownerOrgId: dest.id,
            // Clear demo TTL — org-owned layouts persist indefinitely.
            expiresAt: null,
            updatedAt: new Date(),
          })
          .where(eq(schema.layouts.id, req.params.id));

        await writeAuditEvent({
          layoutId: req.params.id,
          userId: user.id,
          eventType: 'transfer',
          payload: {
            from: layout.ownerUserId
              ? { kind: 'user', userId: layout.ownerUserId }
              : { kind: 'org', orgId: layout.ownerOrgId },
            to: { kind: 'org', orgId: dest.id, slug: dest.slug },
          },
        });

        return reply.send({ transferred: true, ownerKind: 'org', ownerSlug: dest.slug });
      }

      // ---- user recipient: pending acceptance ----------------------------
      // We don't allow user→user transfer when the layout is currently
      // org-owned: that would let an org admin sneak a layout out by
      // making it personal first. Org-owned layouts must transfer to
      // another org if leaving the current org's umbrella.
      const layout = await db
        .select()
        .from(schema.layouts)
        .where(eq(schema.layouts.id, req.params.id))
        .get();
      if (!layout) return reply.code(404).send({ error: 'not_found' });
      if (!layout.ownerUserId) {
        return reply
          .code(400)
          .send({ error: 'org_owned_layouts_can_only_transfer_to_orgs' });
      }

      // Email-format check.
      if (!recipientEmail || !recipientEmail.includes('@')) {
        return reply.code(400).send({ error: 'invalid_email' });
      }
      // Refuse self-transfer (no-op).
      if (recipientEmail === user.email.toLowerCase()) {
        return reply.code(400).send({ error: 'cannot_transfer_to_self' });
      }

      const token = randomBytes(24).toString('hex');
      const id = randomUUID();
      const now = new Date();
      const expiresAt = new Date(now.getTime() + TRANSFER_TTL_MS);
      await db.insert(schema.layoutTransfers).values({
        id,
        layoutId: req.params.id,
        initiatedBy: user.id,
        recipientEmail,
        token,
        expiresAt,
        acceptedAt: null,
        createdAt: now,
      });

      const transferUrl = `${env.publicUrl}/transfer/${token}`;
      let emailDelivered = false;
      try {
        emailDelivered = await sendInviteEmail({
          to: recipientEmail,
          inviteUrl: transferUrl,
          inviterName: user.displayName,
        });
      } catch {
        /* ignored */
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

  // ---- preview ------------------------------------------------------------
  app.get<{ Params: { token: string } }>('/api/transfers/:token', async (req, reply) => {
    const transfer = await db
      .select()
      .from(schema.layoutTransfers)
      .where(eq(schema.layoutTransfers.token, req.params.token))
      .get();
    if (!transfer) return reply.code(404).send({ error: 'transfer_not_found' });
    if (transfer.acceptedAt) {
      return reply.code(410).send({ error: 'transfer_already_accepted' });
    }
    if (transfer.expiresAt.getTime() < Date.now()) {
      return reply.code(410).send({ error: 'transfer_expired' });
    }
    const layout = await db
      .select({ title: schema.layouts.title })
      .from(schema.layouts)
      .where(eq(schema.layouts.id, transfer.layoutId))
      .get();
    if (!layout) return reply.code(404).send({ error: 'layout_not_found' });
    return {
      recipientEmail: transfer.recipientEmail,
      layoutId: transfer.layoutId,
      layoutTitle: layout.title,
      expiresAt: transfer.expiresAt.getTime(),
    };
  });

  // ---- accept -------------------------------------------------------------
  app.post<{ Params: { token: string } }>(
    '/api/transfers/:token',
    async (req, reply) => {
      const user = requireUser(req);
      const transfer = await db
        .select()
        .from(schema.layoutTransfers)
        .where(eq(schema.layoutTransfers.token, req.params.token))
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

      const layout = await db
        .select()
        .from(schema.layouts)
        .where(eq(schema.layouts.id, transfer.layoutId))
        .get();
      if (!layout) return reply.code(404).send({ error: 'layout_not_found' });

      const now = new Date();
      await db
        .update(schema.layouts)
        .set({
          ownerUserId: user.id,
          ownerOrgId: null,
          // Clear demo TTL: a non-demo recipient would not want their new
          // layout deleted. Demo TTL is reapplied on next demo-only
          // creation, not on transfer.
          expiresAt: user.isDemoAccount
            ? new Date(now.getTime() + Number(process.env.DEMO_LAYOUT_TTL_DAYS ?? 30) * 86400_000)
            : null,
          updatedAt: now,
        })
        .where(eq(schema.layouts.id, transfer.layoutId));

      await db
        .update(schema.layoutTransfers)
        .set({ acceptedAt: now })
        .where(eq(schema.layoutTransfers.id, transfer.id));

      // The previous owner (initiator) loses ownership but it's polite
      // to keep them as a collaborator so they don't lose access entirely.
      // The new owner can remove them via ShareDialog if they want.
      if (transfer.initiatedBy && transfer.initiatedBy !== user.id) {
        await db
          .insert(schema.layoutCollaborators)
          .values({
            layoutId: transfer.layoutId,
            userId: transfer.initiatedBy,
            role: 'editor',
            addedAt: now,
          })
          .onConflictDoNothing();
      }

      await writeAuditEvent({
        layoutId: transfer.layoutId,
        userId: user.id,
        eventType: 'transfer',
        payload: {
          from: { kind: 'user', userId: transfer.initiatedBy },
          to: { kind: 'user', userId: user.id, email: user.email },
          accepted: true,
        },
      });

      return { layoutId: transfer.layoutId };
    },
  );

  // ---- revoke -------------------------------------------------------------
  app.delete<{ Params: { id: string; transferId: string } }>(
    '/api/layouts/:id/transfer/:transferId',
    async (req, reply) => {
      const user = requireUser(req);
      const { role } = await resolveResourceRole(user.id, 'layout', req.params.id);
      if (role === null) return reply.code(404).send({ error: 'not_found' });
      if (!hasAtLeast(role, 'owner')) {
        return reply.code(403).send({ error: 'forbidden' });
      }
      await db
        .delete(schema.layoutTransfers)
        .where(
          and(
            eq(schema.layoutTransfers.id, req.params.transferId),
            eq(schema.layoutTransfers.layoutId, req.params.id),
          ),
        );
      return { ok: true };
    },
  );
}

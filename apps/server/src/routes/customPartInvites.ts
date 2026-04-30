// Custom-part invite acceptance.
//
//   GET  /api/custom-part-invites/:token    → preview (no side effects)
//   POST /api/custom-part-invites/:token    → accept (auth required, email-match)
//
// Mirrors the layout-invite endpoints in routes/invites.ts.

import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { requireUser } from '../auth/cookie.js';
import { writeAuditEvent } from '../audit/writeAuditEvent.js';

export async function customPartInviteRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Params: { token: string } }>(
    '/api/custom-part-invites/:token',
    async (req, reply) => {
      const invite = await db
        .select()
        .from(schema.customPartInvites)
        .where(eq(schema.customPartInvites.token, req.params.token))
        .get();
      if (!invite) return reply.code(404).send({ error: 'invite_not_found' });
      if (invite.acceptedAt) {
        return reply.code(410).send({ error: 'invite_already_accepted' });
      }
      if (invite.expiresAt.getTime() < Date.now()) {
        return reply.code(410).send({ error: 'invite_expired' });
      }
      const part = await db
        .select({ partNumber: schema.customParts.partNumber, displayName: schema.customParts.displayName })
        .from(schema.customParts)
        .where(eq(schema.customParts.id, invite.customPartId))
        .get();
      if (!part) return reply.code(404).send({ error: 'part_not_found' });

      return {
        invitedEmail: invite.invitedEmail,
        role: invite.role,
        customPartId: invite.customPartId,
        partNumber: part.partNumber,
        displayName: part.displayName,
        expiresAt: invite.expiresAt.getTime(),
      };
    },
  );

  app.post<{ Params: { token: string } }>(
    '/api/custom-part-invites/:token',
    async (req, reply) => {
      const user = requireUser(req);
      const invite = await db
        .select()
        .from(schema.customPartInvites)
        .where(eq(schema.customPartInvites.token, req.params.token))
        .get();
      if (!invite) return reply.code(404).send({ error: 'invite_not_found' });
      if (invite.acceptedAt) {
        return reply.code(410).send({ error: 'invite_already_accepted' });
      }
      if (invite.expiresAt.getTime() < Date.now()) {
        return reply.code(410).send({ error: 'invite_expired' });
      }
      // Email-match check — same security invariant as layout invites.
      if (invite.invitedEmail.toLowerCase() !== user.email.toLowerCase()) {
        return reply.code(403).send({ error: 'email_mismatch' });
      }

      const now = new Date();
      await db
        .insert(schema.customPartCollaborators)
        .values({
          customPartId: invite.customPartId,
          userId: user.id,
          role: invite.role,
          addedAt: now,
        })
        .onConflictDoNothing();
      await db
        .update(schema.customPartInvites)
        .set({ acceptedAt: now })
        .where(eq(schema.customPartInvites.id, invite.id));

      await writeAuditEvent({
        resourceKind: 'custom_part',
        resourceId: invite.customPartId,
        userId: user.id,
        eventType: 'share',
        payload: {
          invitedEmail: invite.invitedEmail,
          role: invite.role,
          inviteId: invite.id,
          accepted: true,
        },
      });

      return { customPartId: invite.customPartId, role: invite.role };
    },
  );
}

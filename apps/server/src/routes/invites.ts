// Invite-acceptance endpoints.
//
//   GET  /api/invites/:token    → preview (no side effects)
//   POST /api/invites/:token    → accept (requires authenticated user)
//
// The accept handler checks that the authenticated user's email matches
// the invite's `invitedEmail` (case-insensitive). This prevents Alice
// from accepting Bob's invite — even if she somehow got the URL — by
// signing in with her own credentials.

import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { requireUser } from '../auth/cookie.js';
import { writeAuditEvent } from '../audit/writeAuditEvent.js';

export async function inviteRoutes(app: FastifyInstance): Promise<void> {
  // ---- preview -------------------------------------------------------------
  app.get<{ Params: { token: string } }>(
    '/api/invites/:token',
    async (req, reply) => {
      const invite = await db
        .select()
        .from(schema.layoutInvites)
        .where(eq(schema.layoutInvites.token, req.params.token))
        .get();
      if (!invite) return reply.code(404).send({ error: 'invite_not_found' });
      if (invite.acceptedAt) {
        return reply.code(410).send({ error: 'invite_already_accepted' });
      }
      if (invite.expiresAt.getTime() < Date.now()) {
        return reply.code(410).send({ error: 'invite_expired' });
      }

      const layout = await db
        .select({ title: schema.layouts.title })
        .from(schema.layouts)
        .where(eq(schema.layouts.id, invite.layoutId))
        .get();
      if (!layout) return reply.code(404).send({ error: 'layout_not_found' });

      return {
        invitedEmail: invite.invitedEmail,
        role: invite.role,
        layoutId: invite.layoutId,
        layoutTitle: layout.title,
        expiresAt: invite.expiresAt.getTime(),
      };
    },
  );

  // ---- accept --------------------------------------------------------------
  app.post<{ Params: { token: string } }>(
    '/api/invites/:token',
    async (req, reply) => {
      const user = requireUser(req);
      const invite = await db
        .select()
        .from(schema.layoutInvites)
        .where(eq(schema.layoutInvites.token, req.params.token))
        .get();
      if (!invite) return reply.code(404).send({ error: 'invite_not_found' });
      if (invite.acceptedAt) {
        return reply.code(410).send({ error: 'invite_already_accepted' });
      }
      if (invite.expiresAt.getTime() < Date.now()) {
        return reply.code(410).send({ error: 'invite_expired' });
      }
      // Email match is the security check: even if a stranger guesses
      // the token, they can't use it unless they're signed in as the
      // invited user. Case-insensitive to avoid `Alice@…` vs `alice@…`
      // tripping legitimate users.
      if (invite.invitedEmail.toLowerCase() !== user.email.toLowerCase()) {
        return reply.code(403).send({ error: 'email_mismatch' });
      }

      const now = new Date();
      await db
        .insert(schema.layoutCollaborators)
        .values({
          layoutId: invite.layoutId,
          userId: user.id,
          role: invite.role,
          addedAt: now,
        })
        .onConflictDoNothing();
      await db
        .update(schema.layoutInvites)
        .set({ acceptedAt: now })
        .where(eq(schema.layoutInvites.id, invite.id));

      await writeAuditEvent({
        layoutId: invite.layoutId,
        userId: user.id,
        eventType: 'share',
        payload: {
          invitedEmail: invite.invitedEmail,
          role: invite.role,
          inviteId: invite.id,
          accepted: true,
        },
      });

      return { layoutId: invite.layoutId, role: invite.role };
    },
  );
}

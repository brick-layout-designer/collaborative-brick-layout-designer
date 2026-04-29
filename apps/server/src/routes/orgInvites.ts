// Org-invite acceptance.
//
//   GET  /api/org-invites/:token    → preview (no side effects)
//   POST /api/org-invites/:token    → accept (auth required, email-match)
//
// Mirrors the layout-invite endpoints in routes/invites.ts. Demo
// accounts CAN accept org invites (the demo restriction is on creating
// orgs, not joining them).

import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { requireUser } from '../auth/cookie.js';

export async function orgInviteRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Params: { token: string } }>(
    '/api/org-invites/:token',
    async (req, reply) => {
      const invite = await db
        .select()
        .from(schema.orgInvites)
        .where(eq(schema.orgInvites.token, req.params.token))
        .get();
      if (!invite) return reply.code(404).send({ error: 'invite_not_found' });
      if (invite.acceptedAt) {
        return reply.code(410).send({ error: 'invite_already_accepted' });
      }
      if (invite.expiresAt.getTime() < Date.now()) {
        return reply.code(410).send({ error: 'invite_expired' });
      }
      const org = await db
        .select({ name: schema.orgs.name, slug: schema.orgs.slug })
        .from(schema.orgs)
        .where(eq(schema.orgs.id, invite.orgId))
        .get();
      if (!org) return reply.code(404).send({ error: 'org_not_found' });

      return {
        invitedEmail: invite.invitedEmail,
        role: invite.role,
        orgId: invite.orgId,
        orgName: org.name,
        orgSlug: org.slug,
        expiresAt: invite.expiresAt.getTime(),
      };
    },
  );

  app.post<{ Params: { token: string } }>(
    '/api/org-invites/:token',
    async (req, reply) => {
      const user = requireUser(req);
      const invite = await db
        .select()
        .from(schema.orgInvites)
        .where(eq(schema.orgInvites.token, req.params.token))
        .get();
      if (!invite) return reply.code(404).send({ error: 'invite_not_found' });
      if (invite.acceptedAt) {
        return reply.code(410).send({ error: 'invite_already_accepted' });
      }
      if (invite.expiresAt.getTime() < Date.now()) {
        return reply.code(410).send({ error: 'invite_expired' });
      }
      // Email-match security check (case-insensitive). Identical to the
      // layout-invite path — see the rationale in routes/invites.ts.
      if (invite.invitedEmail.toLowerCase() !== user.email.toLowerCase()) {
        return reply.code(403).send({ error: 'email_mismatch' });
      }

      const now = new Date();
      await db
        .insert(schema.orgMembers)
        .values({
          orgId: invite.orgId,
          userId: user.id,
          role: invite.role,
          joinedAt: now,
        })
        .onConflictDoNothing();
      await db
        .update(schema.orgInvites)
        .set({ acceptedAt: now })
        .where(eq(schema.orgInvites.id, invite.id));

      return { orgId: invite.orgId, role: invite.role };
    },
  );
}

// Org-invite acceptance.
//
//   GET  /api/org-invites/:token    → preview (no side effects)
//   POST /api/org-invites/:token    → accept (auth required, email-match)
//
// Mirrors the layout-invite endpoints in routes/invites.ts. Demo
// accounts CAN accept org invites (the demo restriction is on creating
// orgs, not joining them).

import type { FastifyInstance } from 'fastify';
import { and, eq } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { checkGrowth } from '../limits/limits.js';
import { requireUser } from '../auth/cookie.js';
import { hasVerifiedEmail } from '../auth/users.js';
import { sameEmail } from '../utils/validate.js';

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
      if (!sameEmail(invite.invitedEmail, user.email)) {
        return reply.code(403).send({ error: 'email_mismatch' });
      }
      // The email match only proves anything if the account has proven
      // it controls that mailbox.
      if (!(await hasVerifiedEmail(user))) {
        return reply.code(403).send({ error: 'email_not_verified' });
      }

      // The invite carries its inviter's authority. If they have since
      // been demoted or removed from the org, the invite is void —
      // otherwise a removed admin's outstanding invites (possibly for
      // role 'admin') would still let people in.
      const inviter = await db
        .select({ role: schema.orgMembers.role })
        .from(schema.orgMembers)
        .where(
          and(
            eq(schema.orgMembers.orgId, invite.orgId),
            eq(schema.orgMembers.userId, invite.invitedBy),
          ),
        )
        .get();
      if (inviter?.role !== 'admin') {
        await db.delete(schema.orgInvites).where(eq(schema.orgInvites.id, invite.id));
        return reply.code(409).send({ error: 'invite_revoked' });
      }

      const already = await db
        .select({ role: schema.orgMembers.role })
        .from(schema.orgMembers)
        .where(and(eq(schema.orgMembers.orgId, invite.orgId), eq(schema.orgMembers.userId, user.id)))
        .get();
      if (!already) {
        const refusal = await checkGrowth({ actor: user, owner: { kind: 'org', id: invite.orgId }, add: { members: 1 } });
        if (refusal) return reply.code(refusal.status).send(refusal.body);
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
      // Any request to join is answered now.
      await db
        .delete(schema.orgJoinRequests)
        .where(and(eq(schema.orgJoinRequests.orgId, invite.orgId), eq(schema.orgJoinRequests.userId, user.id)));
      await db
        .update(schema.orgInvites)
        .set({ acceptedAt: now })
        .where(eq(schema.orgInvites.id, invite.id));

      return { orgId: invite.orgId, role: invite.role };
    },
  );
}

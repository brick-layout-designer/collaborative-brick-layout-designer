// Sharing a custom part with a person by an emailed invite link, the same
// way modules are shared (moduleInvites.ts).
//
//   POST   /api/custom-parts/:id/invites             invite an email (its owners)
//   DELETE /api/custom-parts/:id/invites/:inviteId   cancel a pending invite
//   GET    /api/part-invites/:token                  preview (no side effects)
//   POST   /api/part-invites/:token                  accept (signed in)
//
// Inviting answers the same whether or not the email has an account here.
// Nobody is added until they accept: signed in with the invited email,
// verified, before it expires, once. The invite holds only while the person
// who sent it still manages the part's sharing, and pending invites go when
// the part changes hands (access/pendingShares.ts).

import { randomBytes, randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { requireUser } from '../auth/cookie.js';
import { isDemoUser } from '../demo/demoAccount.js';
import { hasAtLeast, resolveResourceRole } from '../access/resolveResourceRole.js';
import { sendInviteEmail } from '../email/sendInvite.js';
import { writeAuditEvent } from '../audit/writeAuditEvent.js';
import { env } from '../env.js';
import { hasVerifiedEmail } from '../auth/users.js';
import { isValidEmail, normalizeEmail, sameEmail } from '../utils/validate.js';
import { publicName } from '../utils/publicName.js';
import { maskEmail } from '../utils/maskEmail.js';
import { perPerson } from '../utils/rateLimits.js';

const INVITE_TTL_MS = 14 * 24 * 60 * 60 * 1000;

type PartInvite = typeof schema.customPartInvites.$inferSelect;

/** Why an invite can't be used, or null when it can. */
async function unusable(invite: PartInvite | undefined): Promise<{ code: number; error: string } | null> {
  if (!invite) return { code: 404, error: 'invite_not_found' };
  if (invite.acceptedAt) return { code: 410, error: 'invite_already_accepted' };
  if (invite.expiresAt.getTime() < Date.now()) return { code: 410, error: 'invite_expired' };
  if (!invite.invitedBy) return { code: 410, error: 'part_invite_no_longer_valid' };
  const { role } = await resolveResourceRole(invite.invitedBy, 'custom_part', invite.customPartId);
  if (!hasAtLeast(role, 'owner')) return { code: 410, error: 'part_invite_no_longer_valid' };
  return null;
}

async function inviteByToken(token: string): Promise<PartInvite | undefined> {
  return db.select().from(schema.customPartInvites).where(eq(schema.customPartInvites.token, token)).get();
}

export async function customPartInviteRoutes(app: FastifyInstance): Promise<void> {
  // ---- invite ----------------------------------------------------------------
  app.post<{ Params: { id: string }; Body: { email?: unknown; role?: unknown } }>(
    '/api/custom-parts/:id/invites',
    { config: { rateLimit: perPerson(20, '1 minute') } },
    async (req, reply) => {
      const user = requireUser(req);
      if (isDemoUser(user)) return reply.code(403).send({ error: 'demo_account_cannot_invite' });
      const { role } = await resolveResourceRole(user.id, 'custom_part', req.params.id);
      if (role === null) return reply.code(404).send({ error: 'not_found' });
      if (!hasAtLeast(role, 'owner')) return reply.code(403).send({ error: 'forbidden' });
      const email = typeof req.body?.email === 'string' ? normalizeEmail(req.body.email) : '';
      if (!isValidEmail(email)) return reply.code(400).send({ error: 'invalid_email' });
      const inviteRole = req.body?.role;
      if (inviteRole !== 'viewer' && inviteRole !== 'editor') return reply.code(400).send({ error: 'invalid_role' });

      // Someone already on the list (whom the owner can see there) only
      // needs their role changed. Otherwise the answer is the same whether
      // or not the address has an account here.
      const existingUser = await db
        .select({ id: schema.users.id })
        .from(schema.users)
        .where(sql`lower(${schema.users.email}) = ${email}`)
        .get();
      if (existingUser && (await resolveResourceRole(existingUser.id, 'custom_part', req.params.id)).role !== null) {
        return reply.code(409).send({ error: 'already_has_access' });
      }

      // A new invite to the same address replaces the one still waiting.
      await db
        .delete(schema.customPartInvites)
        .where(
          and(
            eq(schema.customPartInvites.customPartId, req.params.id),
            eq(schema.customPartInvites.invitedEmail, email),
            isNull(schema.customPartInvites.acceptedAt),
          ),
        );
      const token = randomBytes(24).toString('hex');
      const id = randomUUID();
      const now = new Date();
      const expiresAt = new Date(now.getTime() + INVITE_TTL_MS);
      await db.insert(schema.customPartInvites).values({
        id,
        customPartId: req.params.id,
        invitedEmail: email,
        role: inviteRole,
        token,
        invitedBy: user.id,
        expiresAt,
        acceptedAt: null,
        createdAt: now,
      });

      const inviteUrl = `${env.publicUrl}/part-invite/${token}`;
      let emailDelivered = false;
      try {
        emailDelivered = await sendInviteEmail({ to: email, inviteUrl, inviterName: publicName(user.id, user.displayName), what: 'part' });
      } catch {
        // emailDelivered stays false; the owner has the link to send.
      }
      await writeAuditEvent({
        resourceKind: 'custom_part',
        resourceId: req.params.id,
        userId: user.id,
        eventType: 'share',
        payload: { invitedEmail: email, role: inviteRole, inviteId: id },
      });
      return { id, token, inviteUrl, emailDelivered, expiresAt: expiresAt.getTime() };
    },
  );

  // ---- cancel ----------------------------------------------------------------
  app.delete<{ Params: { id: string; inviteId: string } }>('/api/custom-parts/:id/invites/:inviteId', async (req, reply) => {
    const user = requireUser(req);
    const { role } = await resolveResourceRole(user.id, 'custom_part', req.params.id);
    if (role === null) return reply.code(404).send({ error: 'not_found' });
    if (!hasAtLeast(role, 'owner')) return reply.code(403).send({ error: 'forbidden' });
    await db
      .delete(schema.customPartInvites)
      .where(and(eq(schema.customPartInvites.id, req.params.inviteId), eq(schema.customPartInvites.customPartId, req.params.id)));
    return { ok: true };
  });

  // ---- preview ---------------------------------------------------------------
  app.get<{ Params: { token: string } }>('/api/part-invites/:token', async (req, reply) => {
    const invite = await inviteByToken(req.params.token);
    const bad = await unusable(invite);
    if (bad) return reply.code(bad.code).send({ error: bad.error });
    const part = await db
      .select({ partNumber: schema.customParts.partNumber, displayName: schema.customParts.displayName })
      .from(schema.customParts)
      .where(eq(schema.customParts.id, invite!.customPartId))
      .get();
    if (!part) return reply.code(404).send({ error: 'invite_not_found' });
    // Whoever holds the link sees a masked address, and whether the invite
    // is for the account they're signed in with.
    const forYou = req.user ? sameEmail(invite!.invitedEmail, req.user.email) : null;
    return {
      invitedEmail: forYou ? invite!.invitedEmail : maskEmail(invite!.invitedEmail),
      forYou,
      role: invite!.role,
      partId: invite!.customPartId,
      partNumber: part.partNumber,
      partName: part.displayName,
      expiresAt: invite!.expiresAt.getTime(),
    };
  });

  // ---- accept ----------------------------------------------------------------
  app.post<{ Params: { token: string } }>('/api/part-invites/:token', async (req, reply) => {
    const user = requireUser(req);
    const invite = await inviteByToken(req.params.token);
    const bad = await unusable(invite);
    if (bad) return reply.code(bad.code).send({ error: bad.error });
    const inv = invite!;
    if (!sameEmail(inv.invitedEmail, user.email)) return reply.code(403).send({ error: 'email_mismatch' });
    if (!(await hasVerifiedEmail(user))) return reply.code(403).send({ error: 'email_not_verified' });

    const now = new Date();
    // Single use: only the request that marks it accepted adds anyone.
    const claimed = await db
      .update(schema.customPartInvites)
      .set({ acceptedAt: now })
      .where(and(eq(schema.customPartInvites.id, inv.id), isNull(schema.customPartInvites.acceptedAt)))
      .returning({ id: schema.customPartInvites.id });
    if (claimed.length === 0) return reply.code(410).send({ error: 'invite_already_accepted' });
    await db
      .insert(schema.customPartCollaborators)
      .values({ customPartId: inv.customPartId, userId: user.id, role: inv.role, addedAt: now })
      .onConflictDoNothing();
    await writeAuditEvent({
      resourceKind: 'custom_part',
      resourceId: inv.customPartId,
      userId: user.id,
      eventType: 'share',
      payload: { invitedEmail: inv.invitedEmail, role: inv.role, inviteId: inv.id, accepted: true },
    });
    return { partId: inv.customPartId, role: inv.role };
  });
}

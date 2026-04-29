// Organization endpoints (Phase 6).
//
// An org has members with two roles:
//   - 'admin'  → can invite/remove members, change member roles, create
//                org-owned layouts, transfer layouts in/out
//   - 'member' → can read the org's metadata and access org-owned layouts
//                as if they had editor role on each one (per
//                resolveResourceRole)
//
// The creator of an org becomes its first admin.
//
// Demo accounts are blocked from creating orgs (PLAN.md §3.4) but can
// accept invites to existing orgs.

import { randomBytes, randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { and, eq } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { requireUser } from '../auth/cookie.js';
import { writeAuditEvent } from '../audit/writeAuditEvent.js';
import { sendInviteEmail } from '../email/sendInvite.js';
import { env } from '../env.js';

interface CreateOrgBody {
  name: string;
  slug: string;
}

interface OrgMemberInviteBody {
  email: string;
  role: 'admin' | 'member';
}

const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;
const ORG_INVITE_TTL_MS = 14 * 24 * 60 * 60 * 1000;

export async function orgRoutes(app: FastifyInstance): Promise<void> {
  // ---- list orgs the current user belongs to -----------------------------
  app.get('/api/orgs', async (req) => {
    const user = requireUser(req);
    const rows = await db
      .select({
        id: schema.orgs.id,
        name: schema.orgs.name,
        slug: schema.orgs.slug,
        createdAt: schema.orgs.createdAt,
        myRole: schema.orgMembers.role,
      })
      .from(schema.orgMembers)
      .innerJoin(schema.orgs, eq(schema.orgs.id, schema.orgMembers.orgId))
      .where(eq(schema.orgMembers.userId, user.id));

    return {
      orgs: rows.map((r) => ({
        id: r.id,
        name: r.name,
        slug: r.slug,
        createdAt: r.createdAt.getTime(),
        myRole: r.myRole,
      })),
    };
  });

  // ---- create org ---------------------------------------------------------
  app.post<{ Body: CreateOrgBody }>('/api/orgs', async (req, reply) => {
    const user = requireUser(req);
    if (user.isDemoAccount) {
      return reply.code(403).send({ error: 'demo_account_cannot_create_org' });
    }
    const name = req.body.name?.trim();
    const slug = req.body.slug?.trim().toLowerCase();
    if (!name || name.length < 1 || name.length > 80) {
      return reply.code(400).send({ error: 'invalid_name' });
    }
    if (!slug || !SLUG_RE.test(slug)) {
      // Slugs must be URL-safe and short. The regex allows lower-case
      // letters, digits, and internal hyphens; can't start or end with
      // a hyphen. Length 1–40 chars.
      return reply.code(400).send({ error: 'invalid_slug' });
    }

    // Reject collisions early so the error is friendlier than a unique-
    // constraint failure. Race-condition window between the check and
    // insert is tiny; the unique index catches it deterministically.
    const existing = await db
      .select()
      .from(schema.orgs)
      .where(eq(schema.orgs.slug, slug))
      .get();
    if (existing) return reply.code(409).send({ error: 'slug_taken' });

    const id = randomUUID();
    const now = new Date();
    await db.insert(schema.orgs).values({ id, name, slug, createdAt: now });
    await db.insert(schema.orgMembers).values({
      orgId: id,
      userId: user.id,
      role: 'admin',
      joinedAt: now,
    });
    return reply.code(201).send({ id, name, slug });
  });

  // ---- get org by slug ----------------------------------------------------
  app.get<{ Params: { slug: string } }>('/api/orgs/:slug', async (req, reply) => {
    const user = requireUser(req);
    const org = await loadOrgBySlug(req.params.slug);
    if (!org) return reply.code(404).send({ error: 'not_found' });

    const myMembership = await db
      .select({ role: schema.orgMembers.role })
      .from(schema.orgMembers)
      .where(
        and(
          eq(schema.orgMembers.orgId, org.id),
          eq(schema.orgMembers.userId, user.id),
        ),
      )
      .get();
    if (!myMembership) return reply.code(404).send({ error: 'not_found' });

    return {
      id: org.id,
      name: org.name,
      slug: org.slug,
      createdAt: org.createdAt.getTime(),
      myRole: myMembership.role,
    };
  });

  // ---- list members + pending invites -------------------------------------
  app.get<{ Params: { slug: string } }>(
    '/api/orgs/:slug/members',
    async (req, reply) => {
      const user = requireUser(req);
      const org = await loadOrgBySlug(req.params.slug);
      if (!org) return reply.code(404).send({ error: 'not_found' });
      const myMembership = await getMembership(org.id, user.id);
      if (!myMembership) return reply.code(404).send({ error: 'not_found' });

      const members = await db
        .select({
          userId: schema.orgMembers.userId,
          role: schema.orgMembers.role,
          joinedAt: schema.orgMembers.joinedAt,
          email: schema.users.email,
          displayName: schema.users.displayName,
          avatarUrl: schema.users.avatarUrl,
        })
        .from(schema.orgMembers)
        .innerJoin(schema.users, eq(schema.users.id, schema.orgMembers.userId))
        .where(eq(schema.orgMembers.orgId, org.id));

      // Only admins can see pending invites (the email list is somewhat
      // sensitive). Members get an empty array.
      const invites =
        myMembership.role === 'admin'
          ? await db
              .select()
              .from(schema.orgInvites)
              .where(eq(schema.orgInvites.orgId, org.id))
              .then((rs) => rs.filter((i) => i.acceptedAt === null))
          : [];

      return {
        members: members.map((m) => ({
          userId: m.userId,
          role: m.role,
          joinedAt: m.joinedAt.getTime(),
          email: m.email,
          displayName: m.displayName,
          avatarUrl: m.avatarUrl,
        })),
        invites: invites.map((i) => ({
          id: i.id,
          invitedEmail: i.invitedEmail,
          role: i.role,
          expiresAt: i.expiresAt.getTime(),
        })),
      };
    },
  );

  // ---- invite member ------------------------------------------------------
  app.post<{ Params: { slug: string }; Body: OrgMemberInviteBody }>(
    '/api/orgs/:slug/invites',
    async (req, reply) => {
      const user = requireUser(req);
      if (user.isDemoAccount) {
        return reply.code(403).send({ error: 'demo_account_cannot_invite' });
      }
      const org = await loadOrgBySlug(req.params.slug);
      if (!org) return reply.code(404).send({ error: 'not_found' });
      const myMembership = await getMembership(org.id, user.id);
      if (!myMembership) return reply.code(404).send({ error: 'not_found' });
      if (myMembership.role !== 'admin') {
        return reply.code(403).send({ error: 'forbidden' });
      }

      const { email, role } = req.body;
      if (!email || !email.includes('@')) {
        return reply.code(400).send({ error: 'invalid_email' });
      }
      if (role !== 'admin' && role !== 'member') {
        return reply.code(400).send({ error: 'invalid_role' });
      }

      // Reject if the recipient is already a member.
      const existingUser = await db
        .select()
        .from(schema.users)
        .where(eq(schema.users.email, email))
        .get();
      if (existingUser) {
        const m = await getMembership(org.id, existingUser.id);
        if (m) return reply.code(409).send({ error: 'already_member' });
      }

      const token = randomBytes(24).toString('hex');
      const id = randomUUID();
      const expiresAt = new Date(Date.now() + ORG_INVITE_TTL_MS);
      await db.insert(schema.orgInvites).values({
        id,
        orgId: org.id,
        invitedEmail: email,
        invitedBy: user.id,
        role,
        token,
        expiresAt,
        acceptedAt: null,
      });

      const inviteUrl = `${env.publicUrl}/org-invite/${token}`;
      let emailDelivered = false;
      try {
        emailDelivered = await sendInviteEmail({
          to: email,
          inviteUrl,
          inviterName: user.displayName,
        });
      } catch {
        /* ignored — fall back to copy-paste link */
      }

      return {
        id,
        token,
        inviteUrl,
        emailDelivered,
        expiresAt: expiresAt.getTime(),
      };
    },
  );

  // ---- revoke invite ------------------------------------------------------
  app.delete<{ Params: { slug: string; inviteId: string } }>(
    '/api/orgs/:slug/invites/:inviteId',
    async (req, reply) => {
      const user = requireUser(req);
      const org = await loadOrgBySlug(req.params.slug);
      if (!org) return reply.code(404).send({ error: 'not_found' });
      const myMembership = await getMembership(org.id, user.id);
      if (!myMembership) return reply.code(404).send({ error: 'not_found' });
      if (myMembership.role !== 'admin') {
        return reply.code(403).send({ error: 'forbidden' });
      }
      await db
        .delete(schema.orgInvites)
        .where(
          and(
            eq(schema.orgInvites.id, req.params.inviteId),
            eq(schema.orgInvites.orgId, org.id),
          ),
        );
      return { ok: true };
    },
  );

  // ---- change member role -------------------------------------------------
  app.patch<{
    Params: { slug: string; userId: string };
    Body: { role: 'admin' | 'member' };
  }>('/api/orgs/:slug/members/:userId', async (req, reply) => {
    const user = requireUser(req);
    const org = await loadOrgBySlug(req.params.slug);
    if (!org) return reply.code(404).send({ error: 'not_found' });
    const myMembership = await getMembership(org.id, user.id);
    if (!myMembership) return reply.code(404).send({ error: 'not_found' });
    if (myMembership.role !== 'admin') {
      return reply.code(403).send({ error: 'forbidden' });
    }

    const targetMembership = await getMembership(org.id, req.params.userId);
    if (!targetMembership) return reply.code(404).send({ error: 'member_not_found' });

    const newRole = req.body.role;
    if (newRole !== 'admin' && newRole !== 'member') {
      return reply.code(400).send({ error: 'invalid_role' });
    }

    // Prevent removing the last admin (would orphan the org). The
    // self-demotion case is the dangerous one: an admin shouldn't be
    // able to demote themselves to 'member' if they're the only admin.
    if (
      myMembership.role === 'admin' &&
      req.params.userId === user.id &&
      newRole === 'member'
    ) {
      const adminCount = await countAdmins(org.id);
      if (adminCount <= 1) {
        return reply.code(409).send({ error: 'last_admin' });
      }
    }

    await db
      .update(schema.orgMembers)
      .set({ role: newRole })
      .where(
        and(
          eq(schema.orgMembers.orgId, org.id),
          eq(schema.orgMembers.userId, req.params.userId),
        ),
      );

    return { ok: true };
  });

  // ---- remove member ------------------------------------------------------
  app.delete<{ Params: { slug: string; userId: string } }>(
    '/api/orgs/:slug/members/:userId',
    async (req, reply) => {
      const user = requireUser(req);
      const org = await loadOrgBySlug(req.params.slug);
      if (!org) return reply.code(404).send({ error: 'not_found' });
      const myMembership = await getMembership(org.id, user.id);
      if (!myMembership) return reply.code(404).send({ error: 'not_found' });

      const isSelf = req.params.userId === user.id;
      if (!isSelf && myMembership.role !== 'admin') {
        return reply.code(403).send({ error: 'forbidden' });
      }

      // Last-admin guard same as above.
      const target = await getMembership(org.id, req.params.userId);
      if (target?.role === 'admin') {
        const adminCount = await countAdmins(org.id);
        if (adminCount <= 1) {
          return reply.code(409).send({ error: 'last_admin' });
        }
      }

      await db
        .delete(schema.orgMembers)
        .where(
          and(
            eq(schema.orgMembers.orgId, org.id),
            eq(schema.orgMembers.userId, req.params.userId),
          ),
        );
      return { ok: true };
    },
  );

  // ---- list org-owned layouts ---------------------------------------------
  app.get<{ Params: { slug: string } }>(
    '/api/orgs/:slug/layouts',
    async (req, reply) => {
      const user = requireUser(req);
      const org = await loadOrgBySlug(req.params.slug);
      if (!org) return reply.code(404).send({ error: 'not_found' });
      const myMembership = await getMembership(org.id, user.id);
      if (!myMembership) return reply.code(404).send({ error: 'not_found' });

      const rows = await db
        .select()
        .from(schema.layouts)
        .where(eq(schema.layouts.ownerOrgId, org.id));
      return {
        layouts: rows.map((l) => ({
          id: l.id,
          title: l.title,
          ownerUserId: l.ownerUserId,
          ownerOrgId: l.ownerOrgId,
          createdAt: l.createdAt.getTime(),
          updatedAt: l.updatedAt.getTime(),
          expiresAt: l.expiresAt?.getTime() ?? null,
          docVersion: l.docVersion,
          hasSidecar: l.sidecarSnapshot !== null,
        })),
      };
    },
  );

  // ---- audit (Phase 6 hook for future read UI) -- intentionally stubbed ---
  void writeAuditEvent;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function loadOrgBySlug(slug: string): Promise<typeof schema.orgs.$inferSelect | null> {
  const row = await db
    .select()
    .from(schema.orgs)
    .where(eq(schema.orgs.slug, slug))
    .get();
  return row ?? null;
}

async function getMembership(
  orgId: string,
  userId: string,
): Promise<{ role: 'admin' | 'member' } | null> {
  const row = await db
    .select({ role: schema.orgMembers.role })
    .from(schema.orgMembers)
    .where(
      and(
        eq(schema.orgMembers.orgId, orgId),
        eq(schema.orgMembers.userId, userId),
      ),
    )
    .get();
  return row ?? null;
}

async function countAdmins(orgId: string): Promise<number> {
  const rows = await db
    .select({ role: schema.orgMembers.role })
    .from(schema.orgMembers)
    .where(eq(schema.orgMembers.orgId, orgId));
  return rows.filter((r) => r.role === 'admin').length;
}

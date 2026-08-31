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
import { and, eq, inArray, ne, or, sql } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { requireUser } from '../auth/cookie.js';
import { writeAuditEvent } from '../audit/writeAuditEvent.js';
import { sendInviteEmail } from '../email/sendInvite.js';
import { env } from '../env.js';
import { escapeLike, isValidEmail } from '../utils/validate.js';

interface CreateOrgBody {
  name: string;
  /**
   * Optional. When omitted (or empty) the server auto-derives a slug
   * from `name` and disambiguates with a numeric suffix on collision.
   * Older clients still send a manual slug.
   */
  slug?: string;
}

/**
 * Slugify a name into a URL-safe identifier. Lowercase, replace any
 * non-alnum run with `-`, trim leading/trailing `-`, cap at 40 chars.
 * Falls back to `'org'` for names with no usable characters (CJK only,
 * empty, etc.) so the suffix-disambig loop has something to grow.
 */
function slugifyName(name: string): string {
  const cleaned = name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/^-+|-+$/g, '');
  return cleaned || 'org';
}

interface OrgMemberInviteBody {
  /**
   * Either an email (existing flow — works whether or not the address
   * has an account yet) OR a userId (the invite-autocomplete path, see
   * GET /api/orgs/:slug/user-search — that endpoint deliberately never
   * exposes an arbitrary user's email to the searching admin, so
   * picking a suggestion invites by id and the server resolves the
   * email itself). Exactly one of the two should be set; email wins if
   * both are present.
   */
  email?: string;
  userId?: string;
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
    const requestedSlug = req.body.slug?.trim().toLowerCase();
    if (!name || name.length < 1 || name.length > 80) {
      return reply.code(400).send({ error: 'invalid_name' });
    }

    // Resolve the final slug. If the caller passed one, validate it
    // and reject collisions explicitly so they see a clear error.
    // If they didn't, auto-derive from `name` and append a numeric
    // suffix until it's unique. This makes the UI a one-field form
    // (just "Name") in the common case.
    let slug: string;
    if (requestedSlug) {
      if (!SLUG_RE.test(requestedSlug)) {
        return reply.code(400).send({ error: 'invalid_slug' });
      }
      const collide = await db
        .select()
        .from(schema.orgs)
        .where(eq(schema.orgs.slug, requestedSlug))
        .get();
      if (collide) return reply.code(409).send({ error: 'slug_taken' });
      slug = requestedSlug;
    } else {
      const base = slugifyName(name).slice(0, 36); // leave room for `-99`
      slug = base;
      for (let n = 2; n < 100; n++) {
        const collide = await db
          .select()
          .from(schema.orgs)
          .where(eq(schema.orgs.slug, slug))
          .get();
        if (!collide) break;
        slug = `${base}-${n}`;
      }
    }

    const id = randomUUID();
    const now = new Date();
    await db.insert(schema.orgs).values({ id, name, slug, createdAt: now });
    await db.insert(schema.orgMembers).values({
      orgId: id,
      userId: user.id,
      role: 'admin',
      joinedAt: now,
    });
    await writeAuditEvent({
      resourceKind: 'org',
      resourceId: id,
      userId: user.id,
      eventType: 'create',
      payload: { name, slug },
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
    { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
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

      const { role } = req.body;
      if (role !== 'admin' && role !== 'member') {
        return reply.code(400).send({ error: 'invalid_role' });
      }

      let email: string;
      let existingUser: typeof schema.users.$inferSelect | undefined;
      if (req.body.email) {
        if (!isValidEmail(req.body.email)) {
          return reply.code(400).send({ error: 'invalid_email' });
        }
        email = req.body.email;
        existingUser = await db.select().from(schema.users).where(eq(schema.users.email, email)).get();
      } else if (req.body.userId) {
        // The autocomplete path — resolve the email server-side so the
        // client (and the searching admin) never needs to see it.
        existingUser = await db.select().from(schema.users).where(eq(schema.users.id, req.body.userId)).get();
        if (!existingUser) return reply.code(404).send({ error: 'not_found' });
        email = existingUser.email;
      } else {
        return reply.code(400).send({ error: 'invalid_input' });
      }

      // Reject if the recipient is already a member.
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

      await writeAuditEvent({
        resourceKind: 'org',
        resourceId: org.id,
        userId: user.id,
        eventType: 'share',
        payload: { invitedEmail: email, role, inviteId: id },
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

  // ---- search users to invite ---------------------------------------------
  // Org-admin-only (NOT the platform-wide /api/admin/users search — that
  // endpoint exposes isGlobalAdmin/isDemoAccount/emailVerified/storage
  // stats for every account and would be a privilege escalation if
  // reachable by a mere org admin). Lets the invite form autocomplete
  // against real accounts instead of the admin blind-typing an email
  // and only finding out it's wrong after submitting. Deliberately
  // narrow: short results, minimal fields (never a bare email match —
  // only id/displayName/avatarUrl, plus the org-membership status so
  // the UI can grey out people who are already members), a minimum
  // query length, and a low rate limit — this is still a user-search
  // oracle and should stay hard to use for enumeration.
  app.get<{ Params: { slug: string }; Querystring: { q?: string } }>(
    '/api/orgs/:slug/user-search',
    { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const user = requireUser(req);
      const org = await loadOrgBySlug(req.params.slug);
      if (!org) return reply.code(404).send({ error: 'not_found' });
      const myMembership = await getMembership(org.id, user.id);
      if (!myMembership) return reply.code(404).send({ error: 'not_found' });
      if (myMembership.role !== 'admin') {
        return reply.code(403).send({ error: 'forbidden' });
      }

      const needle = (req.query.q ?? '').trim();
      if (needle.length < 2) return { users: [] };
      const safe = `%${escapeLike(needle)}%`;

      const matches = await db
        .select({ id: schema.users.id, displayName: schema.users.displayName, avatarUrl: schema.users.avatarUrl })
        .from(schema.users)
        .where(
          and(
            ne(schema.users.id, user.id),
            or(
              sql`${schema.users.displayName} LIKE ${safe} ESCAPE '\\'`,
              // Exact email match only (not a substring LIKE) — lets an
              // admin invite-by-pasting-the-exact-email still work
              // without turning this into an email substring search.
              eq(schema.users.email, needle),
            ),
          ),
        )
        .limit(10);

      const memberIds = matches.length > 0
        ? new Set(
            (
              await db
                .select({ userId: schema.orgMembers.userId })
                .from(schema.orgMembers)
                .where(and(eq(schema.orgMembers.orgId, org.id), inArray(schema.orgMembers.userId, matches.map((m) => m.id))))
            ).map((r) => r.userId),
          )
        : new Set<string>();

      return {
        users: matches.map((m) => ({ ...m, alreadyMember: memberIds.has(m.id) })),
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
    await writeAuditEvent({
      resourceKind: 'org',
      resourceId: org.id,
      userId: user.id,
      eventType: 'role_change',
      payload: {
        targetUserId: req.params.userId,
        fromRole: targetMembership.role,
        toRole: newRole,
      },
    });

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
      await writeAuditEvent({
        resourceKind: 'org',
        resourceId: org.id,
        userId: user.id,
        eventType: 'unshare',
        payload: { targetUserId: req.params.userId, selfRemoved: isSelf },
      });
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

  // -----------------------------------------------------------------
  // Per-org part library management (org admin only)
  // -----------------------------------------------------------------

  // GET /api/orgs/:slug/part-libraries
  // Returns all installed libraries with the org's enabled/disabled status.
  app.get<{ Params: { slug: string } }>(
    '/api/orgs/:slug/part-libraries',
    async (req, reply) => {
      const me = requireUser(req);
      const org = await loadOrgBySlug(req.params.slug);
      if (!org) return reply.code(404).send({ error: 'not_found' });
      const membership = await getMembership(org.id, me.id);
      if (!membership) return reply.code(403).send({ error: 'not_member' });

      // All installed libraries.
      const all = await db.select().from(schema.partLibraries).orderBy(schema.partLibraries.name);
      // This org's explicit overrides.
      const overrides = await db
        .select()
        .from(schema.orgPartLibraries)
        .where(eq(schema.orgPartLibraries.orgId, org.id));
      const overrideMap = new Map(overrides.map((o) => [o.libraryId, o.enabled]));

      return {
        libraries: all.map((lib) => {
          const explicit = overrideMap.get(lib.id);
          // Locked libraries are always enabled regardless of any override.
          const enabled = lib.locked ? true : (explicit !== undefined ? explicit : lib.defaultEnabled);
          return {
            id: lib.id,
            name: lib.name,
            slug: lib.slug,
            partCount: lib.partCount,
            defaultEnabled: lib.defaultEnabled,
            locked: lib.locked,
            enabled,
            explicitOverride: !lib.locked && explicit !== undefined,
          };
        }),
        isAdmin: membership.role === 'admin',
      };
    },
  );

  // PUT /api/orgs/:slug/part-libraries/:libraryId
  // Org admin enables or disables a library for the org.
  app.put<{
    Params: { slug: string; libraryId: string };
    Body: { enabled: boolean };
  }>(
    '/api/orgs/:slug/part-libraries/:libraryId',
    async (req, reply) => {
      const me = requireUser(req);
      const org = await loadOrgBySlug(req.params.slug);
      if (!org) return reply.code(404).send({ error: 'not_found' });
      const membership = await getMembership(org.id, me.id);
      if (!membership || membership.role !== 'admin') {
        return reply.code(403).send({ error: 'not_org_admin' });
      }

      const lib = await db
        .select({ id: schema.partLibraries.id, defaultEnabled: schema.partLibraries.defaultEnabled, locked: schema.partLibraries.locked })
        .from(schema.partLibraries)
        .where(eq(schema.partLibraries.id, req.params.libraryId))
        .get();
      if (!lib) return reply.code(404).send({ error: 'library_not_found' });
      if (lib.locked) return reply.code(403).send({ error: 'library_locked' });

      const enabled = Boolean(req.body.enabled);
      const now = new Date();

      // Upsert the override row.
      const existing = await db
        .select()
        .from(schema.orgPartLibraries)
        .where(
          and(
            eq(schema.orgPartLibraries.orgId, org.id),
            eq(schema.orgPartLibraries.libraryId, lib.id),
          ),
        )
        .get();

      if (existing) {
        await db
          .update(schema.orgPartLibraries)
          .set({ enabled, updatedAt: now })
          .where(
            and(
              eq(schema.orgPartLibraries.orgId, org.id),
              eq(schema.orgPartLibraries.libraryId, lib.id),
            ),
          );
      } else {
        await db.insert(schema.orgPartLibraries).values({
          orgId: org.id,
          libraryId: lib.id,
          enabled,
          updatedAt: now,
        });
      }

      await writeAuditEvent({
        resourceKind: 'org',
        resourceId: org.id,
        userId: me.id,
        eventType: 'org_part_library_toggle',
        payload: { libraryId: lib.id, enabled, orgSlug: org.slug },
      });
      return { ok: true };
    },
  );

  // DELETE /api/orgs/:slug/part-libraries/:libraryId
  // Removes the explicit override — library reverts to its defaultEnabled state.
  app.delete<{ Params: { slug: string; libraryId: string } }>(
    '/api/orgs/:slug/part-libraries/:libraryId',
    async (req, reply) => {
      const me = requireUser(req);
      const org = await loadOrgBySlug(req.params.slug);
      if (!org) return reply.code(404).send({ error: 'not_found' });
      const membership = await getMembership(org.id, me.id);
      if (!membership || membership.role !== 'admin') {
        return reply.code(403).send({ error: 'not_org_admin' });
      }
      const lib = await db
        .select({ locked: schema.partLibraries.locked })
        .from(schema.partLibraries)
        .where(eq(schema.partLibraries.id, req.params.libraryId))
        .get();
      if (!lib) return reply.code(404).send({ error: 'library_not_found' });
      if (lib.locked) return reply.code(403).send({ error: 'library_locked' });
      await db
        .delete(schema.orgPartLibraries)
        .where(
          and(
            eq(schema.orgPartLibraries.orgId, org.id),
            eq(schema.orgPartLibraries.libraryId, req.params.libraryId),
          ),
        );
      return { ok: true };
    },
  );

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

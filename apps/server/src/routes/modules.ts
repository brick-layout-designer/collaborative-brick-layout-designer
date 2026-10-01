// Saved modules (Phase 6.5).
//
// First-class shareable assets that mirror desktop CLD's `Module`. Stored
// as a Y.Doc snapshot (same persistence story as layouts). For v1
// modules are NOT realtime-collaborative — there's no WS endpoint for
// them, just a snapshot REST. Editing happens in the modules editor
// (planned post-Phase-7) or programmatically via the API.
//
// Sharing tiers: owner / editor / viewer; org ownership available;
// explicit collaborators via `module_collaborators`. The
// `resolveResourceRole` helper handles the kind dispatch.

import { randomUUID } from 'node:crypto';
import { Buffer } from 'node:buffer';
import type { FastifyInstance } from 'fastify';
import { and, eq, sql } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { requireUser } from '../auth/cookie.js';
import { hasAtLeast, resolveResourceRole, type Role } from '../access/resolveResourceRole.js';
import { createLayoutDoc, encodeDoc } from '@cld/ydoc';
import { writeAuditEvent } from '../audit/writeAuditEvent.js';
import { destinationOrg, matchesOwner, ownerLookup, resolveOwnerFilter } from './owners.js';
import { isValidEmail, normalizeEmail } from '../utils/validate.js';

interface CreateModuleBody {
  title?: string;
  /** When set, the module is org-owned. Caller must be a member. */
  orgSlug?: string;
}

interface InviteBody {
  email: string;
  role: 'viewer' | 'editor';
}

export async function moduleRoutes(app: FastifyInstance): Promise<void> {
  // The snapshot endpoints accept binary octet-stream bodies (same path
  // as the layouts snapshot). Register the parser if it's not already
  // present (layoutRoutes registers it too — first-wins).
  if (!app.hasContentTypeParser('application/octet-stream')) {
    app.addContentTypeParser(
      'application/octet-stream',
      { parseAs: 'buffer', bodyLimit: 50 * 1024 * 1024 },
      (_req, body, done) => done(null, body),
    );
  }

  // ---- list modules the user can see -------------------------------------
  app.get<{ Querystring: { owner?: string } }>('/api/modules', async (req, reply) => {
    const user = requireUser(req);
    // ?owner=all|me|<club slug>: a club the caller isn't in is not found.
    const filter = await resolveOwnerFilter(user.id, req.query?.owner);
    if (!filter) return reply.code(404).send({ error: 'org_not_found' });
    // Metadata columns only — never the doc blobs.
    const personal = await db
      .select(moduleListColumns)
      .from(schema.modules)
      .where(eq(schema.modules.ownerUserId, user.id));
    const orgOwned = await db
      .select({ module: moduleListColumns, memberRole: schema.orgMembers.role })
      .from(schema.orgMembers)
      .innerJoin(
        schema.modules,
        eq(schema.modules.ownerOrgId, schema.orgMembers.orgId),
      )
      .where(eq(schema.orgMembers.userId, user.id));
    const shared = await db
      .select({ module: moduleListColumns, role: schema.moduleCollaborators.role })
      .from(schema.moduleCollaborators)
      .innerJoin(
        schema.modules,
        eq(schema.modules.id, schema.moduleCollaborators.moduleId),
      )
      .where(eq(schema.moduleCollaborators.userId, user.id));

    const seen = new Set<string>();
    const all: (ReturnType<typeof toListItem> & { role: Role })[] = [];
    for (const m of personal) {
      if (seen.has(m.id)) continue;
      seen.add(m.id);
      all.push({ ...toListItem(m), role: 'owner' });
    }
    for (const { module, memberRole } of orgOwned) {
      if (seen.has(module.id)) continue;
      seen.add(module.id);
      all.push({ ...toListItem(module), role: memberRole === 'admin' ? 'owner' : 'editor' });
    }
    for (const { module, role } of shared) {
      if (seen.has(module.id)) continue;
      seen.add(module.id);
      all.push({ ...toListItem(module), role });
    }
    const shown = all.filter((m) => matchesOwner(m, filter, user.id));
    const ownerOf = await ownerLookup(shown);
    return { modules: shown.map((m) => ({ ...m, owner: ownerOf(m) })) };
  });

  // ---- get one module ---------------------------------------------------
  app.get<{ Params: { id: string } }>('/api/modules/:id', async (req, reply) => {
    const user = requireUser(req);
    const { role } = await resolveResourceRole(user.id, 'module', req.params.id);
    if (role === null) return reply.code(404).send({ error: 'not_found' });
    const module = await db
      .select(moduleListColumns)
      .from(schema.modules)
      .where(eq(schema.modules.id, req.params.id))
      .get();
    if (!module) return reply.code(404).send({ error: 'not_found' });
    return { module: toListItem(module), role };
  });

  // ---- create -----------------------------------------------------------
  app.post<{ Body: CreateModuleBody }>('/api/modules', async (req, reply) => {
    const user = requireUser(req);
    const body = req.body ?? {};
    const title = body.title?.trim() || 'Untitled Module';

    let ownerUserId: string | null = user.id;
    let ownerOrgId: string | null = null;
    if (body.orgSlug) {
      const org = await db
        .select({ id: schema.orgs.id })
        .from(schema.orgs)
        .where(eq(schema.orgs.slug, body.orgSlug.toLowerCase()))
        .get();
      if (!org) return reply.code(404).send({ error: 'org_not_found' });
      const membership = await db
        .select()
        .from(schema.orgMembers)
        .where(
          and(
            eq(schema.orgMembers.orgId, org.id),
            eq(schema.orgMembers.userId, user.id),
          ),
        )
        .get();
      if (!membership) return reply.code(403).send({ error: 'not_an_org_member' });
      ownerUserId = null;
      ownerOrgId = org.id;
    }

    const id = randomUUID();
    const now = new Date();
    // Seed an empty Y.Doc — same shape as a fresh layout. The editor's
    // module-snapshot endpoint then accepts updates.
    const doc = createLayoutDoc();
    const docBytes = encodeDoc(doc);

    await db.insert(schema.modules).values({
      id,
      title,
      ownerUserId,
      ownerOrgId,
      createdBy: user.id,
      docSnapshot: Buffer.from(docBytes),
      docVersion: 0,
      sidecarSnapshot: null,
      createdAt: now,
      updatedAt: now,
    });
    await writeAuditEvent({
      resourceKind: 'module',
      resourceId: id,
      userId: user.id,
      eventType: 'create',
      payload: { title, owner: ownerOrgId ? { kind: 'org', id: ownerOrgId } : { kind: 'user', id: user.id } },
    });
    return reply.code(201).send({ id, title });
  });

  // ---- copy to yourself or a club ----------------------------------------
  // Anyone who can open a module can copy it, into their own modules or a
  // club they're in (moving uses the transfer route).
  app.post<{ Params: { id: string }; Body: { orgSlug?: string; title?: string } }>(
    '/api/modules/:id/copy',
    async (req, reply) => {
      const user = requireUser(req);
      const { role } = await resolveResourceRole(user.id, 'module', req.params.id);
      if (role === null) return reply.code(404).send({ error: 'not_found' });
      const src = await db.select().from(schema.modules).where(eq(schema.modules.id, req.params.id)).get();
      if (!src) return reply.code(404).send({ error: 'not_found' });
      const dest = await destinationOrg(user.id, req.body?.orgSlug);
      if (!dest.ok) return reply.code(dest.code).send({ error: dest.error });
      const sameOwner = dest.orgId ? src.ownerOrgId === dest.orgId : src.ownerUserId === user.id;
      const title = req.body?.title?.trim() || (sameOwner ? `${src.title} (copy)` : src.title);
      const id = randomUUID();
      const now = new Date();
      await db.insert(schema.modules).values({
        id,
        title,
        ownerUserId: dest.orgId ? null : user.id,
        ownerOrgId: dest.orgId,
        createdBy: user.id,
        docSnapshot: src.docSnapshot,
        docVersion: 0,
        sidecarSnapshot: src.sidecarSnapshot,
        createdAt: now,
        updatedAt: now,
      });
      await writeAuditEvent({
        resourceKind: 'module',
        resourceId: id,
        userId: user.id,
        eventType: 'create',
        payload: { title, copiedFrom: src.id, owner: dest.orgId ? { kind: 'org', id: dest.orgId } : { kind: 'user', id: user.id } },
      });
      return reply.code(201).send({ id, title });
    },
  );

  // ---- patch (rename) ---------------------------------------------------
  app.patch<{ Params: { id: string }; Body: { title?: string } }>(
    '/api/modules/:id',
    async (req, reply) => {
      const user = requireUser(req);
      const { role } = await resolveResourceRole(user.id, 'module', req.params.id);
      if (role === null) return reply.code(404).send({ error: 'not_found' });
      if (!hasAtLeast(role, 'editor')) {
        return reply.code(403).send({ error: 'forbidden' });
      }
      const updates: Partial<typeof schema.modules.$inferInsert> = {};
      if (req.body.title !== undefined) {
        const t = req.body.title.trim();
        if (!t) return reply.code(400).send({ error: 'invalid_title' });
        updates.title = t;
      }
      if (Object.keys(updates).length === 0) {
        return reply.code(400).send({ error: 'no_updates' });
      }
      updates.updatedAt = new Date();
      await db.update(schema.modules).set(updates).where(eq(schema.modules.id, req.params.id));
      return { ok: true };
    },
  );

  // ---- delete -----------------------------------------------------------
  app.delete<{ Params: { id: string } }>('/api/modules/:id', async (req, reply) => {
    const user = requireUser(req);
    const { role } = await resolveResourceRole(user.id, 'module', req.params.id);
    if (role === null) return reply.code(404).send({ error: 'not_found' });
    if (!hasAtLeast(role, 'owner')) {
      return reply.code(403).send({ error: 'forbidden' });
    }
    await db.delete(schema.modules).where(eq(schema.modules.id, req.params.id));
    await writeAuditEvent({
      resourceKind: 'module',
      resourceId: req.params.id,
      userId: user.id,
      eventType: 'delete',
      payload: {},
    });
    return { ok: true };
  });

  // ---- snapshot (read) --------------------------------------------------
  app.get<{ Params: { id: string } }>('/api/modules/:id/snapshot', async (req, reply) => {
    const user = requireUser(req);
    const { role } = await resolveResourceRole(user.id, 'module', req.params.id);
    if (role === null) return reply.code(404).send({ error: 'not_found' });
    const module = await db
      .select()
      .from(schema.modules)
      .where(eq(schema.modules.id, req.params.id))
      .get();
    if (!module) return reply.code(404).send({ error: 'not_found' });
    reply.header('Content-Type', 'application/octet-stream');
    reply.header('X-Doc-Version', String(module.docVersion));
    return reply.send(Buffer.from(module.docSnapshot as Uint8Array));
  });

  // ---- snapshot (write, editor+) ----------------------------------------
  app.put<{ Params: { id: string } }>('/api/modules/:id/snapshot', async (req, reply) => {
    const user = requireUser(req);
    const { role } = await resolveResourceRole(user.id, 'module', req.params.id);
    if (role === null) return reply.code(404).send({ error: 'not_found' });
    if (!hasAtLeast(role, 'editor')) {
      return reply.code(403).send({ error: 'forbidden' });
    }
    const body = req.body;
    if (!body || !(body instanceof Buffer || body instanceof Uint8Array)) {
      return reply.code(400).send({ error: 'expected_binary_body' });
    }
    const bytes = body instanceof Buffer ? body : Buffer.from(body);
    if (bytes.length === 0) return reply.code(400).send({ error: 'empty_snapshot' });
    if (bytes.length > 50 * 1024 * 1024) {
      return reply.code(413).send({ error: 'snapshot_too_large' });
    }
    const updatedAt = new Date();
    const current = await db
      .select({ docVersion: schema.modules.docVersion })
      .from(schema.modules)
      .where(eq(schema.modules.id, req.params.id))
      .get();
    await db
      .update(schema.modules)
      .set({
        docSnapshot: bytes,
        docVersion: (current?.docVersion ?? 0) + 1,
        updatedAt,
      })
      .where(eq(schema.modules.id, req.params.id));
    return { ok: true, updatedAt: updatedAt.getTime() };
  });

  // ---- collaborators ----------------------------------------------------
  app.get<{ Params: { id: string } }>(
    '/api/modules/:id/collaborators',
    async (req, reply) => {
      const user = requireUser(req);
      const { role } = await resolveResourceRole(user.id, 'module', req.params.id);
      if (role === null) return reply.code(404).send({ error: 'not_found' });
      const collaborators = await db
        .select({
          userId: schema.moduleCollaborators.userId,
          role: schema.moduleCollaborators.role,
          addedAt: schema.moduleCollaborators.addedAt,
          email: schema.users.email,
          displayName: schema.users.displayName,
          avatarUrl: schema.users.avatarUrl,
        })
        .from(schema.moduleCollaborators)
        .innerJoin(schema.users, eq(schema.users.id, schema.moduleCollaborators.userId))
        .where(eq(schema.moduleCollaborators.moduleId, req.params.id));
      return {
        collaborators: collaborators.map((c) => ({
          userId: c.userId,
          role: c.role,
          addedAt: c.addedAt.getTime(),
          email: c.email,
          displayName: c.displayName,
          avatarUrl: c.avatarUrl,
        })),
      };
    },
  );

  app.post<{ Params: { id: string }; Body: InviteBody }>(
    '/api/modules/:id/invites',
    async (req, reply) => {
      const user = requireUser(req);
      if (user.isDemoAccount) {
        return reply.code(403).send({ error: 'demo_account_cannot_invite' });
      }
      const { role } = await resolveResourceRole(user.id, 'module', req.params.id);
      if (role === null) return reply.code(404).send({ error: 'not_found' });
      if (!hasAtLeast(role, 'owner')) {
        return reply.code(403).send({ error: 'forbidden' });
      }
      const { role: inviteRole } = req.body;
      const email = typeof req.body.email === 'string' ? normalizeEmail(req.body.email) : '';
      if (!isValidEmail(email)) {
        return reply.code(400).send({ error: 'invalid_email' });
      }
      if (inviteRole !== 'viewer' && inviteRole !== 'editor') {
        return reply.code(400).send({ error: 'invalid_role' });
      }
      // Same MVP shape as custom-part invites: immediate add for known
      // recipients. Token-based pending-accept lands in a follow-up.
      const recipient = await db
        .select()
        .from(schema.users)
        .where(sql`lower(${schema.users.email}) = ${email}`)
        .get();
      if (!recipient) {
        return reply.code(400).send({ error: 'recipient_not_registered' });
      }
      await db
        .insert(schema.moduleCollaborators)
        .values({
          moduleId: req.params.id,
          userId: recipient.id,
          role: inviteRole,
          addedAt: new Date(),
        })
        .onConflictDoNothing();
      await writeAuditEvent({
        resourceKind: 'module',
        resourceId: req.params.id,
        userId: user.id,
        eventType: 'share',
        payload: { targetUserId: recipient.id, role: inviteRole },
      });
      return { added: true };
    },
  );

  app.delete<{ Params: { id: string; userId: string } }>(
    '/api/modules/:id/collaborators/:userId',
    async (req, reply) => {
      const user = requireUser(req);
      const { role } = await resolveResourceRole(user.id, 'module', req.params.id);
      if (role === null) return reply.code(404).send({ error: 'not_found' });
      const isSelf = req.params.userId === user.id;
      if (!isSelf && !hasAtLeast(role, 'owner')) {
        return reply.code(403).send({ error: 'forbidden' });
      }
      await db
        .delete(schema.moduleCollaborators)
        .where(
          and(
            eq(schema.moduleCollaborators.moduleId, req.params.id),
            eq(schema.moduleCollaborators.userId, req.params.userId),
          ),
        );
      await writeAuditEvent({
        resourceKind: 'module',
        resourceId: req.params.id,
        userId: user.id,
        eventType: 'unshare',
        payload: { targetUserId: req.params.userId, selfRemoved: isSelf },
      });
      return { ok: true };
    },
  );
}

const moduleListColumns = {
  id: schema.modules.id,
  title: schema.modules.title,
  ownerUserId: schema.modules.ownerUserId,
  ownerOrgId: schema.modules.ownerOrgId,
  docVersion: schema.modules.docVersion,
  hasSidecar: sql<number>`${schema.modules.sidecarSnapshot} IS NOT NULL`,
  createdAt: schema.modules.createdAt,
  updatedAt: schema.modules.updatedAt,
};

function toListItem(
  m: Pick<
    typeof schema.modules.$inferSelect,
    'id' | 'title' | 'ownerUserId' | 'ownerOrgId' | 'docVersion' | 'createdAt' | 'updatedAt'
  > & { hasSidecar: number },
) {
  return {
    id: m.id,
    title: m.title,
    ownerUserId: m.ownerUserId,
    ownerOrgId: m.ownerOrgId,
    docVersion: m.docVersion,
    hasSidecar: Boolean(m.hasSidecar),
    createdAt: m.createdAt.getTime(),
    updatedAt: m.updatedAt.getTime(),
  };
}

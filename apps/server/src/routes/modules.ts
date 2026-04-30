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
import { and, eq } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { requireUser } from '../auth/cookie.js';
import { hasAtLeast, resolveResourceRole, type Role } from '../access/resolveResourceRole.js';
import { createLayoutDoc, encodeDoc } from '@cld/ydoc';
import { writeAuditEvent } from '../audit/writeAuditEvent.js';
import { isValidEmail } from '../utils/validate.js';

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
  app.get('/api/modules', async (req) => {
    const user = requireUser(req);
    const personal = await db
      .select()
      .from(schema.modules)
      .where(eq(schema.modules.ownerUserId, user.id));
    const orgOwned = await db
      .select({ module: schema.modules })
      .from(schema.orgMembers)
      .innerJoin(
        schema.modules,
        eq(schema.modules.ownerOrgId, schema.orgMembers.orgId),
      )
      .where(eq(schema.orgMembers.userId, user.id));
    const shared = await db
      .select({ module: schema.modules })
      .from(schema.moduleCollaborators)
      .innerJoin(
        schema.modules,
        eq(schema.modules.id, schema.moduleCollaborators.moduleId),
      )
      .where(eq(schema.moduleCollaborators.userId, user.id));

    const seen = new Set<string>();
    const all: ReturnType<typeof toListItem>[] = [];
    for (const m of personal) {
      if (seen.has(m.id)) continue;
      seen.add(m.id);
      all.push(toListItem(m));
    }
    for (const { module } of orgOwned) {
      if (seen.has(module.id)) continue;
      seen.add(module.id);
      all.push(toListItem(module));
    }
    for (const { module } of shared) {
      if (seen.has(module.id)) continue;
      seen.add(module.id);
      all.push(toListItem(module));
    }
    return { modules: all };
  });

  // ---- get one module ---------------------------------------------------
  app.get<{ Params: { id: string } }>('/api/modules/:id', async (req, reply) => {
    const user = requireUser(req);
    const { role } = await resolveResourceRole(user.id, 'module', req.params.id);
    if (role === null) return reply.code(404).send({ error: 'not_found' });
    const module = await db
      .select()
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
      const { email, role: inviteRole } = req.body;
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
        .where(eq(schema.users.email, email))
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

function toListItem(m: typeof schema.modules.$inferSelect) {
  return {
    id: m.id,
    title: m.title,
    ownerUserId: m.ownerUserId,
    ownerOrgId: m.ownerOrgId,
    docVersion: m.docVersion,
    hasSidecar: m.sidecarSnapshot !== null,
    createdAt: m.createdAt.getTime(),
    updatedAt: m.updatedAt.getTime(),
  };
}

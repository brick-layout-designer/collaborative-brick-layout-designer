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
import { checkGrowth, type Subject } from '../limits/limits.js';
import { requireUser } from '../auth/cookie.js';
import { hasAtLeast, resolveResourceRole, type Role } from '../access/resolveResourceRole.js';
import { createDefaultLayoutDoc, encodeDoc } from '@cld/ydoc';
import { writeAuditEvent } from '../audit/writeAuditEvent.js';
import { destinationOrg, matchesOwner, ownerLookup, resolveOwnerFilter } from './owners.js';
import { isValidEmail, normalizeEmail } from '../utils/validate.js';
import { clubModuleRole } from '../access/resolveResourceRole.js';

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
      .select({ module: moduleListColumns, memberRole: schema.orgMembers.role, membersCanCreate: schema.orgs.membersCanCreate })
      .from(schema.orgMembers)
      .innerJoin(
        schema.modules,
        eq(schema.modules.ownerOrgId, schema.orgMembers.orgId),
      )
      .innerJoin(schema.orgs, eq(schema.orgs.id, schema.orgMembers.orgId))
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
    for (const { module, memberRole, membersCanCreate } of orgOwned) {
      if (seen.has(module.id)) continue;
      seen.add(module.id);
      all.push({ ...toListItem(module), role: clubModuleRole(memberRole, membersCanCreate) });
    }
    for (const { module, role } of shared) {
      const i = all.findIndex((m) => m.id === module.id);
      // A share can give a club member more than the club does.
      if (i >= 0 && hasAtLeast(role, all[i]!.role) && role !== all[i]!.role) all[i] = { ...all[i]!, role };
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

    const dest = await destinationOrg(user.id, body.orgSlug);
    if (!dest.ok) return reply.code(dest.code).send({ error: dest.error });
    const ownerUserId: string | null = dest.orgId ? null : user.id;
    const ownerOrgId: string | null = dest.orgId;

    const id = randomUUID();
    const now = new Date();
    // Seed a fresh layout's doc (grid + one empty brick layer), so the
    // module editor opens ready for parts. The snapshot PUT saves edits.
    const doc = createDefaultLayoutDoc();
    const docBytes = encodeDoc(doc);
    const owner: Subject = ownerOrgId ? { kind: 'org', id: ownerOrgId } : { kind: 'user', id: user.id };
    const refusal = await checkGrowth({ actor: user, owner, add: { bytes: docBytes.length } });
    if (refusal) return reply.code(refusal.status).send(refusal.body);

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
      const copyOwner: Subject = dest.orgId ? { kind: 'org', id: dest.orgId } : { kind: 'user', id: user.id };
      const copyBytes = (src.docSnapshot as Uint8Array).length + ((src.sidecarSnapshot as Uint8Array | null)?.length ?? 0);
      const refusal = await checkGrowth({ actor: user, owner: copyOwner, add: { bytes: copyBytes } });
      if (refusal) return reply.code(refusal.status).send(refusal.body);
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
      .select({
        docVersion: schema.modules.docVersion,
        ownerUserId: schema.modules.ownerUserId,
        ownerOrgId: schema.modules.ownerOrgId,
        bytes: sql<number>`length(${schema.modules.docSnapshot})`.mapWith(Number),
      })
      .from(schema.modules)
      .where(eq(schema.modules.id, req.params.id))
      .get();
    if (current) {
      const owner: Subject = current.ownerOrgId ? { kind: 'org', id: current.ownerOrgId } : { kind: 'user', id: current.ownerUserId ?? user.id };
      const refusal = await checkGrowth({ actor: user, owner, add: { bytes: bytes.length - current.bytes }, uploadBytes: bytes.length });
      if (refusal) return reply.code(refusal.status).send(refusal.body);
    }
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

  // ---- thumbnail ----------------------------------------------------------
  // The editor makes a small picture of the module when it's saved (or first
  // opened) and sends it here as base64 in JSON: the site's firewall only
  // lets octet-stream through on the two snapshot routes.
  app.put<{ Params: { id: string }; Body: { mime?: unknown; data?: unknown } }>(
    '/api/modules/:id/thumbnail',
    { bodyLimit: 1024 * 1024 },
    async (req, reply) => {
      const user = requireUser(req);
      const { role } = await resolveResourceRole(user.id, 'module', req.params.id);
      if (role === null) return reply.code(404).send({ error: 'not_found' });
      if (!hasAtLeast(role, 'editor')) return reply.code(403).send({ error: 'forbidden' });
      const mime = req.body?.mime;
      const data = req.body?.data;
      if ((mime !== 'image/png' && mime !== 'image/webp') || typeof data !== 'string' || !BASE64_RE.test(data)) {
        return reply.code(400).send({ error: 'invalid_thumbnail' });
      }
      const bytes = Buffer.from(data, 'base64');
      if (bytes.length === 0 || !looksLike(bytes, mime)) return reply.code(400).send({ error: 'invalid_thumbnail' });
      if (bytes.length > MAX_THUMBNAIL_BYTES) return reply.code(413).send({ error: 'thumbnail_too_large' });
      const current = await db
        .select({
          ownerUserId: schema.modules.ownerUserId,
          ownerOrgId: schema.modules.ownerOrgId,
          bytes: sql<number>`coalesce(length(${schema.modules.thumbnail}), 0)`.mapWith(Number),
        })
        .from(schema.modules)
        .where(eq(schema.modules.id, req.params.id))
        .get();
      if (!current) return reply.code(404).send({ error: 'not_found' });
      const owner: Subject = current.ownerOrgId ? { kind: 'org', id: current.ownerOrgId } : { kind: 'user', id: current.ownerUserId ?? user.id };
      const refusal = await checkGrowth({ actor: user, owner, add: { bytes: bytes.length - current.bytes }, uploadBytes: bytes.length });
      if (refusal) return reply.code(refusal.status).send(refusal.body);
      const thumbnailAt = new Date();
      await db
        .update(schema.modules)
        .set({ thumbnail: bytes, thumbnailMime: mime, thumbnailAt })
        .where(eq(schema.modules.id, req.params.id));
      return { ok: true, thumbnailAt: thumbnailAt.getTime() };
    },
  );

  app.get<{ Params: { id: string } }>('/api/modules/:id/thumbnail', async (req, reply) => {
    const user = requireUser(req);
    const { role } = await resolveResourceRole(user.id, 'module', req.params.id);
    if (role === null) return reply.code(404).send({ error: 'not_found' });
    const row = await db
      .select({ thumbnail: schema.modules.thumbnail, mime: schema.modules.thumbnailMime, at: schema.modules.thumbnailAt })
      .from(schema.modules)
      .where(eq(schema.modules.id, req.params.id))
      .get();
    if (!row?.thumbnail || !row.mime) return reply.code(404).send({ error: 'no_thumbnail' });
    // The list links it as ?v=<thumbnailAt>, so a new picture is a new URL.
    const etag = `"${row.at?.getTime() ?? 0}"`;
    reply.header('Cache-Control', 'private, max-age=86400');
    reply.header('ETag', etag);
    if (req.headers['if-none-match'] === etag) return reply.code(304).send();
    reply.header('Content-Type', row.mime);
    reply.header('X-Content-Type-Options', 'nosniff');
    return reply.send(Buffer.from(row.thumbnail as Uint8Array));
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

/** A module picture is small: about 256 px, a few tens of KB. */
export const MAX_THUMBNAIL_BYTES = 512 * 1024;
const BASE64_RE = /^[A-Za-z0-9+/]+={0,2}$/;

/** The file really is the picture type it says it is. */
function looksLike(bytes: Buffer, mime: 'image/png' | 'image/webp'): boolean {
  if (mime === 'image/png') return bytes.length > 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  return bytes.length > 12 && bytes.toString('latin1', 0, 4) === 'RIFF' && bytes.toString('latin1', 8, 12) === 'WEBP';
}

const moduleListColumns = {
  id: schema.modules.id,
  title: schema.modules.title,
  ownerUserId: schema.modules.ownerUserId,
  ownerOrgId: schema.modules.ownerOrgId,
  docVersion: schema.modules.docVersion,
  hasSidecar: sql<number>`${schema.modules.sidecarSnapshot} IS NOT NULL`,
  thumbnailAt: schema.modules.thumbnailAt,
  createdAt: schema.modules.createdAt,
  updatedAt: schema.modules.updatedAt,
};

function toListItem(
  m: Pick<
    typeof schema.modules.$inferSelect,
    'id' | 'title' | 'ownerUserId' | 'ownerOrgId' | 'docVersion' | 'thumbnailAt' | 'createdAt' | 'updatedAt'
  > & { hasSidecar: number },
) {
  return {
    id: m.id,
    title: m.title,
    ownerUserId: m.ownerUserId,
    ownerOrgId: m.ownerOrgId,
    docVersion: m.docVersion,
    hasSidecar: Boolean(m.hasSidecar),
    /** When the picture was made (its cache key), or null: show a placeholder. */
    thumbnailAt: m.thumbnailAt ? m.thumbnailAt.getTime() : null,
    createdAt: m.createdAt.getTime(),
    updatedAt: m.updatedAt.getTime(),
  };
}

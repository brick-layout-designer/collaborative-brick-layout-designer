import { randomUUID } from 'node:crypto';
import { Buffer } from 'node:buffer';
import type { FastifyInstance } from 'fastify';
import { and, eq, isNull, or } from 'drizzle-orm';
import { readBbm, readSidecar, writeBbm, writeSidecar } from '@cld/bbm';
import { decodeDoc, encodeDoc, exportBbmFromDoc, exportSidecarFromDoc, seedFromBbm, seedFromSidecar } from '@cld/ydoc';
import { db, schema } from '../db/index.js';
import { requireUser } from '../auth/cookie.js';
import { hasAtLeast, resolveResourceRole } from '../access/resolveResourceRole.js';

interface CreateLayoutBody {
  title?: string;
  /** Optional `.bbm` XML payload to seed the new layout from. */
  bbm?: string;
  /** Optional `.bbm.cld` JSON payload to seed the sidecar. */
  sidecar?: string;
  /**
   * If provided, the new layout is org-owned. The caller must be a
   * member of the org. Mutually exclusive with personal ownership.
   * Demo accounts cannot create org-owned layouts (they can't join orgs
   * without being invited; if they ARE invited, they can still create).
   */
  orgSlug?: string;
}

interface PatchLayoutBody {
  title?: string;
}

export async function layoutRoutes(app: FastifyInstance) {
  // Accept raw octet-stream bodies (binary Y.Doc snapshots). Without this,
  // Fastify rejects PUT /api/layouts/:id/snapshot with 415. The 50MB ceiling
  // matches the docSnapshot size limit enforced in the handler.
  if (!app.hasContentTypeParser('application/octet-stream')) {
    app.addContentTypeParser(
      'application/octet-stream',
      { parseAs: 'buffer', bodyLimit: 50 * 1024 * 1024 },
      (_req, body, done) => done(null, body),
    );
  }

  // ---- list ----------------------------------------------------------------
  app.get('/api/layouts', async (req) => {
    const user = requireUser(req);
    // Three sources of layouts the user can see:
    //   1. ownerUserId === user.id          (personal)
    //   2. ownerOrgId joined to org_members (org-owned where they're a member)
    //   3. layout_collaborators row         (explicitly shared)
    // Dedupe by id since 2 and 3 can overlap (an org member who also has
    // an explicit per-user share). Set keyed by id wins.
    const personal = await db
      .select()
      .from(schema.layouts)
      .where(eq(schema.layouts.ownerUserId, user.id));
    const orgOwned = await db
      .select({ layout: schema.layouts })
      .from(schema.orgMembers)
      .innerJoin(schema.layouts, eq(schema.layouts.ownerOrgId, schema.orgMembers.orgId))
      .where(eq(schema.orgMembers.userId, user.id));
    const shared = await db
      .select({ layout: schema.layouts })
      .from(schema.layoutCollaborators)
      .innerJoin(schema.layouts, eq(schema.layouts.id, schema.layoutCollaborators.layoutId))
      .where(eq(schema.layoutCollaborators.userId, user.id));

    const seen = new Set<string>();
    const all: ReturnType<typeof toListItem>[] = [];
    for (const l of personal) {
      if (seen.has(l.id)) continue;
      seen.add(l.id);
      all.push(toListItem(l));
    }
    for (const { layout } of orgOwned) {
      if (seen.has(layout.id)) continue;
      seen.add(layout.id);
      all.push(toListItem(layout));
    }
    for (const { layout } of shared) {
      if (seen.has(layout.id)) continue;
      seen.add(layout.id);
      all.push(toListItem(layout));
    }
    return { layouts: all };
  });

  // ---- get -----------------------------------------------------------------
  app.get<{ Params: { id: string } }>('/api/layouts/:id', async (req, reply) => {
    const user = requireUser(req);
    const role = await resolveResourceRole(user.id, 'layout', req.params.id);
    if (!hasAtLeast(role.role, 'viewer')) return reply.code(404).send({ error: 'not_found' });

    const layout = await db
      .select()
      .from(schema.layouts)
      .where(eq(schema.layouts.id, req.params.id))
      .get();
    if (!layout) return reply.code(404).send({ error: 'not_found' });

    return {
      layout: toListItem(layout),
      role: role.role,
    };
  });

  // ---- create --------------------------------------------------------------
  app.post<{ Body: CreateLayoutBody }>('/api/layouts', async (req, reply) => {
    const user = requireUser(req);
    const body = req.body ?? {};

    let title = body.title?.trim() || 'Untitled Layout';
    let docSnapshot: Uint8Array;
    let sidecarSnapshot: Uint8Array | null = null;

    if (body.bbm) {
      try {
        const parsed = readBbm(body.bbm);
        // If no title was provided, derive one from the .bbm metadata —
        // either the LUG/Event line or fall back to default.
        if (!body.title?.trim() && parsed.map.event) title = parsed.map.event;
        docSnapshot = encodeDoc(seedFromBbm(parsed.map));
      } catch (e) {
        return reply.code(400).send({ error: 'bbm_parse_failed', detail: (e as Error).message });
      }
    } else {
      // Fresh empty doc.
      const { createLayoutDoc } = await import('@cld/ydoc');
      docSnapshot = encodeDoc(createLayoutDoc());
    }

    if (body.sidecar) {
      try {
        const parsed = readSidecar(body.sidecar);
        sidecarSnapshot = encodeDoc(seedFromSidecar(parsed));
      } catch (e) {
        return reply.code(400).send({ error: 'sidecar_parse_failed', detail: (e as Error).message });
      }
    }

    // Resolve owner — personal by default, or an org if `orgSlug` provided.
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
        .select({ role: schema.orgMembers.role })
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
    // Demo TTL only applies to user-owned layouts; org layouts persist
    // until an admin deletes them.
    const expiresAt =
      user.isDemoAccount && ownerUserId
        ? new Date(now.getTime() + Number(process.env.DEMO_LAYOUT_TTL_DAYS ?? 30) * 86400_000)
        : null;

    await db.insert(schema.layouts).values({
      id,
      title,
      ownerUserId,
      ownerOrgId,
      createdBy: user.id,
      createdAt: now,
      updatedAt: now,
      expiresAt,
      docSnapshot: Buffer.from(docSnapshot),
      docVersion: 0,
      sidecarSnapshot: sidecarSnapshot ? Buffer.from(sidecarSnapshot) : null,
    });

    return reply.code(201).send({ id, title });
  });

  // ---- patch (rename) ------------------------------------------------------
  app.patch<{ Params: { id: string }; Body: PatchLayoutBody }>(
    '/api/layouts/:id',
    async (req, reply) => {
      const user = requireUser(req);
      const role = await resolveResourceRole(user.id, 'layout', req.params.id);
      // No access at all → 404 (existence-leak protection). Insufficient
      // role (e.g. viewer can't rename) → 403, because the caller already
      // knows the resource exists.
      if (role.role === null) return reply.code(404).send({ error: 'not_found' });
      if (!hasAtLeast(role.role, 'editor')) return reply.code(403).send({ error: 'forbidden' });

      const updates: Partial<typeof schema.layouts.$inferInsert> = {};
      if (req.body.title !== undefined) {
        const t = req.body.title.trim();
        if (!t) return reply.code(400).send({ error: 'invalid_title' });
        updates.title = t;
      }
      if (Object.keys(updates).length === 0) {
        return reply.code(400).send({ error: 'no_updates' });
      }
      updates.updatedAt = new Date();
      await db.update(schema.layouts).set(updates).where(eq(schema.layouts.id, req.params.id));
      return { ok: true };
    },
  );

  // ---- delete --------------------------------------------------------------
  app.delete<{ Params: { id: string } }>('/api/layouts/:id', async (req, reply) => {
    const user = requireUser(req);
    const role = await resolveResourceRole(user.id, 'layout', req.params.id);
    if (role.role === null) return reply.code(404).send({ error: 'not_found' });
    if (!hasAtLeast(role.role, 'owner')) return reply.code(403).send({ error: 'forbidden' });

    await db.delete(schema.layouts).where(eq(schema.layouts.id, req.params.id));
    return { ok: true };
  });

  // ---- export (.bbm) -------------------------------------------------------
  app.get<{ Params: { id: string } }>('/api/layouts/:id/export.bbm', async (req, reply) => {
    const user = requireUser(req);
    const role = await resolveResourceRole(user.id, 'layout', req.params.id);
    if (!hasAtLeast(role.role, 'viewer')) return reply.code(404).send({ error: 'not_found' });

    const layout = await db
      .select()
      .from(schema.layouts)
      .where(eq(schema.layouts.id, req.params.id))
      .get();
    if (!layout) return reply.code(404).send({ error: 'not_found' });

    const doc = decodeDoc(layout.docSnapshot as Uint8Array);
    const map = exportBbmFromDoc(doc);
    if (!map) {
      // The doc was authored in-app and there's no cached BbmMap yet.
      // Phase 3 fills this in once the editor mutates the Yjs structure
      // directly. For Phase 2, we only export what was imported.
      return reply.code(400).send({ error: 'export_unavailable_for_in_app_layout' });
    }
    const xml = writeBbm(map, { recomputeNbItems: false });
    reply.header('Content-Type', 'application/xml; charset=utf-8');
    reply.header(
      'Content-Disposition',
      `attachment; filename="${sanitizeFilename(layout.title)}.bbm"`,
    );
    return reply.send(xml);
  });

  // ---- snapshot (binary Y.Doc) --------------------------------------------
  // The editor reads this on /editor/:id load and writes it back on save.
  // Bytes are the y-update format; the server is dumb about doc internals.
  app.get<{ Params: { id: string } }>('/api/layouts/:id/snapshot', async (req, reply) => {
    const user = requireUser(req);
    const role = await resolveResourceRole(user.id, 'layout', req.params.id);
    if (!hasAtLeast(role.role, 'viewer')) return reply.code(404).send({ error: 'not_found' });

    const layout = await db
      .select()
      .from(schema.layouts)
      .where(eq(schema.layouts.id, req.params.id))
      .get();
    if (!layout) return reply.code(404).send({ error: 'not_found' });

    reply.header('Content-Type', 'application/octet-stream');
    reply.header('X-Doc-Version', String(layout.docVersion));
    return reply.send(Buffer.from(layout.docSnapshot as Uint8Array));
  });

  // PUT replaces the snapshot wholesale. Phase 4 (realtime) replaces this
  // with an incremental y-update protocol over WebSocket; for Phase 3 the
  // single-user editor just persists the full doc on save.
  app.put<{ Params: { id: string } }>('/api/layouts/:id/snapshot', async (req, reply) => {
    const user = requireUser(req);
    const role = await resolveResourceRole(user.id, 'layout', req.params.id);
    // No role at all → 404 (existence-leak protection). Has a role but not
    // editor (e.g. viewer) → 403, because the user already knows the
    // resource exists.
    if (role.role === null) return reply.code(404).send({ error: 'not_found' });
    if (!hasAtLeast(role.role, 'editor')) return reply.code(403).send({ error: 'forbidden' });

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
    await db
      .update(schema.layouts)
      .set({
        docSnapshot: bytes,
        docVersion: (await currentVersion(req.params.id)) + 1,
        updatedAt,
      })
      .where(eq(schema.layouts.id, req.params.id));
    return { ok: true, updatedAt: updatedAt.getTime() };
  });

  // ---- export (.bbm.cld) ---------------------------------------------------
  app.get<{ Params: { id: string } }>('/api/layouts/:id/export.bbm.cld', async (req, reply) => {
    const user = requireUser(req);
    const role = await resolveResourceRole(user.id, 'layout', req.params.id);
    if (!hasAtLeast(role.role, 'viewer')) return reply.code(404).send({ error: 'not_found' });

    const layout = await db
      .select()
      .from(schema.layouts)
      .where(eq(schema.layouts.id, req.params.id))
      .get();
    if (!layout || !layout.sidecarSnapshot) {
      return reply.code(404).send({ error: 'no_sidecar' });
    }
    const doc = decodeDoc(layout.sidecarSnapshot as Uint8Array);
    const sidecar = exportSidecarFromDoc(doc);
    if (!sidecar) return reply.code(404).send({ error: 'no_sidecar' });
    const json = writeSidecar(sidecar);
    reply.header('Content-Type', 'application/json; charset=utf-8');
    reply.header(
      'Content-Disposition',
      `attachment; filename="${sanitizeFilename(layout.title)}.bbm.cld"`,
    );
    return reply.send(json);
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toListItem(l: typeof schema.layouts.$inferSelect) {
  return {
    id: l.id,
    title: l.title,
    ownerUserId: l.ownerUserId,
    ownerOrgId: l.ownerOrgId,
    createdAt: l.createdAt,
    updatedAt: l.updatedAt,
    expiresAt: l.expiresAt,
    docVersion: l.docVersion,
    hasSidecar: l.sidecarSnapshot !== null,
  };
}

async function currentVersion(layoutId: string): Promise<number> {
  const row = await db
    .select({ docVersion: schema.layouts.docVersion })
    .from(schema.layouts)
    .where(eq(schema.layouts.id, layoutId))
    .get();
  return row?.docVersion ?? 0;
}

function sanitizeFilename(s: string): string {
  // Strip path-traversal characters and trim. Falls back if the entire
  // name is non-printable.
  const cleaned = s.replace(/[\\/:*?"<>|\x00-\x1F]+/g, '_').trim();
  return cleaned.length > 0 ? cleaned.slice(0, 80) : 'layout';
}

// Silence the unused-import: `or`/`isNull` are reserved for the org-join
// query that lands in Phase 6. Importing them here keeps the future diff
// small.
void or;
void isNull;
void and;

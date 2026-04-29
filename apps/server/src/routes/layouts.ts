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
}

interface PatchLayoutBody {
  title?: string;
}

export async function layoutRoutes(app: FastifyInstance) {
  // ---- list ----------------------------------------------------------------
  app.get('/api/layouts', async (req) => {
    const user = requireUser(req);
    // Layouts the user owns + layouts they collaborate on. Org-owned layouts
    // (where user is a member) are not yet listed here — Phase 6 wires the
    // org-membership join. Phase-2 scope: personal layouts only.
    const personal = await db
      .select()
      .from(schema.layouts)
      .where(eq(schema.layouts.ownerUserId, user.id));
    const shared = await db
      .select({ layout: schema.layouts })
      .from(schema.layoutCollaborators)
      .innerJoin(schema.layouts, eq(schema.layouts.id, schema.layoutCollaborators.layoutId))
      .where(eq(schema.layoutCollaborators.userId, user.id));

    const all = [
      ...personal.map(toListItem),
      ...shared.map((s) => toListItem(s.layout)),
    ];
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

    const id = randomUUID();
    const now = new Date();
    const expiresAt = user.isDemoAccount
      ? new Date(now.getTime() + Number(process.env.DEMO_LAYOUT_TTL_DAYS ?? 30) * 86400_000)
      : null;

    await db.insert(schema.layouts).values({
      id,
      title,
      ownerUserId: user.id,
      ownerOrgId: null,
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

import { randomUUID } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { createWriteStream, createReadStream, existsSync } from 'node:fs';
import { mkdir, unlink } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { FastifyInstance } from 'fastify';
import { and, eq, isNull, or } from 'drizzle-orm';
import { readBbm, readSidecar, writeBbm, writeSidecar } from '@cld/bbm';
import { createDefaultLayoutDoc, decodeDoc, encodeDoc, exportBbmFromDoc, exportSidecarFromDoc, seedFromBbm, seedFromSidecar } from '@cld/ydoc';
import { db, schema } from '../db/index.js';
import { requireUser } from '../auth/cookie.js';
import { hasAtLeast, resolveResourceRole } from '../access/resolveResourceRole.js';
import { env } from '../env.js';

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
      docSnapshot = encodeDoc(createDefaultLayoutDoc());
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
        ? new Date(now.getTime() + env.demoLayoutTtlDays * 86400_000)
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

  // ---- export (.zip — .bbm + optional .bbm.cld bundled together) ----------
  // Single-download equivalent of the two separate export routes above.
  // The .bbm.cld entry is omitted when the layout has no sidecar.
  app.get<{ Params: { id: string } }>('/api/layouts/:id/export.zip', async (req, reply) => {
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
    if (!map) return reply.code(400).send({ error: 'export_unavailable_for_in_app_layout' });

    const safe = sanitizeFilename(layout.title);
    const entries: { name: string; data: Buffer }[] = [];

    const xml = writeBbm(map, { recomputeNbItems: false });
    entries.push({ name: `${safe}.bbm`, data: Buffer.from(xml, 'utf8') });

    if (layout.sidecarSnapshot) {
      const sidecarDoc = decodeDoc(layout.sidecarSnapshot as Uint8Array);
      const sidecar = exportSidecarFromDoc(sidecarDoc);
      if (sidecar) {
        const json = writeSidecar(sidecar);
        entries.push({ name: `${safe}.bbm.cld`, data: Buffer.from(json, 'utf8') });
      }
    }

    const zip = buildZip(entries);
    reply.header('Content-Type', 'application/zip');
    reply.header('Content-Disposition', `attachment; filename="${safe}.zip"`);
    return reply.send(zip);
  });

  // ---- public share: enable -----------------------------------------------
  // Owner-only. Mints a fresh random token and stores it on the layout.
  // Anyone with the token URL (`/p/:token`) can read the layout without
  // signing in. Re-enabling on an already-shared layout returns the
  // existing token (idempotent) so the share UI doesn't accidentally
  // rotate the link on every click.
  app.post<{ Params: { id: string } }>('/api/layouts/:id/public-share', async (req, reply) => {
    const user = requireUser(req);
    const role = await resolveResourceRole(user.id, 'layout', req.params.id);
    if (role.role === null) return reply.code(404).send({ error: 'not_found' });
    if (!hasAtLeast(role.role, 'owner')) return reply.code(403).send({ error: 'forbidden' });

    const layout = await db
      .select()
      .from(schema.layouts)
      .where(eq(schema.layouts.id, req.params.id))
      .get();
    if (!layout) return reply.code(404).send({ error: 'not_found' });

    let token = layout.publicShareToken;
    if (!token) {
      // 32 hex chars (16 bytes) is plenty for a public-share secret —
      // collision search is infeasible and the URL stays compact.
      token = randomUUID().replaceAll('-', '');
      await db
        .update(schema.layouts)
        .set({ publicShareToken: token })
        .where(eq(schema.layouts.id, req.params.id));
    }
    return reply.send({ token });
  });

  // ---- public share: disable ----------------------------------------------
  app.delete<{ Params: { id: string } }>('/api/layouts/:id/public-share', async (req, reply) => {
    const user = requireUser(req);
    const role = await resolveResourceRole(user.id, 'layout', req.params.id);
    if (role.role === null) return reply.code(404).send({ error: 'not_found' });
    if (!hasAtLeast(role.role, 'owner')) return reply.code(403).send({ error: 'forbidden' });

    await db
      .update(schema.layouts)
      .set({ publicShareToken: null })
      .where(eq(schema.layouts.id, req.params.id));
    return { ok: true };
  });

  // ---- public viewer: metadata --------------------------------------------
  // Anonymous endpoint. Looks up a layout by its public share token.
  // Returns the same summary shape as authenticated GET /api/layouts/:id,
  // minus owner identifiers (the public viewer doesn't need to know who
  // owns the layout — just title + version + a way to fetch bytes).
  app.get<{ Params: { token: string } }>('/api/public-layouts/:token', async (req, reply) => {
    const layout = await db
      .select()
      .from(schema.layouts)
      .where(eq(schema.layouts.publicShareToken, req.params.token))
      .get();
    if (!layout) return reply.code(404).send({ error: 'not_found' });
    reply.header('Cache-Control', 'no-store');
    return {
      layout: {
        id: layout.id,
        title: layout.title,
        updatedAt: layout.updatedAt,
        docVersion: layout.docVersion,
        hasSidecar: layout.sidecarSnapshot !== null,
      },
    };
  });

  // ---- background image: upload -------------------------------------------
  // Editor-role required. Stores the uploaded image as a file under
  // `<data>/bgimages/<layoutId>.<ext>`. Returns the serve URL.
  // 10 MB ceiling; accepted types: image/jpeg, image/png, image/gif, image/webp.
  app.post<{ Params: { id: string } }>(
    '/api/layouts/:id/background-image',
    { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const user = requireUser(req);
      if (!/^[0-9a-f-]{36}$/.test(req.params.id)) return reply.code(400).send({ error: 'invalid_id' });
      const role = await resolveResourceRole(user.id, 'layout', req.params.id);
      if (!hasAtLeast(role.role, 'editor')) return reply.code(403).send({ error: 'forbidden' });

      const data = await req.file({ limits: { fileSize: 10 * 1024 * 1024 } });
      if (!data) return reply.code(400).send({ error: 'no_file' });

      const mime = data.mimetype ?? '';
      const ext = mime === 'image/jpeg' ? 'jpg'
        : mime === 'image/png' ? 'png'
        : mime === 'image/gif' ? 'gif'
        : mime === 'image/webp' ? 'webp'
        : null;
      if (!ext) {
        await data.file.resume();
        return reply.code(415).send({ error: 'unsupported_image_type' });
      }

      const bgDir = join(dirname(env.dbPath), 'bgimages');
      await mkdir(bgDir, { recursive: true });
      const filename = `${req.params.id}.${ext}`;
      const dest = join(bgDir, filename);
      await pipeline(data.file, createWriteStream(dest));
      const url = `/api/layouts/${req.params.id}/background-image`;
      return { url };
    },
  );

  // ---- background image: serve --------------------------------------------
  app.get<{ Params: { id: string } }>(
    '/api/layouts/:id/background-image',
    { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const user = requireUser(req);
      if (!/^[0-9a-f-]{36}$/.test(req.params.id)) return reply.code(400).send({ error: 'invalid_id' });
      const role = await resolveResourceRole(user.id, 'layout', req.params.id);
      if (!hasAtLeast(role.role, 'viewer')) return reply.code(404).send({ error: 'not_found' });

      const bgDir = join(dirname(env.dbPath), 'bgimages');
      for (const ext of ['png', 'jpg', 'gif', 'webp']) {
        const p = join(bgDir, `${req.params.id}.${ext}`);
        if (existsSync(p)) {
          const mime = ext === 'jpg' ? 'image/jpeg' : `image/${ext}`;
          reply.header('Content-Type', mime);
          reply.header('Cache-Control', 'private, max-age=3600');
          return reply.send(createReadStream(p));
        }
      }
      return reply.code(404).send({ error: 'not_found' });
    },
  );

  // ---- background image: delete -------------------------------------------
  app.delete<{ Params: { id: string } }>(
    '/api/layouts/:id/background-image',
    { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const user = requireUser(req);
      if (!/^[0-9a-f-]{36}$/.test(req.params.id)) return reply.code(400).send({ error: 'invalid_id' });
      const role = await resolveResourceRole(user.id, 'layout', req.params.id);
      if (!hasAtLeast(role.role, 'editor')) return reply.code(403).send({ error: 'forbidden' });

      const bgDir = join(dirname(env.dbPath), 'bgimages');
      for (const ext of ['png', 'jpg', 'gif', 'webp']) {
        const p = join(bgDir, `${req.params.id}.${ext}`);
        if (existsSync(p)) { await unlink(p); break; }
      }
      return { ok: true };
    },
  );

  // ---- public viewer: snapshot bytes --------------------------------------
  app.get<{ Params: { token: string } }>(
    '/api/public-layouts/:token/snapshot',
    async (req, reply) => {
      const layout = await db
        .select()
        .from(schema.layouts)
        .where(eq(schema.layouts.publicShareToken, req.params.token))
        .get();
      if (!layout) return reply.code(404).send({ error: 'not_found' });
      reply.header('Content-Type', 'application/octet-stream');
      reply.header('X-Doc-Version', String(layout.docVersion));
      return reply.send(Buffer.from(layout.docSnapshot as Uint8Array));
    },
  );
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
    publicShareToken: l.publicShareToken ?? null,
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

/**
 * Build a minimal ZIP archive containing the provided entries.
 * Uses store (no compression, method=0) to avoid a native zlib dependency.
 * Format: PKZIP 2.0 — universally supported.
 */
function buildZip(entries: { name: string; data: Buffer }[]): Buffer {
  const localHeaders: Buffer[] = [];
  const offsets: number[] = [];
  let offset = 0;

  for (const entry of entries) {
    offsets.push(offset);
    const nameBytes = Buffer.from(entry.name, 'utf8');
    const crc = crc32Buffer(entry.data);
    const size = entry.data.length;
    // Local file header (30 bytes + name)
    const local = Buffer.alloc(30 + nameBytes.length);
    local.writeUInt32LE(0x04034b50, 0);  // signature
    local.writeUInt16LE(20, 4);           // version needed
    local.writeUInt16LE(0, 6);            // flags
    local.writeUInt16LE(0, 8);            // method: store
    local.writeUInt16LE(0, 10);           // mod time
    local.writeUInt16LE(0, 12);           // mod date
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(size, 18);        // compressed size
    local.writeUInt32LE(size, 22);        // uncompressed size
    local.writeUInt16LE(nameBytes.length, 26);
    local.writeUInt16LE(0, 28);           // extra len
    nameBytes.copy(local, 30);
    localHeaders.push(local);
    offset += local.length + size;
  }

  const centralDirStart = offset;
  const centralHeaders: Buffer[] = [];

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]!;
    const nameBytes = Buffer.from(entry.name, 'utf8');
    const crc = crc32Buffer(entry.data);
    const size = entry.data.length;
    const central = Buffer.alloc(46 + nameBytes.length);
    central.writeUInt32LE(0x02014b50, 0); // signature
    central.writeUInt16LE(20, 4);          // version made by
    central.writeUInt16LE(20, 6);          // version needed
    central.writeUInt16LE(0, 8);           // flags
    central.writeUInt16LE(0, 10);          // method
    central.writeUInt16LE(0, 12);          // mod time
    central.writeUInt16LE(0, 14);          // mod date
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(size, 20);
    central.writeUInt32LE(size, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt16LE(0, 30);          // extra len
    central.writeUInt16LE(0, 32);          // comment len
    central.writeUInt16LE(0, 34);          // disk start
    central.writeUInt16LE(0, 36);          // int attr
    central.writeUInt32LE(0, 38);          // ext attr
    central.writeUInt32LE(offsets[i]!, 42); // local header offset
    nameBytes.copy(central, 46);
    centralHeaders.push(central);
  }

  const centralDirLen = centralHeaders.reduce((s, b) => s + b.length, 0);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);         // end of central dir signature
  eocd.writeUInt16LE(0, 4);                   // disk number
  eocd.writeUInt16LE(0, 6);                   // disk with start of CD
  eocd.writeUInt16LE(entries.length, 8);      // entries on disk
  eocd.writeUInt16LE(entries.length, 10);     // total entries
  eocd.writeUInt32LE(centralDirLen, 12);      // CD size
  eocd.writeUInt32LE(centralDirStart, 16);    // CD offset
  eocd.writeUInt16LE(0, 20);                  // comment len

  return Buffer.concat([
    ...localHeaders.flatMap((h, i) => [h, entries[i]!.data]),
    ...centralHeaders,
    eocd,
  ]);
}

/** CRC-32 compatible with PKZIP (polynomial 0xEDB88320). */
function crc32Buffer(buf: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i]!;
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
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

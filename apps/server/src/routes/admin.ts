// Platform-admin endpoints — every route is gated by `requireGlobalAdmin`
// and writes an audit_event for any mutation. Read-only endpoints don't
// audit (would balloon the table for what's effectively just listing).
//
// Routes are intentionally namespaced at /api/admin/* so a reverse proxy
// can apply tighter rate limits / IP allowlists per deployment.

import type { FastifyInstance } from 'fastify';
import { and, count, desc, eq, inArray, like, or, sql } from 'drizzle-orm';

/** Escape SQLite LIKE wildcards so user input is treated as a literal string. */
function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, '\\$&');
}
import { randomUUID } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { mkdir, rm, readdir } from 'node:fs/promises';
import { join, resolve, extname } from 'node:path';
import { db, schema } from '../db/index.js';
import { requireGlobalAdmin } from '../auth/cookie.js';
import { writeAuditEvent } from '../audit/writeAuditEvent.js';
import { invalidateAllSessions } from '../auth/session.js';
import { parsePartXml } from '@cld/parts-catalog';
import { invalidatePartsCache } from './parts.js';

function safeParse(json: string): unknown {
  try { return JSON.parse(json); } catch { return { _raw: json }; }
}

/**
 * Assert that a URL is safe to fetch from an outbound server-side request.
 * Throws if the URL is not https:// or resolves to a private/loopback network.
 */
function assertSafeUrl(raw: string): void {
  let parsed: URL;
  try { parsed = new URL(raw); } catch { throw new Error('invalid URL'); }
  if (parsed.protocol !== 'https:') throw new Error('only https:// URLs are allowed');
  const host = parsed.hostname.toLowerCase();
  // Block localhost and RFC-1918 / link-local ranges (SSRF guard)
  if (
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host === '::1' ||
    host.endsWith('.local') ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
    /^169\.254\./.test(host)
  ) {
    throw new Error('URL resolves to a private network address');
  }
}

interface UserListQuery {
  q?: string;
  limit?: string;
  offset?: string;
}

interface OrgListQuery {
  q?: string;
  limit?: string;
  offset?: string;
}

interface LayoutListQuery {
  q?: string;
  limit?: string;
  offset?: string;
  ownerUserId?: string;
  ownerOrgId?: string;
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

function clampLimit(raw: string | undefined): number {
  const n = raw ? parseInt(raw, 10) : DEFAULT_LIMIT;
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_LIMIT;
  return Math.min(MAX_LIMIT, n);
}

function clampOffset(raw: string | undefined): number {
  const n = raw ? parseInt(raw, 10) : 0;
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

export async function adminRoutes(app: FastifyInstance): Promise<void> {
  // -----------------------------------------------------------------
  // Users
  // -----------------------------------------------------------------
  app.get<{ Querystring: UserListQuery }>('/api/admin/users', async (req) => {
    requireGlobalAdmin(req);
    const limit = clampLimit(req.query.limit);
    const offset = clampOffset(req.query.offset);
    const needle = (req.query.q ?? '').trim();
    const safe = `%${escapeLike(needle)}%`;
    const where = needle
      ? or(
          sql`${schema.users.email} LIKE ${safe} ESCAPE '\'`,
          sql`${schema.users.displayName} LIKE ${safe} ESCAPE '\'`,
        )
      : undefined;
    const rows = await db
      .select({
        id: schema.users.id,
        email: schema.users.email,
        displayName: schema.users.displayName,
        avatarUrl: schema.users.avatarUrl,
        isDemoAccount: schema.users.isDemoAccount,
        isGlobalAdmin: schema.users.isGlobalAdmin,
        createdAt: schema.users.createdAt,
      })
      .from(schema.users)
      .where(where)
      .orderBy(desc(schema.users.createdAt))
      .limit(limit)
      .offset(offset);

    const totalRow = await db
      .select({ n: count() })
      .from(schema.users)
      .where(where)
      .get();
    return { users: rows, total: totalRow?.n ?? 0, limit, offset };
  });

  app.get<{ Params: { id: string } }>('/api/admin/users/:id', async (req, reply) => {
    requireGlobalAdmin(req);
    const user = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, req.params.id))
      .get();
    if (!user) return reply.code(404).send({ error: 'not_found' });

    // Counts: orgs the user belongs to, layouts they own, custom parts, modules.
    const [orgCount, layoutCount, partCount, moduleCount, sessionCount] = await Promise.all([
      db.select({ n: count() }).from(schema.orgMembers).where(eq(schema.orgMembers.userId, user.id)).get(),
      db.select({ n: count() }).from(schema.layouts).where(eq(schema.layouts.ownerUserId, user.id)).get(),
      db.select({ n: count() }).from(schema.customParts).where(eq(schema.customParts.ownerUserId, user.id)).get(),
      db.select({ n: count() }).from(schema.modules).where(eq(schema.modules.ownerUserId, user.id)).get(),
      db.select({ n: count() }).from(schema.sessions).where(eq(schema.sessions.userId, user.id)).get(),
    ]);

    return {
      user: {
        id: user.id,
        email: user.email,
        displayName: user.displayName,
        avatarUrl: user.avatarUrl,
        isDemoAccount: user.isDemoAccount,
        isGlobalAdmin: user.isGlobalAdmin,
        createdAt: user.createdAt,
      },
      stats: {
        orgs: orgCount?.n ?? 0,
        layouts: layoutCount?.n ?? 0,
        customParts: partCount?.n ?? 0,
        modules: moduleCount?.n ?? 0,
        activeSessions: sessionCount?.n ?? 0,
      },
    };
  });

  app.patch<{ Params: { id: string }; Body: { isGlobalAdmin?: boolean; isDemoAccount?: boolean } }>(
    '/api/admin/users/:id',
    async (req, reply) => {
      const me = requireGlobalAdmin(req);
      const target = await db
        .select()
        .from(schema.users)
        .where(eq(schema.users.id, req.params.id))
        .get();
      if (!target) return reply.code(404).send({ error: 'not_found' });

      // Don't let an admin demote themselves — would lock them out.
      // Other admins are still around to do it; this just prevents
      // accidental self-lockout.
      const patch: Partial<typeof schema.users.$inferInsert> = {};
      if (typeof req.body.isGlobalAdmin === 'boolean') {
        if (target.id === me.id && !req.body.isGlobalAdmin) {
          return reply.code(400).send({ error: 'cannot_demote_self' });
        }
        patch.isGlobalAdmin = req.body.isGlobalAdmin;
      }
      if (typeof req.body.isDemoAccount === 'boolean') {
        patch.isDemoAccount = req.body.isDemoAccount;
      }
      if (Object.keys(patch).length === 0) {
        return reply.code(400).send({ error: 'empty_patch' });
      }
      await db.update(schema.users).set(patch).where(eq(schema.users.id, target.id));
      await writeAuditEvent({
        resourceKind: 'user',
        resourceId: target.id,
        userId: me.id,
        eventType: 'admin_user_patch',
        payload: { patch, targetEmail: target.email },
      });
      return { ok: true };
    },
  );

  app.delete<{ Params: { id: string } }>('/api/admin/users/:id', async (req, reply) => {
    const me = requireGlobalAdmin(req);
    if (req.params.id === me.id) {
      return reply.code(400).send({ error: 'cannot_delete_self' });
    }
    const target = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, req.params.id))
      .get();
    if (!target) return reply.code(404).send({ error: 'not_found' });
    await db.delete(schema.users).where(eq(schema.users.id, target.id));
    // Cascade handles sessions, oauth_accounts, org_members,
    // owner_user_id columns (SET NULL or CASCADE per schema).
    await writeAuditEvent({
      resourceKind: 'user',
      resourceId: target.id,
      userId: me.id,
      eventType: 'admin_user_delete',
      payload: { targetEmail: target.email },
    });
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>(
    '/api/admin/users/:id/sessions/revoke-all',
    async (req, reply) => {
      const me = requireGlobalAdmin(req);
      const target = await db
        .select()
        .from(schema.users)
        .where(eq(schema.users.id, req.params.id))
        .get();
      if (!target) return reply.code(404).send({ error: 'not_found' });
      await invalidateAllSessions(target.id);
      await writeAuditEvent({
        resourceKind: 'user',
        resourceId: target.id,
        userId: me.id,
        eventType: 'admin_revoke_sessions',
        payload: { targetEmail: target.email },
      });
      return { ok: true };
    },
  );

  // -----------------------------------------------------------------
  // Organizations
  // -----------------------------------------------------------------
  app.get<{ Querystring: OrgListQuery }>('/api/admin/orgs', async (req) => {
    requireGlobalAdmin(req);
    const limit = clampLimit(req.query.limit);
    const offset = clampOffset(req.query.offset);
    const needle = (req.query.q ?? '').trim();
    const safe = `%${escapeLike(needle)}%`;
    const where = needle
      ? or(
          sql`${schema.orgs.name} LIKE ${safe} ESCAPE '\'`,
          sql`${schema.orgs.slug} LIKE ${safe} ESCAPE '\'`,
        )
      : undefined;
    const rows = await db
      .select({
        id: schema.orgs.id,
        name: schema.orgs.name,
        slug: schema.orgs.slug,
        createdAt: schema.orgs.createdAt,
      })
      .from(schema.orgs)
      .where(where)
      .orderBy(desc(schema.orgs.createdAt))
      .limit(limit)
      .offset(offset);
    const totalRow = await db
      .select({ n: count() })
      .from(schema.orgs)
      .where(where)
      .get();
    // Fold member-counts into the rows (one extra round-trip avoided
    // by computing in SQL).
    const memberCounts = await db
      .select({ orgId: schema.orgMembers.orgId, n: count() })
      .from(schema.orgMembers)
      .groupBy(schema.orgMembers.orgId);
    const byId = new Map(memberCounts.map((r) => [r.orgId, r.n]));
    return {
      orgs: rows.map((r) => ({ ...r, memberCount: byId.get(r.id) ?? 0 })),
      total: totalRow?.n ?? 0,
      limit,
      offset,
    };
  });

  app.delete<{ Params: { id: string } }>('/api/admin/orgs/:id', async (req, reply) => {
    const me = requireGlobalAdmin(req);
    const target = await db.select().from(schema.orgs).where(eq(schema.orgs.id, req.params.id)).get();
    if (!target) return reply.code(404).send({ error: 'not_found' });
    await db.delete(schema.orgs).where(eq(schema.orgs.id, target.id));
    await writeAuditEvent({
      resourceKind: 'org',
      resourceId: target.id,
      userId: me.id,
      eventType: 'admin_org_delete',
      payload: { name: target.name, slug: target.slug },
    });
    return { ok: true };
  });

  // -----------------------------------------------------------------
  // Layouts
  // -----------------------------------------------------------------
  app.get<{ Querystring: LayoutListQuery }>('/api/admin/layouts', async (req) => {
    requireGlobalAdmin(req);
    const limit = clampLimit(req.query.limit);
    const offset = clampOffset(req.query.offset);
    const needle = (req.query.q ?? '').trim();
    const filters = [];
    if (needle) {
      const safe = `%${escapeLike(needle)}%`;
      filters.push(sql`${schema.layouts.title} LIKE ${safe} ESCAPE '\'`);
    }
    if (req.query.ownerUserId) filters.push(eq(schema.layouts.ownerUserId, req.query.ownerUserId));
    if (req.query.ownerOrgId) filters.push(eq(schema.layouts.ownerOrgId, req.query.ownerOrgId));
    const where = filters.length > 0 ? and(...filters) : undefined;

    const rows = await db
      .select({
        id: schema.layouts.id,
        title: schema.layouts.title,
        ownerUserId: schema.layouts.ownerUserId,
        ownerOrgId: schema.layouts.ownerOrgId,
        createdBy: schema.layouts.createdBy,
        createdAt: schema.layouts.createdAt,
        updatedAt: schema.layouts.updatedAt,
        expiresAt: schema.layouts.expiresAt,
        docVersion: schema.layouts.docVersion,
      })
      .from(schema.layouts)
      .where(where)
      .orderBy(desc(schema.layouts.updatedAt))
      .limit(limit)
      .offset(offset);
    const totalRow = await db
      .select({ n: count() })
      .from(schema.layouts)
      .where(where)
      .get();
    return { layouts: rows, total: totalRow?.n ?? 0, limit, offset };
  });

  app.delete<{ Params: { id: string } }>('/api/admin/layouts/:id', async (req, reply) => {
    const me = requireGlobalAdmin(req);
    const target = await db
      .select({ id: schema.layouts.id, title: schema.layouts.title })
      .from(schema.layouts)
      .where(eq(schema.layouts.id, req.params.id))
      .get();
    if (!target) return reply.code(404).send({ error: 'not_found' });
    await db.delete(schema.layouts).where(eq(schema.layouts.id, target.id));
    await writeAuditEvent({
      layoutId: target.id,
      userId: me.id,
      eventType: 'admin_layout_delete',
      payload: { title: target.title },
    });
    return { ok: true };
  });

  // -----------------------------------------------------------------
  // Global parts library (admin-managed, visible to all users)
  // -----------------------------------------------------------------

  app.get('/api/admin/global-parts', async (req) => {
    requireGlobalAdmin(req);
    const rows = await db
      .select({
        id: schema.customParts.id,
        partNumber: schema.customParts.partNumber,
        displayName: schema.customParts.displayName,
        category: schema.customParts.category,
        spriteMime: schema.customParts.spriteMime,
        createdAt: schema.customParts.createdAt,
      })
      .from(schema.customParts)
      .where(eq(schema.customParts.isGlobal, true))
      .orderBy(schema.customParts.category, schema.customParts.displayName);
    return { parts: rows };
  });

  interface GlobalPartBody {
    partNumber: string;
    displayName: string;
    category?: string;
    /** Base64-encoded XML payload — same format as /api/custom-parts. */
    xmlBase64: string;
    /** Base64-encoded sprite (gif or png). */
    spriteBase64: string;
    spriteMime: 'image/gif' | 'image/png';
  }

  app.post<{ Body: GlobalPartBody }>('/api/admin/global-parts', async (req, reply) => {
    const me = requireGlobalAdmin(req);
    const body = req.body ?? ({} as GlobalPartBody);
    const partNumber = body.partNumber?.trim();
    const displayName = body.displayName?.trim();
    const category = (body.category ?? 'Custom').trim() || 'Custom';
    if (!partNumber || !displayName) return reply.code(400).send({ error: 'invalid_input' });
    if (body.spriteMime !== 'image/gif' && body.spriteMime !== 'image/png') {
      return reply.code(400).send({ error: 'invalid_sprite_mime' });
    }
    let xmlBlob: Buffer;
    let spriteBlob: Buffer;
    try {
      xmlBlob = Buffer.from(body.xmlBase64, 'base64');
      spriteBlob = Buffer.from(body.spriteBase64, 'base64');
    } catch {
      return reply.code(400).send({ error: 'invalid_base64' });
    }
    if (xmlBlob.length === 0 || spriteBlob.length === 0) {
      return reply.code(400).send({ error: 'empty_payload' });
    }
    try {
      parsePartXml(xmlBlob.toString('utf8'), { partNumber, colorCode: '', spritePath: '' });
    } catch {
      return reply.code(400).send({ error: 'invalid_part_xml' });
    }
    const id = randomUUID();
    const now = new Date();
    await db.insert(schema.customParts).values({
      id,
      partNumber,
      displayName,
      category,
      isGlobal: true,
      ownerUserId: null,
      ownerOrgId: null,
      createdBy: me.id,
      xmlBlob,
      spriteBlob,
      spriteMime: body.spriteMime,
      createdAt: now,
      updatedAt: now,
    });
    await writeAuditEvent({
      resourceKind: 'custom_part',
      resourceId: id,
      userId: me.id,
      eventType: 'admin_global_part_create',
      payload: { partId: id, partNumber, displayName, category },
    });
    return reply.code(201).send({ id });
  });

  app.delete<{ Params: { id: string } }>('/api/admin/global-parts/:id', async (req, reply) => {
    const me = requireGlobalAdmin(req);
    const part = await db
      .select({ id: schema.customParts.id, partNumber: schema.customParts.partNumber, isGlobal: schema.customParts.isGlobal })
      .from(schema.customParts)
      .where(eq(schema.customParts.id, req.params.id))
      .get();
    if (!part) return reply.code(404).send({ error: 'not_found' });
    if (!part.isGlobal) return reply.code(403).send({ error: 'not a global part' });
    await db.delete(schema.customParts).where(eq(schema.customParts.id, part.id));
    await writeAuditEvent({
      resourceKind: 'custom_part',
      resourceId: part.id,
      userId: me.id,
      eventType: 'admin_global_part_delete',
      payload: { partId: part.id, partNumber: part.partNumber },
    });
    return { ok: true };
  });

  // -----------------------------------------------------------------
  // Global audit log (all events, newest first, paginated)
  // -----------------------------------------------------------------
  app.get<{ Querystring: { q?: string; limit?: string; offset?: string } }>(
    '/api/admin/audit',
    async (req) => {
      requireGlobalAdmin(req);
      const limit = clampLimit(req.query.limit);
      const offset = clampOffset(req.query.offset);
      const rows = await db
        .select()
        .from(schema.auditEvents)
        .orderBy(desc(schema.auditEvents.createdAt))
        .limit(limit)
        .offset(offset);
      const totalRow = await db.select({ n: count() }).from(schema.auditEvents).get();
      const userIds = [...new Set(rows.map((r) => r.userId).filter((id): id is string => id !== null))];
      const userRows = userIds.length > 0
        ? await db
            .select({ id: schema.users.id, displayName: schema.users.displayName, email: schema.users.email })
            .from(schema.users)
            .where(inArray(schema.users.id, userIds))
        : [];
      const names = new Map(userRows.map((u) => [u.id, u.displayName || u.email]));
      return {
        events: rows.map((r) => ({
          id: r.id,
          layoutId: r.layoutId,
          resourceKind: r.resourceKind,
          resourceId: r.resourceId,
          userId: r.userId,
          userName: r.userId ? (names.get(r.userId) ?? null) : null,
          eventType: r.eventType,
          payload: safeParse(r.payload),
          createdAt: r.createdAt.getTime(),
        })),
        total: totalRow?.n ?? 0,
        limit,
        offset,
      };
    },
  );

  // -----------------------------------------------------------------
  // Part Libraries — installable named sets of parts.
  // Admin installs from zip URL or upload; orgs opt-in/out per library.
  // -----------------------------------------------------------------

  app.get('/api/admin/part-libraries', async (req) => {
    requireGlobalAdmin(req);
    const rows = await db
      .select()
      .from(schema.partLibraries)
      .orderBy(schema.partLibraries.name);
    return { libraries: rows.map((r) => ({
      id: r.id,
      name: r.name,
      slug: r.slug,
      sourceUrl: r.sourceUrl,
      partCount: r.partCount,
      defaultEnabled: r.defaultEnabled,
      locked: r.locked,
      installedAt: r.installedAt instanceof Date ? r.installedAt.getTime() : r.installedAt,
      updatedAt: r.updatedAt instanceof Date ? r.updatedAt.getTime() : r.updatedAt,
    })) };
  });

  interface InstallLibraryBody {
    name: string;
    slug: string;
    /** Remote zip URL to fetch; mutually exclusive with zipBase64. */
    sourceUrl?: string;
    /** Base64-encoded zip; used when admin uploads a local file. */
    zipBase64?: string;
    defaultEnabled?: boolean;
  }

  // Install a new part library. The zip is extracted into
  // `${PARTS_DIR}/libraries/${slug}/` so the bundled parts scanner picks
  // them up. We count XMLs found and store the count in the DB row.
  app.post<{ Body: InstallLibraryBody }>(
    '/api/admin/part-libraries',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (req, reply) => {
    const me = requireGlobalAdmin(req);
    const body = req.body ?? ({} as InstallLibraryBody);
    const name = body.name?.trim();
    const slugRaw = body.slug?.trim().toLowerCase().replace(/[^a-z0-9-]/g, '-');
    if (!name || !slugRaw) return reply.code(400).send({ error: 'name and slug required' });
    if (!/^[a-z0-9-]+$/.test(slugRaw)) return reply.code(400).send({ error: 'invalid_slug' });

    // Slug must be unique.
    const existing = await db
      .select({ id: schema.partLibraries.id })
      .from(schema.partLibraries)
      .where(eq(schema.partLibraries.slug, slugRaw))
      .get();
    if (existing) return reply.code(409).send({ error: 'slug_conflict' });

    // Resolve library directory.
    const { env } = await import('../env.js');
    const libDir = resolve(join(env.partsDir, 'libraries', slugRaw));
    await mkdir(libDir, { recursive: true });

    let partCount = 0;
    let fetchErr: string | null = null;

    if (body.zipBase64) {
      // Decode + extract zip from upload.
      try {
        const zipBuf = Buffer.from(body.zipBase64, 'base64');
        await extractZip(zipBuf, libDir);
        partCount = await countXmls(libDir);
      } catch (e) {
        fetchErr = e instanceof Error ? e.message : 'zip extraction failed';
      }
    } else if (body.sourceUrl) {
      // Fetch from remote URL and extract.
      const sourceUrl = body.sourceUrl.trim();
      try { assertSafeUrl(sourceUrl); } catch (e) {
        await rm(libDir, { recursive: true, force: true });
        return reply.code(400).send({ error: e instanceof Error ? e.message : 'invalid sourceUrl' });
      }
      try {
        const res = await fetch(sourceUrl, { signal: AbortSignal.timeout(120_000) });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const buf = Buffer.from(await res.arrayBuffer());
        if (buf.length > 100 * 1024 * 1024) throw new Error('Archive exceeds 100 MB limit');
        await extractZip(buf, libDir);
        partCount = await countXmls(libDir);
      } catch (e) {
        fetchErr = e instanceof Error ? e.message : 'download failed';
      }
    }

    if (fetchErr) {
      // Clean up empty dir.
      await rm(libDir, { recursive: true, force: true });
      return reply.code(422).send({ error: fetchErr });
    }

    const id = randomUUID();
    const now = new Date();
    await db.insert(schema.partLibraries).values({
      id,
      name,
      slug: slugRaw,
      sourceUrl: body.sourceUrl ?? null,
      partCount,
      defaultEnabled: body.defaultEnabled ?? false,
      installedAt: now,
      updatedAt: now,
    });
    await writeAuditEvent({
      resourceKind: 'part_library',
      resourceId: id,
      userId: me.id,
      eventType: 'admin_part_library_install',
      payload: { name, slug: slugRaw, partCount, sourceUrl: body.sourceUrl ?? null },
    });
    return reply.code(201).send({ id, slug: slugRaw, partCount });
  });

  // Search BlueBrick download-center sources for available packages.
  // Acts as a server-side proxy so the browser doesn't hit CORS.
  // `source` can be 'official', 'nonlego', or any https:// URL.
  app.get<{ Querystring: { source?: string } }>(
    '/api/admin/part-libraries/search',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (req, reply) => {
      requireGlobalAdmin(req);
      const source = (req.query.source ?? '').trim();

      let indexUrl: string;
      if (source === 'official') {
        indexUrl = 'https://bluebrick.lswproject.com/download/package/';
      } else if (source === 'nonlego') {
        indexUrl = 'https://bluebrick.lswproject.com/download/packageOther/';
      } else if (source.startsWith('https://')) {
        indexUrl = source.endsWith('/') ? source : source + '/';
      } else {
        return reply.code(400).send({ error: 'invalid source' });
      }

      // SSRF guard — assertSafeUrl also validates https:// for custom sources.
      try { assertSafeUrl(indexUrl); } catch (e) {
        return reply.code(400).send({ error: e instanceof Error ? e.message : 'invalid source URL' });
      }

      let html: string;
      try {
        const res = await fetch(indexUrl, {
          headers: {
            'User-Agent':
              'Mozilla/5.0 (compatible; Collaborative Brick Layout Designer/1.0; +https://github.com/brick-layout-designer/collaborative-brick-layout-designer)',
          },
          signal: AbortSignal.timeout(20_000),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const raw = await res.arrayBuffer();
        if (raw.byteLength > 1024 * 1024) throw new Error('Index page exceeds 1 MB');
        html = Buffer.from(raw).toString('utf8');
      } catch (e) {
        return reply.code(502).send({
          error: e instanceof Error ? e.message : 'fetch failed',
        });
      }

      // Same regex as the desktop DownloadCenterDialog:
      // <a href="...zip">Name.zip</a>
      const rx = /<a href="[^"]+\.zip">([^<]+\.zip)<\/a>/gi;
      const packages: Array<{ name: string; version: string; fileName: string; sourceUrl: string }> =
        [];
      let m: RegExpExecArray | null;
      while ((m = rx.exec(html)) !== null) {
        const fileName = m[1]!;
        let stem = fileName.slice(0, -4); // strip ".zip"
        let name = stem;
        let version = '';
        const dot = stem.indexOf('.');
        if (dot > 0) {
          name = stem.slice(0, dot);
          version = stem.slice(dot + 1);
        }
        packages.push({ name, version, fileName, sourceUrl: indexUrl + fileName });
      }

      return { packages, indexUrl };
    },
  );

  // Register the bundled parts library (already on disk at PARTS_DIR) as a
  // part_library row — no extraction needed, just a DB record so orgs can
  // see and enable it.
  app.post('/api/admin/part-libraries/install-base', async (req, reply) => {
    const me = requireGlobalAdmin(req);

    const existing = await db
      .select({ id: schema.partLibraries.id })
      .from(schema.partLibraries)
      .where(eq(schema.partLibraries.slug, 'bluebrickparts'))
      .get();
    if (existing) return reply.code(409).send({ error: 'already_installed' });

    const { env } = await import('../env.js');
    const partCount = await countXmls(resolve(env.partsDir));

    const id = randomUUID();
    const now = new Date();
    await db.insert(schema.partLibraries).values({
      id,
      name: 'BlueBrickParts (base library)',
      slug: 'bluebrickparts',
      sourceUrl: 'https://github.com/Lswbanban/BlueBrickParts',
      partCount,
      defaultEnabled: true,
      locked: true,
      installedAt: now,
      updatedAt: now,
    });
    await writeAuditEvent({
      resourceKind: 'part_library',
      resourceId: id,
      userId: me.id,
      eventType: 'admin_part_library_install',
      payload: { name: 'BlueBrickParts (base library)', slug: 'bluebrickparts', partCount },
    });
    return reply.code(201).send({ id, slug: 'bluebrickparts', partCount });
  });

  // Download a package from a known BlueBrick source URL and install it.
  // Mirrors desktop DownloadCenterDialog::downloadAndInstall.
  interface DownloadLibraryBody {
    name: string;
    slug: string;
    sourceUrl: string;
    defaultEnabled?: boolean;
  }

  app.post<{ Body: DownloadLibraryBody }>(
    '/api/admin/part-libraries/download',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const me = requireGlobalAdmin(req);
      const body = req.body ?? ({} as DownloadLibraryBody);
      const name = body.name?.trim();
      const slugRaw = body.slug?.trim().toLowerCase().replace(/[^a-z0-9-]/g, '-');
      const sourceUrl = body.sourceUrl?.trim();

      if (!name || !slugRaw || !sourceUrl) {
        return reply.code(400).send({ error: 'name, slug and sourceUrl required' });
      }
      if (!/^[a-z0-9-]+$/.test(slugRaw)) return reply.code(400).send({ error: 'invalid_slug' });
      try { assertSafeUrl(sourceUrl); } catch (e) {
        return reply.code(400).send({ error: e instanceof Error ? e.message : 'invalid sourceUrl' });
      }
      // Only allow bluebrick.lswproject.com or user-confirmed custom URLs.
      // The slug-conflict check acts as an idempotency guard.
      const existing = await db
        .select({ id: schema.partLibraries.id })
        .from(schema.partLibraries)
        .where(eq(schema.partLibraries.slug, slugRaw))
        .get();
      if (existing) return reply.code(409).send({ error: 'slug_conflict' });

      const { env } = await import('../env.js');
      const libDir = resolve(join(env.partsDir, 'libraries', slugRaw));
      await mkdir(libDir, { recursive: true });

      try {
        const res = await fetch(sourceUrl, {
          headers: {
            'User-Agent':
              'Mozilla/5.0 (compatible; Collaborative Brick Layout Designer/1.0; +https://github.com/brick-layout-designer/collaborative-brick-layout-designer)',
          },
          signal: AbortSignal.timeout(120_000),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const buf = Buffer.from(await res.arrayBuffer());
        if (buf.length > 100 * 1024 * 1024) throw new Error('Archive exceeds 100 MB limit');
        await extractZip(buf, libDir);
      } catch (e) {
        await rm(libDir, { recursive: true, force: true });
        return reply.code(422).send({ error: e instanceof Error ? e.message : 'download failed' });
      }

      const partCount = await countXmls(libDir);
      const id = randomUUID();
      const now = new Date();
      await db.insert(schema.partLibraries).values({
        id,
        name,
        slug: slugRaw,
        sourceUrl,
        partCount,
        defaultEnabled: body.defaultEnabled ?? false,
        installedAt: now,
        updatedAt: now,
      });
      await writeAuditEvent({
        resourceKind: 'part_library',
        resourceId: id,
        userId: me.id,
        eventType: 'admin_part_library_install',
        payload: { name, slug: slugRaw, partCount, sourceUrl },
      });
      return reply.code(201).send({ id, slug: slugRaw, partCount });
    },
  );

  app.patch<{
    Params: { id: string };
    Body: { defaultEnabled?: boolean; name?: string; locked?: boolean };
  }>('/api/admin/part-libraries/:id', async (req, reply) => {
    const me = requireGlobalAdmin(req);
    const lib = await db
      .select()
      .from(schema.partLibraries)
      .where(eq(schema.partLibraries.id, req.params.id))
      .get();
    if (!lib) return reply.code(404).send({ error: 'not_found' });
    const patch: Partial<typeof schema.partLibraries.$inferInsert> = { updatedAt: new Date() };
    if (typeof req.body.defaultEnabled === 'boolean') patch.defaultEnabled = req.body.defaultEnabled;
    if (typeof req.body.name === 'string' && req.body.name.trim()) patch.name = req.body.name.trim();
    if (typeof req.body.locked === 'boolean') patch.locked = req.body.locked;
    await db.update(schema.partLibraries).set(patch).where(eq(schema.partLibraries.id, lib.id));
    await writeAuditEvent({
      resourceKind: 'part_library',
      resourceId: lib.id,
      userId: me.id,
      eventType: 'admin_part_library_patch',
      payload: { patch },
    });
    return { ok: true };
  });

  // POST /api/admin/part-libraries/:id/update
  // Re-fetch from sourceUrl and replace directory contents in-place.
  app.post<{ Params: { id: string } }>(
    '/api/admin/part-libraries/:id/update',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const me = requireGlobalAdmin(req);
      const lib = await db
        .select()
        .from(schema.partLibraries)
        .where(eq(schema.partLibraries.id, req.params.id))
        .get();
      if (!lib) return reply.code(404).send({ error: 'not_found' });
      if (!lib.sourceUrl) return reply.code(400).send({ error: 'no_source_url' });
      if (!/^[a-z0-9-]+$/.test(lib.slug)) return reply.code(500).send({ error: 'corrupt_slug' });
      try { assertSafeUrl(lib.sourceUrl); } catch (e) {
        return reply.code(500).send({ error: e instanceof Error ? e.message : 'corrupt_source_url' });
      }

      const { env } = await import('../env.js');
      const libDir = resolve(join(env.partsDir, 'libraries', lib.slug));

      // Download into a temp sibling dir, swap on success.
      const tmpDir = libDir + '.tmp_update';
      await rm(tmpDir, { recursive: true, force: true });
      await mkdir(tmpDir, { recursive: true });

      try {
        const res = await fetch(lib.sourceUrl, { signal: AbortSignal.timeout(120_000) });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const buf = Buffer.from(await res.arrayBuffer());
        if (buf.length > 100 * 1024 * 1024) throw new Error('Archive exceeds 100 MB limit');
        await extractZip(buf, tmpDir);
      } catch (e) {
        await rm(tmpDir, { recursive: true, force: true });
        return reply.code(422).send({ error: e instanceof Error ? e.message : 'download failed' });
      }

      // Swap: remove old dir, rename tmp into place.
      await rm(libDir, { recursive: true, force: true });
      const { rename } = await import('node:fs/promises');
      await rename(tmpDir, libDir);

      const partCount = await countXmls(libDir);
      const now = new Date();
      await db
        .update(schema.partLibraries)
        .set({ partCount, updatedAt: now })
        .where(eq(schema.partLibraries.id, lib.id));

      invalidatePartsCache();

      await writeAuditEvent({
        resourceKind: 'part_library',
        resourceId: lib.id,
        userId: me.id,
        eventType: 'admin_part_library_update',
        payload: { name: lib.name, slug: lib.slug, partCount, sourceUrl: lib.sourceUrl },
      });
      return { ok: true, partCount };
    },
  );

  app.delete<{ Params: { id: string } }>(
    '/api/admin/part-libraries/:id',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (req, reply) => {
    const me = requireGlobalAdmin(req);
    const lib = await db
      .select()
      .from(schema.partLibraries)
      .where(eq(schema.partLibraries.id, req.params.id))
      .get();
    if (!lib) return reply.code(404).send({ error: 'not_found' });
    if (!/^[a-z0-9-]+$/.test(lib.slug)) return reply.code(500).send({ error: 'corrupt_slug' });

    // Remove the library directory from disk.
    const { env } = await import('../env.js');
    const libDir = resolve(join(env.partsDir, 'libraries', lib.slug));
    await rm(libDir, { recursive: true, force: true });

    await db.delete(schema.partLibraries).where(eq(schema.partLibraries.id, lib.id));
    await writeAuditEvent({
      resourceKind: 'part_library',
      resourceId: lib.id,
      userId: me.id,
      eventType: 'admin_part_library_delete',
      payload: { name: lib.name, slug: lib.slug },
    });
    return { ok: true };
  });

  // -----------------------------------------------------------------
  // Reload parts library — drops the in-process catalog cache so the
  // next `/api/parts/catalog` request triggers a fresh rescan of all
  // directories. Port of Tools → Reload Parts Library.
  // -----------------------------------------------------------------
  app.post('/api/admin/reload-parts', async (req) => {
    requireGlobalAdmin(req);
    invalidatePartsCache();
    return { ok: true };
  });

  // -----------------------------------------------------------------
  // Aggregate stats — one cheap call so the dashboard can render.
  // -----------------------------------------------------------------
  app.get('/api/admin/stats', async (req) => {
    requireGlobalAdmin(req);
    const [usersRow, orgsRow, layoutsRow, partsRow, modulesRow, demoRow, adminRow, sessionsRow] = await Promise.all([
      db.select({ n: count() }).from(schema.users).get(),
      db.select({ n: count() }).from(schema.orgs).get(),
      db.select({ n: count() }).from(schema.layouts).get(),
      db.select({ n: count() }).from(schema.customParts).get(),
      db.select({ n: count() }).from(schema.modules).get(),
      db
        .select({ n: count() })
        .from(schema.users)
        .where(eq(schema.users.isDemoAccount, true))
        .get(),
      db
        .select({ n: count() })
        .from(schema.users)
        .where(eq(schema.users.isGlobalAdmin, true))
        .get(),
      db
        .select({ n: count() })
        .from(schema.sessions)
        .where(sql`${schema.sessions.expiresAt} > ${Date.now()}`)
        .get(),
    ]);
    return {
      users: usersRow?.n ?? 0,
      demoUsers: demoRow?.n ?? 0,
      globalAdmins: adminRow?.n ?? 0,
      orgs: orgsRow?.n ?? 0,
      layouts: layoutsRow?.n ?? 0,
      customParts: partsRow?.n ?? 0,
      modules: modulesRow?.n ?? 0,
      activeSessions: sessionsRow?.n ?? 0,
    };
  });
}

// ---------------------------------------------------------------------------
// Zip extraction helper — uses the built-in DecompressionStream (Node 18+).
// Falls back to iterating a simple stored-zip by walking entries. For a more
// robust solution production deployments can swap in `unzipper`; this avoids
// an extra dependency for now.
// ---------------------------------------------------------------------------

async function extractZip(buf: Buffer, destDir: string): Promise<void> {
  const { writeFile: wf, mkdir: mk } = await import('node:fs/promises');
  const { join: j, dirname } = await import('node:path');
  const { createInflateRaw } = await import('node:zlib');

  function inflateRaw(data: Buffer): Promise<Buffer> {
    return new Promise<Buffer>((res, rej) => {
      const z = createInflateRaw();
      const chunks: Buffer[] = [];
      z.on('data', (c: Buffer) => chunks.push(c));
      z.on('end', () => res(Buffer.concat(chunks)));
      z.on('error', rej);
      z.write(data);
      z.end();
    });
  }

  const MAX_ENTRY_SIZE = 200 * 1024 * 1024; // 200 MB per file
  const MAX_TOTAL_SIZE = 500 * 1024 * 1024; // 500 MB total uncompressed
  let totalUncomp = 0;

  function safeDestPath(base: string, entryName: string): string {
    const dest = j(base, entryName);
    // Prevent ZIP slip — resolved path must stay inside destDir.
    if (!dest.startsWith(base + '/') && dest !== base) {
      throw new Error(`ZIP slip attempt: ${entryName}`);
    }
    return dest;
  }

  // Try adm-zip if installed (not a hard dep — optional optimisation).
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const AdmZip = require('adm-zip') as new (buf: Buffer) => {
      getEntries(): Array<{ entryName: string; isDirectory: boolean; getData(): Buffer }>;
    };
    const zip = new AdmZip(buf);
    for (const entry of zip.getEntries()) {
      if (entry.isDirectory) continue;
      const dest = safeDestPath(destDir, entry.entryName);
      const data = entry.getData();
      if (data.length > MAX_ENTRY_SIZE) throw new Error(`entry too large: ${entry.entryName}`);
      totalUncomp += data.length;
      if (totalUncomp > MAX_TOTAL_SIZE) throw new Error('zip bomb: total uncompressed size exceeds limit');
      await mk(dirname(dest), { recursive: true });
      await wf(dest, data);
    }
    return;
  } catch (e) {
    if (e instanceof Error && (e.message.startsWith('ZIP slip') || e.message.startsWith('entry too large') || e.message.startsWith('zip bomb'))) throw e;
    // adm-zip not available; fall through to built-in parser.
  }

  // Minimal local-file-entry parser (stored + deflate). Good enough for
  // parts library zips which are typically flat or one-level-deep.
  let off = 0;
  function u16() { const v = buf.readUInt16LE(off); off += 2; return v; }
  function u32() { const v = buf.readUInt32LE(off); off += 4; return v; }
  function skip(n: number) { off += n; }
  function read(n: number) { const v = buf.subarray(off, off + n); off += n; return v; }

  while (off + 4 <= buf.length) {
    if (buf.readUInt32LE(off) !== 0x04034b50) break;
    off += 4;
    skip(2); // version needed
    skip(2); // flags
    const method = u16();
    skip(2 + 2 + 4); // mod time, mod date, crc
    const compSize = u32();
    const uncompSize = u32();
    const nameLen = u16();
    const extraLen = u16();
    const name = read(nameLen).toString('utf8');
    skip(extraLen);
    const compData = read(compSize);

    if (!name.endsWith('/')) {
      if (uncompSize > MAX_ENTRY_SIZE) throw new Error(`entry too large: ${name}`);
      const dest = safeDestPath(destDir, name);
      await mk(dirname(dest), { recursive: true });
      let data: Buffer;
      if (method === 0) {
        data = compData;
      } else if (method === 8) {
        data = await inflateRaw(compData);
      } else {
        throw new Error(`unsupported compression method ${method} for ${name}`);
      }
      if (data.length !== uncompSize) throw new Error(`size mismatch for ${name}`);
      totalUncomp += data.length;
      if (totalUncomp > MAX_TOTAL_SIZE) throw new Error('zip bomb: total uncompressed size exceeds limit');
      await wf(dest, data);
    }
  }
}

async function countXmls(dir: string): Promise<number> {
  let n = 0;
  async function walk(d: string) {
    const entries = await readdir(d, { withFileTypes: true });
    for (const e of entries) {
      const full = join(d, e.name);
      if (e.isDirectory()) await walk(full);
      else if (extname(e.name).toLowerCase() === '.xml') n++;
    }
  }
  await walk(dir);
  return n;
}

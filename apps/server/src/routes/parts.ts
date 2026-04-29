// Serves the parts catalog metadata. The bundled library is large
// (550+ parts) but constant per deploy — we scan it lazily once and
// cache the slim wire shape. Custom parts (per-user uploads, Phase 6.5)
// are merged in per request because they're cheap to query and we
// want them to surface immediately after upload.
//
// Response includes a `source` discriminator on every part:
//   - 'bundled' → sprite at /parts/<spritePath>
//   - 'custom'  → sprite at /api/custom-parts/<id>/sprite (auth required)

import { resolve } from 'node:path';
import { Buffer } from 'node:buffer';
import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { parsePartXml, scanCatalog } from '@cld/parts-catalog';
import type { PartMetadata } from '@cld/parts-catalog';
import { db, schema } from '../db/index.js';
import { env } from '../env.js';
import { requireUser } from '../auth/cookie.js';

interface ConnectionPointWire {
  type: string;
  x: number;
  y: number;
  angle: number;
  electricPlug: number;
}

interface PartWire {
  key: string;
  partNumber: string;
  colorCode: string;
  kind: 'leaf' | 'group';
  description: string;
  sortingKey: string;
  spritePath: string;
  pxPerStud: number;
  /**
   * Catalog connection points in local-part-coords (studs). Used by:
   *   - the editor's connectivity recompute
   *   - rendering connection-point markers (Phase 3 polish)
   * Empty for parts that never connect (most decorative bricks).
   */
  connections: ConnectionPointWire[];
  /**
   * Where this part came from. Drives sprite-URL resolution + UI
   * grouping. Defaults to 'bundled' so existing clients keep working.
   */
  source: 'bundled' | 'custom';
  /**
   * For 'custom' parts: the id of the row in `custom_parts`. Lets the
   * editor compose `/api/custom-parts/:id/sprite` without a separate
   * lookup. Always null for bundled parts.
   */
  customPartId: string | null;
}

let bundledCache: { etag: string; wire: PartWire[] } | null = null;

export async function partsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/parts/catalog', async (req, reply) => {
    const bundled = await loadBundled(app);

    // Custom parts visible to this user. attachUser populates req.user
    // even on this endpoint — anonymous callers still get the bundled
    // catalog (no custom parts) so the docs site / public previews
    // can hit it without a session.
    const user = req.user;
    let customWire: PartWire[] = [];
    if (user) {
      try {
        customWire = await loadCustom(user.id);
      } catch (err) {
        app.log.warn({ err }, 'custom parts merge failed; serving bundled only');
      }
    }

    // ETag includes the user id + count of custom parts so a fresh
    // upload busts the cache for that user without touching the
    // bundled cache. Falls back to anonymous when no user.
    const etag = user
      ? `"${bundled.etag.slice(1, -1)}-u-${user.id.slice(0, 8)}-${customWire.length}"`
      : bundled.etag;
    reply.header('etag', etag);
    reply.header('cache-control', 'private, max-age=60');
    if (req.headers['if-none-match'] === etag) {
      return reply.code(304).send();
    }
    return { parts: [...bundled.wire, ...customWire] };
  });
}

async function loadBundled(
  app: FastifyInstance,
): Promise<{ etag: string; wire: PartWire[] }> {
  if (bundledCache) return bundledCache;

  const partsRoot = resolve(env.partsDir, 'parts');
  try {
    const result = await scanCatalog(partsRoot);
    if (result.errors.length > 0) {
      app.log.warn({ count: result.errors.length }, 'parts catalog scan: some XML files unreadable');
    }
    const wire = Array.from(result.catalog.values()).map(toBundledWire);
    const etag = `"${Date.now().toString(36)}-${wire.length}"`;
    bundledCache = { etag, wire };
    return bundledCache;
  } catch (err) {
    app.log.error({ err }, 'failed to scan parts library');
    bundledCache = { etag: '"empty-0"', wire: [] };
    return bundledCache;
  }
}

async function loadCustom(userId: string): Promise<PartWire[]> {
  // Three sources of custom parts the user can see (same shape as the
  // /api/custom-parts list endpoint):
  //   1. ownerUserId === user.id
  //   2. ownerOrgId joined to org_members where user.id matches
  //   3. explicit collaborator on custom_part_collaborators
  const personal = await db
    .select()
    .from(schema.customParts)
    .where(eq(schema.customParts.ownerUserId, userId));
  const orgOwned = await db
    .select({ part: schema.customParts })
    .from(schema.orgMembers)
    .innerJoin(
      schema.customParts,
      eq(schema.customParts.ownerOrgId, schema.orgMembers.orgId),
    )
    .where(eq(schema.orgMembers.userId, userId));
  const shared = await db
    .select({ part: schema.customParts })
    .from(schema.customPartCollaborators)
    .innerJoin(
      schema.customParts,
      eq(schema.customParts.id, schema.customPartCollaborators.customPartId),
    )
    .where(eq(schema.customPartCollaborators.userId, userId));

  const seen = new Set<string>();
  const all: PartWire[] = [];
  for (const part of [...personal, ...orgOwned.map((o) => o.part), ...shared.map((s) => s.part)]) {
    if (seen.has(part.id)) continue;
    seen.add(part.id);
    all.push(customRowToWire(part));
  }
  return all;
}

function toBundledWire(p: PartMetadata): PartWire {
  return {
    key: p.key,
    partNumber: p.partNumber,
    colorCode: p.colorCode,
    kind: p.kind,
    description: pickDescription(p.descriptions),
    sortingKey: p.sortingKey,
    spritePath: p.spritePath,
    pxPerStud: p.pxPerStud,
    connections: p.connections.map((c) => ({
      type: c.type,
      x: c.x,
      y: c.y,
      angle: c.angle,
      electricPlug: c.electricPlug,
    })),
    source: 'bundled',
    customPartId: null,
  };
}

function customRowToWire(p: typeof schema.customParts.$inferSelect): PartWire {
  // Parse the stored XML to extract connection points + pxPerStud so
  // the connectivity recompute treats custom parts the same way as
  // bundled. Wrap in try/catch — a malformed upload shouldn't break
  // the whole catalog response.
  let connections: ConnectionPointWire[] = [];
  let pxPerStud = 8;
  let kind: 'leaf' | 'group' = 'leaf';
  try {
    const xml = Buffer.from(p.xmlBlob as Uint8Array).toString('utf8');
    const parsed = parsePartXml(xml, {
      partNumber: p.partNumber,
      colorCode: '',
      spritePath: '',
    });
    connections = parsed.connections.map((c) => ({
      type: c.type,
      x: c.x,
      y: c.y,
      angle: c.angle,
      electricPlug: c.electricPlug,
    }));
    pxPerStud = parsed.pxPerStud;
    kind = parsed.kind;
  } catch {
    /* malformed — fall back to defaults; the part still renders as a sprite */
  }

  // The "key" namespace is `custom:<id>` so it can never collide with
  // a bundled part's `<partNumber>.<colorCode>` slug.
  return {
    key: `custom:${p.id}`,
    partNumber: p.partNumber,
    colorCode: '',
    kind,
    description: p.displayName,
    // Group all custom parts under a high-numbered sortingKey so they
    // sort to the end of the bundled list. Override per-owner if we
    // want finer grouping later.
    sortingKey: p.ownerOrgId ? 'Z2-org-custom' : 'Z1-my-custom',
    // Empty bundled-relative path; the editor uses `customPartId` to
    // build the sprite URL instead.
    spritePath: '',
    pxPerStud,
    connections,
    source: 'custom',
    customPartId: p.id,
  };
}

function pickDescription(descriptions: Record<string, string>): string {
  return (
    descriptions.en ??
    descriptions.fr ??
    Object.values(descriptions)[0] ??
    ''
  );
}

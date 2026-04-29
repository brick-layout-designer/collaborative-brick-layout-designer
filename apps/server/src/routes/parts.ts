// Serves the parts catalog metadata. The library is large (550+ parts) but
// constant per deploy — we scan it lazily once and cache the slim wire shape
// for all subsequent requests.

import { resolve } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { scanCatalog } from '@cld/parts-catalog';
import type { PartMetadata } from '@cld/parts-catalog';
import { env } from '../env.js';

interface PartWire {
  key: string;
  partNumber: string;
  colorCode: string;
  kind: 'leaf' | 'group';
  description: string;
  sortingKey: string;
  spritePath: string;
  pxPerStud: number;
  /** True if the part has any catalog connection points. Useful for the parts panel. */
  hasConnections: boolean;
}

let cache: { etag: string; wire: PartWire[] } | null = null;

export async function partsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/parts/catalog', async (req, reply) => {
    const data = await loadCache(app);
    reply.header('etag', data.etag);
    reply.header('cache-control', 'public, max-age=300');
    if (req.headers['if-none-match'] === data.etag) {
      return reply.code(304).send();
    }
    return { parts: data.wire };
  });
}

async function loadCache(app: FastifyInstance): Promise<{ etag: string; wire: PartWire[] }> {
  if (cache) return cache;

  const partsRoot = resolve(env.partsDir, 'parts');
  try {
    const result = await scanCatalog(partsRoot);
    if (result.errors.length > 0) {
      app.log.warn({ count: result.errors.length }, 'parts catalog scan: some XML files unreadable');
    }
    const wire = Array.from(result.catalog.values()).map(toWire);
    // ETag = scan-time + count. Good enough for a stable single-host deploy
    // and changes whenever the server restarts (which is when the
    // submodule could have been updated).
    const etag = `"${Date.now().toString(36)}-${wire.length}"`;
    cache = { etag, wire };
    return cache;
  } catch (err) {
    app.log.error({ err }, 'failed to scan parts library');
    cache = { etag: '"empty-0"', wire: [] };
    return cache;
  }
}

function toWire(p: PartMetadata): PartWire {
  return {
    key: p.key,
    partNumber: p.partNumber,
    colorCode: p.colorCode,
    kind: p.kind,
    description: pickDescription(p.descriptions),
    sortingKey: p.sortingKey,
    spritePath: p.spritePath,
    pxPerStud: p.pxPerStud,
    hasConnections: p.connections.length > 0,
  };
}

function pickDescription(descriptions: Record<string, string>): string {
  // Prefer English, fall back to French (the desktop's primary author
  // language), then any other language; finally empty string.
  return (
    descriptions.en ??
    descriptions.fr ??
    Object.values(descriptions)[0] ??
    ''
  );
}

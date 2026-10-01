// GET /api/version — public build/protocol info so a non-browser client
// (the desktop app's live sync) can check compatibility before signing
// in: which server build it's talking to, which Y.Doc layout shape the
// server writes (`schemaVersion`, see packages/ydoc ids.ts), and which
// realtime protocols /ws/layout/:id speaks; which desktop versions it
// works with (`desktop`), which doc and file versions it reads and writes,
// and what it can do (`features`). See compat.ts and compat/compat.json.

import { readFileSync } from 'node:fs';
import type { FastifyInstance } from 'fastify';
import { CURRENT_SCHEMA_VERSION as SIDECAR_SCHEMA_VERSION } from '@cld/bbm';
import { DOC_MIN_READABLE, DOC_SCHEMA_VERSION } from '@cld/ydoc';
import { DESKTOP_DOWNLOAD_URL, FEATURES, desktopPolicy } from '../compat.js';

/** Realtime protocols served at /ws/layout/:id. */
export const PROTOCOLS = ['y-websocket/1'] as const;

/** The .bld-layout bundle version the web app writes (apps/web layoutFile.ts). */
export const LAYOUT_FILE_VERSION = 1;

/**
 * APP_VERSION (set at image build time) wins; otherwise the server
 * package's own version. The runtime image ships no package.json, hence
 * the fallback.
 */
export function appVersion(): string {
  if (process.env.APP_VERSION) return process.env.APP_VERSION;
  try {
    const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as {
      version?: string;
    };
    return pkg.version ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

export async function versionRoutes(app: FastifyInstance) {
  const fixed = {
    version: appVersion(),
    schemaVersion: DOC_SCHEMA_VERSION,
    protocols: [...PROTOCOLS],
    doc: { schemaVersion: DOC_SCHEMA_VERSION, minReadable: DOC_MIN_READABLE },
    sidecar: { schemaVersion: SIDECAR_SCHEMA_VERSION },
    layoutFile: { version: LAYOUT_FILE_VERSION },
    features: [...FEATURES],
  };
  // codeql[js/missing-rate-limiting] - rate limited via Fastify config.rateLimit
  app.get(
    '/api/version',
    { config: { rateLimit: { max: 120, timeWindow: '1 minute' }, apiToken: 'layouts:read' } },
    async () => {
      const policy = await desktopPolicy();
      return { ...fixed, desktop: { ...policy, downloadUrl: DESKTOP_DOWNLOAD_URL } };
    },
  );
}

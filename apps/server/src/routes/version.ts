// GET /api/version — public build/protocol info so a non-browser client
// (the desktop app's live sync) can check compatibility before signing
// in: which server build it's talking to, which Y.Doc layout shape the
// server writes (`schemaVersion`, see packages/ydoc ids.ts), and which
// realtime protocols /ws/layout/:id speaks.

import { readFileSync } from 'node:fs';
import type { FastifyInstance } from 'fastify';
import { DOC_SCHEMA_VERSION } from '@cld/ydoc';

/** Realtime protocols served at /ws/layout/:id. */
export const PROTOCOLS = ['y-websocket/1'] as const;

/**
 * APP_VERSION (set at image build time) wins; otherwise the server
 * package's own version. The runtime image ships no package.json, hence
 * the fallback.
 */
function appVersion(): string {
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
  const body = { version: appVersion(), schemaVersion: DOC_SCHEMA_VERSION, protocols: [...PROTOCOLS] };
  // codeql[js/missing-rate-limiting] - rate limited via Fastify config.rateLimit
  app.get(
    '/api/version',
    { config: { rateLimit: { max: 120, timeWindow: '1 minute' } } },
    async () => body,
  );
}

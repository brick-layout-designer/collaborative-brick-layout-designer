import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import fastifyMultipart from '@fastify/multipart';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { db } from './db/index.js';
import { env } from './env.js';
import { attachUser } from './auth/cookie.js';
import { ensureBootstrapAdmin } from './auth/bootstrap.js';
import { registerDesktopGate } from './compat.js';
import { syncLibrariesFromDisk } from './routes/admin.js';
import { registerLimitHooks } from './limits/hooks.js';
import { registerRequestMetrics } from './metrics/activity.js';
import { startRollup, stopRollup } from './metrics/rollup.js';
import { startWorkers, stopWorkers } from './workers/index.js';
import { registerSecurityHeaders } from './utils/securityHeaders.js';
import { registerApiRoutes } from './routes/all.js';
import { registerChangeHints } from './events/routeHints.js';
import { setHintErrorLogger } from './events/audience.js';
import { stopEvents } from './routes/events.js';

async function main() {
  // Run pending migrations on boot. Idempotent.
  migrate(db, { migrationsFolder: resolve('./migrations') });
  await ensureBootstrapAdmin();
  await syncLibrariesFromDisk(env.partsDir, console);

  // 10MB body limit — large `.bbm` imports (XML payload) routinely exceed
  // the default 1MB. Real desktop layouts run ~500KB; cap at 10MB to give
  // plenty of headroom while still rejecting obvious DoS shapes.
  // trustProxy: behind a reverse proxy, req.ip (used by the rate
  // limiter and logs) is otherwise the proxy's address for every client.
  const app = Fastify({ logger: true, bodyLimit: 10 * 1024 * 1024, trustProxy: env.trustProxy });

  await app.register(helmet, {
    contentSecurityPolicy: false, // SPA sets its own; API responses are JSON
    crossOriginEmbedderPolicy: false,
  });
  // …but /api/* and /parts/* responses (which can carry user-uploaded
  // bytes) get a locked-down sandbox policy. Registered on the root
  // instance before any routes so it covers every plugin, including the
  // static /parts/* servers below.
  registerSecurityHeaders(app);
  await app.register(cors, {
    origin: env.publicUrl,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  });
  await app.register(rateLimit, {
    global: false, // applied per-route where needed
  });
  await app.register(cookie);
  await app.register(fastifyMultipart);

  app.addHook('preHandler', attachUser);
  // Admin dashboard counters (aggregate only — see metrics/rollup.ts).
  registerRequestMetrics(app);
  // Usage limits: request rates per person and per token, read-only
  // suspended accounts, per-person request counts (limits/hooks.ts).
  registerLimitHooks(app);
  // Desktop apps older than the minimum get a clear "please update" (426).
  registerDesktopGate(app);

  // codeql[js/missing-rate-limiting] - rate limited via Fastify config.rateLimit
  app.get('/api/health', { config: { rateLimit: { max: 120, timeWindow: '1 minute' } } }, async () => ({ ok: true }));
  // Deeper /api/health/ready: confirms DB is reachable. Useful as a
  // container readiness probe (k8s, docker compose health-check).
  // codeql[js/missing-rate-limiting] - rate limited via Fastify config.rateLimit
  app.get('/api/health/ready', { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (_req, reply) => {
    try {
      // Cheap query that exercises the SQLite connection.
      const { sqlite } = await import('./db/index.js');
      const row = sqlite.prepare('SELECT 1 AS ok').get() as { ok: number } | undefined;
      if (row?.ok !== 1) throw new Error('db ping returned unexpected shape');
      return { ok: true, db: 'ready' };
    } catch (err) {
      return reply.code(503).send({ ok: false, error: (err as Error).message });
    }
  });

  // Live change hints for GET /api/events (events/routeHints.ts).
  registerChangeHints(app);
  setHintErrorLogger((err) => app.log.warn({ err }, 'live hint failed'));
  await registerApiRoutes(app);

  // Serve the BlueBrickParts base library at /parts/*.
  // The submodule organises files under PARTS_DIR/parts/ so we point there.
  const partsRoot = resolve(env.partsDir, 'parts');
  if (existsSync(partsRoot)) {
    await app.register(fastifyStatic, {
      root: partsRoot,
      prefix: '/parts/',
      decorateReply: false,
      cacheControl: true,
      maxAge: '30d',
      immutable: true,
    });
  } else {
    app.log.warn(`parts library not found at ${partsRoot}; /parts/* disabled`);
  }

  // Serve downloaded libraries at /parts/libraries/<slug>/*.
  // Each library is extracted into PARTS_DIR/libraries/<slug>/ and its
  // sprite paths are prefixed with "libraries/<slug>/" in the catalog.
  const libsRoot = resolve(env.partsDir, 'libraries');
  if (existsSync(libsRoot)) {
    await app.register(fastifyStatic, {
      root: libsRoot,
      prefix: '/parts/libraries/',
      decorateReply: false,
      cacheControl: true,
      maxAge: '30d',
      immutable: true,
    });
  }

  // Serve the SPA (built by `apps/web`) from /web/dist when present.
  // In dev, run `pnpm --filter @cld/web dev` separately on :5173 — Vite
  // proxies /api and /ws to this server.
  //
  // The SPA fallback (`setNotFoundHandler` -> serve index.html for any
  // non-API path) used to call `reply.sendFile` — but BOTH static
  // registrations pass `decorateReply: false` (the parts registration
  // does it for a tiny perf win; the SPA registration inherited it),
  // so `reply.sendFile` is undefined and a hard refresh on `/library`,
  // `/orgs/...`, etc. produced a 500. Cache `index.html` at boot and
  // serve its bytes directly so we don't depend on any reply decoration.
  const spaDir = resolve('../web/dist');
  const spaIndexPath = resolve(spaDir, 'index.html');
  let spaIndexHtml: string | null = null;
  try {
    if (existsSync(spaIndexPath)) {
      const { readFileSync } = await import('node:fs');
      spaIndexHtml = readFileSync(spaIndexPath, 'utf8');
    }
  } catch (err) {
    app.log.warn({ err }, `failed to cache SPA index.html from ${spaIndexPath}`);
  }
  if (spaIndexHtml !== null) {
    await app.register(fastifyStatic, {
      root: spaDir,
      prefix: '/',
      decorateReply: false,
      wildcard: false,
    });
    const indexBytes = spaIndexHtml; // capture for the closure
    app.setNotFoundHandler(async (req, reply) => {
      if (req.url.startsWith('/api/')) return reply.code(404).send({ error: 'not_found' });
      reply.header('content-type', 'text/html; charset=utf-8');
      // Don't cache — the SPA bundle hash is in the linked assets;
      // if `index.html` itself is cached, deploys break for users
      // whose browser still has the previous version.
      reply.header('cache-control', 'no-cache');
      return reply.send(indexBytes);
    });
  } else {
    app.log.warn(`SPA dist not found at ${spaDir}; serving API only`);
  }

  startWorkers();
  startRollup();
  app.addHook('preClose', async () => {
    stopEvents();
  });
  app.addHook('onClose', async () => {
    stopWorkers();
    stopRollup();
  });

  await app.listen({ port: env.port, host: '0.0.0.0' });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

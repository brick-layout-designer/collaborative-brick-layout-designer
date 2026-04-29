import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { db } from './db/index.js';
import { env } from './env.js';
import { attachUser } from './auth/cookie.js';
import { ensureBootstrapAdmin } from './auth/bootstrap.js';
import { oauthRoutes } from './routes/auth/oauth.js';
import { passwordRoutes } from './routes/auth/password.js';
import { sessionRoutes } from './routes/auth/session.js';
import { layoutRoutes } from './routes/layouts.js';
import { partsRoutes } from './routes/parts.js';
import { wsRoutes } from './routes/ws.js';

async function main() {
  // Run pending migrations on boot. Idempotent.
  migrate(db, { migrationsFolder: resolve('./migrations') });
  await ensureBootstrapAdmin();

  // 10MB body limit — large `.bbm` imports (XML payload) routinely exceed
  // the default 1MB. Real desktop layouts run ~500KB; cap at 10MB to give
  // plenty of headroom while still rejecting obvious DoS shapes.
  const app = Fastify({ logger: true, bodyLimit: 10 * 1024 * 1024 });

  await app.register(cookie);

  app.addHook('preHandler', attachUser);

  app.get('/api/health', async () => ({ ok: true }));

  await app.register(oauthRoutes);
  await app.register(passwordRoutes);
  await app.register(sessionRoutes);
  await app.register(layoutRoutes);
  await app.register(partsRoutes);
  await app.register(wsRoutes);

  // Serve the BlueBrickParts library at /parts/*. The desktop's submodule
  // organises files under `parts-library/parts/`, so we point at that
  // subdirectory directly. In Docker the host bind-mounts the submodule at
  // `/parts`; in local dev the submodule lives at `../../parts-library`.
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

  // Serve the SPA (built by `apps/web`) from /web/dist when present.
  // In dev, run `pnpm --filter @cld/web dev` separately on :5173 — Vite
  // proxies /api and /ws to this server.
  const spaDir = resolve('../web/dist');
  try {
    await app.register(fastifyStatic, {
      root: spaDir,
      prefix: '/',
      decorateReply: false,
      wildcard: false,
    });
    app.setNotFoundHandler(async (req, reply) => {
      if (req.url.startsWith('/api/')) return reply.code(404).send({ error: 'not_found' });
      return reply.sendFile('index.html', spaDir);
    });
  } catch {
    app.log.warn(`SPA dist not found at ${spaDir}; serving API only`);
  }

  await app.listen({ port: env.port, host: '0.0.0.0' });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

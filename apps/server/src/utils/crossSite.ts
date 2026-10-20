// Changes to the API from a browser must come from this site. The session
// cookie is SameSite=Lax, which keeps other sites' requests from carrying
// it, but every host under the same registrable domain counts as the same
// site, and sign-in routes set a cookie rather than read one. So a
// state-changing /api request (POST, PUT, PATCH, DELETE) that a browser
// sends from another origin is refused:
//   - an Origin header that isn't PUBLIC_URL's origin;
//   - no Origin, but Sec-Fetch-Site says cross-site or same-site.
// Requests with neither header come from something that isn't a browser
// (the desktop app, scripts) and carry no ambient cookie risk; Bearer
// (desktop token) requests are never cookie-authenticated, so they pass.
// The WebSocket handshake has its own check (routes/ws.ts).

import type { FastifyInstance, FastifyRequest } from 'fastify';
import { env } from '../env.js';

const WRITES = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function apiPath(url: string): boolean {
  const path = url.split('?')[0] ?? '';
  let decoded = path;
  try {
    decoded = decodeURIComponent(path);
  } catch {
    // Fastify refuses a malformed path itself.
  }
  return path.startsWith('/api/') || decoded.startsWith('/api/');
}

/** Whether a request is a browser's state-changing API call from somewhere other than this site. */
export function isCrossSiteWrite(req: Pick<FastifyRequest, 'method' | 'url' | 'headers'>, publicUrl = env.publicUrl): boolean {
  if (!WRITES.has(req.method) || !apiPath(req.url)) return false;
  const auth = req.headers.authorization;
  if (typeof auth === 'string' && /^Bearer\s/i.test(auth)) return false;
  const origin = req.headers.origin;
  if (typeof origin === 'string') {
    try {
      return new URL(origin).origin !== new URL(publicUrl).origin;
    } catch {
      return true; // "null" and other opaque origins
    }
  }
  const site = req.headers['sec-fetch-site'];
  return site === 'cross-site' || site === 'same-site';
}

export function registerCrossSiteGuard(app: FastifyInstance): void {
  app.addHook('onRequest', async (req, reply) => {
    if (isCrossSiteWrite(req)) {
      req.log.warn({ origin: req.headers.origin, site: req.headers['sec-fetch-site'] }, 'refused a cross-site write');
      return reply.code(403).send({ error: 'cross_site_request' });
    }
  });
}

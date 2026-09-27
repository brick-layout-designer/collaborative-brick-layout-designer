// Defence-in-depth headers for responses that carry user- or
// admin-supplied bytes: everything under /api/* (JSON, exports, custom
// part XML/sprites, background images) and /parts/* (bundled and
// admin-installed part libraries, which are extracted from arbitrary
// zips and could contain .html/.svg).
//
// `default-src 'none'; sandbox` means that even if such a response is
// ever rendered as a document on our origin (opened directly, sniffed as
// HTML, an SVG with script), it gets an opaque origin with scripts
// disabled — so it can't read cookies or call the API as the victim.
// Images rendered through <img> are unaffected: CSP on an image response
// only applies when the image itself is navigated to.
//
// The SPA (served from `/`) is deliberately NOT covered; it ships its own
// policy.

import type { FastifyInstance } from 'fastify';

export const SANDBOX_CSP = "default-src 'none'; frame-ancestors 'none'; sandbox";

export function isSandboxedPath(url: string): boolean {
  return url.startsWith('/api/') || url.startsWith('/parts/');
}

export function registerSecurityHeaders(app: FastifyInstance): void {
  app.addHook('onSend', async (req, reply, payload) => {
    if (isSandboxedPath(req.url)) {
      reply.header('Content-Security-Policy', SANDBOX_CSP);
      reply.header('X-Content-Type-Options', 'nosniff');
    }
    return payload;
  });
}

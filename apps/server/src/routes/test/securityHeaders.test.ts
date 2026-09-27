// Regression tests for stored-XSS hardening:
//   - uploaded custom-part XML is served as a text/plain attachment
//   - /api/* and /parts/* responses carry a sandbox CSP + nosniff

import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import { beforeEach, describe, expect, it } from 'vitest';
import { loginAs, resetDb } from '../../test/helpers.js';
import { attachUser } from '../../auth/cookie.js';
import { passwordRoutes } from '../auth/password.js';
import { customPartRoutes } from '../customParts.js';
import { registerSecurityHeaders, SANDBOX_CSP } from '../../utils/securityHeaders.js';

const XHTML = '<html xmlns="http://www.w3.org/1999/xhtml"><script>alert(document.cookie)</script></html>';

async function buildApp(staticRoot?: string): Promise<FastifyInstance> {
  const app = Fastify({ bodyLimit: 10 * 1024 * 1024 });
  registerSecurityHeaders(app);
  await app.register(cookie);
  app.addHook('preHandler', attachUser);
  await app.register(passwordRoutes);
  await app.register(customPartRoutes);
  if (staticRoot) {
    await app.register(fastifyStatic, { root: staticRoot, prefix: '/parts/libraries/', decorateReply: false });
  }
  app.get('/spa-route', async () => 'spa');
  return app;
}

describe('stored XSS hardening', () => {
  beforeEach(() => resetDb());

  it('serves uploaded part XML as a text/plain attachment, never inline XML', async () => {
    const app = await buildApp();
    const a = await loginAs(app, 'a@x.com');
    const created = await app.inject({
      method: 'POST',
      url: '/api/custom-parts',
      headers: { cookie: a.cookie },
      payload: {
        partNumber: 'P',
        displayName: 'P',
        xmlBase64: Buffer.from(XHTML).toString('base64'),
        spriteBase64: 'R0lGODlh',
        spriteMime: 'image/gif',
      },
    });
    expect(created.statusCode).toBe(201);
    const id = (created.json() as { id: string }).id;

    const res = await app.inject({
      method: 'GET',
      url: `/api/custom-parts/${id}/xml`,
      headers: { cookie: a.cookie },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/^text\/plain/);
    expect(res.headers['content-disposition']).toMatch(/^attachment/);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['content-security-policy']).toBe(SANDBOX_CSP);
    expect(res.body).toBe(XHTML);
    await app.close();
  });

  it('sandboxes files served from /parts/libraries/* (e.g. html/svg from an installed zip)', async () => {
    const root = mkdtempSync(join(tmpdir(), 'cld-libs-'));
    try {
      mkdirSync(join(root, 'evil'));
      writeFileSync(join(root, 'evil', 'x.svg'), '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
      const app = await buildApp(root);
      const res = await app.inject({ method: 'GET', url: '/parts/libraries/evil/x.svg' });
      expect(res.statusCode).toBe(200);
      expect(res.headers['content-security-policy']).toBe(SANDBOX_CSP);
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      await app.close();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('covers JSON API errors too, but leaves non-API (SPA) routes alone', async () => {
    const app = await buildApp();
    const api = await app.inject({ method: 'GET', url: '/api/custom-parts' });
    expect(api.statusCode).toBe(401);
    expect(api.headers['content-security-policy']).toBe(SANDBOX_CSP);
    const spa = await app.inject({ method: 'GET', url: '/spa-route' });
    expect(spa.headers['content-security-policy']).toBeUndefined();
    await app.close();
  });
});

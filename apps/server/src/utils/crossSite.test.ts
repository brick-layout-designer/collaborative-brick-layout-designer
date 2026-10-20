import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { attachUser } from '../auth/cookie.js';
import { passwordRoutes } from '../routes/auth/password.js';
import { sessionRoutes } from '../routes/auth/session.js';
import { loginAs, resetDb } from '../test/helpers.js';
import { isCrossSiteWrite, registerCrossSiteGuard } from './crossSite.js';

const SITE = 'http://localhost:3000'; // PUBLIC_URL in test/setup.ts

describe('isCrossSiteWrite', () => {
  const req = (method: string, url: string, headers: Record<string, string> = {}) => ({ method, url, headers });

  it('lets this site, non-browser clients and desktop tokens write', () => {
    expect(isCrossSiteWrite(req('POST', '/api/layouts', { origin: SITE }), SITE)).toBe(false);
    expect(isCrossSiteWrite(req('POST', '/api/layouts', { 'sec-fetch-site': 'same-origin' }), SITE)).toBe(false);
    expect(isCrossSiteWrite(req('POST', '/api/layouts'), SITE)).toBe(false);
    expect(isCrossSiteWrite(req('POST', '/api/layouts', { origin: 'https://other.example', authorization: 'Bearer x' }), SITE)).toBe(false);
  });

  it('refuses browser writes from anywhere else', () => {
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      expect(isCrossSiteWrite(req(method, '/api/layouts/x', { origin: 'https://other.example' }), SITE), method).toBe(true);
    }
    expect(isCrossSiteWrite(req('POST', '/api/auth/logout', { origin: 'null' }), SITE)).toBe(true);
    expect(isCrossSiteWrite(req('POST', '/api/auth/logout', { origin: 'http://localhost:3001' }), SITE)).toBe(true);
    expect(isCrossSiteWrite(req('POST', '/api/auth/demo', { 'sec-fetch-site': 'same-site' }), SITE)).toBe(true);
    expect(isCrossSiteWrite(req('POST', '/api/auth/demo', { 'sec-fetch-site': 'cross-site' }), SITE)).toBe(true);
    expect(isCrossSiteWrite(req('POST', '/%61pi/auth/demo', { origin: 'https://other.example' }), SITE)).toBe(true);
  });

  it('leaves reads and pages outside /api alone', () => {
    expect(isCrossSiteWrite(req('GET', '/api/layouts', { origin: 'https://other.example' }), SITE)).toBe(false);
    expect(isCrossSiteWrite(req('POST', '/somewhere', { origin: 'https://other.example' }), SITE)).toBe(false);
  });
});

describe('the cross-site guard on real routes', () => {
  let app: FastifyInstance;
  let session: string;
  beforeAll(async () => {
    resetDb();
    app = Fastify();
    registerCrossSiteGuard(app);
    await app.register(cookie);
    app.addHook('preHandler', attachUser);
    await app.register(passwordRoutes);
    await app.register(sessionRoutes);
    await app.ready();
    session = (await loginAs(app, 'guard@example.com')).cookie;
  });
  afterAll(async () => {
    await app.close();
  });

  it('refuses a sign-in or sign-out sent from another site, in any body type', async () => {
    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/password/login',
      headers: { origin: 'https://other.example' },
      payload: { email: 'guard@example.com', password: 'correct horse battery' },
    });
    expect(login.statusCode).toBe(403);
    expect(login.json()).toEqual({ error: 'cross_site_request' });
    expect(login.headers['set-cookie']).toBeUndefined();
    const logout = await app.inject({
      method: 'POST',
      url: '/api/auth/logout',
      headers: { cookie: session, origin: 'https://other.example', 'content-type': 'text/plain' },
      payload: 'x',
    });
    expect(logout.statusCode).toBe(403);
    // The session still works.
    const me = await app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie: session } });
    expect(me.json()).toMatchObject({ user: { email: 'guard@example.com' } });
  });

  it('lets the site itself sign in', async () => {
    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/password/login',
      headers: { origin: SITE },
      payload: { email: 'guard@example.com', password: 'correct horse battery' },
    });
    expect(login.statusCode).toBe(200);
  });
});

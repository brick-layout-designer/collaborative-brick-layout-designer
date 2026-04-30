import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetDb } from '../../test/helpers.js';
import { attachUser } from '../../auth/cookie.js';
import { passwordRoutes } from './password.js';
import { sessionRoutes } from './session.js';

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify();
  await app.register(cookie);
  app.addHook('preHandler', attachUser);
  await app.register(passwordRoutes);
  await app.register(sessionRoutes);
  return app;
}

describe('password auth routes', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    resetDb();
    app = await buildApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it('register → session cookie → /me echoes the user', async () => {
    const register = await app.inject({
      method: 'POST',
      url: '/api/auth/password/register',
      payload: { email: 'alice@example.com', password: 'correct horse battery', displayName: 'Alice' },
    });
    expect(register.statusCode).toBe(200);

    const setCookie = register.headers['set-cookie'];
    const cookieStr = Array.isArray(setCookie) ? setCookie.join('; ') : (setCookie ?? '');
    expect(cookieStr).toContain('cld_session=');
    expect(cookieStr).toContain('HttpOnly');
    expect(cookieStr).toContain('SameSite=Lax');

    const me = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { cookie: cookieStr },
    });
    expect(me.statusCode).toBe(200);
    const meBody = me.json() as { user: { email: string; displayName: string } | null };
    expect(meBody.user?.email).toBe('alice@example.com');
    expect(meBody.user?.displayName).toBe('Alice');
  });

  it('rejects passwords shorter than 8 chars', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/password/register',
      payload: { email: 'short@example.com', password: 'short' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects duplicate email registration', async () => {
    const payload = { email: 'dup@example.com', password: 'correct horse battery' };
    const first = await app.inject({ method: 'POST', url: '/api/auth/password/register', payload });
    expect(first.statusCode).toBe(200);
    const second = await app.inject({ method: 'POST', url: '/api/auth/password/register', payload });
    expect(second.statusCode).toBe(409);
  });

  it('login with the right password returns a session', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/auth/password/register',
      payload: { email: 'bob@example.com', password: 'correct horse battery' },
    });
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/password/login',
      payload: { email: 'bob@example.com', password: 'correct horse battery' },
    });
    expect(res.statusCode).toBe(200);
    const setCookie = res.headers['set-cookie'];
    const cookieStr = Array.isArray(setCookie) ? setCookie.join('; ') : (setCookie ?? '');
    expect(cookieStr).toContain('cld_session=');
  });

  it('login with wrong password returns 401 and no cookie', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/auth/password/register',
      payload: { email: 'carol@example.com', password: 'correct horse battery' },
    });
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/password/login',
      payload: { email: 'carol@example.com', password: 'wrong wrong wrong' },
    });
    expect(res.statusCode).toBe(401);
    expect(res.headers['set-cookie']).toBeUndefined();
  });

  it('login for unknown email returns 401 (does not leak existence)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/password/login',
      payload: { email: 'nobody@example.com', password: 'correct horse battery' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('logout clears the session cookie', async () => {
    const register = await app.inject({
      method: 'POST',
      url: '/api/auth/password/register',
      payload: { email: 'dave@example.com', password: 'correct horse battery' },
    });
    const setCookie = register.headers['set-cookie'];
    const cookieStr = Array.isArray(setCookie) ? setCookie.join('; ') : (setCookie ?? '');

    const logout = await app.inject({
      method: 'POST',
      url: '/api/auth/logout',
      headers: { cookie: cookieStr },
    });
    expect(logout.statusCode).toBe(200);

    const me = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { cookie: cookieStr },
    });
    const meBody = me.json() as { user: unknown };
    expect(meBody.user).toBeNull();
  });
});

import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetDb } from '../../test/helpers.js';
import { attachUser } from '../../auth/cookie.js';
import { db, schema } from '../../db/index.js';
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

/** No SMTP is configured in tests, so the link never gets emailed — pull the live token straight from the DB, the way the server log fallback would print it. */
async function tokenFor(email: string): Promise<string> {
  const user = await db.select().from(schema.users).where(eq(schema.users.email, email)).get();
  const verification = await db
    .select()
    .from(schema.emailVerifications)
    .where(eq(schema.emailVerifications.userId, user!.id))
    .get();
  return verification!.token;
}

function cookieHeader(res: { headers: Record<string, unknown> }): string {
  const setCookie = res.headers['set-cookie'];
  return Array.isArray(setCookie) ? setCookie.join('; ') : ((setCookie as string | undefined) ?? '');
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

  it('register does not log in yet — no session cookie, verificationRequired flag set', async () => {
    const register = await app.inject({
      method: 'POST',
      url: '/api/auth/password/register',
      payload: { email: 'alice@example.com', password: 'correct horse battery', displayName: 'Alice' },
    });
    expect(register.statusCode).toBe(200);
    expect((register.json() as { verificationRequired: boolean }).verificationRequired).toBe(true);
    expect(register.headers['set-cookie']).toBeUndefined();

    const me = await app.inject({ method: 'GET', url: '/api/auth/me' });
    expect((me.json() as { user: unknown }).user).toBeNull();
  });

  it('login before verifying returns 403 email_not_verified', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/auth/password/register',
      payload: { email: 'alice@example.com', password: 'correct horse battery' },
    });
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/password/login',
      payload: { email: 'alice@example.com', password: 'correct horse battery' },
    });
    expect(res.statusCode).toBe(403);
    expect((res.json() as { error: string }).error).toBe('email_not_verified');
    expect(res.headers['set-cookie']).toBeUndefined();
  });

  it('verify-email with the emailed token logs the user in, then login works too', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/auth/password/register',
      payload: { email: 'alice@example.com', password: 'correct horse battery', displayName: 'Alice' },
    });
    const token = await tokenFor('alice@example.com');

    const verify = await app.inject({ method: 'POST', url: `/api/auth/password/verify-email/${token}` });
    expect(verify.statusCode).toBe(200);
    const verifyCookie = cookieHeader(verify);
    expect(verifyCookie).toContain('cld_session=');

    const me = await app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie: verifyCookie } });
    const meBody = me.json() as { user: { email: string; displayName: string } | null };
    expect(meBody.user?.email).toBe('alice@example.com');
    expect(meBody.user?.displayName).toBe('Alice');

    // The account can log in normally from now on.
    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/password/login',
      payload: { email: 'alice@example.com', password: 'correct horse battery' },
    });
    expect(login.statusCode).toBe(200);
    expect(cookieHeader(login)).toContain('cld_session=');
  });

  it('verify-email consumes the token — a second use 404s', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/auth/password/register',
      payload: { email: 'alice@example.com', password: 'correct horse battery' },
    });
    const token = await tokenFor('alice@example.com');
    await app.inject({ method: 'POST', url: `/api/auth/password/verify-email/${token}` });
    const second = await app.inject({ method: 'POST', url: `/api/auth/password/verify-email/${token}` });
    expect(second.statusCode).toBe(404);
  });

  it('verify-email with a bogus token returns 404', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/auth/password/verify-email/not-a-real-token' });
    expect(res.statusCode).toBe(404);
  });

  it('resend-verification issues a new, different token that also verifies', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/auth/password/register',
      payload: { email: 'alice@example.com', password: 'correct horse battery' },
    });
    const firstToken = await tokenFor('alice@example.com');

    const resend = await app.inject({
      method: 'POST',
      url: '/api/auth/password/resend-verification',
      payload: { email: 'alice@example.com' },
    });
    expect(resend.statusCode).toBe(200);

    const secondToken = await tokenFor('alice@example.com');
    expect(secondToken).not.toBe(firstToken);

    // The old token from before the resend no longer works (resend deletes it).
    const oldAttempt = await app.inject({ method: 'POST', url: `/api/auth/password/verify-email/${firstToken}` });
    expect(oldAttempt.statusCode).toBe(404);

    const verify = await app.inject({ method: 'POST', url: `/api/auth/password/verify-email/${secondToken}` });
    expect(verify.statusCode).toBe(200);
  });

  it('resend-verification returns 200 for an unknown email without leaking existence', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/password/resend-verification',
      payload: { email: 'nobody@example.com' },
    });
    expect(res.statusCode).toBe(200);
  });

  it('resend-verification is a no-op for an already-verified account', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/auth/password/register',
      payload: { email: 'alice@example.com', password: 'correct horse battery' },
    });
    const token = await tokenFor('alice@example.com');
    await app.inject({ method: 'POST', url: `/api/auth/password/verify-email/${token}` });

    const resend = await app.inject({
      method: 'POST',
      url: '/api/auth/password/resend-verification',
      payload: { email: 'alice@example.com' },
    });
    expect(resend.statusCode).toBe(200);

    const user = await db.select().from(schema.users).where(eq(schema.users.email, 'alice@example.com')).get();
    const leftoverVerification = await db
      .select()
      .from(schema.emailVerifications)
      .where(eq(schema.emailVerifications.userId, user!.id))
      .get();
    expect(leftoverVerification).toBeUndefined();
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

  it('login with the right password returns a session once verified', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/auth/password/register',
      payload: { email: 'bob@example.com', password: 'correct horse battery' },
    });
    await app.inject({ method: 'POST', url: `/api/auth/password/verify-email/${await tokenFor('bob@example.com')}` });
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/password/login',
      payload: { email: 'bob@example.com', password: 'correct horse battery' },
    });
    expect(res.statusCode).toBe(200);
    expect(cookieHeader(res)).toContain('cld_session=');
  });

  it('login with wrong password returns 401 and no cookie', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/auth/password/register',
      payload: { email: 'carol@example.com', password: 'correct horse battery' },
    });
    await app.inject({ method: 'POST', url: `/api/auth/password/verify-email/${await tokenFor('carol@example.com')}` });
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/password/login',
      payload: { email: 'carol@example.com', password: 'wrong wrong wrong' },
    });
    expect(res.statusCode).toBe(401);
    expect(res.headers['set-cookie']).toBeUndefined();
  });

  it('login returns 400 when email is missing', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/password/login',
      payload: { password: 'correct horse battery' },
    });
    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: string }).error).toBe('invalid_input');
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
    await app.inject({
      method: 'POST',
      url: '/api/auth/password/register',
      payload: { email: 'dave@example.com', password: 'correct horse battery' },
    });
    const verify = await app.inject({
      method: 'POST',
      url: `/api/auth/password/verify-email/${await tokenFor('dave@example.com')}`,
    });
    const cookieStr = cookieHeader(verify);

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

  it('logout without a session cookie still returns 200', async () => {
    const logout = await app.inject({
      method: 'POST',
      url: '/api/auth/logout',
    });
    expect(logout.statusCode).toBe(200);
    expect((logout.json() as { ok: boolean }).ok).toBe(true);
  });
});

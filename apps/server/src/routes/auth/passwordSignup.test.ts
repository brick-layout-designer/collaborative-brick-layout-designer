// Sign-up answers, verification links and choosing a password.

import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const sentLinks: { to: string; url: string; purpose: string }[] = [];
vi.mock('../../email/sendVerification.js', () => ({
  sendVerificationEmail: async (args: { to: string; verifyUrl: string; purpose?: string }) => {
    sentLinks.push({ to: args.to, url: args.verifyUrl, purpose: args.purpose ?? 'verify' });
    return false;
  },
}));
const notices: string[] = [];
vi.mock('../../email/sendSignupNotice.js', () => ({
  sendSignupNoticeEmail: async (args: { to: string }) => {
    notices.push(args.to);
    return true;
  },
}));

import { resetDb, signupCookieOf } from '../../test/helpers.js';
import { attachUser } from '../../auth/cookie.js';
import { createApiToken } from '../../auth/apiTokens.js';
import { hashToken } from '../../auth/session.js';
import { getPlatformSettings } from '../../auth/platformSettings.js';
import { db, schema } from '../../db/index.js';
import { passwordRoutes, resetSignupNoticesForTests } from './password.js';
import { sessionRoutes } from './session.js';

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify();
  await app.register(cookie);
  app.addHook('preHandler', attachUser);
  await app.register(passwordRoutes);
  await app.register(sessionRoutes);
  return app;
}

function cookieHeader(res: { headers: Record<string, unknown> }): string {
  const sc = res.headers['set-cookie'];
  return Array.isArray(sc) ? sc.join('; ') : ((sc as string | undefined) ?? '');
}

/** The session pair only, so a later request sends just that. */
function sessionOf(res: { headers: Record<string, unknown> }): string {
  const m = /cld_session=([^;]+)/.exec(cookieHeader(res));
  return m ? `cld_session=${m[1]}` : '';
}

const tokenOf = (url: string) => url.split('/verify-email/')[1]!.split('?')[0]!;
const lastToken = () => tokenOf(sentLinks.at(-1)!.url);

async function userRow(email: string) {
  return (await db.select().from(schema.users).where(eq(schema.users.email, email)).get())!;
}

describe('sign-up and email verification', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    resetDb();
    resetSignupNoticesForTests();
    sentLinks.length = 0;
    notices.length = 0;
    app = await buildApp();
  });

  afterEach(async () => {
    await app.close();
  });

  const register = (email: string, password: string, cookieStr = '') =>
    app.inject({
      method: 'POST',
      url: '/api/auth/password/register',
      payload: { email, password, displayName: 'Sam' },
      headers: cookieStr ? { cookie: cookieStr } : {},
    });
  const verify = (token: string, cookieStr = '') =>
    app.inject({
      method: 'POST',
      url: `/api/auth/password/verify-email/${token}`,
      headers: cookieStr ? { cookie: cookieStr } : {},
    });
  const login = (email: string, password: string) =>
    app.inject({ method: 'POST', url: '/api/auth/password/login', payload: { email, password } });

  it('sign-up with an address that has a verified account answers like a new one and emails the owner a note', async () => {
    const first = await register('owner@example.com', 'owner-password-1');
    await verify(lastToken(), signupCookieOf(first));
    sentLinks.length = 0;

    const again = await register('Owner@example.com', 'other-password-2');
    const fresh = await register('new-person@example.com', 'other-password-2');
    expect(again.statusCode).toBe(200);
    expect(again.json()).toEqual(fresh.json());
    expect(again.json()).toEqual({ ok: true, verificationRequired: true });
    expect(cookieHeader(again)).not.toContain('cld_session=');
    expect(cookieHeader(again)).not.toContain('cld_signup=');

    expect(notices).toEqual(['owner@example.com']);
    // No link went to the owner; only the new address got one.
    expect(sentLinks.map((l) => l.to)).toEqual(['new-person@example.com']);
    // Nothing changed: the owner's password still works, the other one doesn't.
    expect((await login('owner@example.com', 'owner-password-1')).statusCode).toBe(200);
    expect((await login('owner@example.com', 'other-password-2')).statusCode).toBe(401);

    // One note per hour at most.
    await register('owner@example.com', 'other-password-3');
    expect(notices).toEqual(['owner@example.com']);
  });

  it('the link keeps the sign-up password only in the browser that signed up', async () => {
    const reg = await register('sam@example.com', 'sam-password-1');
    const token = lastToken();
    const res = await verify(token, signupCookieOf(reg));
    expect(res.json()).toEqual({ ok: true, needsPassword: false });
    expect((await login('sam@example.com', 'sam-password-1')).statusCode).toBe(200);
  });

  it('the link opened in another browser signs in and asks for a new password; the sign-up password stops working', async () => {
    await register('pat@example.com', 'first-password-1');
    const res = await verify(lastToken());
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, needsPassword: true });
    const me = await app.inject({ url: '/api/auth/me', headers: { cookie: sessionOf(res) } });
    expect(me.json().user).toMatchObject({ email: 'pat@example.com', hasPassword: false });
    expect((await login('pat@example.com', 'first-password-1')).statusCode).toBe(401);
    expect((await userRow('pat@example.com')).emailVerified).toBe(true);

    const set = await app.inject({
      method: 'POST',
      url: '/api/auth/password/set',
      headers: { cookie: sessionOf(res) },
      payload: { password: 'chosen-password-2' },
    });
    expect(set.statusCode).toBe(200);
    expect((await login('pat@example.com', 'chosen-password-2')).statusCode).toBe(200);
  });

  it('a second sign-up for a never-verified account sends a new link; whoever opens it chooses the password', async () => {
    const first = await register('lee@example.com', 'first-password-1');
    const firstToken = lastToken();
    const second = await register('lee@example.com', 'second-password-2');
    expect(second.json()).toEqual(first.json());
    expect(cookieHeader(second)).not.toContain('cld_signup=');
    expect(sentLinks).toHaveLength(2);
    expect(notices).toEqual([]);

    // Only the newest link works, and it doesn't keep either sign-up password.
    expect((await verify(firstToken, signupCookieOf(first))).statusCode).toBe(404);
    const res = await verify(lastToken(), signupCookieOf(first));
    expect(res.json()).toEqual({ ok: true, needsPassword: true });
    expect((await login('lee@example.com', 'first-password-1')).statusCode).toBe(401);
    expect((await login('lee@example.com', 'second-password-2')).statusCode).toBe(401);
  });

  it('asking again from the browser that signed up, with the same password, keeps the link bound', async () => {
    const first = await register('kim@example.com', 'kim-password-1');
    await register('kim@example.com', 'kim-password-1', signupCookieOf(first));
    const res = await verify(lastToken(), signupCookieOf(first));
    expect(res.json()).toEqual({ ok: true, needsPassword: false });
    expect((await login('kim@example.com', 'kim-password-1')).statusCode).toBe(200);
  });

  it('a resend from another browser makes the newest link one that asks for a new password', async () => {
    const reg = await register('ash@example.com', 'ash-password-1');
    await app.inject({ method: 'POST', url: '/api/auth/password/resend-verification', payload: { email: 'ash@example.com' } });
    const res = await verify(lastToken(), signupCookieOf(reg));
    expect(res.json()).toEqual({ ok: true, needsPassword: true });
    expect((await login('ash@example.com', 'ash-password-1')).statusCode).toBe(401);
  });

  it('a resend from the browser that signed up keeps the link bound', async () => {
    const reg = await register('rio@example.com', 'rio-password-1');
    await app.inject({
      method: 'POST',
      url: '/api/auth/password/resend-verification',
      payload: { email: 'rio@example.com' },
      headers: { cookie: signupCookieOf(reg) },
    });
    const res = await verify(lastToken(), signupCookieOf(reg));
    expect(res.json()).toEqual({ ok: true, needsPassword: false });
  });

  it('verifying ends every session and API token the account had before', async () => {
    await getPlatformSettings();
    await db.update(schema.platformSettings).set({ requireEmailVerification: false });
    const reg = await register('jo@example.com', 'jo-password-1');
    const early = sessionOf(reg);
    expect(early).toContain('cld_session=');
    const user = await userRow('jo@example.com');
    // Created while verification was off, so marked verified: make it a never-verified account.
    await db.update(schema.users).set({ emailVerified: false }).where(eq(schema.users.id, user.id));
    const { row } = await createApiToken(user.id, 'desktop', ['layouts:read']);

    await db.update(schema.platformSettings).set({ requireEmailVerification: true });
    await app.inject({ method: 'POST', url: '/api/auth/password/resend-verification', payload: { email: 'jo@example.com' } });
    const res = await verify(lastToken());
    expect(res.statusCode).toBe(200);

    const before = await app.inject({ url: '/api/auth/me', headers: { cookie: early } });
    expect(before.json().user).toBeNull();
    const after = await app.inject({ url: '/api/auth/me', headers: { cookie: sessionOf(res) } });
    expect(after.json().user.email).toBe('jo@example.com');
    const token = await db.select().from(schema.apiTokens).where(eq(schema.apiTokens.id, row.id)).get();
    expect(token!.revokedAt).not.toBeNull();
  });

  it('verification tokens are kept hashed; the stored value does not work as a link', async () => {
    await register('hal@example.com', 'hal-password-1');
    const token = lastToken();
    const user = await userRow('hal@example.com');
    const row = (await db.select().from(schema.emailVerifications).where(eq(schema.emailVerifications.userId, user.id)).get())!;
    expect(row.token).toBe(hashToken(token));
    expect(row.token).not.toBe(token);
    expect((await verify(row.token)).statusCode).toBe(404);
    expect((await verify(token)).statusCode).toBe(200);
  });

  it('a link issued before tokens were hashed still works', async () => {
    await register('old@example.com', 'old-password-1');
    const user = await userRow('old@example.com');
    const legacy = 'ab'.repeat(24);
    await db.update(schema.emailVerifications).set({ token: legacy }).where(eq(schema.emailVerifications.userId, user.id));
    const res = await verify(legacy);
    expect(res.statusCode).toBe(200);
    expect((await userRow('old@example.com')).emailVerified).toBe(true);
  });

  it('an account left without a password gets a link to choose one when it signs up or asks again', async () => {
    await register('mo@example.com', 'mo-password-1');
    await verify(lastToken());
    sentLinks.length = 0;

    await register('mo@example.com', 'mo-password-2');
    expect(notices).toEqual([]);
    expect(sentLinks.at(-1)).toMatchObject({ to: 'mo@example.com', purpose: 'set-password' });
    await app.inject({ method: 'POST', url: '/api/auth/password/resend-verification', payload: { email: 'mo@example.com' } });
    expect(sentLinks.at(-1)).toMatchObject({ to: 'mo@example.com', purpose: 'set-password' });

    const res = await verify(lastToken());
    expect(res.json()).toEqual({ ok: true, needsPassword: true });
    expect((await login('mo@example.com', 'mo-password-2')).statusCode).toBe(401);
  });

  it('choosing a password needs a signed-in account without one', async () => {
    const anon = await app.inject({ method: 'POST', url: '/api/auth/password/set', payload: { password: 'some-password-1' } });
    expect(anon.statusCode).toBe(401);

    const reg = await register('cy@example.com', 'cy-password-1');
    const res = await verify(lastToken(), signupCookieOf(reg));
    const session = sessionOf(res);
    const taken = await app.inject({ method: 'POST', url: '/api/auth/password/set', headers: { cookie: session }, payload: { password: 'new-password-2' } });
    expect(taken.statusCode).toBe(409);
    expect(taken.json()).toEqual({ error: 'password_already_set' });
    expect((await login('cy@example.com', 'cy-password-1')).statusCode).toBe(200);

    await register('dee@example.com', 'dee-password-1');
    const res2 = await verify(lastToken());
    const short = await app.inject({ method: 'POST', url: '/api/auth/password/set', headers: { cookie: sessionOf(res2) }, payload: { password: 'short' } });
    expect(short.statusCode).toBe(400);
  });

  it('login for an unknown email does the same password work as a wrong password', async () => {
    const reg = await register('tim@example.com', 'tim-password-1');
    await verify(lastToken(), signupCookieOf(reg));
    const median = async (email: string) => {
      const t: number[] = [];
      for (let i = 0; i < 5; i++) {
        const s = performance.now();
        await login(email, 'wrong-password-x');
        t.push(performance.now() - s);
      }
      t.sort((a, b) => a - b);
      return t[2]!;
    };
    await median('nobody@example.com'); // warm up the shared hash
    const unknown = await median('nobody@example.com');
    const known = await median('tim@example.com');
    expect(unknown).toBeGreaterThan(known * 0.5);
  });
});

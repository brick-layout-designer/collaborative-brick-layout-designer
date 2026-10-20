// Sign-in pacing per account: free tries, then waits that double up to a
// cap, never a lock; the right password clears the count.

import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { LOGIN_PACING, loginWaitMs, noteLoginFailure, noteLoginSuccess, resetLoginPacing, trackedLoginCount } from './loginPacing.js';
import { attachUser } from './cookie.js';
import { loginAs, resetDb } from '../test/helpers.js';
import { passwordRoutes } from '../routes/auth/password.js';
import { sessionRoutes } from '../routes/auth/session.js';

describe('login pacing rules', () => {
  beforeEach(() => resetLoginPacing());

  it('allows the free tries, then waits that double from one second up to the cap', () => {
    const t0 = 1_000_000;
    for (let i = 0; i < LOGIN_PACING.FREE_FAILURES - 1; i++) {
      noteLoginFailure('a@example.com', t0);
      expect(loginWaitMs('a@example.com', t0)).toBe(0);
    }
    noteLoginFailure('a@example.com', t0);
    expect(loginWaitMs('a@example.com', t0)).toBe(1000);

    const waits: number[] = [];
    let now = t0;
    for (let i = 0; i < 14; i++) {
      now += loginWaitMs('a@example.com', now);
      noteLoginFailure('a@example.com', now);
      waits.push(loginWaitMs('a@example.com', now));
    }
    expect(waits.slice(0, 5)).toEqual([2000, 4000, 8000, 16000, 32000]);
    expect(Math.max(...waits)).toBe(LOGIN_PACING.MAX_DELAY_MS);
    expect(waits.at(-1)).toBe(LOGIN_PACING.MAX_DELAY_MS);
    // Another account is not affected.
    expect(loginWaitMs('b@example.com', now)).toBe(0);
  });

  it('the right password, or a quiet spell, starts the count over', () => {
    for (let i = 0; i < LOGIN_PACING.FREE_FAILURES; i++) noteLoginFailure('c@example.com', 0);
    expect(loginWaitMs('c@example.com', 0)).toBeGreaterThan(0);
    noteLoginSuccess('c@example.com');
    expect(loginWaitMs('c@example.com', 0)).toBe(0);

    for (let i = 0; i < LOGIN_PACING.FREE_FAILURES; i++) noteLoginFailure('d@example.com', 0);
    const later = 1000 + LOGIN_PACING.WINDOW_MS + 1;
    expect(loginWaitMs('d@example.com', later)).toBe(0);
    noteLoginFailure('d@example.com', later);
    expect(loginWaitMs('d@example.com', later)).toBe(0);
  });

  it('keeps a bounded number of accounts', () => {
    for (let i = 0; i < LOGIN_PACING.MAX_TRACKED + 25; i++) noteLoginFailure(`u${i}@example.com`, 0);
    expect(trackedLoginCount()).toBe(LOGIN_PACING.MAX_TRACKED);
    // The oldest went first.
    noteLoginFailure('u0@example.com', 0);
    expect(trackedLoginCount()).toBe(LOGIN_PACING.MAX_TRACKED);
  });
});

describe('POST /api/auth/password/login pacing', () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    resetDb();
    app = Fastify();
    await app.register(cookie);
    app.addHook('preHandler', attachUser);
    await app.register(passwordRoutes);
    await app.register(sessionRoutes);
    await loginAs(app, 'pace@example.com');
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(() => resetLoginPacing());
  afterEach(() => vi.useRealTimers());

  const login = (email: string, password: string, from = '198.51.100.1') =>
    app.inject({ method: 'POST', url: '/api/auth/password/login', payload: { email, password }, remoteAddress: from });

  it('after ten wrong passwords, a further try too soon gets 429 with Retry-After, even with the right password', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-20T12:00:00Z'));
    // From many addresses: it's the account that's paced, not the address.
    for (let i = 0; i < 10; i++) expect((await login('Pace@example.com', `wrong-${i}`, `203.0.113.${i}`)).statusCode).toBe(401);

    const early = await login('pace@example.com', 'correct horse battery', '203.0.113.99');
    expect(early.statusCode).toBe(429);
    expect(early.headers['retry-after']).toBe('1');
    expect(early.json()).toEqual({ error: 'login_paced', retryAfter: 1 });

    vi.setSystemTime(new Date('2026-10-20T12:00:01Z'));
    expect((await login('pace@example.com', 'wrong-again')).statusCode).toBe(401);
    const next = await login('pace@example.com', 'correct horse battery');
    expect(next.statusCode).toBe(429);
    expect(next.headers['retry-after']).toBe('2');

    // Once the wait is over the right password works, and the count starts over.
    vi.setSystemTime(new Date('2026-10-20T12:00:03Z'));
    expect((await login('pace@example.com', 'correct horse battery')).statusCode).toBe(200);
    expect((await login('pace@example.com', 'wrong-after')).statusCode).toBe(401);
    expect((await login('pace@example.com', 'correct horse battery')).statusCode).toBe(200);
  });

  it('an address without an account is paced the same way', async () => {
    for (let i = 0; i < 10; i++) expect((await login('nobody@example.com', `wrong-${i}`)).statusCode).toBe(401);
    const res = await login('nobody@example.com', 'wrong-x');
    expect(res.statusCode).toBe(429);
    expect(res.headers['retry-after']).toBe('1');
  });

  it('the per-address limit still applies on top', async () => {
    const limited = Fastify();
    await limited.register(rateLimit, { global: false });
    await limited.register(cookie);
    limited.addHook('preHandler', attachUser);
    await limited.register(passwordRoutes);
    const codes: number[] = [];
    for (let i = 0; i < 11; i++) {
      const res = await limited.inject({
        method: 'POST',
        url: '/api/auth/password/login',
        payload: { email: `someone-${i}@example.com`, password: 'wrong-password' },
        remoteAddress: '198.51.100.200',
      });
      codes.push(res.statusCode);
    }
    expect(codes.slice(0, 10).every((c) => c === 401)).toBe(true);
    expect(codes[10]).toBe(429);
    await limited.close();
  });
});

// Signed-in limits count per person (a club on one show Wi-Fi shares an
// address); signed out, the address. Only the sign-in routes and the
// health checks keep plain per-address limits.

import Fastify from 'fastify';
import rateLimit from '@fastify/rate-limit';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { perPerson } from './rateLimits.js';

describe('perPerson', () => {
  it('one person using up their turns leaves others on the same address alone; signed out, the address counts', async () => {
    const app = Fastify();
    await app.register(rateLimit, { global: false });
    app.addHook('preHandler', async (req) => {
      const who = req.headers['x-user'];
      (req as unknown as { user: unknown }).user = typeof who === 'string' ? { id: who } : null;
    });
    app.post('/x', { config: { rateLimit: perPerson(2, '1 minute') } }, async () => ({ ok: true }));
    const hit = (user?: string) => app.inject({ method: 'POST', url: '/x', headers: user ? { 'x-user': user } : {} });
    expect((await hit('a')).statusCode).toBe(200);
    expect((await hit('a')).statusCode).toBe(200);
    expect((await hit('a')).statusCode).toBe(429);
    expect((await hit('b')).statusCode).toBe(200);
    expect((await hit()).statusCode).toBe(200);
    expect((await hit()).statusCode).toBe(200);
    expect((await hit()).statusCode).toBe(429);
    await app.close();
  });

  it('every route limit outside sign-in and health is per person', () => {
    const dir = join(import.meta.dirname, '../routes');
    const files = readdirSync(dir).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'));
    const perAddress = files.filter((f) => /rateLimit: \{ max:/.test(readFileSync(join(dir, f), 'utf8')));
    expect(perAddress).toEqual([]);
  });
});

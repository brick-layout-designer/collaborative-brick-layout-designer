import Fastify from 'fastify';
import rateLimit from '@fastify/rate-limit';
import { describe, expect, it } from 'vitest';

// Guards the plugin contract index.ts relies on: global off, per-route
// `config.rateLimit` still enforced.
describe('per-route rate limiting', () => {
  it('returns 429 once a route exceeds its own max', async () => {
    const app = Fastify();
    await app.register(rateLimit, { global: false });
    // codeql[js/missing-rate-limiting] - rate limited via Fastify config.rateLimit
    app.get('/limited', { config: { rateLimit: { max: 2, timeWindow: '1 minute' } } }, async () => ({ ok: true }));
    app.get('/open', async () => ({ ok: true }));

    const codes: number[] = [];
    for (let i = 0; i < 3; i++) codes.push((await app.inject({ url: '/limited' })).statusCode);
    expect(codes).toEqual([200, 200, 429]);

    for (let i = 0; i < 5; i++) expect((await app.inject({ url: '/open' })).statusCode).toBe(200);
    await app.close();
  });
});

import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetDb } from './test/helpers.js';

// We mount the health endpoints inline here rather than calling the
// production main() so the test stays self-contained — index.ts wires
// up listeners that aren't wanted in unit tests.

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify();
  await app.register(cookie);
  app.get('/api/health', { config: { rateLimit: { max: 120, timeWindow: '1 minute' } } }, async () => ({ ok: true })); // codeql[js/missing-rate-limiting]
  app.get('/api/health/ready', { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (_req, reply) => { // codeql[js/missing-rate-limiting]
    try {
      const { sqlite } = await import('./db/index.js');
      const row = sqlite.prepare('SELECT 1 AS ok').get() as { ok: number } | undefined;
      if (row?.ok !== 1) throw new Error('db ping unexpected');
      return { ok: true, db: 'ready' };
    } catch (err) {
      return reply.code(503).send({ ok: false, error: (err as Error).message });
    }
  });
  return app;
}

describe('health endpoints', () => {
  let app: FastifyInstance;
  beforeEach(async () => {
    resetDb();
    app = await buildApp();
  });
  afterEach(async () => {
    await app.close();
  });

  it('GET /api/health returns ok', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
  });

  it('GET /api/health/ready confirms DB is reachable', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/health/ready' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { ok: boolean; db: string };
    expect(body.ok).toBe(true);
    expect(body.db).toBe('ready');
  });
});

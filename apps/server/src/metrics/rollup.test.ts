// The admin dashboard's daily rollup and the request hook that feeds it.

import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { db, loginAs, resetDb, schema } from '../test/helpers.js';
import { attachUser } from '../auth/cookie.js';
import { passwordRoutes } from '../routes/auth/password.js';
import { dayKey, Rollup, rollup, ROLLUP_RETENTION_DAYS, sweepRollup } from './rollup.js';
import { classifyClient, registerRequestMetrics, resetActivityThrottles } from './activity.js';

const DAY = 24 * 60 * 60 * 1000;

function stat(metric: string, key = '', day = dayKey()): number | undefined {
  return db
    .select({ v: schema.dailyStats.value })
    .from(schema.dailyStats)
    .where(and(eq(schema.dailyStats.day, day), eq(schema.dailyStats.metric, metric), eq(schema.dailyStats.key, key)))
    .get()?.v;
}

describe('Rollup', () => {
  beforeEach(() => {
    resetDb();
    rollup.reset();
  });

  it('adds counters across flushes', () => {
    const r = new Rollup();
    r.count('requests');
    r.count('requests', '', 2);
    r.flush();
    r.count('requests');
    r.flush();
    expect(stat('requests')).toBe(4);
  });

  it('counts each member once a day and never lowers the stored count after a restart', () => {
    const r = new Rollup();
    r.distinct('client', 'web', 'u1');
    r.distinct('client', 'web', 'u1');
    r.distinct('client', 'web', 'u2');
    r.flush();
    expect(stat('client', 'web')).toBe(2);
    const afterRestart = new Rollup();
    afterRestart.distinct('client', 'web', 'u3');
    afterRestart.flush();
    expect(stat('client', 'web')).toBe(2);
  });

  it('replaces gauges and keeps the highest peak', () => {
    const r = new Rollup();
    r.gauge('db_bytes', '', 100);
    r.peak('live_peak', '', 5);
    r.flush();
    r.gauge('db_bytes', '', 80);
    r.peak('live_peak', '', 3);
    r.flush();
    expect(stat('db_bytes')).toBe(80);
    expect(stat('live_peak')).toBe(5);
  });

  it('folds keys past the per-metric cap into "(other)"', () => {
    const r = new Rollup();
    for (let i = 0; i < 520; i++) r.count('refused', `k${i}`);
    r.flush();
    expect(stat('refused', '(other)')).toBe(20);
    expect(stat('refused', 'k0')).toBe(1);
  });

  it('sweeps only rows older than the retention window', () => {
    const now = Date.now();
    const old = dayKey(now - (ROLLUP_RETENTION_DAYS + 2) * DAY);
    const recent = dayKey(now - 3 * DAY);
    db.insert(schema.dailyStats).values([
      { day: old, metric: 'requests', key: '', value: 1 },
      { day: recent, metric: 'requests', key: '', value: 2 },
    ]).run();
    expect(sweepRollup(now)).toBe(1);
    expect(stat('requests', '', old)).toBeUndefined();
    expect(stat('requests', '', recent)).toBe(2);
  });
});

describe('classifyClient', () => {
  it('reads the desktop app and its version', () => {
    expect(classifyClient('BrickLayoutDesigner/1.3.0 (desktop)')).toEqual({ kind: 'desktop', version: '1.3.0' });
  });
  it('splits the web app by device', () => {
    expect(classifyClient('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile/15E148')).toEqual({ kind: 'web', device: 'phone' });
    // Some in-app browsers drop the "Mobile" token.
    expect(classifyClient('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)')).toEqual({ kind: 'web', device: 'phone' });
    expect(classifyClient('Mozilla/5.0 (Linux; Android 14; Pixel 7) Mobile Safari/537.36')).toEqual({ kind: 'web', device: 'phone' });
    expect(classifyClient('Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)')).toEqual({ kind: 'web', device: 'tablet' });
    expect(classifyClient('Mozilla/5.0 (X11; Linux x86_64) Chrome/130')).toEqual({ kind: 'web', device: 'computer' });
    expect(classifyClient(undefined)).toEqual({ kind: 'web', device: 'computer' });
  });
});

describe('registerRequestMetrics', () => {
  let app: FastifyInstance;
  beforeEach(async () => {
    resetDb();
    rollup.reset();
    resetActivityThrottles();
    app = Fastify();
    await app.register(cookie);
    app.addHook('preHandler', attachUser);
    registerRequestMetrics(app);
    await app.register(passwordRoutes);
    app.get('/api/things/:id', async (_req, reply) => reply.code(403).send({ error: 'forbidden' }));
    app.get('/api/boom', async (_req, reply) => reply.code(500).send({ error: 'x' }));
    app.get('/api/ok', async () => ({ ok: true }));
    app.get('/not-api', async () => ({ ok: true }));
  });
  afterEach(async () => {
    await app.close();
  });

  it('counts requests, errors and refusals by route pattern, never by URL', async () => {
    await app.inject({ url: '/api/things/secret-value-123' });
    await app.inject({ url: '/api/boom' });
    await app.inject({ url: '/api/ok' });
    await app.inject({ url: '/not-api' });
    rollup.flush();
    expect(stat('requests')).toBe(3);
    expect(stat('errors_5xx')).toBe(1);
    expect(stat('errors_5xx_route', 'GET /api/boom')).toBe(1);
    expect(stat('refused', '403 GET /api/things/:id')).toBe(1);
    const keys = db.select({ key: schema.dailyStats.key }).from(schema.dailyStats).all().map((r) => r.key);
    expect(keys.join(' ')).not.toContain('secret-value-123');
  });

  it('notes signed-in people: last seen, and which client they use', async () => {
    const { cookie: c, id } = await loginAs(app, 'seen@example.com');
    await db.update(schema.users).set({ lastSeenAt: null }).where(eq(schema.users.id, id));
    resetActivityThrottles();
    await app.inject({ url: '/api/ok', headers: { cookie: c, 'user-agent': 'Mozilla/5.0 (iPhone) Mobile' } });
    rollup.flush();
    const user = db.select().from(schema.users).where(eq(schema.users.id, id)).get();
    expect(user?.lastSeenAt).toBeInstanceOf(Date);
    expect(stat('client', 'web')).toBe(1);
    expect(stat('device', 'phone')).toBe(1);
  });
});

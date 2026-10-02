// Live editing and limits: a layout takes at most liveEditorsPerLayout
// connections (4429 limit_reached after that), and a suspended person
// still opens a layout but read-only.

import { WebSocket } from 'ws';
import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { db, loginAs, resetDb, schema } from '../../test/helpers.js';
import { attachUser } from '../../auth/cookie.js';
import { passwordRoutes } from '../auth/password.js';
import { layoutRoutes } from '../layouts.js';
import { wsRoutes } from '../ws.js';
import { invalidateLimitCaches } from '../../limits/limits.js';
import { docHub } from '../../ws/docHub.js';
import { env } from '../../env.js';

function open(port: number, layoutId: string, cookieStr: string): Promise<{ ws: WebSocket; closed: Promise<[number, string]> }> {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/layout/${layoutId}`, { headers: { cookie: cookieStr } });
  ws.on('error', () => {});
  const closed = new Promise<[number, string]>((r) => ws.once('close', (code, reason) => r([code, reason.toString()])));
  return new Promise((resolve, reject) => {
    ws.once('open', () => resolve({ ws, closed }));
    ws.once('error', reject);
  });
}

describe('live editing limits', () => {
  let app: FastifyInstance;
  let port: number;
  beforeEach(async () => {
    resetDb();
    invalidateLimitCaches();
    app = Fastify();
    await app.register(cookie);
    app.addHook('preHandler', attachUser);
    await app.register(passwordRoutes);
    await app.register(layoutRoutes);
    await app.register(wsRoutes);
    await app.listen({ port: 0, host: '127.0.0.1' });
    port = (app.server.address() as { port: number }).port;
  });
  afterEach(async () => {
    await app.close();
  });

  it('refuses a connection past the per-layout limit', async () => {
    const u = await loginAs(app, 'live@example.com');
    const id = ((await app.inject({ method: 'POST', url: '/api/layouts', headers: { cookie: u.cookie }, payload: { title: 'L' } })).json() as { id: string }).id;
    db.insert(schema.limitOverrides)
      .values({ subjectKind: 'user', subjectId: u.id, limits: JSON.stringify({ liveEditorsPerLayout: 1 }), updatedAt: new Date() })
      .run();
    invalidateLimitCaches();
    const a = await open(port, id, u.cookie);
    const b = await open(port, id, u.cookie);
    expect(await b.closed).toEqual([4429, 'limit_reached']);
    a.ws.close();
    await a.closed;
    await docHub.close(id);
  });

  it('lets everyone in when LIMITS_ENFORCE=off', async () => {
    const u = await loginAs(app, 'open@example.com');
    const id = ((await app.inject({ method: 'POST', url: '/api/layouts', headers: { cookie: u.cookie }, payload: { title: 'L' } })).json() as { id: string }).id;
    db.insert(schema.limitOverrides)
      .values({ subjectKind: 'user', subjectId: u.id, limits: JSON.stringify({ liveEditorsPerLayout: 1 }), updatedAt: new Date() })
      .run();
    invalidateLimitCaches();
    env.limitsEnforceForced = 'off';
    try {
      const a = await open(port, id, u.cookie);
      const b = await open(port, id, u.cookie);
      const outcome = await Promise.race([b.closed, new Promise((r) => setTimeout(() => r('still open'), 300))]);
      expect(outcome).toBe('still open');
      a.ws.close();
      b.ws.close();
      await a.closed;
      await b.closed;
    } finally {
      env.limitsEnforceForced = null;
    }
    await docHub.close(id);
  });

  it('opens read-only for a suspended person', async () => {
    const u = await loginAs(app, 'ro@example.com');
    const id = ((await app.inject({ method: 'POST', url: '/api/layouts', headers: { cookie: u.cookie }, payload: { title: 'L' } })).json() as { id: string }).id;
    db.insert(schema.limitOverrides).values({ subjectKind: 'user', subjectId: u.id, suspended: true, updatedAt: new Date() }).run();
    invalidateLimitCaches();
    const before = db.select().from(schema.layoutUpdates).where(eq(schema.layoutUpdates.layoutId, id)).all().length;
    const c = await open(port, id, u.cookie);
    // A y-websocket sync update (message 0, step 2 = update) with a tiny change.
    const Y = await import('yjs');
    const encoding = await import('lib0/encoding');
    const sync = await import('y-protocols/sync');
    const d = new Y.Doc();
    d.getMap('meta').set('title', 'hacked');
    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, 0);
    sync.writeUpdate(enc, Y.encodeStateAsUpdate(d));
    c.ws.send(encoding.toUint8Array(enc));
    await new Promise((r) => setTimeout(r, 150));
    const after = db.select().from(schema.layoutUpdates).where(eq(schema.layoutUpdates.layoutId, id)).all().length;
    expect(after).toBe(before);
    c.ws.close();
    await c.closed;
    await docHub.close(id);
  });
});

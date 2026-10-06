// Regression tests: realtime sockets end with the session that opened
// them, and oversized frames are refused.

import { WebSocket } from 'ws';
import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { db, loginAs, resetDb, schema } from '../../test/helpers.js';
import { attachUser } from '../../auth/cookie.js';
import { passwordRoutes } from '../auth/password.js';
import { sessionRoutes } from '../auth/session.js';
import { layoutRoutes } from '../layouts.js';
import { adminRoutes } from '../admin.js';
import { wsRoutes, WS_MAX_PAYLOAD } from '../ws.js';
import { privacyRoutes } from '../privacy.js';
import { privacyAdminRoutes } from '../privacyAdmin.js';

async function buildApp(): Promise<{ app: FastifyInstance; port: number }> {
  const app = Fastify({ logger: false });
  await app.register(cookie);
  app.addHook('preHandler', attachUser);
  await app.register(passwordRoutes);
  await app.register(sessionRoutes);
  await app.register(layoutRoutes);
  await app.register(adminRoutes);
  await app.register(wsRoutes);
  await app.register(privacyRoutes);
  await app.register(privacyAdminRoutes);
  await app.listen({ port: 0, host: '127.0.0.1' });
  const addr = app.server.address();
  return { app, port: typeof addr === 'object' && addr ? addr.port : 0 };
}

function open(port: number, layoutId: string, cookieStr: string): Promise<{ ws: WebSocket; closed: Promise<number> }> {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/layout/${layoutId}`, { headers: { cookie: cookieStr } });
  ws.on('error', () => {});
  const closed = new Promise<number>((r) => ws.once('close', (code) => r(code)));
  return new Promise((resolve, reject) => {
    ws.once('open', () => resolve({ ws, closed }));
    ws.once('error', reject);
  });
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | 'timeout'> {
  return Promise.race([p, new Promise<'timeout'>((r) => setTimeout(() => r('timeout'), ms))]);
}

describe('WS lifetime is bound to the session', () => {
  let app: FastifyInstance;
  let port: number;
  let user: { cookie: string; id: string };
  let layoutId: string;

  beforeEach(async () => {
    resetDb();
    ({ app, port } = await buildApp());
    user = await loginAs(app, 'ws-user@x.com');
    layoutId = (
      await app.inject({ method: 'POST', url: '/api/layouts', headers: { cookie: user.cookie }, payload: {} })
    ).json().id;
  });
  afterEach(async () => {
    await app.close();
  });

  it('privacy: deleting the account, or putting it on hold, closes its sockets and says why', async () => {
    const reasonOf = (ws: WebSocket) => new Promise<string>((r) => ws.once('close', (_c, reason) => r(reason.toString())));
    // On hold: closed with the reason, and it can come straight back (read only).
    const admin = await loginAs(app, 'admin@x.com');
    await db.update(schema.users).set({ isGlobalAdmin: true }).where(eq(schema.users.id, admin.id));
    const req = (
      await app.inject({ method: 'POST', url: '/api/admin/privacy/requests', headers: { cookie: admin.cookie }, payload: { type: 'restriction', subjectUserId: user.id } })
    ).json().request.id as string;
    const a = await open(port, layoutId, user.cookie);
    const heldReason = reasonOf(a.ws);
    await app.inject({ method: 'POST', url: `/api/admin/privacy/requests/${req}/restrict`, headers: { cookie: admin.cookie }, payload: { restricted: true } });
    expect(await withTimeout(heldReason, 2000)).toBe('account_restricted');
    const again = await open(port, layoutId, user.cookie);
    again.ws.close();
    await app.inject({ method: 'POST', url: `/api/admin/privacy/requests/${req}/restrict`, headers: { cookie: admin.cookie }, payload: { restricted: false } });

    // Being deleted: closed with that reason.
    const b = await open(port, layoutId, user.cookie);
    const goneReason = reasonOf(b.ws);
    await app.inject({ method: 'POST', url: '/api/me/deletion', headers: { cookie: user.cookie }, payload: { confirm: 'ws-user@x.com' } });
    expect(await withTimeout(goneReason, 2000)).toBe('account_pending_deletion');
  });

  it('logout closes the sockets opened with that session', async () => {
    const s = await open(port, layoutId, user.cookie);
    const logout = await app.inject({ method: 'POST', url: '/api/auth/logout', headers: { cookie: user.cookie } });
    expect(logout.statusCode).toBe(200);
    expect(await withTimeout(s.closed, 2000)).toBe(1008);
  });

  it("admin 'revoke all sessions' closes the user's sockets", async () => {
    const admin = await loginAs(app, 'admin@x.com');
    await db.update(schema.users).set({ isGlobalAdmin: true }).where(eq(schema.users.id, admin.id));
    const s = await open(port, layoutId, user.cookie);
    const res = await app.inject({
      method: 'POST',
      url: `/api/admin/users/${user.id}/sessions/revoke-all`,
      headers: { cookie: admin.cookie },
    });
    expect(res.statusCode).toBe(200);
    expect(await withTimeout(s.closed, 2000)).toBe(1008);
  });

  it('refuses frames larger than the payload cap', async () => {
    const s = await open(port, layoutId, user.cookie);
    s.ws.send(Buffer.alloc(WS_MAX_PAYLOAD + 1));
    expect(await withTimeout(s.closed, 5000)).toBe(1009);
  });
});

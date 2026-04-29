import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, resetDb, schema } from '../test/helpers.js';
import { attachUser } from '../auth/cookie.js';
import { passwordRoutes } from './auth/password.js';
import { sessionRoutes } from './auth/session.js';
import { layoutRoutes } from './layouts.js';
import { collaboratorRoutes } from './collaborators.js';
import { inviteRoutes } from './invites.js';

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ bodyLimit: 10 * 1024 * 1024 });
  await app.register(cookie);
  app.addHook('preHandler', attachUser);
  await app.register(passwordRoutes);
  await app.register(sessionRoutes);
  await app.register(layoutRoutes);
  await app.register(collaboratorRoutes);
  await app.register(inviteRoutes);
  return app;
}

async function registerAndLogin(app: FastifyInstance, email: string): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/password/register',
    payload: { email, password: 'correct horse battery', displayName: email },
  });
  expect(res.statusCode).toBe(200);
  const setCookie = res.headers['set-cookie'];
  return Array.isArray(setCookie) ? setCookie.join('; ') : (setCookie ?? '');
}

async function createLayout(app: FastifyInstance, cookieStr: string): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/layouts',
    headers: { cookie: cookieStr },
    payload: { title: 'shareable' },
  });
  return (res.json() as { id: string }).id;
}

describe('layout collaborators', () => {
  let app: FastifyInstance;
  beforeEach(async () => {
    resetDb();
    app = await buildApp();
  });
  afterEach(async () => {
    await app.close();
  });

  it('owner invites bob via POST /invites; preview + accept works', async () => {
    const aliceCookie = await registerAndLogin(app, 'alice@example.com');
    const layoutId = await createLayout(app, aliceCookie);

    const inv = await app.inject({
      method: 'POST',
      url: `/api/layouts/${layoutId}/invites`,
      headers: { cookie: aliceCookie },
      payload: { email: 'bob@example.com', role: 'editor' },
    });
    expect(inv.statusCode).toBe(200);
    const invBody = inv.json() as { token: string; inviteUrl: string };
    expect(invBody.token).toMatch(/^[0-9a-f]{48}$/);
    expect(invBody.inviteUrl).toContain(invBody.token);

    // Preview without auth — public endpoint, returns shape.
    const preview = await app.inject({
      method: 'GET',
      url: `/api/invites/${invBody.token}`,
    });
    expect(preview.statusCode).toBe(200);
    expect((preview.json() as { invitedEmail: string }).invitedEmail).toBe('bob@example.com');

    // Bob registers (with the same email) and accepts.
    const bobCookie = await registerAndLogin(app, 'bob@example.com');
    const accept = await app.inject({
      method: 'POST',
      url: `/api/invites/${invBody.token}`,
      headers: { cookie: bobCookie },
    });
    expect(accept.statusCode).toBe(200);
    expect((accept.json() as { layoutId: string }).layoutId).toBe(layoutId);

    // Bob can now GET the layout.
    const bobView = await app.inject({
      method: 'GET',
      url: `/api/layouts/${layoutId}`,
      headers: { cookie: bobCookie },
    });
    expect(bobView.statusCode).toBe(200);
    expect((bobView.json() as { role: string }).role).toBe('editor');
  });

  it('rejects invite acceptance from a different email (security)', async () => {
    // Critical: even if Eve gets Bob's invite token, signing in as Eve
    // does NOT let her accept.
    const aliceCookie = await registerAndLogin(app, 'alice@example.com');
    const layoutId = await createLayout(app, aliceCookie);
    const inv = await app.inject({
      method: 'POST',
      url: `/api/layouts/${layoutId}/invites`,
      headers: { cookie: aliceCookie },
      payload: { email: 'bob@example.com', role: 'editor' },
    });
    const token = (inv.json() as { token: string }).token;

    const eveCookie = await registerAndLogin(app, 'eve@example.com');
    const accept = await app.inject({
      method: 'POST',
      url: `/api/invites/${token}`,
      headers: { cookie: eveCookie },
    });
    expect(accept.statusCode).toBe(403);
  });

  it('rejects inviting an email already with access (409)', async () => {
    const aliceCookie = await registerAndLogin(app, 'alice@example.com');
    const layoutId = await createLayout(app, aliceCookie);
    const bobCookie = await registerAndLogin(app, 'bob@example.com');
    // First invite + accept.
    const first = await app.inject({
      method: 'POST',
      url: `/api/layouts/${layoutId}/invites`,
      headers: { cookie: aliceCookie },
      payload: { email: 'bob@example.com', role: 'editor' },
    });
    await app.inject({
      method: 'POST',
      url: `/api/invites/${(first.json() as { token: string }).token}`,
      headers: { cookie: bobCookie },
    });
    // Second invite — already has access.
    const second = await app.inject({
      method: 'POST',
      url: `/api/layouts/${layoutId}/invites`,
      headers: { cookie: aliceCookie },
      payload: { email: 'bob@example.com', role: 'viewer' },
    });
    expect(second.statusCode).toBe(409);
  });

  it('only owner can invite — editor cannot', async () => {
    const aliceCookie = await registerAndLogin(app, 'alice@example.com');
    const bobCookie = await registerAndLogin(app, 'bob@example.com');
    const layoutId = await createLayout(app, aliceCookie);
    // Grant Bob editor manually.
    const bob = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.email, 'bob@example.com'))
      .get();
    await db.insert(schema.layoutCollaborators).values({
      layoutId,
      userId: bob!.id,
      role: 'editor',
      addedAt: new Date(),
    });

    const res = await app.inject({
      method: 'POST',
      url: `/api/layouts/${layoutId}/invites`,
      headers: { cookie: bobCookie },
      payload: { email: 'carol@example.com', role: 'viewer' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('demo accounts cannot invite (403)', async () => {
    const aliceCookie = await registerAndLogin(app, 'alice@example.com');
    const layoutId = await createLayout(app, aliceCookie);
    // Mark alice as demo after the fact.
    await db
      .update(schema.users)
      .set({ isDemoAccount: true })
      .where(eq(schema.users.email, 'alice@example.com'));

    const res = await app.inject({
      method: 'POST',
      url: `/api/layouts/${layoutId}/invites`,
      headers: { cookie: aliceCookie },
      payload: { email: 'bob@example.com', role: 'editor' },
    });
    expect(res.statusCode).toBe(403);
    expect((res.json() as { error: string }).error).toBe('demo_account_cannot_invite');
  });

  it('owner changes a collaborator role; audit row written', async () => {
    const aliceCookie = await registerAndLogin(app, 'alice@example.com');
    const bobCookie = await registerAndLogin(app, 'bob@example.com');
    const layoutId = await createLayout(app, aliceCookie);
    const inv = await app.inject({
      method: 'POST',
      url: `/api/layouts/${layoutId}/invites`,
      headers: { cookie: aliceCookie },
      payload: { email: 'bob@example.com', role: 'viewer' },
    });
    await app.inject({
      method: 'POST',
      url: `/api/invites/${(inv.json() as { token: string }).token}`,
      headers: { cookie: bobCookie },
    });
    const bob = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.email, 'bob@example.com'))
      .get();

    const patch = await app.inject({
      method: 'PATCH',
      url: `/api/layouts/${layoutId}/collaborators/${bob!.id}`,
      headers: { cookie: aliceCookie },
      payload: { role: 'editor' },
    });
    expect(patch.statusCode).toBe(200);

    const audit = await db
      .select()
      .from(schema.auditEvents)
      .where(eq(schema.auditEvents.layoutId, layoutId));
    const roleChange = audit.find((a) => a.eventType === 'role_change');
    expect(roleChange).toBeDefined();
    const payload = JSON.parse(roleChange!.payload);
    expect(payload.fromRole).toBe('viewer');
    expect(payload.toRole).toBe('editor');
  });

  it('user can self-remove from a layout (DELETE /collaborators/:userId for self)', async () => {
    const aliceCookie = await registerAndLogin(app, 'alice@example.com');
    const bobCookie = await registerAndLogin(app, 'bob@example.com');
    const layoutId = await createLayout(app, aliceCookie);
    const bob = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.email, 'bob@example.com'))
      .get();
    await db.insert(schema.layoutCollaborators).values({
      layoutId,
      userId: bob!.id,
      role: 'editor',
      addedAt: new Date(),
    });

    const del = await app.inject({
      method: 'DELETE',
      url: `/api/layouts/${layoutId}/collaborators/${bob!.id}`,
      headers: { cookie: bobCookie },
    });
    expect(del.statusCode).toBe(200);

    // Bob can no longer see the layout.
    const get = await app.inject({
      method: 'GET',
      url: `/api/layouts/${layoutId}`,
      headers: { cookie: bobCookie },
    });
    expect(get.statusCode).toBe(404);
  });

  it('expired invites are rejected with 410', async () => {
    const aliceCookie = await registerAndLogin(app, 'alice@example.com');
    const layoutId = await createLayout(app, aliceCookie);
    const inv = await app.inject({
      method: 'POST',
      url: `/api/layouts/${layoutId}/invites`,
      headers: { cookie: aliceCookie },
      payload: { email: 'bob@example.com', role: 'editor' },
    });
    const inviteId = (inv.json() as { id: string }).id;
    // Force-expire.
    await db
      .update(schema.layoutInvites)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(schema.layoutInvites.id, inviteId));

    const token = (inv.json() as { token: string }).token;
    const preview = await app.inject({ method: 'GET', url: `/api/invites/${token}` });
    expect(preview.statusCode).toBe(410);
  });
});

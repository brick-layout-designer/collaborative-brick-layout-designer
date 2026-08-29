import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, resetDb, schema } from '../test/helpers.js';
import { attachUser } from '../auth/cookie.js';
import { passwordRoutes } from './auth/password.js';
import { sessionRoutes } from './auth/session.js';
import { layoutRoutes } from './layouts.js';
import { orgRoutes } from './orgs.js';
import { transferRoutes } from './transfers.js';

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ bodyLimit: 10 * 1024 * 1024 });
  await app.register(cookie);
  app.addHook('preHandler', attachUser);
  await app.register(passwordRoutes);
  await app.register(sessionRoutes);
  await app.register(layoutRoutes);
  await app.register(orgRoutes);
  await app.register(transferRoutes);
  return app;
}

async function registerAndLogin(app: FastifyInstance, email: string): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/password/register',
    payload: { email, password: 'correct horse battery', displayName: email },
  });
  expect(res.statusCode).toBe(200);
  const user = await db.select().from(schema.users).where(eq(schema.users.email, email)).get();
  const verification = await db
    .select()
    .from(schema.emailVerifications)
    .where(eq(schema.emailVerifications.userId, user!.id))
    .get();
  const verifyRes = await app.inject({
    method: 'POST',
    url: `/api/auth/password/verify-email/${verification!.token}`,
  });
  expect(verifyRes.statusCode).toBe(200);
  const setCookie = verifyRes.headers['set-cookie'];
  return Array.isArray(setCookie) ? setCookie.join('; ') : (setCookie ?? '');
}

async function createPersonalLayout(app: FastifyInstance, cookieStr: string): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/layouts',
    headers: { cookie: cookieStr },
    payload: { title: 'mine' },
  });
  return (res.json() as { id: string }).id;
}

describe('layout transfer', () => {
  let app: FastifyInstance;
  beforeEach(async () => {
    resetDb();
    app = await buildApp();
  });
  afterEach(async () => {
    await app.close();
  });

  it('user → org commits immediately and clears expires_at', async () => {
    const aliceCookie = await registerAndLogin(app, 'alice@example.com');
    await app.inject({
      method: 'POST',
      url: '/api/orgs',
      headers: { cookie: aliceCookie },
      payload: { name: 'Acme', slug: 'acme' },
    });
    const layoutId = await createPersonalLayout(app, aliceCookie);
    // Force the layout to look "demo-owned" with an expires_at; transfer
    // to org should clear it.
    await db
      .update(schema.layouts)
      .set({ expiresAt: new Date(Date.now() + 86400_000) })
      .where(eq(schema.layouts.id, layoutId));

    const res = await app.inject({
      method: 'POST',
      url: `/api/layouts/${layoutId}/transfer`,
      headers: { cookie: aliceCookie },
      payload: { recipientOrgSlug: 'acme' },
    });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { transferred: boolean }).transferred).toBe(true);

    const layout = await db
      .select()
      .from(schema.layouts)
      .where(eq(schema.layouts.id, layoutId))
      .get();
    expect(layout!.ownerUserId).toBeNull();
    expect(layout!.ownerOrgId).toBeTruthy();
    expect(layout!.expiresAt).toBeNull();

    const audit = await db
      .select()
      .from(schema.auditEvents)
      .where(eq(schema.auditEvents.layoutId, layoutId));
    expect(audit.some((a) => a.eventType === 'transfer')).toBe(true);
  });

  it('rejects org-recipient transfer when caller is not a member', async () => {
    const aliceCookie = await registerAndLogin(app, 'alice@example.com');
    const bobCookie = await registerAndLogin(app, 'bob@example.com');
    await app.inject({
      method: 'POST',
      url: '/api/orgs',
      headers: { cookie: bobCookie }, // Bob owns acme
      payload: { name: 'Acme', slug: 'acme' },
    });
    const layoutId = await createPersonalLayout(app, aliceCookie);
    const res = await app.inject({
      method: 'POST',
      url: `/api/layouts/${layoutId}/transfer`,
      headers: { cookie: aliceCookie }, // Alice tries to push into Bob's org
      payload: { recipientOrgSlug: 'acme' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('user → user is pending; recipient accepts and ownership flips', async () => {
    const aliceCookie = await registerAndLogin(app, 'alice@example.com');
    const layoutId = await createPersonalLayout(app, aliceCookie);

    const init = await app.inject({
      method: 'POST',
      url: `/api/layouts/${layoutId}/transfer`,
      headers: { cookie: aliceCookie },
      payload: { recipientEmail: 'bob@example.com' },
    });
    expect(init.statusCode).toBe(200);
    const token = (init.json() as { token: string }).token;

    // Layout still owned by Alice until accept.
    const stillAlice = await db
      .select()
      .from(schema.layouts)
      .where(eq(schema.layouts.id, layoutId))
      .get();
    expect(stillAlice!.ownerUserId).toBeTruthy();

    const bobCookie = await registerAndLogin(app, 'bob@example.com');
    const accept = await app.inject({
      method: 'POST',
      url: `/api/transfers/${token}`,
      headers: { cookie: bobCookie },
    });
    expect(accept.statusCode).toBe(200);

    const layout = await db
      .select()
      .from(schema.layouts)
      .where(eq(schema.layouts.id, layoutId))
      .get();
    const bob = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.email, 'bob@example.com'))
      .get();
    expect(layout!.ownerUserId).toBe(bob!.id);
    expect(layout!.ownerOrgId).toBeNull();

    // Alice should retain access as a collaborator (editor).
    const aliceAccess = await app.inject({
      method: 'GET',
      url: `/api/layouts/${layoutId}`,
      headers: { cookie: aliceCookie },
    });
    expect(aliceAccess.statusCode).toBe(200);
    expect((aliceAccess.json() as { role: string }).role).toBe('editor');
  });

  it('user → user transfer enforces email match', async () => {
    const aliceCookie = await registerAndLogin(app, 'alice@example.com');
    const layoutId = await createPersonalLayout(app, aliceCookie);
    const init = await app.inject({
      method: 'POST',
      url: `/api/layouts/${layoutId}/transfer`,
      headers: { cookie: aliceCookie },
      payload: { recipientEmail: 'bob@example.com' },
    });
    const token = (init.json() as { token: string }).token;

    const eveCookie = await registerAndLogin(app, 'eve@example.com');
    const accept = await app.inject({
      method: 'POST',
      url: `/api/transfers/${token}`,
      headers: { cookie: eveCookie },
    });
    expect(accept.statusCode).toBe(403);
  });

  it('rejects user→user transfer when source is org-owned', async () => {
    const aliceCookie = await registerAndLogin(app, 'alice@example.com');
    await app.inject({
      method: 'POST',
      url: '/api/orgs',
      headers: { cookie: aliceCookie },
      payload: { name: 'Acme', slug: 'acme' },
    });
    const create = await app.inject({
      method: 'POST',
      url: '/api/layouts',
      headers: { cookie: aliceCookie },
      payload: { title: 'team', orgSlug: 'acme' },
    });
    const id = (create.json() as { id: string }).id;
    const res = await app.inject({
      method: 'POST',
      url: `/api/layouts/${id}/transfer`,
      headers: { cookie: aliceCookie },
      payload: { recipientEmail: 'bob@example.com' },
    });
    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: string }).error).toContain('org_owned');
  });

  it('rejects self-transfer', async () => {
    const aliceCookie = await registerAndLogin(app, 'alice@example.com');
    const layoutId = await createPersonalLayout(app, aliceCookie);
    const res = await app.inject({
      method: 'POST',
      url: `/api/layouts/${layoutId}/transfer`,
      headers: { cookie: aliceCookie },
      payload: { recipientEmail: 'alice@example.com' },
    });
    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: string }).error).toBe('cannot_transfer_to_self');
  });

  it('non-owners cannot initiate transfer', async () => {
    const aliceCookie = await registerAndLogin(app, 'alice@example.com');
    const bobCookie = await registerAndLogin(app, 'bob@example.com');
    const layoutId = await createPersonalLayout(app, aliceCookie);
    // Add Bob as editor.
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
      url: `/api/layouts/${layoutId}/transfer`,
      headers: { cookie: bobCookie },
      payload: { recipientEmail: 'carol@example.com' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('rejects request specifying both recipient kinds', async () => {
    const aliceCookie = await registerAndLogin(app, 'alice@example.com');
    const layoutId = await createPersonalLayout(app, aliceCookie);
    const res = await app.inject({
      method: 'POST',
      url: `/api/layouts/${layoutId}/transfer`,
      headers: { cookie: aliceCookie },
      payload: { recipientEmail: 'bob@example.com', recipientOrgSlug: 'acme' },
    });
    expect(res.statusCode).toBe(400);
  });
});

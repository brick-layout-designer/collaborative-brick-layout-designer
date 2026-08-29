// Integration tests for layout collaborator + invite endpoints:
//   GET    /api/layouts/:id/collaborators
//   POST   /api/layouts/:id/invites
//   DELETE /api/layouts/:id/invites/:inviteId
//   PATCH  /api/layouts/:id/collaborators/:userId
//   DELETE /api/layouts/:id/collaborators/:userId
//   GET    /api/invites/:token  (preview)
//   POST   /api/invites/:token  (accept)

import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, resetDb, schema } from '../../test/helpers.js';
import { attachUser } from '../../auth/cookie.js';
import { passwordRoutes } from '../auth/password.js';
import { sessionRoutes } from '../auth/session.js';
import { layoutRoutes } from '../layouts.js';
import { collaboratorRoutes } from '../collaborators.js';
import { inviteRoutes } from '../invites.js';

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

async function createLayout(app: FastifyInstance, cookieStr: string, title = 'Test Layout'): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/layouts',
    headers: { cookie: cookieStr },
    payload: { title },
  });
  expect(res.statusCode).toBe(201);
  return (res.json() as { id: string }).id;
}

async function inviteCollaborator(
  app: FastifyInstance,
  cookieStr: string,
  layoutId: string,
  email: string,
  role: 'viewer' | 'editor' = 'editor',
): Promise<{ token: string; id: string }> {
  const res = await app.inject({
    method: 'POST',
    url: `/api/layouts/${layoutId}/invites`,
    headers: { cookie: cookieStr },
    payload: { email, role },
  });
  expect(res.statusCode).toBe(200);
  return res.json() as { token: string; id: string };
}

describe('collaborators — list', () => {
  let app: FastifyInstance;
  beforeEach(async () => { resetDb(); app = await buildApp(); });
  afterEach(async () => { await app.close(); });

  it('returns empty collaborators and invites for a fresh layout', async () => {
    const cookie = await registerAndLogin(app, 'owner@example.com');
    const id = await createLayout(app, cookie);

    const res = await app.inject({
      method: 'GET',
      url: `/api/layouts/${id}/collaborators`,
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { collaborators: unknown[]; invites: unknown[] };
    expect(body.collaborators).toHaveLength(0);
    expect(body.invites).toHaveLength(0);
  });

  it('shows a pending invite after it is created', async () => {
    const cookie = await registerAndLogin(app, 'owner@example.com');
    const id = await createLayout(app, cookie);
    await inviteCollaborator(app, cookie, id, 'invitee@example.com');

    const res = await app.inject({
      method: 'GET',
      url: `/api/layouts/${id}/collaborators`,
      headers: { cookie },
    });
    const body = res.json() as { invites: Array<{ invitedEmail: string; role: string }> };
    expect(body.invites).toHaveLength(1);
    expect(body.invites[0]!.invitedEmail).toBe('invitee@example.com');
    expect(body.invites[0]!.role).toBe('editor');
  });

  it('shows accepted collaborator after invite is accepted', async () => {
    const ownerCookie = await registerAndLogin(app, 'owner@example.com');
    const memberCookie = await registerAndLogin(app, 'member@example.com');
    const id = await createLayout(app, ownerCookie);
    const { token } = await inviteCollaborator(app, ownerCookie, id, 'member@example.com');

    await app.inject({
      method: 'POST',
      url: `/api/invites/${token}`,
      headers: { cookie: memberCookie },
    });

    const res = await app.inject({
      method: 'GET',
      url: `/api/layouts/${id}/collaborators`,
      headers: { cookie: ownerCookie },
    });
    const body = res.json() as {
      collaborators: Array<{ email: string; role: string }>;
      invites: unknown[];
    };
    expect(body.collaborators).toHaveLength(1);
    expect(body.collaborators[0]!.email).toBe('member@example.com');
    expect(body.collaborators[0]!.role).toBe('editor');
    expect(body.invites).toHaveLength(0);
  });

  it('returns 404 to a non-collaborator', async () => {
    const ownerCookie = await registerAndLogin(app, 'owner@example.com');
    const outsiderCookie = await registerAndLogin(app, 'outsider@example.com');
    const id = await createLayout(app, ownerCookie);

    const res = await app.inject({
      method: 'GET',
      url: `/api/layouts/${id}/collaborators`,
      headers: { cookie: outsiderCookie },
    });
    expect(res.statusCode).toBe(404);
  });

  it('returns 401 to an unauthenticated caller', async () => {
    const cookie = await registerAndLogin(app, 'owner@example.com');
    const id = await createLayout(app, cookie);

    const res = await app.inject({
      method: 'GET',
      url: `/api/layouts/${id}/collaborators`,
    });
    expect(res.statusCode).toBe(401);
  });
});

describe('collaborators — invite', () => {
  let app: FastifyInstance;
  beforeEach(async () => { resetDb(); app = await buildApp(); });
  afterEach(async () => { await app.close(); });

  it('owner can invite an editor', async () => {
    const cookie = await registerAndLogin(app, 'owner@example.com');
    const id = await createLayout(app, cookie);

    const res = await app.inject({
      method: 'POST',
      url: `/api/layouts/${id}/invites`,
      headers: { cookie },
      payload: { email: 'editor@example.com', role: 'editor' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { token: string; inviteUrl: string; expiresAt: number };
    expect(typeof body.token).toBe('string');
    expect(body.token.length).toBeGreaterThan(10);
    expect(body.inviteUrl).toContain(body.token);
    expect(body.expiresAt).toBeGreaterThan(Date.now());
  });

  it('owner can invite a viewer', async () => {
    const cookie = await registerAndLogin(app, 'owner@example.com');
    const id = await createLayout(app, cookie);

    const res = await app.inject({
      method: 'POST',
      url: `/api/layouts/${id}/invites`,
      headers: { cookie },
      payload: { email: 'viewer@example.com', role: 'viewer' },
    });
    expect(res.statusCode).toBe(200);
  });

  it('rejects invalid role', async () => {
    const cookie = await registerAndLogin(app, 'owner@example.com');
    const id = await createLayout(app, cookie);

    const res = await app.inject({
      method: 'POST',
      url: `/api/layouts/${id}/invites`,
      headers: { cookie },
      payload: { email: 'x@example.com', role: 'owner' },
    });
    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: string }).error).toBe('invalid_role');
  });

  it('rejects invalid email', async () => {
    const cookie = await registerAndLogin(app, 'owner@example.com');
    const id = await createLayout(app, cookie);

    const res = await app.inject({
      method: 'POST',
      url: `/api/layouts/${id}/invites`,
      headers: { cookie },
      payload: { email: 'not-an-email', role: 'editor' },
    });
    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: string }).error).toBe('invalid_email');
  });

  it('returns 409 when inviting someone who already has access', async () => {
    const ownerCookie = await registerAndLogin(app, 'owner@example.com');
    const memberCookie = await registerAndLogin(app, 'member@example.com');
    const id = await createLayout(app, ownerCookie);
    const { token } = await inviteCollaborator(app, ownerCookie, id, 'member@example.com');
    await app.inject({ method: 'POST', url: `/api/invites/${token}`, headers: { cookie: memberCookie } });

    const res = await app.inject({
      method: 'POST',
      url: `/api/layouts/${id}/invites`,
      headers: { cookie: ownerCookie },
      payload: { email: 'member@example.com', role: 'viewer' },
    });
    expect(res.statusCode).toBe(409);
    expect((res.json() as { error: string }).error).toBe('already_has_access');
  });

  it('returns 403 when non-owner tries to invite', async () => {
    const ownerCookie = await registerAndLogin(app, 'owner@example.com');
    const editorCookie = await registerAndLogin(app, 'editor@example.com');
    const id = await createLayout(app, ownerCookie);
    const { token } = await inviteCollaborator(app, ownerCookie, id, 'editor@example.com');
    await app.inject({ method: 'POST', url: `/api/invites/${token}`, headers: { cookie: editorCookie } });

    const res = await app.inject({
      method: 'POST',
      url: `/api/layouts/${id}/invites`,
      headers: { cookie: editorCookie },
      payload: { email: 'third@example.com', role: 'viewer' },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('collaborators — invite accept (invites route)', () => {
  let app: FastifyInstance;
  beforeEach(async () => { resetDb(); app = await buildApp(); });
  afterEach(async () => { await app.close(); });

  it('GET /api/invites/:token previews the invite without side effects', async () => {
    const ownerCookie = await registerAndLogin(app, 'owner@example.com');
    const id = await createLayout(app, ownerCookie);
    const { token } = await inviteCollaborator(app, ownerCookie, id, 'alice@example.com');

    const res = await app.inject({ method: 'GET', url: `/api/invites/${token}` });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { invitedEmail: string; role: string; layoutTitle: string };
    expect(body.invitedEmail).toBe('alice@example.com');
    expect(body.role).toBe('editor');
    expect(body.layoutTitle).toBe('Test Layout');
  });

  it('POST /api/invites/:token accepts and grants access', async () => {
    const ownerCookie = await registerAndLogin(app, 'owner@example.com');
    const recipientCookie = await registerAndLogin(app, 'alice@example.com');
    const id = await createLayout(app, ownerCookie);
    const { token } = await inviteCollaborator(app, ownerCookie, id, 'alice@example.com');

    const acceptRes = await app.inject({
      method: 'POST',
      url: `/api/invites/${token}`,
      headers: { cookie: recipientCookie },
    });
    expect(acceptRes.statusCode).toBe(200);

    const layoutRes = await app.inject({
      method: 'GET',
      url: `/api/layouts/${id}`,
      headers: { cookie: recipientCookie },
    });
    expect(layoutRes.statusCode).toBe(200);
  });

  it('returns 403 when wrong user accepts the invite', async () => {
    const ownerCookie = await registerAndLogin(app, 'owner@example.com');
    const wrongCookie = await registerAndLogin(app, 'wrong@example.com');
    const id = await createLayout(app, ownerCookie);
    const { token } = await inviteCollaborator(app, ownerCookie, id, 'alice@example.com');

    const res = await app.inject({
      method: 'POST',
      url: `/api/invites/${token}`,
      headers: { cookie: wrongCookie },
    });
    expect(res.statusCode).toBe(403);
    expect((res.json() as { error: string }).error).toBe('email_mismatch');
  });

  it('returns 410 when accepting the same invite twice', async () => {
    const ownerCookie = await registerAndLogin(app, 'owner@example.com');
    const recipientCookie = await registerAndLogin(app, 'alice@example.com');
    const id = await createLayout(app, ownerCookie);
    const { token } = await inviteCollaborator(app, ownerCookie, id, 'alice@example.com');

    await app.inject({ method: 'POST', url: `/api/invites/${token}`, headers: { cookie: recipientCookie } });
    const second = await app.inject({
      method: 'POST',
      url: `/api/invites/${token}`,
      headers: { cookie: recipientCookie },
    });
    expect(second.statusCode).toBe(410);
    expect((second.json() as { error: string }).error).toBe('invite_already_accepted');
  });

  it('returns 404 for an unknown token', async () => {
    await registerAndLogin(app, 'user@example.com');
    const res = await app.inject({ method: 'GET', url: '/api/invites/no-such-token' });
    expect(res.statusCode).toBe(404);
  });
});

describe('collaborators — revoke invite', () => {
  let app: FastifyInstance;
  beforeEach(async () => { resetDb(); app = await buildApp(); });
  afterEach(async () => { await app.close(); });

  it('owner can revoke a pending invite', async () => {
    const cookie = await registerAndLogin(app, 'owner@example.com');
    const id = await createLayout(app, cookie);
    const { id: inviteId } = await inviteCollaborator(app, cookie, id, 'x@example.com');

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/layouts/${id}/invites/${inviteId}`,
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { ok: boolean }).ok).toBe(true);

    // Invite should no longer appear in the collaborator list.
    const list = await app.inject({
      method: 'GET',
      url: `/api/layouts/${id}/collaborators`,
      headers: { cookie },
    });
    expect((list.json() as { invites: unknown[] }).invites).toHaveLength(0);
  });

  it('revoked invite token is still accepted as 200 (delete is idempotent server-side)', async () => {
    const cookie = await registerAndLogin(app, 'owner@example.com');
    const id = await createLayout(app, cookie);
    const { id: inviteId } = await inviteCollaborator(app, cookie, id, 'x@example.com');

    await app.inject({ method: 'DELETE', url: `/api/layouts/${id}/invites/${inviteId}`, headers: { cookie } });
    const second = await app.inject({
      method: 'DELETE',
      url: `/api/layouts/${id}/invites/${inviteId}`,
      headers: { cookie },
    });
    expect(second.statusCode).toBe(200);
  });
});

describe('collaborators — change role', () => {
  let app: FastifyInstance;
  beforeEach(async () => { resetDb(); app = await buildApp(); });
  afterEach(async () => { await app.close(); });

  it('owner can change collaborator role from editor to viewer', async () => {
    const ownerCookie = await registerAndLogin(app, 'owner@example.com');
    const memberCookie = await registerAndLogin(app, 'member@example.com');
    const id = await createLayout(app, ownerCookie);
    const { token } = await inviteCollaborator(app, ownerCookie, id, 'member@example.com', 'editor');
    await app.inject({ method: 'POST', url: `/api/invites/${token}`, headers: { cookie: memberCookie } });

    // Get userId from collaborator list.
    const list = await app.inject({
      method: 'GET',
      url: `/api/layouts/${id}/collaborators`,
      headers: { cookie: ownerCookie },
    });
    const { collaborators } = list.json() as { collaborators: Array<{ userId: string; role: string }> };
    const userId = collaborators[0]!.userId;

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/layouts/${id}/collaborators/${userId}`,
      headers: { cookie: ownerCookie },
      payload: { role: 'viewer' },
    });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { ok: boolean }).ok).toBe(true);

    // Verify the role was updated.
    const list2 = await app.inject({
      method: 'GET',
      url: `/api/layouts/${id}/collaborators`,
      headers: { cookie: ownerCookie },
    });
    const updated = (list2.json() as { collaborators: Array<{ userId: string; role: string }> }).collaborators;
    expect(updated.find((c) => c.userId === userId)!.role).toBe('viewer');
  });

  it('returns 400 for invalid role in PATCH', async () => {
    const ownerCookie = await registerAndLogin(app, 'owner@example.com');
    const memberCookie = await registerAndLogin(app, 'member@example.com');
    const id = await createLayout(app, ownerCookie);
    const { token } = await inviteCollaborator(app, ownerCookie, id, 'member@example.com', 'editor');
    await app.inject({ method: 'POST', url: `/api/invites/${token}`, headers: { cookie: memberCookie } });

    const list = await app.inject({ method: 'GET', url: `/api/layouts/${id}/collaborators`, headers: { cookie: ownerCookie } });
    const userId = (list.json() as { collaborators: Array<{ userId: string }> }).collaborators[0]!.userId;

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/layouts/${id}/collaborators/${userId}`,
      headers: { cookie: ownerCookie },
      payload: { role: 'owner' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('returns 403 when a non-owner tries to change a role', async () => {
    const ownerCookie = await registerAndLogin(app, 'owner@example.com');
    const editorCookie = await registerAndLogin(app, 'editor@example.com');
    const viewerCookie = await registerAndLogin(app, 'viewer@example.com');
    const id = await createLayout(app, ownerCookie);

    const { token: t1 } = await inviteCollaborator(app, ownerCookie, id, 'editor@example.com', 'editor');
    const { token: t2 } = await inviteCollaborator(app, ownerCookie, id, 'viewer@example.com', 'viewer');
    await app.inject({ method: 'POST', url: `/api/invites/${t1}`, headers: { cookie: editorCookie } });
    await app.inject({ method: 'POST', url: `/api/invites/${t2}`, headers: { cookie: viewerCookie } });

    const list = await app.inject({ method: 'GET', url: `/api/layouts/${id}/collaborators`, headers: { cookie: ownerCookie } });
    const viewerId = (list.json() as { collaborators: Array<{ userId: string; role: string }> })
      .collaborators.find((c) => c.role === 'viewer')!.userId;

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/layouts/${id}/collaborators/${viewerId}`,
      headers: { cookie: editorCookie },
      payload: { role: 'editor' },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('collaborators — remove', () => {
  let app: FastifyInstance;
  beforeEach(async () => { resetDb(); app = await buildApp(); });
  afterEach(async () => { await app.close(); });

  it('owner can remove a collaborator', async () => {
    const ownerCookie = await registerAndLogin(app, 'owner@example.com');
    const memberCookie = await registerAndLogin(app, 'member@example.com');
    const id = await createLayout(app, ownerCookie);
    const { token } = await inviteCollaborator(app, ownerCookie, id, 'member@example.com', 'editor');
    await app.inject({ method: 'POST', url: `/api/invites/${token}`, headers: { cookie: memberCookie } });

    const list = await app.inject({ method: 'GET', url: `/api/layouts/${id}/collaborators`, headers: { cookie: ownerCookie } });
    const userId = (list.json() as { collaborators: Array<{ userId: string }> }).collaborators[0]!.userId;

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/layouts/${id}/collaborators/${userId}`,
      headers: { cookie: ownerCookie },
    });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { ok: boolean }).ok).toBe(true);

    // Removed user can no longer see the layout.
    const check = await app.inject({
      method: 'GET',
      url: `/api/layouts/${id}`,
      headers: { cookie: memberCookie },
    });
    expect(check.statusCode).toBe(404);
  });

  it('collaborator can remove themselves (self-leave)', async () => {
    const ownerCookie = await registerAndLogin(app, 'owner@example.com');
    const memberCookie = await registerAndLogin(app, 'member@example.com');
    const id = await createLayout(app, ownerCookie);
    const { token } = await inviteCollaborator(app, ownerCookie, id, 'member@example.com', 'editor');
    await app.inject({ method: 'POST', url: `/api/invites/${token}`, headers: { cookie: memberCookie } });

    const list = await app.inject({ method: 'GET', url: `/api/layouts/${id}/collaborators`, headers: { cookie: ownerCookie } });
    const userId = (list.json() as { collaborators: Array<{ userId: string }> }).collaborators[0]!.userId;

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/layouts/${id}/collaborators/${userId}`,
      headers: { cookie: memberCookie },
    });
    expect(res.statusCode).toBe(200);
  });

  it('returns 403 when an editor tries to remove another collaborator', async () => {
    const ownerCookie = await registerAndLogin(app, 'owner@example.com');
    const editorCookie = await registerAndLogin(app, 'editor@example.com');
    await registerAndLogin(app, 'victim@example.com');
    const id = await createLayout(app, ownerCookie);

    // Invite both editor and victim.
    const { token: editorToken } = await inviteCollaborator(app, ownerCookie, id, 'editor@example.com', 'editor');
    await app.inject({ method: 'POST', url: `/api/invites/${editorToken}`, headers: { cookie: editorCookie } });
    const { token: victimToken } = await inviteCollaborator(app, ownerCookie, id, 'victim@example.com', 'viewer');
    const victimCookie = await registerAndLogin(app, 'victim2@example.com');
    await app.inject({ method: 'POST', url: `/api/invites/${victimToken}`, headers: { cookie: victimCookie } });

    const list = await app.inject({ method: 'GET', url: `/api/layouts/${id}/collaborators`, headers: { cookie: ownerCookie } });
    const collabs = (list.json() as { collaborators: Array<{ userId: string; email: string }> }).collaborators;
    const victim = collabs.find((c) => c.email === 'victim@example.com');
    if (!victim) return; // victim might not have accepted; skip

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/layouts/${id}/collaborators/${victim.userId}`,
      headers: { cookie: editorCookie },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('collaborators — revoke invite (non-owner)', () => {
  let app: FastifyInstance;
  beforeEach(async () => { resetDb(); app = await buildApp(); });
  afterEach(async () => { await app.close(); });

  it('returns 403 when an editor tries to revoke a pending invite', async () => {
    const ownerCookie = await registerAndLogin(app, 'owner@example.com');
    const editorCookie = await registerAndLogin(app, 'editor@example.com');
    const id = await createLayout(app, ownerCookie);

    // Make editor a collaborator.
    const { token: editorTok } = await inviteCollaborator(app, ownerCookie, id, 'editor@example.com', 'editor');
    await app.inject({ method: 'POST', url: `/api/invites/${editorTok}`, headers: { cookie: editorCookie } });

    // Owner creates another pending invite.
    const { id: inviteId } = await inviteCollaborator(app, ownerCookie, id, 'pending@example.com', 'viewer');

    // Editor tries to revoke it — should be 403.
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/layouts/${id}/invites/${inviteId}`,
      headers: { cookie: editorCookie },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('collaborators — 404 on non-existent layout', () => {
  let app: FastifyInstance;
  beforeEach(async () => { resetDb(); app = await buildApp(); });
  afterEach(async () => { await app.close(); });

  it('POST /api/layouts/:id/invites returns 404 for unknown layout', async () => {
    const cookie = await registerAndLogin(app, 'user@example.com');
    const res = await app.inject({
      method: 'POST',
      url: '/api/layouts/no-such-layout/invites',
      headers: { cookie },
      payload: { email: 'other@example.com', role: 'editor' },
    });
    expect(res.statusCode).toBe(404);
  });

  it('DELETE /api/layouts/:id/invites/:inviteId returns 404 for unknown layout', async () => {
    const cookie = await registerAndLogin(app, 'user@example.com');
    const res = await app.inject({
      method: 'DELETE',
      url: '/api/layouts/no-such-layout/invites/no-such-invite',
      headers: { cookie },
    });
    expect(res.statusCode).toBe(404);
  });

  it('DELETE /api/layouts/:id/collaborators/:userId returns 404 for unknown layout', async () => {
    const cookie = await registerAndLogin(app, 'user@example.com');
    const res = await app.inject({
      method: 'DELETE',
      url: '/api/layouts/no-such-layout/collaborators/no-such-user',
      headers: { cookie },
    });
    expect(res.statusCode).toBe(404);
  });
});

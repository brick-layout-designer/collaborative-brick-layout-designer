// Integration tests for module ownership transfers:
//   POST /api/modules/:id/transfer       — initiate
//   GET  /api/module-transfers/:token    — preview
//   POST /api/module-transfers/:token    — accept

import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { db, resetDb, schema } from '../../test/helpers.js';
import { attachUser } from '../../auth/cookie.js';
import { passwordRoutes } from '../auth/password.js';
import { sessionRoutes } from '../auth/session.js';
import { moduleRoutes } from '../modules.js';
import { moduleTransferRoutes } from '../moduleTransfers.js';
import { orgRoutes } from '../orgs.js';
import { orgInviteRoutes } from '../orgInvites.js';

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ bodyLimit: 10 * 1024 * 1024 });
  await app.register(cookie);
  app.addHook('preHandler', attachUser);
  await app.register(passwordRoutes);
  await app.register(sessionRoutes);
  await app.register(moduleRoutes);
  await app.register(moduleTransferRoutes);
  await app.register(orgRoutes);
  await app.register(orgInviteRoutes);
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

async function createModule(app: FastifyInstance, cookieStr: string, title = 'Test Module'): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/modules',
    headers: { cookie: cookieStr },
    payload: { title },
  });
  expect(res.statusCode).toBe(201);
  return (res.json() as { id: string }).id;
}

async function createOrg(app: FastifyInstance, cookieStr: string, name: string): Promise<{ id: string; slug: string }> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/orgs',
    headers: { cookie: cookieStr },
    payload: { name },
  });
  expect(res.statusCode).toBe(201);
  return res.json() as { id: string; slug: string };
}

describe('module transfers — initiate user→user', () => {
  let app: FastifyInstance;
  beforeEach(async () => { resetDb(); app = await buildApp(); });
  afterEach(async () => { await app.close(); });

  it('owner can initiate and get a token', async () => {
    const ownerCookie = await registerAndLogin(app, 'owner@example.com');
    const id = await createModule(app, ownerCookie);

    const res = await app.inject({
      method: 'POST',
      url: `/api/modules/${id}/transfer`,
      headers: { cookie: ownerCookie },
      payload: { recipientEmail: 'recipient@example.com' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { token: string; transferUrl: string; expiresAt: number };
    expect(typeof body.token).toBe('string');
    expect(body.token.length).toBeGreaterThan(10);
    expect(body.expiresAt).toBeGreaterThan(Date.now());
  });

  it('rejects transfer to self', async () => {
    const ownerCookie = await registerAndLogin(app, 'owner@example.com');
    const id = await createModule(app, ownerCookie);

    const res = await app.inject({
      method: 'POST',
      url: `/api/modules/${id}/transfer`,
      headers: { cookie: ownerCookie },
      payload: { recipientEmail: 'owner@example.com' },
    });
    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: string }).error).toBe('cannot_transfer_to_self');
  });

  it('rejects when neither email nor org slug provided', async () => {
    const ownerCookie = await registerAndLogin(app, 'owner@example.com');
    const id = await createModule(app, ownerCookie);

    const res = await app.inject({
      method: 'POST',
      url: `/api/modules/${id}/transfer`,
      headers: { cookie: ownerCookie },
      payload: {},
    });
    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: string }).error).toBe('specify_recipient_email_xor_org');
  });

  it('rejects invalid email', async () => {
    const ownerCookie = await registerAndLogin(app, 'owner@example.com');
    const id = await createModule(app, ownerCookie);

    const res = await app.inject({
      method: 'POST',
      url: `/api/modules/${id}/transfer`,
      headers: { cookie: ownerCookie },
      payload: { recipientEmail: 'bad-email' },
    });
    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: string }).error).toBe('invalid_email');
  });

  it('returns 403 for non-owner', async () => {
    const ownerCookie = await registerAndLogin(app, 'owner@example.com');
    const otherCookie = await registerAndLogin(app, 'other@example.com');
    const id = await createModule(app, ownerCookie);

    const res = await app.inject({
      method: 'POST',
      url: `/api/modules/${id}/transfer`,
      headers: { cookie: otherCookie },
      payload: { recipientEmail: 'anyone@example.com' },
    });
    expect(res.statusCode).toBe(404);
  });

  it('returns 404 for non-existent module', async () => {
    const ownerCookie = await registerAndLogin(app, 'owner@example.com');

    const res = await app.inject({
      method: 'POST',
      url: '/api/modules/does-not-exist/transfer',
      headers: { cookie: ownerCookie },
      payload: { recipientEmail: 'x@example.com' },
    });
    expect(res.statusCode).toBe(404);
  });
});

describe('module transfers — preview', () => {
  let app: FastifyInstance;
  beforeEach(async () => { resetDb(); app = await buildApp(); });
  afterEach(async () => { await app.close(); });

  it('returns module metadata for a valid token', async () => {
    const ownerCookie = await registerAndLogin(app, 'owner@example.com');
    const id = await createModule(app, ownerCookie, 'My Special Module');

    const initRes = await app.inject({
      method: 'POST',
      url: `/api/modules/${id}/transfer`,
      headers: { cookie: ownerCookie },
      payload: { recipientEmail: 'recipient@example.com' },
    });
    const { token } = initRes.json() as { token: string };

    const res = await app.inject({ method: 'GET', url: `/api/module-transfers/${token}` });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { recipientEmail: string; moduleTitle: string; moduleId: string };
    expect(body.recipientEmail).toBe('recipient@example.com');
    expect(body.moduleTitle).toBe('My Special Module');
    expect(body.moduleId).toBe(id);
  });

  it('returns 404 for unknown token', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/module-transfers/no-such-token' });
    expect(res.statusCode).toBe(404);
  });
});

describe('module transfers — accept', () => {
  let app: FastifyInstance;
  beforeEach(async () => { resetDb(); app = await buildApp(); });
  afterEach(async () => { await app.close(); });

  it('recipient can accept and gains ownership', async () => {
    const ownerCookie = await registerAndLogin(app, 'owner@example.com');
    const recipientCookie = await registerAndLogin(app, 'recipient@example.com');
    const id = await createModule(app, ownerCookie);

    const initRes = await app.inject({
      method: 'POST',
      url: `/api/modules/${id}/transfer`,
      headers: { cookie: ownerCookie },
      payload: { recipientEmail: 'recipient@example.com' },
    });
    const { token } = initRes.json() as { token: string };

    const acceptRes = await app.inject({
      method: 'POST',
      url: `/api/module-transfers/${token}`,
      headers: { cookie: recipientCookie },
    });
    expect(acceptRes.statusCode).toBe(200);
    expect((acceptRes.json() as { moduleId: string }).moduleId).toBe(id);

    // Recipient can now GET the module.
    const getRes = await app.inject({
      method: 'GET',
      url: `/api/modules/${id}`,
      headers: { cookie: recipientCookie },
    });
    expect(getRes.statusCode).toBe(200);
  });

  it('original owner is kept as editor after transfer', async () => {
    const ownerCookie = await registerAndLogin(app, 'owner@example.com');
    const recipientCookie = await registerAndLogin(app, 'recipient@example.com');
    const id = await createModule(app, ownerCookie);

    const initRes = await app.inject({
      method: 'POST',
      url: `/api/modules/${id}/transfer`,
      headers: { cookie: ownerCookie },
      payload: { recipientEmail: 'recipient@example.com' },
    });
    const { token } = initRes.json() as { token: string };
    await app.inject({ method: 'POST', url: `/api/module-transfers/${token}`, headers: { cookie: recipientCookie } });

    // Original owner should still be able to GET the module.
    const getRes = await app.inject({
      method: 'GET',
      url: `/api/modules/${id}`,
      headers: { cookie: ownerCookie },
    });
    expect(getRes.statusCode).toBe(200);
  });

  it('returns 403 for email mismatch', async () => {
    const ownerCookie = await registerAndLogin(app, 'owner@example.com');
    const wrongCookie = await registerAndLogin(app, 'wrong@example.com');
    const id = await createModule(app, ownerCookie);

    const initRes = await app.inject({
      method: 'POST',
      url: `/api/modules/${id}/transfer`,
      headers: { cookie: ownerCookie },
      payload: { recipientEmail: 'recipient@example.com' },
    });
    const { token } = initRes.json() as { token: string };

    const res = await app.inject({
      method: 'POST',
      url: `/api/module-transfers/${token}`,
      headers: { cookie: wrongCookie },
    });
    expect(res.statusCode).toBe(403);
    expect((res.json() as { error: string }).error).toBe('email_mismatch');
  });

  it('returns 410 on double-accept', async () => {
    const ownerCookie = await registerAndLogin(app, 'owner@example.com');
    const recipientCookie = await registerAndLogin(app, 'recipient@example.com');
    const id = await createModule(app, ownerCookie);

    const initRes = await app.inject({
      method: 'POST',
      url: `/api/modules/${id}/transfer`,
      headers: { cookie: ownerCookie },
      payload: { recipientEmail: 'recipient@example.com' },
    });
    const { token } = initRes.json() as { token: string };
    await app.inject({ method: 'POST', url: `/api/module-transfers/${token}`, headers: { cookie: recipientCookie } });
    const second = await app.inject({ method: 'POST', url: `/api/module-transfers/${token}`, headers: { cookie: recipientCookie } });
    expect(second.statusCode).toBe(410);
    expect((second.json() as { error: string }).error).toBe('transfer_already_accepted');
  });
});

describe('module transfers — user→org (immediate)', () => {
  let app: FastifyInstance;
  beforeEach(async () => { resetDb(); app = await buildApp(); });
  afterEach(async () => { await app.close(); });

  it('owner can transfer module to an org they belong to', async () => {
    const ownerCookie = await registerAndLogin(app, 'owner@example.com');
    const id = await createModule(app, ownerCookie);
    const org = await createOrg(app, ownerCookie, 'Module Org');

    const res = await app.inject({
      method: 'POST',
      url: `/api/modules/${id}/transfer`,
      headers: { cookie: ownerCookie },
      payload: { recipientOrgSlug: org.slug },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { transferred: boolean; ownerKind: string; ownerSlug: string };
    expect(body.transferred).toBe(true);
    expect(body.ownerKind).toBe('org');
    expect(body.ownerSlug).toBe(org.slug);
  });

  it('returns 404 for unknown org slug', async () => {
    const ownerCookie = await registerAndLogin(app, 'owner@example.com');
    const id = await createModule(app, ownerCookie);

    const res = await app.inject({
      method: 'POST',
      url: `/api/modules/${id}/transfer`,
      headers: { cookie: ownerCookie },
      payload: { recipientOrgSlug: 'no-such-org' },
    });
    expect(res.statusCode).toBe(404);
    expect((res.json() as { error: string }).error).toBe('recipient_org_not_found');
  });

  it('returns 403 if caller is not a member of the destination org', async () => {
    const ownerCookie = await registerAndLogin(app, 'owner@example.com');
    const otherCookie = await registerAndLogin(app, 'other@example.com');
    const id = await createModule(app, ownerCookie);
    const org = await createOrg(app, otherCookie, 'Other Org');

    const res = await app.inject({
      method: 'POST',
      url: `/api/modules/${id}/transfer`,
      headers: { cookie: ownerCookie },
      payload: { recipientOrgSlug: org.slug },
    });
    expect(res.statusCode).toBe(403);
    expect((res.json() as { error: string }).error).toBe('not_a_member_of_recipient_org');
  });

  it('returns 400 when trying user→user transfer on an org-owned module', async () => {
    const ownerCookie = await registerAndLogin(app, 'owner@example.com');
    const org = await createOrg(app, ownerCookie, 'Acme Corp');
    // Create a module owned by the org.
    const res = await app.inject({
      method: 'POST',
      url: '/api/modules',
      headers: { cookie: ownerCookie },
      payload: { title: 'Org Module', orgSlug: org.slug },
    });
    expect(res.statusCode).toBe(201);
    const moduleId = (res.json() as { id: string }).id;

    const transferRes = await app.inject({
      method: 'POST',
      url: `/api/modules/${moduleId}/transfer`,
      headers: { cookie: ownerCookie },
      payload: { recipientEmail: 'recipient@example.com' },
    });
    expect(transferRes.statusCode).toBe(400);
    expect((transferRes.json() as { error: string }).error).toBe('org_owned_modules_can_only_transfer_to_orgs');
  });

  it('org-owned module can be transferred from one org to another (org→org)', async () => {
    const ownerCookie = await registerAndLogin(app, 'owner@example.com');
    const srcOrg = await createOrg(app, ownerCookie, 'Source Org');
    const dstOrg = await createOrg(app, ownerCookie, 'Dest Org');

    // Create a module owned by srcOrg.
    const res = await app.inject({
      method: 'POST',
      url: '/api/modules',
      headers: { cookie: ownerCookie },
      payload: { title: 'Shared Module', orgSlug: srcOrg.slug },
    });
    expect(res.statusCode).toBe(201);
    const moduleId = (res.json() as { id: string }).id;

    // Transfer from srcOrg to dstOrg (owner is admin of both).
    const transferRes = await app.inject({
      method: 'POST',
      url: `/api/modules/${moduleId}/transfer`,
      headers: { cookie: ownerCookie },
      payload: { recipientOrgSlug: dstOrg.slug },
    });
    expect(transferRes.statusCode).toBe(200);
    const body = transferRes.json() as { transferred: boolean; ownerKind: string; ownerSlug: string };
    expect(body.transferred).toBe(true);
    expect(body.ownerKind).toBe('org');
    expect(body.ownerSlug).toBe(dstOrg.slug);
  });
});

// ---------------------------------------------------------------------------
// Helpers for inserting transfers with custom expiry/accepted state.
// ---------------------------------------------------------------------------

async function getUserId(email: string): Promise<string> {
  const row = await db.select().from(schema.users).where(eq(schema.users.email, email)).get();
  return row!.id;
}

async function getModuleId(app: FastifyInstance, cookieStr: string, title = 'Test'): Promise<string> {
  const res = await app.inject({
    method: 'POST', url: '/api/modules', headers: { cookie: cookieStr }, payload: { title },
  });
  return (res.json() as { id: string }).id;
}

import { eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';

async function insertModuleTransfer(opts: {
  moduleId: string;
  initiatedBy: string;
  recipientEmail: string;
  expiresAt: Date;
  acceptedAt?: Date;
}): Promise<string> {
  const token = `mt-tok-${Math.random().toString(36).slice(2)}`;
  const id = randomUUID();
  await db.insert(schema.moduleTransfers).values({
    id,
    moduleId: opts.moduleId,
    initiatedBy: opts.initiatedBy,
    recipientEmail: opts.recipientEmail,
    token,
    expiresAt: opts.expiresAt,
    acceptedAt: opts.acceptedAt ?? null,
    createdAt: new Date(),
  });
  return token;
}

describe('module transfers — preview expiry edge cases', () => {
  let app: FastifyInstance;
  beforeEach(async () => { resetDb(); app = await buildApp(); });
  afterEach(async () => { await app.close(); });

  it('GET returns 410 when transfer was already accepted', async () => {
    const ownerCookie = await registerAndLogin(app, 'owner@example.com');
    const ownerId = await getUserId('owner@example.com');
    const moduleId = await getModuleId(app, ownerCookie);
    const token = await insertModuleTransfer({
      moduleId,
      initiatedBy: ownerId,
      recipientEmail: 'recipient@example.com',
      expiresAt: new Date(Date.now() + 86400_000),
      acceptedAt: new Date(),
    });

    const res = await app.inject({ method: 'GET', url: `/api/module-transfers/${token}` });
    expect(res.statusCode).toBe(410);
    expect((res.json() as { error: string }).error).toBe('transfer_already_accepted');
  });

  it('GET returns 410 when transfer has expired', async () => {
    const ownerCookie = await registerAndLogin(app, 'owner@example.com');
    const ownerId = await getUserId('owner@example.com');
    const moduleId = await getModuleId(app, ownerCookie);
    const token = await insertModuleTransfer({
      moduleId,
      initiatedBy: ownerId,
      recipientEmail: 'recipient@example.com',
      expiresAt: new Date(Date.now() - 1000),
    });

    const res = await app.inject({ method: 'GET', url: `/api/module-transfers/${token}` });
    expect(res.statusCode).toBe(410);
    expect((res.json() as { error: string }).error).toBe('transfer_expired');
  });

  it('POST accept returns 403 when email does not match', async () => {
    const ownerCookie = await registerAndLogin(app, 'owner@example.com');
    const wrongCookie = await registerAndLogin(app, 'wrongperson@example.com');
    const ownerId = await getUserId('owner@example.com');
    const moduleId = await getModuleId(app, ownerCookie);
    const token = await insertModuleTransfer({
      moduleId,
      initiatedBy: ownerId,
      recipientEmail: 'correct@example.com',
      expiresAt: new Date(Date.now() + 86400_000),
    });

    const res = await app.inject({
      method: 'POST',
      url: `/api/module-transfers/${token}`,
      headers: { cookie: wrongCookie },
    });
    expect(res.statusCode).toBe(403);
    expect((res.json() as { error: string }).error).toBe('email_mismatch');
  });

  it('POST accept returns 410 when transfer has expired', async () => {
    const ownerCookie = await registerAndLogin(app, 'owner@example.com');
    const recipientCookie = await registerAndLogin(app, 'recipient@example.com');
    const ownerId = await getUserId('owner@example.com');
    const moduleId = await getModuleId(app, ownerCookie);
    const token = await insertModuleTransfer({
      moduleId,
      initiatedBy: ownerId,
      recipientEmail: 'recipient@example.com',
      expiresAt: new Date(Date.now() - 1000),
    });

    const res = await app.inject({
      method: 'POST',
      url: `/api/module-transfers/${token}`,
      headers: { cookie: recipientCookie },
    });
    expect(res.statusCode).toBe(410);
    expect((res.json() as { error: string }).error).toBe('transfer_expired');
  });
});

describe('module transfers — accept: initiator-is-recipient edge case', () => {
  let app: FastifyInstance;
  beforeEach(async () => { resetDb(); app = await buildApp(); });
  afterEach(async () => { await app.close(); });

  it('does not add initiator as editor when they accept their own transfer', async () => {
    // Insert a transfer where initiatedBy === recipient (edge case: same user).
    const ownerCookie = await registerAndLogin(app, 'owner@example.com');
    const ownerId = await getUserId('owner@example.com');
    const moduleId = await getModuleId(app, ownerCookie);
    const token = await insertModuleTransfer({
      moduleId,
      initiatedBy: ownerId,
      recipientEmail: 'owner@example.com',
      expiresAt: new Date(Date.now() + 86400_000),
    });

    const res = await app.inject({
      method: 'POST',
      url: `/api/module-transfers/${token}`,
      headers: { cookie: ownerCookie },
    });
    expect(res.statusCode).toBe(200);

    // Owner should still be the owner; no duplicate collaborator row added.
    const collaborators = await db
      .select()
      .from(schema.moduleCollaborators)
      .where(eq(schema.moduleCollaborators.moduleId, moduleId));
    expect(collaborators.length).toBe(0);
  });
});

describe('module transfers — initiate: collaborator (non-owner) gets 403', () => {
  let app: FastifyInstance;
  beforeEach(async () => { resetDb(); app = await buildApp(); });
  afterEach(async () => { await app.close(); });

  it('returns 403 when initiator is a collaborator but not the owner', async () => {
    const ownerCookie = await registerAndLogin(app, 'owner@example.com');
    const editorCookie = await registerAndLogin(app, 'editor@example.com');
    const moduleId = await createModule(app, ownerCookie);
    const editor = await db.select().from(schema.users).where(eq(schema.users.email, 'editor@example.com')).get();
    await db.insert(schema.moduleCollaborators).values({ moduleId, userId: editor!.id, role: 'editor', addedAt: new Date() });

    const res = await app.inject({
      method: 'POST',
      url: `/api/modules/${moduleId}/transfer`,
      headers: { cookie: editorCookie },
      payload: { recipientEmail: 'anyone@example.com' },
    });
    expect(res.statusCode).toBe(403);
    expect((res.json() as { error: string }).error).toBe('forbidden');
  });
});

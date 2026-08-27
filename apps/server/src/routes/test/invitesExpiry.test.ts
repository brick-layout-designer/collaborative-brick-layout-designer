// Integration tests for invite and org-invite expiry / email-mismatch paths.
// Covers the branches left uncovered by the main test suites:
//   invites.ts  line 29  (GET → 410 already accepted)
//               line 31  (GET → 410 expired)
//               line 64  (POST → 410 already accepted)
//               line 67  (POST → 410 expired)
//               line 73  (POST → 403 email_mismatch)
//   orgInvites.ts line 25 (GET → 410 already accepted)
//                 line 28 (GET → 410 expired)
//                 line 59 (POST → 410 already accepted)
//                 line 62 (POST → 410 expired)
//                 line 67 (POST → 403 email_mismatch)

import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, schema, resetDb } from '../../test/helpers.js';
import { attachUser } from '../../auth/cookie.js';
import { passwordRoutes } from '../auth/password.js';
import { sessionRoutes } from '../auth/session.js';
import { layoutRoutes } from '../layouts.js';
import { orgRoutes } from '../orgs.js';
import { orgInviteRoutes } from '../orgInvites.js';
import { inviteRoutes } from '../invites.js';

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ bodyLimit: 10 * 1024 * 1024 });
  await app.register(cookie);
  app.addHook('preHandler', attachUser);
  await app.register(passwordRoutes);
  await app.register(sessionRoutes);
  await app.register(layoutRoutes);
  await app.register(orgRoutes);
  await app.register(orgInviteRoutes);
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

async function createLayout(app: FastifyInstance, cookieStr: string, title = 'Test'): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/layouts',
    headers: { cookie: cookieStr },
    payload: { title },
  });
  expect(res.statusCode).toBe(201);
  return (res.json() as { id: string }).id;
}

// ---- layout invite expiry helpers -----------------------------------------

/**
 * Create a layout invite directly in the DB with a custom expiresAt.
 * `invitedBy` is accepted (call sites fetch the owner's id for it) but
 * unused — `layout_invites` has no such column; it's kept as a param so
 * call sites document who's issuing the invite without implying the
 * schema tracks it.
 */
async function insertLayoutInvite(opts: {
  layoutId: string;
  invitedBy: string;
  invitedEmail: string;
  expiresAt: Date;
  acceptedAt?: Date;
}): Promise<string> {
  void opts.invitedBy;
  const token = `tok-layout-${Math.random().toString(36).slice(2)}`;
  const id = `inv-${Math.random().toString(36).slice(2)}`;
  await db.insert(schema.layoutInvites).values({
    id,
    layoutId: opts.layoutId,
    invitedEmail: opts.invitedEmail,
    role: 'editor',
    token,
    expiresAt: opts.expiresAt,
    acceptedAt: opts.acceptedAt ?? null,
  });
  return token;
}

/** Get the user id for a registered email. */
async function getUserId(email: string): Promise<string> {
  const row = await db.select().from(schema.users).where(eq(schema.users.email, email)).get();
  return row!.id;
}

// ---- org invite helpers ----------------------------------------------------

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

async function insertOrgInvite(opts: {
  orgId: string;
  invitedBy: string;
  invitedEmail: string;
  expiresAt: Date;
  acceptedAt?: Date;
}): Promise<string> {
  const token = `tok-org-${Math.random().toString(36).slice(2)}`;
  const id = `org-inv-${Math.random().toString(36).slice(2)}`;
  await db.insert(schema.orgInvites).values({
    id,
    orgId: opts.orgId,
    invitedBy: opts.invitedBy,
    invitedEmail: opts.invitedEmail,
    role: 'member',
    token,
    expiresAt: opts.expiresAt,
    acceptedAt: opts.acceptedAt ?? null,
  });
  return token;
}

// ===========================================================================
// Layout invite — GET preview
// ===========================================================================

describe('layout invite — GET preview edge cases', () => {
  let app: FastifyInstance;
  beforeEach(async () => { resetDb(); app = await buildApp(); });
  afterEach(async () => { await app.close(); });

  it('returns 404 for an unknown token', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/invites/no-such-token' });
    expect(res.statusCode).toBe(404);
  });

  it('returns 410 when the invite has already been accepted', async () => {
    const ownerCookie = await registerAndLogin(app, 'owner@example.com');
    const ownerId = await getUserId('owner@example.com');
    const layoutId = await createLayout(app, ownerCookie);
    const token = await insertLayoutInvite({
      layoutId,
      invitedBy: ownerId,
      invitedEmail: 'invitee@example.com',
      expiresAt: new Date(Date.now() + 86400_000),
      acceptedAt: new Date(),
    });

    const res = await app.inject({ method: 'GET', url: `/api/invites/${token}` });
    expect(res.statusCode).toBe(410);
    expect((res.json() as { error: string }).error).toBe('invite_already_accepted');
  });

  it('returns 410 when the invite has expired', async () => {
    const ownerCookie = await registerAndLogin(app, 'owner@example.com');
    const ownerId = await getUserId('owner@example.com');
    const layoutId = await createLayout(app, ownerCookie);
    const token = await insertLayoutInvite({
      layoutId,
      invitedBy: ownerId,
      invitedEmail: 'invitee@example.com',
      expiresAt: new Date(Date.now() - 1000),
    });

    const res = await app.inject({ method: 'GET', url: `/api/invites/${token}` });
    expect(res.statusCode).toBe(410);
    expect((res.json() as { error: string }).error).toBe('invite_expired');
  });

  it('returns 200 with invite details for a valid token', async () => {
    const ownerCookie = await registerAndLogin(app, 'owner@example.com');
    const ownerId = await getUserId('owner@example.com');
    const layoutId = await createLayout(app, ownerCookie, 'Invite Layout');
    const token = await insertLayoutInvite({
      layoutId,
      invitedBy: ownerId,
      invitedEmail: 'invitee@example.com',
      expiresAt: new Date(Date.now() + 86400_000),
    });

    const res = await app.inject({ method: 'GET', url: `/api/invites/${token}` });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { invitedEmail: string; layoutTitle: string };
    expect(body.invitedEmail).toBe('invitee@example.com');
    expect(body.layoutTitle).toBe('Invite Layout');
  });
});

// ===========================================================================
// Layout invite — POST accept
// ===========================================================================

describe('layout invite — POST accept edge cases', () => {
  let app: FastifyInstance;
  beforeEach(async () => { resetDb(); app = await buildApp(); });
  afterEach(async () => { await app.close(); });

  it('returns 401 when unauthenticated', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/invites/any-token' });
    expect(res.statusCode).toBe(401);
  });

  it('returns 404 for an unknown token', async () => {
    const cookie = await registerAndLogin(app, 'user@example.com');
    const res = await app.inject({
      method: 'POST',
      url: '/api/invites/no-such-token',
      headers: { cookie },
    });
    expect(res.statusCode).toBe(404);
  });

  it('returns 410 when the invite has already been accepted', async () => {
    const ownerCookie = await registerAndLogin(app, 'owner@example.com');
    const inviteeCookie = await registerAndLogin(app, 'invitee@example.com');
    const ownerId = await getUserId('owner@example.com');
    const layoutId = await createLayout(app, ownerCookie);
    const token = await insertLayoutInvite({
      layoutId,
      invitedBy: ownerId,
      invitedEmail: 'invitee@example.com',
      expiresAt: new Date(Date.now() + 86400_000),
      acceptedAt: new Date(),
    });

    const res = await app.inject({
      method: 'POST',
      url: `/api/invites/${token}`,
      headers: { cookie: inviteeCookie },
    });
    expect(res.statusCode).toBe(410);
    expect((res.json() as { error: string }).error).toBe('invite_already_accepted');
  });

  it('returns 410 when the invite has expired', async () => {
    const ownerCookie = await registerAndLogin(app, 'owner@example.com');
    const inviteeCookie = await registerAndLogin(app, 'invitee@example.com');
    const ownerId = await getUserId('owner@example.com');
    const layoutId = await createLayout(app, ownerCookie);
    const token = await insertLayoutInvite({
      layoutId,
      invitedBy: ownerId,
      invitedEmail: 'invitee@example.com',
      expiresAt: new Date(Date.now() - 1000),
    });

    const res = await app.inject({
      method: 'POST',
      url: `/api/invites/${token}`,
      headers: { cookie: inviteeCookie },
    });
    expect(res.statusCode).toBe(410);
    expect((res.json() as { error: string }).error).toBe('invite_expired');
  });

  it('returns 403 on email mismatch', async () => {
    const ownerCookie = await registerAndLogin(app, 'owner@example.com');
    const wrongCookie = await registerAndLogin(app, 'wrong@example.com');
    const ownerId = await getUserId('owner@example.com');
    const layoutId = await createLayout(app, ownerCookie);
    const token = await insertLayoutInvite({
      layoutId,
      invitedBy: ownerId,
      invitedEmail: 'invitee@example.com',
      expiresAt: new Date(Date.now() + 86400_000),
    });

    const res = await app.inject({
      method: 'POST',
      url: `/api/invites/${token}`,
      headers: { cookie: wrongCookie },
    });
    expect(res.statusCode).toBe(403);
    expect((res.json() as { error: string }).error).toBe('email_mismatch');
  });

  it('accepts a valid invite and returns layoutId + role', async () => {
    const ownerCookie = await registerAndLogin(app, 'owner@example.com');
    const inviteeCookie = await registerAndLogin(app, 'invitee@example.com');
    const ownerId = await getUserId('owner@example.com');
    const layoutId = await createLayout(app, ownerCookie);
    const token = await insertLayoutInvite({
      layoutId,
      invitedBy: ownerId,
      invitedEmail: 'invitee@example.com',
      expiresAt: new Date(Date.now() + 86400_000),
    });

    const res = await app.inject({
      method: 'POST',
      url: `/api/invites/${token}`,
      headers: { cookie: inviteeCookie },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { layoutId: string; role: string };
    expect(body.layoutId).toBe(layoutId);
    expect(body.role).toBe('editor');
  });
});

// ===========================================================================
// Org invite — GET preview
// ===========================================================================

describe('org invite — GET preview edge cases', () => {
  let app: FastifyInstance;
  beforeEach(async () => { resetDb(); app = await buildApp(); });
  afterEach(async () => { await app.close(); });

  it('returns 404 for unknown token', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/org-invites/no-such' });
    expect(res.statusCode).toBe(404);
  });

  it('returns 410 for an already-accepted org invite', async () => {
    const adminCookie = await registerAndLogin(app, 'admin@example.com');
    const adminId = await getUserId('admin@example.com');
    const org = await createOrg(app, adminCookie, 'My Org');
    const token = await insertOrgInvite({
      orgId: org.id,
      invitedBy: adminId,
      invitedEmail: 'member@example.com',
      expiresAt: new Date(Date.now() + 86400_000),
      acceptedAt: new Date(),
    });

    const res = await app.inject({ method: 'GET', url: `/api/org-invites/${token}` });
    expect(res.statusCode).toBe(410);
    expect((res.json() as { error: string }).error).toBe('invite_already_accepted');
  });

  it('returns 410 for an expired org invite', async () => {
    const adminCookie = await registerAndLogin(app, 'admin@example.com');
    const adminId = await getUserId('admin@example.com');
    const org = await createOrg(app, adminCookie, 'My Org');
    const token = await insertOrgInvite({
      orgId: org.id,
      invitedBy: adminId,
      invitedEmail: 'member@example.com',
      expiresAt: new Date(Date.now() - 1000),
    });

    const res = await app.inject({ method: 'GET', url: `/api/org-invites/${token}` });
    expect(res.statusCode).toBe(410);
    expect((res.json() as { error: string }).error).toBe('invite_expired');
  });

  it('returns 200 with org details for a valid token', async () => {
    const adminCookie = await registerAndLogin(app, 'admin@example.com');
    const adminId = await getUserId('admin@example.com');
    const org = await createOrg(app, adminCookie, 'Preview Org');
    const token = await insertOrgInvite({
      orgId: org.id,
      invitedBy: adminId,
      invitedEmail: 'member@example.com',
      expiresAt: new Date(Date.now() + 86400_000),
    });

    const res = await app.inject({ method: 'GET', url: `/api/org-invites/${token}` });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { orgName: string; invitedEmail: string };
    expect(body.orgName).toBe('Preview Org');
    expect(body.invitedEmail).toBe('member@example.com');
  });
});

// ===========================================================================
// Org invite — POST accept
// ===========================================================================

describe('org invite — POST accept edge cases', () => {
  let app: FastifyInstance;
  beforeEach(async () => { resetDb(); app = await buildApp(); });
  afterEach(async () => { await app.close(); });

  it('returns 401 when unauthenticated', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/org-invites/any' });
    expect(res.statusCode).toBe(401);
  });

  it('returns 410 for an already-accepted org invite', async () => {
    const adminCookie = await registerAndLogin(app, 'admin@example.com');
    const memberCookie = await registerAndLogin(app, 'member@example.com');
    const adminId = await getUserId('admin@example.com');
    const org = await createOrg(app, adminCookie, 'My Org');
    const token = await insertOrgInvite({
      orgId: org.id,
      invitedBy: adminId,
      invitedEmail: 'member@example.com',
      expiresAt: new Date(Date.now() + 86400_000),
      acceptedAt: new Date(),
    });

    const res = await app.inject({
      method: 'POST',
      url: `/api/org-invites/${token}`,
      headers: { cookie: memberCookie },
    });
    expect(res.statusCode).toBe(410);
  });

  it('returns 410 for an expired org invite', async () => {
    const adminCookie = await registerAndLogin(app, 'admin@example.com');
    const memberCookie = await registerAndLogin(app, 'member@example.com');
    const adminId = await getUserId('admin@example.com');
    const org = await createOrg(app, adminCookie, 'My Org');
    const token = await insertOrgInvite({
      orgId: org.id,
      invitedBy: adminId,
      invitedEmail: 'member@example.com',
      expiresAt: new Date(Date.now() - 1000),
    });

    const res = await app.inject({
      method: 'POST',
      url: `/api/org-invites/${token}`,
      headers: { cookie: memberCookie },
    });
    expect(res.statusCode).toBe(410);
  });

  it('returns 403 on email mismatch', async () => {
    const adminCookie = await registerAndLogin(app, 'admin@example.com');
    const wrongCookie = await registerAndLogin(app, 'wrong@example.com');
    const adminId = await getUserId('admin@example.com');
    const org = await createOrg(app, adminCookie, 'My Org');
    const token = await insertOrgInvite({
      orgId: org.id,
      invitedBy: adminId,
      invitedEmail: 'rightperson@example.com',
      expiresAt: new Date(Date.now() + 86400_000),
    });

    const res = await app.inject({
      method: 'POST',
      url: `/api/org-invites/${token}`,
      headers: { cookie: wrongCookie },
    });
    expect(res.statusCode).toBe(403);
    expect((res.json() as { error: string }).error).toBe('email_mismatch');
  });

  it('accepts a valid org invite and returns orgId + role', async () => {
    const adminCookie = await registerAndLogin(app, 'admin@example.com');
    const memberCookie = await registerAndLogin(app, 'member@example.com');
    const adminId = await getUserId('admin@example.com');
    const org = await createOrg(app, adminCookie, 'My Org');
    const token = await insertOrgInvite({
      orgId: org.id,
      invitedBy: adminId,
      invitedEmail: 'member@example.com',
      expiresAt: new Date(Date.now() + 86400_000),
    });

    const res = await app.inject({
      method: 'POST',
      url: `/api/org-invites/${token}`,
      headers: { cookie: memberCookie },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { orgId: string; role: string };
    expect(body.orgId).toBe(org.id);
    expect(body.role).toBe('member');
  });
});

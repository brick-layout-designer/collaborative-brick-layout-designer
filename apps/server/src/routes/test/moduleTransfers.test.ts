// Integration tests for module ownership transfers:
//   POST /api/modules/:id/transfer       — to a club, at once
// (The person-to-person transfer by emailed link is gone: it had no page.)

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
import { eq } from 'drizzle-orm';

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

  it('a transfer to a person by email is refused, for a club’s module too', async () => {
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
    expect((transferRes.json() as { error: string }).error).toBe('transfer_to_club_only');
    // …and a personal one: no pending transfer, no emailed link, no token routes.
    const mine = await createModule(app, ownerCookie, 'Mine');
    const byEmail = await app.inject({ method: 'POST', url: `/api/modules/${mine}/transfer`, headers: { cookie: ownerCookie }, payload: { recipientEmail: 'someone@example.com' } });
    expect(byEmail.statusCode).toBe(400);
    expect((byEmail.json() as { error: string }).error).toBe('transfer_to_club_only');
    expect(await db.select().from(schema.moduleTransfers).all()).toHaveLength(0);
    expect((await app.inject({ method: 'GET', url: '/api/module-transfers/anything' })).statusCode).toBe(404);
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

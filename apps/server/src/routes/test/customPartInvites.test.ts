// Integration tests for custom-part invite acceptance:
//   GET  /api/custom-part-invites/:token  — preview
//   POST /api/custom-part-invites/:token  — accept

import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, resetDb, schema } from '../../test/helpers.js';
import { attachUser } from '../../auth/cookie.js';
import { passwordRoutes } from '../auth/password.js';
import { sessionRoutes } from '../auth/session.js';
import { orgRoutes } from '../orgs.js';
import { customPartRoutes } from '../customParts.js';
import { customPartInviteRoutes } from '../customPartInvites.js';

const SAMPLE_XML = Buffer.from(
  `<?xml version="1.0"?><part><Author>Test</Author></part>`,
).toString('base64');
const FAKE_GIF = Buffer.from('GIF89a\x01\x00\x01\x00\x00\xff\x00,\x00\x00\x00\x00\x01\x00\x01\x00\x00\x02\x00;').toString('base64');

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ bodyLimit: 10 * 1024 * 1024 });
  await app.register(cookie);
  app.addHook('preHandler', attachUser);
  await app.register(passwordRoutes);
  await app.register(sessionRoutes);
  await app.register(orgRoutes);
  await app.register(customPartRoutes);
  await app.register(customPartInviteRoutes);
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

async function createPart(app: FastifyInstance, cookieStr: string, partNumber = 'PART_A'): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/custom-parts',
    headers: { cookie: cookieStr },
    payload: {
      partNumber,
      displayName: 'Test Part',
      xmlBase64: SAMPLE_XML,
      spriteBase64: FAKE_GIF,
      spriteMime: 'image/gif',
    },
  });
  expect(res.statusCode).toBe(201);
  return (res.json() as { id: string }).id;
}

async function createPendingInvite(
  app: FastifyInstance,
  ownerCookie: string,
  partId: string,
  recipientEmail: string,
): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: `/api/custom-parts/${partId}/invites`,
    headers: { cookie: ownerCookie },
    payload: { email: recipientEmail, role: 'editor' },
  });
  // Recipient is not registered, so we get 202 + token.
  expect(res.statusCode).toBe(202);
  const body = res.json() as { inviteUrl: string };
  return body.inviteUrl.split('/').pop()!;
}

describe('custom-part invites — preview (GET)', () => {
  let app: FastifyInstance;
  beforeEach(async () => { resetDb(); app = await buildApp(); });
  afterEach(async () => { await app.close(); });

  it('returns metadata for a valid pending invite', async () => {
    const ownerCookie = await registerAndLogin(app, 'owner@example.com');
    const partId = await createPart(app, ownerCookie);
    const token = await createPendingInvite(app, ownerCookie, partId, 'pending@example.com');

    const res = await app.inject({ method: 'GET', url: `/api/custom-part-invites/${token}` });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      invitedEmail: string;
      role: string;
      customPartId: string;
      partNumber: string;
      displayName: string;
      expiresAt: number;
    };
    expect(body.invitedEmail).toBe('pending@example.com');
    expect(body.role).toBe('editor');
    expect(body.customPartId).toBe(partId);
    expect(typeof body.partNumber).toBe('string');
    expect(body.expiresAt).toBeGreaterThan(Date.now());
  });

  it('returns 404 for an unknown token', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/custom-part-invites/no-such-token' });
    expect(res.statusCode).toBe(404);
    expect((res.json() as { error: string }).error).toBe('invite_not_found');
  });

  it('returns 410 for an already-accepted invite', async () => {
    const ownerCookie = await registerAndLogin(app, 'owner@example.com');
    const partId = await createPart(app, ownerCookie);
    const token = await createPendingInvite(app, ownerCookie, partId, 'recipient@example.com');

    const recipientCookie = await registerAndLogin(app, 'recipient@example.com');
    await app.inject({ method: 'POST', url: `/api/custom-part-invites/${token}`, headers: { cookie: recipientCookie } });

    const res = await app.inject({ method: 'GET', url: `/api/custom-part-invites/${token}` });
    expect(res.statusCode).toBe(410);
    expect((res.json() as { error: string }).error).toBe('invite_already_accepted');
  });

  it('returns 410 for an expired invite', async () => {
    const ownerCookie = await registerAndLogin(app, 'owner@example.com');
    const partId = await createPart(app, ownerCookie);
    const token = await createPendingInvite(app, ownerCookie, partId, 'expired@example.com');

    // Back-date the expiry directly in the DB.
    const invite = await db
      .select()
      .from(schema.customPartInvites)
      .where(eq(schema.customPartInvites.token, token))
      .get();
    await db
      .update(schema.customPartInvites)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(schema.customPartInvites.id, invite!.id));

    const res = await app.inject({ method: 'GET', url: `/api/custom-part-invites/${token}` });
    expect(res.statusCode).toBe(410);
    expect((res.json() as { error: string }).error).toBe('invite_expired');
  });
});

describe('custom-part invites — accept (POST)', () => {
  let app: FastifyInstance;
  beforeEach(async () => { resetDb(); app = await buildApp(); });
  afterEach(async () => { await app.close(); });

  it('recipient can accept and gains access to the part', async () => {
    const ownerCookie = await registerAndLogin(app, 'owner@example.com');
    const partId = await createPart(app, ownerCookie);
    const token = await createPendingInvite(app, ownerCookie, partId, 'recipient@example.com');

    const recipientCookie = await registerAndLogin(app, 'recipient@example.com');
    const acceptRes = await app.inject({
      method: 'POST',
      url: `/api/custom-part-invites/${token}`,
      headers: { cookie: recipientCookie },
    });
    expect(acceptRes.statusCode).toBe(200);
    const body = acceptRes.json() as { customPartId: string; role: string };
    expect(body.customPartId).toBe(partId);
    expect(body.role).toBe('editor');

    // Recipient can now GET the part.
    const getRes = await app.inject({
      method: 'GET',
      url: `/api/custom-parts/${partId}`,
      headers: { cookie: recipientCookie },
    });
    expect(getRes.statusCode).toBe(200);
    expect((getRes.json() as { role: string }).role).toBe('editor');
  });

  it('returns 403 for email mismatch', async () => {
    const ownerCookie = await registerAndLogin(app, 'owner@example.com');
    const partId = await createPart(app, ownerCookie);
    const token = await createPendingInvite(app, ownerCookie, partId, 'recipient@example.com');

    const wrongCookie = await registerAndLogin(app, 'wrong@example.com');
    const res = await app.inject({
      method: 'POST',
      url: `/api/custom-part-invites/${token}`,
      headers: { cookie: wrongCookie },
    });
    expect(res.statusCode).toBe(403);
    expect((res.json() as { error: string }).error).toBe('email_mismatch');
  });

  it('returns 410 when accepting an expired invite', async () => {
    const ownerCookie = await registerAndLogin(app, 'owner@example.com');
    const partId = await createPart(app, ownerCookie);
    const token = await createPendingInvite(app, ownerCookie, partId, 'recipient@example.com');

    const invite = await db
      .select()
      .from(schema.customPartInvites)
      .where(eq(schema.customPartInvites.token, token))
      .get();
    await db
      .update(schema.customPartInvites)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(schema.customPartInvites.id, invite!.id));

    const recipientCookie = await registerAndLogin(app, 'recipient@example.com');
    const res = await app.inject({
      method: 'POST',
      url: `/api/custom-part-invites/${token}`,
      headers: { cookie: recipientCookie },
    });
    expect(res.statusCode).toBe(410);
    expect((res.json() as { error: string }).error).toBe('invite_expired');
  });

  it('returns 410 on double-accept', async () => {
    const ownerCookie = await registerAndLogin(app, 'owner@example.com');
    const partId = await createPart(app, ownerCookie);
    const token = await createPendingInvite(app, ownerCookie, partId, 'recipient@example.com');

    const recipientCookie = await registerAndLogin(app, 'recipient@example.com');
    await app.inject({ method: 'POST', url: `/api/custom-part-invites/${token}`, headers: { cookie: recipientCookie } });
    const second = await app.inject({
      method: 'POST',
      url: `/api/custom-part-invites/${token}`,
      headers: { cookie: recipientCookie },
    });
    expect(second.statusCode).toBe(410);
    expect((second.json() as { error: string }).error).toBe('invite_already_accepted');
  });

  it('returns 401 when unauthenticated', async () => {
    const ownerCookie = await registerAndLogin(app, 'owner@example.com');
    const partId = await createPart(app, ownerCookie);
    const token = await createPendingInvite(app, ownerCookie, partId, 'recipient@example.com');

    const res = await app.inject({ method: 'POST', url: `/api/custom-part-invites/${token}` });
    expect(res.statusCode).toBe(401);
  });

  it('returns 404 for unknown token', async () => {
    const recipientCookie = await registerAndLogin(app, 'recipient@example.com');
    const res = await app.inject({
      method: 'POST',
      url: '/api/custom-part-invites/no-such-token',
      headers: { cookie: recipientCookie },
    });
    expect(res.statusCode).toBe(404);
    expect((res.json() as { error: string }).error).toBe('invite_not_found');
  });
});

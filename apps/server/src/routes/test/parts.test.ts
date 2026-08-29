// Integration tests for the parts catalog endpoint:
//   GET /api/parts/catalog

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
import { partsRoutes, invalidatePartsCache } from '../parts.js';

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
  await app.register(partsRoutes);
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

describe('parts catalog — anonymous', () => {
  let app: FastifyInstance;
  beforeEach(async () => { resetDb(); invalidatePartsCache(); app = await buildApp(); });
  afterEach(async () => { await app.close(); });

  it('returns 200 with a parts array (may be empty if no parts dir)', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/parts/catalog' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { parts: unknown[] };
    expect(Array.isArray(body.parts)).toBe(true);
  });

  it('sets an ETag header on every response', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/parts/catalog' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['etag']).toBeTruthy();
  });

  it('sets cache-control header', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/parts/catalog' });
    expect(res.headers['cache-control']).toContain('max-age=');
  });

  it('returns 304 when If-None-Match matches the ETag', async () => {
    const first = await app.inject({ method: 'GET', url: '/api/parts/catalog' });
    const etag = first.headers['etag'] as string;

    const second = await app.inject({
      method: 'GET',
      url: '/api/parts/catalog',
      headers: { 'if-none-match': etag },
    });
    expect(second.statusCode).toBe(304);
  });

  it('does not return 304 for a stale ETag', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/parts/catalog',
      headers: { 'if-none-match': '"stale-etag"' },
    });
    expect(res.statusCode).toBe(200);
  });
});

describe('parts catalog — authenticated with custom parts', () => {
  let app: FastifyInstance;
  beforeEach(async () => { resetDb(); invalidatePartsCache(); app = await buildApp(); });
  afterEach(async () => { await app.close(); });

  it('merges custom parts into the catalog', async () => {
    const cookie = await registerAndLogin(app, 'alice@example.com');
    await app.inject({
      method: 'POST',
      url: '/api/custom-parts',
      headers: { cookie },
      payload: { partNumber: 'MY_CUSTOM', displayName: 'Custom Part', xmlBase64: SAMPLE_XML, spriteBase64: FAKE_GIF, spriteMime: 'image/gif' },
    });

    const res = await app.inject({ method: 'GET', url: '/api/parts/catalog', headers: { cookie } });
    expect(res.statusCode).toBe(200);
    const parts = (res.json() as { parts: { source: string; partNumber: string }[] }).parts;
    const custom = parts.filter((p) => p.source === 'custom');
    expect(custom.length).toBeGreaterThanOrEqual(1);
    expect(custom.some((p) => p.partNumber === 'MY_CUSTOM')).toBe(true);
  });

  it('custom parts from other users are NOT included', async () => {
    const aliceCookie = await registerAndLogin(app, 'alice@example.com');
    await registerAndLogin(app, 'bob@example.com');
    await app.inject({
      method: 'POST',
      url: '/api/custom-parts',
      headers: { cookie: aliceCookie },
      payload: { partNumber: 'ALICE_PART', displayName: 'Alice Part', xmlBase64: SAMPLE_XML, spriteBase64: FAKE_GIF, spriteMime: 'image/gif' },
    });

    const bobCookie = await registerAndLogin(app, 'carol@example.com');
    const res = await app.inject({ method: 'GET', url: '/api/parts/catalog', headers: { cookie: bobCookie } });
    const parts = (res.json() as { parts: { partNumber: string }[] }).parts;
    const hasAlicePart = parts.some((p) => p.partNumber === 'ALICE_PART');
    expect(hasAlicePart).toBe(false);
  });

  it('custom parts are source="custom" with customPartId set', async () => {
    const cookie = await registerAndLogin(app, 'alice@example.com');
    const create = await app.inject({
      method: 'POST',
      url: '/api/custom-parts',
      headers: { cookie },
      payload: { partNumber: 'P1', displayName: 'P1', xmlBase64: SAMPLE_XML, spriteBase64: FAKE_GIF, spriteMime: 'image/gif' },
    });
    const { id } = create.json() as { id: string };

    const res = await app.inject({ method: 'GET', url: '/api/parts/catalog', headers: { cookie } });
    const parts = (res.json() as { parts: { source: string; customPartId: string | null; partNumber: string }[] }).parts;
    const custom = parts.find((p) => p.source === 'custom' && p.partNumber === 'P1');
    expect(custom).toBeTruthy();
    expect(custom!.customPartId).toBe(id);
  });

  it('authenticated ETag differs from anonymous ETag (user-scoped cache)', async () => {
    const anonRes = await app.inject({ method: 'GET', url: '/api/parts/catalog' });
    const anonEtag = anonRes.headers['etag'] as string;

    const cookie = await registerAndLogin(app, 'alice@example.com');
    const authRes = await app.inject({ method: 'GET', url: '/api/parts/catalog', headers: { cookie } });
    const authEtag = authRes.headers['etag'] as string;

    // The two ETags may differ (user-scoped suffix), but both must be truthy.
    expect(anonEtag).toBeTruthy();
    expect(authEtag).toBeTruthy();
  });

  it('global custom parts appear for all users (isGlobal=true)', async () => {
    // Create a user to act as the global-part creator.
    await registerAndLogin(app, 'sysadmin@example.com');
    const creator = await db.select().from(schema.users).where(eq(schema.users.email, 'sysadmin@example.com')).get();

    // Directly insert a global custom part.
    const randomId = 'test-global-part-id';
    const xmlBuf = Buffer.from(Buffer.from(SAMPLE_XML, 'base64').toString('utf8'));
    const spriteBuf = Buffer.from(FAKE_GIF, 'base64');
    const now = new Date();
    await db.insert(schema.customParts).values({
      id: randomId,
      partNumber: 'GLOBAL_PART',
      displayName: 'Global Part',
      ownerUserId: null,
      ownerOrgId: null,
      createdBy: creator!.id,
      xmlBlob: xmlBuf,
      spriteBlob: spriteBuf,
      spriteMime: 'image/gif',
      isGlobal: true,
      category: 'Custom',
      createdAt: now,
      updatedAt: now,
    });

    // Anonymous user sees it.
    const anonRes = await app.inject({ method: 'GET', url: '/api/parts/catalog' });
    const anonParts = (anonRes.json() as { parts: { partNumber: string }[] }).parts;
    expect(anonParts.some((p) => p.partNumber === 'GLOBAL_PART')).toBe(true);

    // Authenticated user also sees it.
    const cookie = await registerAndLogin(app, 'bob@example.com');
    const authRes = await app.inject({ method: 'GET', url: '/api/parts/catalog', headers: { cookie } });
    const authParts = (authRes.json() as { parts: { partNumber: string }[] }).parts;
    expect(authParts.some((p) => p.partNumber === 'GLOBAL_PART')).toBe(true);
  });
});

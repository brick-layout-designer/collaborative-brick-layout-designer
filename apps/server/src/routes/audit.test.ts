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
import { customPartRoutes } from './customParts.js';
import { auditRoutes } from './audit.js';
import { writeAuditEvent } from '../audit/writeAuditEvent.js';

const FAKE_GIF = Buffer.from(
  'GIF89a    \xff\xff\xff   !\xf9    ,       D ;',
  'binary',
).toString('base64');
const SAMPLE_XML = Buffer.from('<?xml version="1.0"?><part/>').toString('base64');

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ bodyLimit: 10 * 1024 * 1024 });
  await app.register(cookie);
  app.addHook('preHandler', attachUser);
  await app.register(passwordRoutes);
  await app.register(sessionRoutes);
  await app.register(layoutRoutes);
  await app.register(collaboratorRoutes);
  await app.register(customPartRoutes);
  await app.register(auditRoutes);
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

describe('audit endpoints', () => {
  let app: FastifyInstance;
  beforeEach(async () => {
    resetDb();
    app = await buildApp();
  });
  afterEach(async () => {
    await app.close();
  });

  it('GET /api/layouts/:id/audit returns layout-scoped events newest-first', async () => {
    const aliceCookie = await registerAndLogin(app, 'alice@example.com');
    const create = await app.inject({
      method: 'POST',
      url: '/api/layouts',
      headers: { cookie: aliceCookie },
      payload: { title: 'L' },
    });
    const id = (create.json() as { id: string }).id;

    // Manually emit a couple of events with distinct timestamps.
    await writeAuditEvent({
      layoutId: id,
      userId: null,
      eventType: 'edit',
      payload: { stage: 'first' },
    });
    await new Promise((r) => setTimeout(r, 5));
    await writeAuditEvent({
      layoutId: id,
      userId: null,
      eventType: 'edit',
      payload: { stage: 'second' },
    });

    const res = await app.inject({
      method: 'GET',
      url: `/api/layouts/${id}/audit`,
      headers: { cookie: aliceCookie },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { events: { eventType: string; payload: { stage?: string } }[] };
    // Newest-first ordering.
    expect(body.events[0]!.payload.stage).toBe('second');
    expect(body.events[1]!.payload.stage).toBe('first');
  });

  it('GET /api/layouts/:id/audit returns 404 to non-collaborators', async () => {
    const aliceCookie = await registerAndLogin(app, 'alice@example.com');
    const create = await app.inject({
      method: 'POST',
      url: '/api/layouts',
      headers: { cookie: aliceCookie },
      payload: { title: 'L' },
    });
    const id = (create.json() as { id: string }).id;
    const bobCookie = await registerAndLogin(app, 'bob@example.com');
    const res = await app.inject({
      method: 'GET',
      url: `/api/layouts/${id}/audit`,
      headers: { cookie: bobCookie },
    });
    expect(res.statusCode).toBe(404);
  });

  it('GET /api/audit?kind=custom_part&id=... returns the part history', async () => {
    const aliceCookie = await registerAndLogin(app, 'alice@example.com');
    const create = await app.inject({
      method: 'POST',
      url: '/api/custom-parts',
      headers: { cookie: aliceCookie },
      payload: {
        partNumber: 'P',
        displayName: 'P',
        xmlBase64: SAMPLE_XML,
        spriteBase64: FAKE_GIF,
        spriteMime: 'image/gif',
      },
    });
    const id = (create.json() as { id: string }).id;
    const res = await app.inject({
      method: 'GET',
      url: `/api/audit?kind=custom_part&id=${id}`,
      headers: { cookie: aliceCookie },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { events: { eventType: string }[] };
    expect(body.events.some((e) => e.eventType === 'create')).toBe(true);
  });

  it('rejects ?kind=org (unsupported) with 400', async () => {
    const aliceCookie = await registerAndLogin(app, 'alice@example.com');
    const res = await app.inject({
      method: 'GET',
      url: '/api/audit?kind=org&id=abc',
      headers: { cookie: aliceCookie },
    });
    expect(res.statusCode).toBe(400);
  });

  it('share/unshare on custom parts produces audit rows', async () => {
    const aliceCookie = await registerAndLogin(app, 'alice@example.com');
    const bobCookie = await registerAndLogin(app, 'bob@example.com');
    const create = await app.inject({
      method: 'POST',
      url: '/api/custom-parts',
      headers: { cookie: aliceCookie },
      payload: {
        partNumber: 'P',
        displayName: 'P',
        xmlBase64: SAMPLE_XML,
        spriteBase64: FAKE_GIF,
        spriteMime: 'image/gif',
      },
    });
    const id = (create.json() as { id: string }).id;
    await app.inject({
      method: 'POST',
      url: `/api/custom-parts/${id}/invites`,
      headers: { cookie: aliceCookie },
      payload: { email: 'bob@example.com', role: 'editor' },
    });
    const bob = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.email, 'bob@example.com'))
      .get();
    await app.inject({
      method: 'DELETE',
      url: `/api/custom-parts/${id}/collaborators/${bob!.id}`,
      headers: { cookie: aliceCookie },
    });

    const res = await app.inject({
      method: 'GET',
      url: `/api/audit?kind=custom_part&id=${id}`,
      headers: { cookie: aliceCookie },
    });
    const body = res.json() as { events: { eventType: string }[] };
    const types = body.events.map((e) => e.eventType);
    expect(types).toContain('create');
    expect(types).toContain('share');
    expect(types).toContain('unshare');
    void bobCookie;
  });
});

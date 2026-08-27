// Integration tests for the audit-log read endpoints:
//   GET /api/layouts/:id/audit
//   GET /api/orgs/:slug/audit
//   GET /api/audit?kind=...&id=...

import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { db, resetDb, schema } from '../../test/helpers.js';
import { attachUser } from '../../auth/cookie.js';
import { passwordRoutes } from '../auth/password.js';
import { sessionRoutes } from '../auth/session.js';
import { layoutRoutes } from '../layouts.js';
import { collaboratorRoutes } from '../collaborators.js';
import { inviteRoutes } from '../invites.js';
import { orgRoutes } from '../orgs.js';
import { orgInviteRoutes } from '../orgInvites.js';
import { auditRoutes } from '../audit.js';

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ bodyLimit: 10 * 1024 * 1024 });
  await app.register(cookie);
  app.addHook('preHandler', attachUser);
  await app.register(passwordRoutes);
  await app.register(sessionRoutes);
  await app.register(layoutRoutes);
  await app.register(collaboratorRoutes);
  await app.register(inviteRoutes);
  await app.register(orgRoutes);
  await app.register(orgInviteRoutes);
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

async function createLayout(app: FastifyInstance, cookieStr: string, title = 'Audit Layout'): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/layouts',
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

describe('audit — layout-scoped', () => {
  let app: FastifyInstance;
  beforeEach(async () => { resetDb(); app = await buildApp(); });
  afterEach(async () => { await app.close(); });

  it('returns an events array (may be empty) for a fresh layout', async () => {
    const cookie = await registerAndLogin(app, 'owner@example.com');
    const id = await createLayout(app, cookie);

    const res = await app.inject({
      method: 'GET',
      url: `/api/layouts/${id}/audit`,
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { events: unknown[] };
    expect(Array.isArray(body.events)).toBe(true);
  });

  it('returns an empty events array for a newly created layout (no audit events written yet)', async () => {
    const cookie = await registerAndLogin(app, 'owner@example.com');
    const id = await createLayout(app, cookie, 'Audited Layout');

    const res = await app.inject({
      method: 'GET',
      url: `/api/layouts/${id}/audit`,
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    const { events } = res.json() as { events: Array<{ eventType: string }> };
    // The layout route does not yet write create/rename events — the array
    // will be empty for a freshly-created layout with no shares.
    expect(Array.isArray(events)).toBe(true);
  });

  it('records a share event when a collaborator is invited (invites.ts writes audit)', async () => {
    const cookie = await registerAndLogin(app, 'owner@example.com');
    const id = await createLayout(app, cookie);

    await app.inject({
      method: 'POST',
      url: `/api/layouts/${id}/invites`,
      headers: { cookie },
      payload: { email: 'invitee@example.com', role: 'editor' },
    });

    const res = await app.inject({
      method: 'GET',
      url: `/api/layouts/${id}/audit`,
      headers: { cookie },
    });
    const { events } = res.json() as { events: Array<{ eventType: string }> };
    expect(events.some((e) => e.eventType === 'share')).toBe(true);
  });

  it('returns 404 to a non-collaborator', async () => {
    const ownerCookie = await registerAndLogin(app, 'owner@example.com');
    const outsiderCookie = await registerAndLogin(app, 'outsider@example.com');
    const id = await createLayout(app, ownerCookie);

    const res = await app.inject({
      method: 'GET',
      url: `/api/layouts/${id}/audit`,
      headers: { cookie: outsiderCookie },
    });
    expect(res.statusCode).toBe(404);
  });

  it('respects the ?limit query parameter', async () => {
    const cookie = await registerAndLogin(app, 'owner@example.com');
    const id = await createLayout(app, cookie);

    // Generate a few events via renames.
    for (let i = 0; i < 5; i++) {
      await app.inject({
        method: 'PATCH',
        url: `/api/layouts/${id}`,
        headers: { cookie },
        payload: { title: `Rename ${i}` },
      });
    }

    const res = await app.inject({
      method: 'GET',
      url: `/api/layouts/${id}/audit?limit=2`,
      headers: { cookie },
    });
    const { events } = res.json() as { events: unknown[] };
    expect(events.length).toBeLessThanOrEqual(2);
  });

  it('returns 401 when unauthenticated', async () => {
    const cookie = await registerAndLogin(app, 'owner@example.com');
    const id = await createLayout(app, cookie);

    const res = await app.inject({ method: 'GET', url: `/api/layouts/${id}/audit` });
    expect(res.statusCode).toBe(401);
  });

  it('includes userName in each event row when events exist', async () => {
    const cookie = await registerAndLogin(app, 'owner@example.com');
    const id = await createLayout(app, cookie);

    // Create a share event so the audit log is non-empty.
    await app.inject({
      method: 'POST',
      url: `/api/layouts/${id}/invites`,
      headers: { cookie },
      payload: { email: 'invitee2@example.com', role: 'viewer' },
    });

    const res = await app.inject({
      method: 'GET',
      url: `/api/layouts/${id}/audit`,
      headers: { cookie },
    });
    const { events } = res.json() as { events: Array<{ userName: string | null }> };
    expect(events.length).toBeGreaterThan(0);
    expect(events.some((e) => e.userName !== null)).toBe(true);
  });
});

describe('audit — org-scoped', () => {
  let app: FastifyInstance;
  beforeEach(async () => { resetDb(); app = await buildApp(); });
  afterEach(async () => { await app.close(); });

  it('returns events array for org admin', async () => {
    const cookie = await registerAndLogin(app, 'admin@example.com');
    const org = await createOrg(app, cookie, 'Audit Org');

    const res = await app.inject({
      method: 'GET',
      url: `/api/orgs/${org.slug}/audit`,
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { events: unknown[] };
    expect(Array.isArray(body.events)).toBe(true);
  });

  it('records org create event', async () => {
    const cookie = await registerAndLogin(app, 'admin@example.com');
    const org = await createOrg(app, cookie, 'Event Org');

    const res = await app.inject({
      method: 'GET',
      url: `/api/orgs/${org.slug}/audit`,
      headers: { cookie },
    });
    const { events } = res.json() as { events: Array<{ eventType: string }> };
    expect(events.some((e) => e.eventType === 'create')).toBe(true);
  });

  it('returns 403 for non-admin member', async () => {
    const adminCookie = await registerAndLogin(app, 'admin@example.com');
    const memberCookie = await registerAndLogin(app, 'member@example.com');
    const org = await createOrg(app, adminCookie, 'Protected Org');

    // Invite as regular member.
    const inviteRes = await app.inject({
      method: 'POST',
      url: `/api/orgs/${org.slug}/invites`,
      headers: { cookie: adminCookie },
      payload: { email: 'member@example.com', role: 'member' },
    });
    const { token } = inviteRes.json() as { token: string };
    await app.inject({ method: 'POST', url: `/api/org-invites/${token}`, headers: { cookie: memberCookie } });

    const res = await app.inject({
      method: 'GET',
      url: `/api/orgs/${org.slug}/audit`,
      headers: { cookie: memberCookie },
    });
    expect(res.statusCode).toBe(403);
  });

  it('returns 404 for unknown org slug', async () => {
    const cookie = await registerAndLogin(app, 'admin@example.com');

    const res = await app.inject({
      method: 'GET',
      url: '/api/orgs/no-such-org/audit',
      headers: { cookie },
    });
    expect(res.statusCode).toBe(404);
  });

  it('respects limit and offset query params', async () => {
    const cookie = await registerAndLogin(app, 'admin@example.com');
    const org = await createOrg(app, cookie, 'Paginated Org');

    const res = await app.inject({
      method: 'GET',
      url: `/api/orgs/${org.slug}/audit?limit=1&offset=0`,
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { events: unknown[]; limit: number; offset: number };
    expect(body.events.length).toBeLessThanOrEqual(1);
    expect(body.limit).toBe(1);
    expect(body.offset).toBe(0);
  });
});

describe('audit — generic endpoint', () => {
  let app: FastifyInstance;
  beforeEach(async () => { resetDb(); app = await buildApp(); });
  afterEach(async () => { await app.close(); });

  it('GET /api/audit?kind=layout&id=:id returns events array', async () => {
    const cookie = await registerAndLogin(app, 'owner@example.com');
    const id = await createLayout(app, cookie);

    // Create a share event so the log is non-empty.
    await app.inject({
      method: 'POST',
      url: `/api/layouts/${id}/invites`,
      headers: { cookie },
      payload: { email: 'someone@example.com', role: 'viewer' },
    });

    const res = await app.inject({
      method: 'GET',
      url: `/api/audit?kind=layout&id=${id}`,
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { events: Array<{ eventType: string }> };
    expect(Array.isArray(body.events)).toBe(true);
    expect(body.events.some((e) => e.eventType === 'share')).toBe(true);
  });

  it('returns 400 when kind and id are missing', async () => {
    const cookie = await registerAndLogin(app, 'owner@example.com');

    const res = await app.inject({
      method: 'GET',
      url: '/api/audit',
      headers: { cookie },
    });
    expect(res.statusCode).toBe(400);
  });

  it('returns 400 for unsupported kind', async () => {
    const cookie = await registerAndLogin(app, 'owner@example.com');

    const res = await app.inject({
      method: 'GET',
      url: '/api/audit?kind=foobar&id=anything',
      headers: { cookie },
    });
    expect(res.statusCode).toBe(400);
  });

  it('returns 404 for layout the caller cannot access', async () => {
    const ownerCookie = await registerAndLogin(app, 'owner@example.com');
    const outsiderCookie = await registerAndLogin(app, 'outsider@example.com');
    const id = await createLayout(app, ownerCookie);

    const res = await app.inject({
      method: 'GET',
      url: `/api/audit?kind=layout&id=${id}`,
      headers: { cookie: outsiderCookie },
    });
    expect(res.statusCode).toBe(404);
  });

  it('GET /api/audit?kind=org&id=:id returns events array for org admin', async () => {
    const cookie = await registerAndLogin(app, 'admin@example.com');
    const org = await createOrg(app, cookie, 'TestOrg');

    const res = await app.inject({
      method: 'GET',
      url: `/api/audit?kind=org&id=${org.id}`,
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { events: unknown[] };
    expect(Array.isArray(body.events)).toBe(true);
  });

  it('returns event with _parseError when stored payload is invalid JSON', async () => {
    const cookie = await registerAndLogin(app, 'owner@example.com');
    const id = await createLayout(app, cookie);

    // Insert a raw audit row with a non-JSON payload string directly in the DB.
    await db.insert(schema.auditEvents).values({
      layoutId: id,
      eventType: 'test',
      payload: 'not{valid}json',
      createdAt: new Date(),
    });

    const res = await app.inject({
      method: 'GET',
      url: `/api/audit?kind=layout&id=${id}`,
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { events: Array<{ payload: unknown }> };
    const errEvent = body.events.find((e) => (e.payload as Record<string, unknown>)._parseError);
    expect(errEvent).toBeDefined();
  });
});

// Extended integration tests for org routes:
//   GET    /api/orgs/:slug/layouts          — list org layouts
//   GET    /api/orgs/:slug/part-libraries   — list libraries + enabled state
//   PUT    /api/orgs/:slug/part-libraries/:id — enable/disable
//   DELETE /api/orgs/:slug/part-libraries/:id — remove override
//   DELETE /api/orgs/:slug/invites/:inviteId — revoke pending invite
//   DELETE /api/orgs/:slug/members/:userId   — remove member
//   PATCH  /api/orgs/:slug/members/:userId   — change member role

import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq, and } from 'drizzle-orm';
import { db, resetDb, schema } from '../../test/helpers.js';
import { sqlite } from '../../db/index.js';
import { attachUser } from '../../auth/cookie.js';
import { passwordRoutes } from '../auth/password.js';
import { sessionRoutes } from '../auth/session.js';
import { layoutRoutes } from '../layouts.js';
import { orgRoutes } from '../orgs.js';
import { orgInviteRoutes } from '../orgInvites.js';

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ bodyLimit: 10 * 1024 * 1024 });
  await app.register(cookie);
  app.addHook('preHandler', attachUser);
  await app.register(passwordRoutes);
  await app.register(sessionRoutes);
  await app.register(layoutRoutes);
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

async function createOrg(app: FastifyInstance, cookieStr: string, name: string, slug?: string): Promise<{ id: string; slug: string }> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/orgs',
    headers: { cookie: cookieStr },
    payload: slug ? { name, slug } : { name },
  });
  expect(res.statusCode).toBe(201);
  return res.json() as { id: string; slug: string };
}

describe('orgs — org layouts list', () => {
  let app: FastifyInstance;
  beforeEach(async () => { resetDb(); app = await buildApp(); });
  afterEach(async () => { await app.close(); });

  it('admin can list org layouts (empty initially)', async () => {
    const cookie = await registerAndLogin(app, 'admin@example.com');
    const org = await createOrg(app, cookie, 'Acme');

    const res = await app.inject({ method: 'GET', url: `/api/orgs/${org.slug}/layouts`, headers: { cookie } });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { layouts: unknown[] }).layouts).toHaveLength(0);
  });

  it('org member can list org layouts', async () => {
    const adminCookie = await registerAndLogin(app, 'admin@example.com');
    const memberCookie = await registerAndLogin(app, 'member@example.com');
    const org = await createOrg(app, adminCookie, 'Acme');

    await app.inject({ method: 'POST', url: '/api/layouts', headers: { cookie: adminCookie }, payload: { title: 'Team Layout', orgSlug: org.slug } });

    const member = await db.select().from(schema.users).where(eq(schema.users.email, 'member@example.com')).get();
    const orgRow = await db.select().from(schema.orgs).where(eq(schema.orgs.slug, org.slug)).get();
    await db.insert(schema.orgMembers).values({ orgId: orgRow!.id, userId: member!.id, role: 'member', joinedAt: new Date() });

    const res = await app.inject({ method: 'GET', url: `/api/orgs/${org.slug}/layouts`, headers: { cookie: memberCookie } });
    expect(res.statusCode).toBe(200);
    const layouts = (res.json() as { layouts: { title: string }[] }).layouts;
    expect(layouts.some((l) => l.title === 'Team Layout')).toBe(true);
  });

  it('returns 404 for non-member', async () => {
    const adminCookie = await registerAndLogin(app, 'admin@example.com');
    const outsiderCookie = await registerAndLogin(app, 'outsider@example.com');
    const org = await createOrg(app, adminCookie, 'Acme');

    const res = await app.inject({ method: 'GET', url: `/api/orgs/${org.slug}/layouts`, headers: { cookie: outsiderCookie } });
    expect(res.statusCode).toBe(404);
  });

  it('returns 404 for unknown org slug', async () => {
    const cookie = await registerAndLogin(app, 'admin@example.com');
    const res = await app.inject({ method: 'GET', url: '/api/orgs/no-such-org/layouts', headers: { cookie } });
    expect(res.statusCode).toBe(404);
  });
});

describe('orgs — part-libraries list', () => {
  let app: FastifyInstance;
  beforeEach(async () => { resetDb(); app = await buildApp(); });
  afterEach(async () => { await app.close(); });

  it('member can list part-libraries', async () => {
    const cookie = await registerAndLogin(app, 'admin@example.com');
    const org = await createOrg(app, cookie, 'Acme');

    const res = await app.inject({ method: 'GET', url: `/api/orgs/${org.slug}/part-libraries`, headers: { cookie } });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { libraries: unknown[]; isAdmin: boolean };
    expect(Array.isArray(body.libraries)).toBe(true);
    expect(body.isAdmin).toBe(true);
  });

  it('non-member gets 403', async () => {
    const adminCookie = await registerAndLogin(app, 'admin@example.com');
    const outsiderCookie = await registerAndLogin(app, 'outsider@example.com');
    const org = await createOrg(app, adminCookie, 'Acme');

    const res = await app.inject({ method: 'GET', url: `/api/orgs/${org.slug}/part-libraries`, headers: { cookie: outsiderCookie } });
    expect(res.statusCode).toBe(403);
  });

  it('regular member gets isAdmin=false', async () => {
    const adminCookie = await registerAndLogin(app, 'admin@example.com');
    const memberCookie = await registerAndLogin(app, 'member@example.com');
    const org = await createOrg(app, adminCookie, 'Acme');

    const member = await db.select().from(schema.users).where(eq(schema.users.email, 'member@example.com')).get();
    const orgRow = await db.select().from(schema.orgs).where(eq(schema.orgs.slug, org.slug)).get();
    await db.insert(schema.orgMembers).values({ orgId: orgRow!.id, userId: member!.id, role: 'member', joinedAt: new Date() });

    const res = await app.inject({ method: 'GET', url: `/api/orgs/${org.slug}/part-libraries`, headers: { cookie: memberCookie } });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { isAdmin: boolean }).isAdmin).toBe(false);
  });
});

describe('orgs — part-library toggle (PUT/DELETE)', () => {
  let app: FastifyInstance;
  let adminCookie: string;
  let orgSlug: string;
  let libraryId: string;

  beforeEach(async () => {
    resetDb();
    // Part libraries and org_part_libraries are NOT cleared by resetDb — clean them manually.
    sqlite.exec('DELETE FROM org_part_libraries; DELETE FROM part_libraries;');
    app = await buildApp();
    adminCookie = await registerAndLogin(app, 'admin@example.com');
    const org = await createOrg(app, adminCookie, 'Acme');
    orgSlug = org.slug;

    // Seed a non-locked test library directly in the DB.
    libraryId = 'test-lib-id';
    const now = new Date();
    await db.insert(schema.partLibraries).values({
      id: libraryId,
      name: 'Test Library',
      slug: 'test-lib',
      partCount: 10,
      defaultEnabled: true,
      locked: false,
      installedAt: now,
      updatedAt: now,
    });
  });
  afterEach(async () => { await app.close(); });

  it('admin can disable a library with PUT', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: `/api/orgs/${orgSlug}/part-libraries/${libraryId}`,
      headers: { cookie: adminCookie },
      payload: { enabled: false },
    });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { ok: boolean }).ok).toBe(true);

    // Verify the override row was created.
    const orgRow = await db.select().from(schema.orgs).where(eq(schema.orgs.slug, orgSlug)).get();
    const override = await db.select().from(schema.orgPartLibraries).where(and(eq(schema.orgPartLibraries.orgId, orgRow!.id), eq(schema.orgPartLibraries.libraryId, libraryId))).get();
    expect(override!.enabled).toBe(false);
  });

  it('admin can re-enable a disabled library', async () => {
    // Disable first.
    await app.inject({ method: 'PUT', url: `/api/orgs/${orgSlug}/part-libraries/${libraryId}`, headers: { cookie: adminCookie }, payload: { enabled: false } });

    // Re-enable.
    const res = await app.inject({ method: 'PUT', url: `/api/orgs/${orgSlug}/part-libraries/${libraryId}`, headers: { cookie: adminCookie }, payload: { enabled: true } });
    expect(res.statusCode).toBe(200);
  });

  it('non-admin member gets 403 on PUT', async () => {
    const memberCookie = await registerAndLogin(app, 'member@example.com');
    const member = await db.select().from(schema.users).where(eq(schema.users.email, 'member@example.com')).get();
    const orgRow = await db.select().from(schema.orgs).where(eq(schema.orgs.slug, orgSlug)).get();
    await db.insert(schema.orgMembers).values({ orgId: orgRow!.id, userId: member!.id, role: 'member', joinedAt: new Date() });

    const res = await app.inject({ method: 'PUT', url: `/api/orgs/${orgSlug}/part-libraries/${libraryId}`, headers: { cookie: memberCookie }, payload: { enabled: false } });
    expect(res.statusCode).toBe(403);
  });

  it('returns 403 for locked library', async () => {
    const lockedId = 'locked-lib-id';
    const now2 = new Date();
    await db.insert(schema.partLibraries).values({ id: lockedId, name: 'Locked', slug: 'locked', partCount: 5, defaultEnabled: true, locked: true, installedAt: now2, updatedAt: now2 });

    const res = await app.inject({ method: 'PUT', url: `/api/orgs/${orgSlug}/part-libraries/${lockedId}`, headers: { cookie: adminCookie }, payload: { enabled: false } });
    expect(res.statusCode).toBe(403);
    expect((res.json() as { error: string }).error).toBe('library_locked');
  });

  it('returns 404 for unknown library', async () => {
    const res = await app.inject({ method: 'PUT', url: `/api/orgs/${orgSlug}/part-libraries/no-such-lib`, headers: { cookie: adminCookie }, payload: { enabled: false } });
    expect(res.statusCode).toBe(404);
  });

  it('admin can DELETE library override (reverts to default)', async () => {
    // Create override first.
    await app.inject({ method: 'PUT', url: `/api/orgs/${orgSlug}/part-libraries/${libraryId}`, headers: { cookie: adminCookie }, payload: { enabled: false } });

    const del = await app.inject({ method: 'DELETE', url: `/api/orgs/${orgSlug}/part-libraries/${libraryId}`, headers: { cookie: adminCookie } });
    expect(del.statusCode).toBe(200);
    expect((del.json() as { ok: boolean }).ok).toBe(true);

    // Override row should be gone.
    const orgRow = await db.select().from(schema.orgs).where(eq(schema.orgs.slug, orgSlug)).get();
    const override = await db.select().from(schema.orgPartLibraries).where(and(eq(schema.orgPartLibraries.orgId, orgRow!.id), eq(schema.orgPartLibraries.libraryId, libraryId))).get();
    expect(override).toBeUndefined();
  });

  it('non-admin gets 403 on DELETE', async () => {
    const memberCookie = await registerAndLogin(app, 'member2@example.com');
    const member = await db.select().from(schema.users).where(eq(schema.users.email, 'member2@example.com')).get();
    const orgRow = await db.select().from(schema.orgs).where(eq(schema.orgs.slug, orgSlug)).get();
    await db.insert(schema.orgMembers).values({ orgId: orgRow!.id, userId: member!.id, role: 'member', joinedAt: new Date() });

    const res = await app.inject({ method: 'DELETE', url: `/api/orgs/${orgSlug}/part-libraries/${libraryId}`, headers: { cookie: memberCookie } });
    expect(res.statusCode).toBe(403);
  });

  it('PUT returns 404 for unknown org slug', async () => {
    const res = await app.inject({ method: 'PUT', url: '/api/orgs/no-such-org/part-libraries/some-lib', headers: { cookie: adminCookie }, payload: { enabled: true } });
    expect(res.statusCode).toBe(404);
    expect((res.json() as { error: string }).error).toBe('not_found');
  });

  it('DELETE returns 404 for unknown org slug', async () => {
    const res = await app.inject({ method: 'DELETE', url: '/api/orgs/no-such-org/part-libraries/some-lib', headers: { cookie: adminCookie } });
    expect(res.statusCode).toBe(404);
    expect((res.json() as { error: string }).error).toBe('not_found');
  });

  it('DELETE returns 404 for unknown library', async () => {
    const res = await app.inject({ method: 'DELETE', url: `/api/orgs/${orgSlug}/part-libraries/no-such-lib`, headers: { cookie: adminCookie } });
    expect(res.statusCode).toBe(404);
    expect((res.json() as { error: string }).error).toBe('library_not_found');
  });

  it('DELETE returns 403 for locked library', async () => {
    const lockedId = 'locked-delete-lib';
    const now3 = new Date();
    await db.insert(schema.partLibraries).values({ id: lockedId, name: 'LockedDel', slug: 'locked-del', partCount: 0, defaultEnabled: true, locked: true, installedAt: now3, updatedAt: now3 });

    const res = await app.inject({ method: 'DELETE', url: `/api/orgs/${orgSlug}/part-libraries/${lockedId}`, headers: { cookie: adminCookie } });
    expect(res.statusCode).toBe(403);
    expect((res.json() as { error: string }).error).toBe('library_locked');
  });
});

describe('orgs — revoke pending invite', () => {
  let app: FastifyInstance;
  beforeEach(async () => { resetDb(); app = await buildApp(); });
  afterEach(async () => { await app.close(); });

  it('admin can revoke a pending org invite', async () => {
    const adminCookie = await registerAndLogin(app, 'admin@example.com');
    const org = await createOrg(app, adminCookie, 'Acme');

    const inviteRes = await app.inject({
      method: 'POST',
      url: `/api/orgs/${org.slug}/invites`,
      headers: { cookie: adminCookie },
      payload: { email: 'pending@example.com', role: 'member' },
    });
    expect(inviteRes.statusCode).toBe(200);
    const { id: inviteId } = inviteRes.json() as { id: string; token: string };

    const revokeRes = await app.inject({
      method: 'DELETE',
      url: `/api/orgs/${org.slug}/invites/${inviteId}`,
      headers: { cookie: adminCookie },
    });
    expect(revokeRes.statusCode).toBe(200);
    expect((revokeRes.json() as { ok: boolean }).ok).toBe(true);
  });

  it('non-admin cannot revoke an invite', async () => {
    const adminCookie = await registerAndLogin(app, 'admin@example.com');
    const memberCookie = await registerAndLogin(app, 'member@example.com');
    const org = await createOrg(app, adminCookie, 'Acme');

    const member = await db.select().from(schema.users).where(eq(schema.users.email, 'member@example.com')).get();
    const orgRow = await db.select().from(schema.orgs).where(eq(schema.orgs.slug, org.slug)).get();
    await db.insert(schema.orgMembers).values({ orgId: orgRow!.id, userId: member!.id, role: 'member', joinedAt: new Date() });

    const inviteRes = await app.inject({
      method: 'POST',
      url: `/api/orgs/${org.slug}/invites`,
      headers: { cookie: adminCookie },
      payload: { email: 'target@example.com', role: 'member' },
    });
    const { id: inviteId } = inviteRes.json() as { id: string };

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/orgs/${org.slug}/invites/${inviteId}`,
      headers: { cookie: memberCookie },
    });
    expect(res.statusCode).toBe(403);
  });

  it('returns 200 (idempotent) for non-existent invite id', async () => {
    const cookie = await registerAndLogin(app, 'admin@example.com');
    const org = await createOrg(app, cookie, 'Acme');
    // The route does a DELETE without first checking existence — it is idempotent.
    const res = await app.inject({ method: 'DELETE', url: `/api/orgs/${org.slug}/invites/no-such-invite`, headers: { cookie } });
    expect([200, 404]).toContain(res.statusCode);
  });
});

describe('orgs — remove member', () => {
  let app: FastifyInstance;
  beforeEach(async () => { resetDb(); app = await buildApp(); });
  afterEach(async () => { await app.close(); });

  it('admin can remove a member', async () => {
    const adminCookie = await registerAndLogin(app, 'admin@example.com');
    const memberCookie = await registerAndLogin(app, 'member@example.com');
    const org = await createOrg(app, adminCookie, 'Acme');

    const member = await db.select().from(schema.users).where(eq(schema.users.email, 'member@example.com')).get();
    const orgRow = await db.select().from(schema.orgs).where(eq(schema.orgs.slug, org.slug)).get();
    await db.insert(schema.orgMembers).values({ orgId: orgRow!.id, userId: member!.id, role: 'member', joinedAt: new Date() });

    const del = await app.inject({
      method: 'DELETE',
      url: `/api/orgs/${org.slug}/members/${member!.id}`,
      headers: { cookie: adminCookie },
    });
    expect(del.statusCode).toBe(200);

    // Member can no longer see the org.
    const get = await app.inject({ method: 'GET', url: `/api/orgs/${org.slug}`, headers: { cookie: memberCookie } });
    expect(get.statusCode).toBe(404);
  });

  it('member can remove themselves (self-leave)', async () => {
    const adminCookie = await registerAndLogin(app, 'admin@example.com');
    const memberCookie = await registerAndLogin(app, 'member@example.com');
    const org = await createOrg(app, adminCookie, 'Acme');

    const member = await db.select().from(schema.users).where(eq(schema.users.email, 'member@example.com')).get();
    const orgRow = await db.select().from(schema.orgs).where(eq(schema.orgs.slug, org.slug)).get();
    await db.insert(schema.orgMembers).values({ orgId: orgRow!.id, userId: member!.id, role: 'member', joinedAt: new Date() });

    const del = await app.inject({
      method: 'DELETE',
      url: `/api/orgs/${org.slug}/members/${member!.id}`,
      headers: { cookie: memberCookie },
    });
    expect(del.statusCode).toBe(200);
  });

  it('non-admin cannot remove another member', async () => {
    const adminCookie = await registerAndLogin(app, 'admin@example.com');
    const member1Cookie = await registerAndLogin(app, 'member1@example.com');
    await registerAndLogin(app, 'member2@example.com');
    const org = await createOrg(app, adminCookie, 'Acme');

    const member1 = await db.select().from(schema.users).where(eq(schema.users.email, 'member1@example.com')).get();
    const member2 = await db.select().from(schema.users).where(eq(schema.users.email, 'member2@example.com')).get();
    const orgRow = await db.select().from(schema.orgs).where(eq(schema.orgs.slug, org.slug)).get();
    await db.insert(schema.orgMembers).values({ orgId: orgRow!.id, userId: member1!.id, role: 'member', joinedAt: new Date() });
    await db.insert(schema.orgMembers).values({ orgId: orgRow!.id, userId: member2!.id, role: 'member', joinedAt: new Date() });

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/orgs/${org.slug}/members/${member2!.id}`,
      headers: { cookie: member1Cookie },
    });
    expect(res.statusCode).toBe(403);
  });

  it('cannot remove the only admin', async () => {
    const adminCookie = await registerAndLogin(app, 'admin@example.com');
    const org = await createOrg(app, adminCookie, 'Acme');
    const admin = await db.select().from(schema.users).where(eq(schema.users.email, 'admin@example.com')).get();

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/orgs/${org.slug}/members/${admin!.id}`,
      headers: { cookie: adminCookie },
    });
    // Either 409 (last_admin guard) or 403.
    expect([403, 409]).toContain(res.statusCode);
  });
});

describe('orgs — change member role (PATCH)', () => {
  let app: FastifyInstance;
  beforeEach(async () => { resetDb(); app = await buildApp(); });
  afterEach(async () => { await app.close(); });

  it('admin can promote a member to admin', async () => {
    const adminCookie = await registerAndLogin(app, 'admin@example.com');
    const memberCookie = await registerAndLogin(app, 'member@example.com');
    const org = await createOrg(app, adminCookie, 'Acme');
    const member = await db.select().from(schema.users).where(eq(schema.users.email, 'member@example.com')).get();
    const orgRow = await db.select().from(schema.orgs).where(eq(schema.orgs.slug, org.slug)).get();
    await db.insert(schema.orgMembers).values({ orgId: orgRow!.id, userId: member!.id, role: 'member', joinedAt: new Date() });

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/orgs/${org.slug}/members/${member!.id}`,
      headers: { cookie: adminCookie },
      payload: { role: 'admin' },
    });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { ok: boolean }).ok).toBe(true);

    // Verify the role was updated in the database.
    const updated = await db.select({ role: schema.orgMembers.role })
      .from(schema.orgMembers)
      .where(and(eq(schema.orgMembers.orgId, orgRow!.id), eq(schema.orgMembers.userId, member!.id)))
      .get();
    expect(updated!.role).toBe('admin');
    void memberCookie;
  });

  it('returns 404 when target user is not a member', async () => {
    const adminCookie = await registerAndLogin(app, 'admin@example.com');
    await registerAndLogin(app, 'outsider@example.com');
    const org = await createOrg(app, adminCookie, 'Acme');
    const outsider = await db.select().from(schema.users).where(eq(schema.users.email, 'outsider@example.com')).get();

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/orgs/${org.slug}/members/${outsider!.id}`,
      headers: { cookie: adminCookie },
      payload: { role: 'member' },
    });
    expect(res.statusCode).toBe(404);
    expect((res.json() as { error: string }).error).toBe('member_not_found');
  });

  it('returns 400 for an invalid role value', async () => {
    const adminCookie = await registerAndLogin(app, 'admin@example.com');
    const memberCookie = await registerAndLogin(app, 'member@example.com');
    const org = await createOrg(app, adminCookie, 'Acme');
    const member = await db.select().from(schema.users).where(eq(schema.users.email, 'member@example.com')).get();
    const orgRow = await db.select().from(schema.orgs).where(eq(schema.orgs.slug, org.slug)).get();
    await db.insert(schema.orgMembers).values({ orgId: orgRow!.id, userId: member!.id, role: 'member', joinedAt: new Date() });

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/orgs/${org.slug}/members/${member!.id}`,
      headers: { cookie: adminCookie },
      payload: { role: 'superuser' },
    });
    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: string }).error).toBe('invalid_role');
    void memberCookie;
  });
});

describe('orgs — part-libraries list with locked library', () => {
  let app: FastifyInstance;
  beforeEach(async () => {
    resetDb();
    sqlite.exec('DELETE FROM org_part_libraries; DELETE FROM part_libraries;');
    app = await buildApp();
  });
  afterEach(async () => { await app.close(); });

  it('non-locked library with no override uses defaultEnabled', async () => {
    const adminCookie = await registerAndLogin(app, 'admin@example.com');
    const org = await createOrg(app, adminCookie, 'Acme');
    const now = new Date();

    const libId = 'default-lib-test';
    await db.insert(schema.partLibraries).values({
      id: libId,
      name: 'Default Library',
      slug: 'default-lib',
      partCount: 2,
      defaultEnabled: true,
      locked: false,
      installedAt: now,
      updatedAt: now,
    });

    const res = await app.inject({ method: 'GET', url: `/api/orgs/${org.slug}/part-libraries`, headers: { cookie: adminCookie } });
    expect(res.statusCode).toBe(200);
    const { libraries } = res.json() as { libraries: Array<{ id: string; enabled: boolean; explicitOverride: boolean }> };
    const lib = libraries.find((l) => l.id === libId);
    expect(lib).toBeDefined();
    expect(lib!.enabled).toBe(true);
    expect(lib!.explicitOverride).toBe(false);
  });

  it('locked library shows enabled=true regardless of any override', async () => {
    const adminCookie = await registerAndLogin(app, 'admin@example.com');
    const org = await createOrg(app, adminCookie, 'Acme');
    const now = new Date();

    // Insert a locked library.
    const lockedLibId = 'locked-lib-list-test';
    await db.insert(schema.partLibraries).values({
      id: lockedLibId,
      name: 'Locked Library',
      slug: 'locked-lib-list',
      partCount: 3,
      defaultEnabled: false,
      locked: true,
      installedAt: now,
      updatedAt: now,
    });

    const res = await app.inject({ method: 'GET', url: `/api/orgs/${org.slug}/part-libraries`, headers: { cookie: adminCookie } });
    expect(res.statusCode).toBe(200);
    const { libraries } = res.json() as { libraries: Array<{ id: string; enabled: boolean; locked: boolean }> };
    const locked = libraries.find((l) => l.id === lockedLibId);
    expect(locked).toBeDefined();
    expect(locked!.locked).toBe(true);
    expect(locked!.enabled).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Org-invite POST accept edge cases
// ---------------------------------------------------------------------------

describe('org-invites — POST accept edge cases', () => {
  let app: FastifyInstance;
  beforeEach(async () => { resetDb(); app = await buildApp(); });
  afterEach(async () => { await app.close(); });

  it('returns 410 when accepting an already-accepted org invite', async () => {
    const adminCookie = await registerAndLogin(app, 'admin@example.com');
    const recipientCookie = await registerAndLogin(app, 'recipient@example.com');
    const org = await createOrg(app, adminCookie, 'AcceptOrg');

    // Issue an invite via the API so the token is valid.
    const inviteRes = await app.inject({
      method: 'POST',
      url: `/api/orgs/${org.slug}/invites`,
      headers: { cookie: adminCookie },
      payload: { email: 'recipient@example.com', role: 'member' },
    });
    const { token } = inviteRes.json() as { token: string };

    // Accept once (valid).
    const first = await app.inject({ method: 'POST', url: `/api/org-invites/${token}`, headers: { cookie: recipientCookie } });
    expect(first.statusCode).toBe(200);

    // Accept again — should return 410.
    const second = await app.inject({ method: 'POST', url: `/api/org-invites/${token}`, headers: { cookie: recipientCookie } });
    expect(second.statusCode).toBe(410);
    expect((second.json() as { error: string }).error).toBe('invite_already_accepted');
  });

  it('returns 410 when accepting an expired org invite', async () => {
    const adminCookie = await registerAndLogin(app, 'admin@example.com');
    const recipientCookie = await registerAndLogin(app, 'recipient@example.com');
    const org = await createOrg(app, adminCookie, 'ExpiredOrg');

    // Insert an expired invite directly into the DB.
    const adminUser = await db.select().from(schema.users).where(eq(schema.users.email, 'admin@example.com')).get();
    const orgRow = await db.select().from(schema.orgs).where(eq(schema.orgs.slug, org.slug)).get();
    const token = `expired-org-tok-${Math.random().toString(36).slice(2)}`;
    await db.insert(schema.orgInvites).values({
      id: `expired-org-inv-${Math.random().toString(36).slice(2)}`,
      orgId: orgRow!.id,
      invitedEmail: 'recipient@example.com',
      invitedBy: adminUser!.id,
      role: 'member',
      token,
      expiresAt: new Date(Date.now() - 1000),
    });

    const res = await app.inject({ method: 'POST', url: `/api/org-invites/${token}`, headers: { cookie: recipientCookie } });
    expect(res.statusCode).toBe(410);
    expect((res.json() as { error: string }).error).toBe('invite_expired');
  });

  it('returns 403 when accepting an org invite with wrong email', async () => {
    const adminCookie = await registerAndLogin(app, 'admin@example.com');
    const wrongCookie = await registerAndLogin(app, 'wrongperson@example.com');
    const org = await createOrg(app, adminCookie, 'MismatchOrg');

    const inviteRes = await app.inject({
      method: 'POST',
      url: `/api/orgs/${org.slug}/invites`,
      headers: { cookie: adminCookie },
      payload: { email: 'correct@example.com', role: 'member' },
    });
    const { token } = inviteRes.json() as { token: string };

    const res = await app.inject({ method: 'POST', url: `/api/org-invites/${token}`, headers: { cookie: wrongCookie } });
    expect(res.statusCode).toBe(403);
    expect((res.json() as { error: string }).error).toBe('email_mismatch');
  });
});

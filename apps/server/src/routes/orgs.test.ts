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
import { orgInviteRoutes } from './orgInvites.js';

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

describe('orgs', () => {
  let app: FastifyInstance;
  beforeEach(async () => {
    resetDb();
    app = await buildApp();
  });
  afterEach(async () => {
    await app.close();
  });

  it('creates an org and the creator becomes admin', async () => {
    const aliceCookie = await registerAndLogin(app, 'alice@example.com');
    const create = await app.inject({
      method: 'POST',
      url: '/api/orgs',
      headers: { cookie: aliceCookie },
      payload: { name: 'Acme Bricks', slug: 'acme' },
    });
    expect(create.statusCode).toBe(201);
    const created = create.json() as { id: string; slug: string };
    expect(created.slug).toBe('acme');

    const get = await app.inject({
      method: 'GET',
      url: '/api/orgs/acme',
      headers: { cookie: aliceCookie },
    });
    expect(get.statusCode).toBe(200);
    expect((get.json() as { myRole: string }).myRole).toBe('admin');
  });

  it('rejects invalid slugs', async () => {
    const aliceCookie = await registerAndLogin(app, 'alice@example.com');
    // Note: the handler lowercases the slug before validation, so "Acme"
    // is accepted as "acme". Test only the truly-invalid shapes — the
    // empty-string case is now treated as "omitted" (auto-derive from
    // name) and accepted, so it's deliberately NOT in this list.
    for (const bad of ['a_b', '-leading', 'trailing-', 'a'.repeat(50), 'has space']) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/orgs',
        headers: { cookie: aliceCookie },
        payload: { name: 'x', slug: bad },
      });
      expect(res.statusCode).toBe(400);
    }
  });

  it('auto-derives slug from name when none is provided', async () => {
    const aliceCookie = await registerAndLogin(app, 'alice@example.com');
    const res = await app.inject({
      method: 'POST',
      url: '/api/orgs',
      headers: { cookie: aliceCookie },
      payload: { name: 'Acme Bricks!' },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json() as { slug: string };
    expect(body.slug).toBe('acme-bricks');
  });

  it('disambiguates auto-slug with a numeric suffix on collision', async () => {
    const aliceCookie = await registerAndLogin(app, 'alice@example.com');
    const first = await app.inject({
      method: 'POST',
      url: '/api/orgs',
      headers: { cookie: aliceCookie },
      payload: { name: 'Foo' },
    });
    expect((first.json() as { slug: string }).slug).toBe('foo');
    const second = await app.inject({
      method: 'POST',
      url: '/api/orgs',
      headers: { cookie: aliceCookie },
      payload: { name: 'Foo' },
    });
    expect(second.statusCode).toBe(201);
    expect((second.json() as { slug: string }).slug).toBe('foo-2');
  });

  it('rejects duplicate slug with 409', async () => {
    const aliceCookie = await registerAndLogin(app, 'alice@example.com');
    const first = await app.inject({
      method: 'POST',
      url: '/api/orgs',
      headers: { cookie: aliceCookie },
      payload: { name: 'A', slug: 'shared' },
    });
    expect(first.statusCode).toBe(201);
    const second = await app.inject({
      method: 'POST',
      url: '/api/orgs',
      headers: { cookie: aliceCookie },
      payload: { name: 'B', slug: 'shared' },
    });
    expect(second.statusCode).toBe(409);
  });

  it('blocks demo accounts from creating orgs', async () => {
    const aliceCookie = await registerAndLogin(app, 'alice@example.com');
    await db
      .update(schema.users)
      .set({ isDemoAccount: true })
      .where(eq(schema.users.email, 'alice@example.com'));
    const res = await app.inject({
      method: 'POST',
      url: '/api/orgs',
      headers: { cookie: aliceCookie },
      payload: { name: 'A', slug: 'demoorg' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('non-members get 404 when probing /api/orgs/:slug (existence-leak)', async () => {
    const aliceCookie = await registerAndLogin(app, 'alice@example.com');
    await app.inject({
      method: 'POST',
      url: '/api/orgs',
      headers: { cookie: aliceCookie },
      payload: { name: 'Private', slug: 'privateco' },
    });
    const bobCookie = await registerAndLogin(app, 'bob@example.com');
    const res = await app.inject({
      method: 'GET',
      url: '/api/orgs/privateco',
      headers: { cookie: bobCookie },
    });
    expect(res.statusCode).toBe(404);
  });

  it('admin invites a member; recipient accepts', async () => {
    const aliceCookie = await registerAndLogin(app, 'alice@example.com');
    await app.inject({
      method: 'POST',
      url: '/api/orgs',
      headers: { cookie: aliceCookie },
      payload: { name: 'Acme', slug: 'acme' },
    });
    const inv = await app.inject({
      method: 'POST',
      url: '/api/orgs/acme/invites',
      headers: { cookie: aliceCookie },
      payload: { email: 'bob@example.com', role: 'member' },
    });
    expect(inv.statusCode).toBe(200);
    const token = (inv.json() as { token: string }).token;

    const bobCookie = await registerAndLogin(app, 'bob@example.com');
    const accept = await app.inject({
      method: 'POST',
      url: `/api/org-invites/${token}`,
      headers: { cookie: bobCookie },
    });
    expect(accept.statusCode).toBe(200);

    const me = await app.inject({
      method: 'GET',
      url: '/api/orgs/acme',
      headers: { cookie: bobCookie },
    });
    expect(me.statusCode).toBe(200);
    expect((me.json() as { myRole: string }).myRole).toBe('member');
  });

  it('non-admin members cannot invite', async () => {
    const aliceCookie = await registerAndLogin(app, 'alice@example.com');
    await app.inject({
      method: 'POST',
      url: '/api/orgs',
      headers: { cookie: aliceCookie },
      payload: { name: 'Acme', slug: 'acme' },
    });
    // Add Bob directly as a 'member' (not admin).
    const bobCookie = await registerAndLogin(app, 'bob@example.com');
    const bob = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.email, 'bob@example.com'))
      .get();
    const acme = await db.select().from(schema.orgs).where(eq(schema.orgs.slug, 'acme')).get();
    await db.insert(schema.orgMembers).values({
      orgId: acme!.id,
      userId: bob!.id,
      role: 'member',
      joinedAt: new Date(),
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/orgs/acme/invites',
      headers: { cookie: bobCookie },
      payload: { email: 'carol@example.com', role: 'member' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('last-admin guard prevents the only admin from self-demoting', async () => {
    const aliceCookie = await registerAndLogin(app, 'alice@example.com');
    await app.inject({
      method: 'POST',
      url: '/api/orgs',
      headers: { cookie: aliceCookie },
      payload: { name: 'Acme', slug: 'acme' },
    });
    const alice = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.email, 'alice@example.com'))
      .get();
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/orgs/acme/members/${alice!.id}`,
      headers: { cookie: aliceCookie },
      payload: { role: 'member' },
    });
    expect(res.statusCode).toBe(409);
    expect((res.json() as { error: string }).error).toBe('last_admin');
  });

  it('creating a layout with orgSlug stores ownerOrgId, not ownerUserId', async () => {
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
      payload: { title: 'team layout', orgSlug: 'acme' },
    });
    expect(create.statusCode).toBe(201);
    const id = (create.json() as { id: string }).id;
    const layout = await db
      .select()
      .from(schema.layouts)
      .where(eq(schema.layouts.id, id))
      .get();
    expect(layout!.ownerUserId).toBeNull();
    expect(layout!.ownerOrgId).toBeTruthy();
  });

  it('non-org-members cannot create org-owned layouts', async () => {
    const aliceCookie = await registerAndLogin(app, 'alice@example.com');
    await app.inject({
      method: 'POST',
      url: '/api/orgs',
      headers: { cookie: aliceCookie },
      payload: { name: 'Acme', slug: 'acme' },
    });
    const bobCookie = await registerAndLogin(app, 'bob@example.com');
    const res = await app.inject({
      method: 'POST',
      url: '/api/layouts',
      headers: { cookie: bobCookie },
      payload: { title: 'sneaky', orgSlug: 'acme' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('org members can see + open org-owned layouts', async () => {
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

    // Add Bob as a member directly.
    const bobCookie = await registerAndLogin(app, 'bob@example.com');
    const bob = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.email, 'bob@example.com'))
      .get();
    const acme = await db.select().from(schema.orgs).where(eq(schema.orgs.slug, 'acme')).get();
    await db.insert(schema.orgMembers).values({
      orgId: acme!.id,
      userId: bob!.id,
      role: 'member',
      joinedAt: new Date(),
    });

    const get = await app.inject({
      method: 'GET',
      url: `/api/layouts/${id}`,
      headers: { cookie: bobCookie },
    });
    expect(get.statusCode).toBe(200);
    expect((get.json() as { role: string }).role).toBe('editor'); // members → editor

    const list = await app.inject({
      method: 'GET',
      url: '/api/layouts',
      headers: { cookie: bobCookie },
    });
    const items = (list.json() as { layouts: { id: string }[] }).layouts;
    expect(items.some((l) => l.id === id)).toBe(true);
  });

  it('org admins see "owner" role on org-owned layouts', async () => {
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
      payload: { title: 't', orgSlug: 'acme' },
    });
    const id = (create.json() as { id: string }).id;
    const get = await app.inject({
      method: 'GET',
      url: `/api/layouts/${id}`,
      headers: { cookie: aliceCookie },
    });
    expect((get.json() as { role: string }).role).toBe('owner');
  });

  it('org invite returns 400 for invalid email', async () => {
    const aliceCookie = await registerAndLogin(app, 'alice@example.com');
    await app.inject({ method: 'POST', url: '/api/orgs', headers: { cookie: aliceCookie }, payload: { name: 'Acme', slug: 'acme' } });

    const res = await app.inject({
      method: 'POST',
      url: '/api/orgs/acme/invites',
      headers: { cookie: aliceCookie },
      payload: { email: 'not-an-email', role: 'member' },
    });
    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: string }).error).toBe('invalid_email');
  });

  it('org invite returns 400 for invalid role', async () => {
    const aliceCookie = await registerAndLogin(app, 'alice@example.com');
    await app.inject({ method: 'POST', url: '/api/orgs', headers: { cookie: aliceCookie }, payload: { name: 'Acme2', slug: 'acme2' } });

    const res = await app.inject({
      method: 'POST',
      url: '/api/orgs/acme2/invites',
      headers: { cookie: aliceCookie },
      payload: { email: 'bob@example.com', role: 'superuser' },
    });
    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: string }).error).toBe('invalid_role');
  });

  it('POST /api/orgs returns 400 for invalid name', async () => {
    const aliceCookie = await registerAndLogin(app, 'alice@example.com');
    // name too long (> 80 chars)
    const res = await app.inject({
      method: 'POST',
      url: '/api/orgs',
      headers: { cookie: aliceCookie },
      payload: { name: 'A'.repeat(81) },
    });
    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: string }).error).toBe('invalid_name');
  });

  it('demo account cannot invite org members', async () => {
    const aliceCookie = await registerAndLogin(app, 'alice@example.com');
    await app.inject({ method: 'POST', url: '/api/orgs', headers: { cookie: aliceCookie }, payload: { name: 'DemoOrg', slug: 'demo-org' } });
    const alice = await db.select().from(schema.users).where(eq(schema.users.email, 'alice@example.com')).get();
    await db.update(schema.users).set({ isDemoAccount: true }).where(eq(schema.users.id, alice!.id));

    const res = await app.inject({
      method: 'POST',
      url: '/api/orgs/demo-org/invites',
      headers: { cookie: aliceCookie },
      payload: { email: 'bob@example.com', role: 'member' },
    });
    expect(res.statusCode).toBe(403);
    expect((res.json() as { error: string }).error).toBe('demo_account_cannot_invite');
  });

  it('GET /api/orgs/:slug/members lists members and pending invites for admin', async () => {
    const aliceCookie = await registerAndLogin(app, 'alice@example.com');
    await app.inject({ method: 'POST', url: '/api/orgs', headers: { cookie: aliceCookie }, payload: { name: 'MembersOrg', slug: 'members-org' } });
    await app.inject({
      method: 'POST', url: '/api/orgs/members-org/invites',
      headers: { cookie: aliceCookie },
      payload: { email: 'pending@example.com', role: 'member' },
    });

    const res = await app.inject({
      method: 'GET',
      url: '/api/orgs/members-org/members',
      headers: { cookie: aliceCookie },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { members: unknown[]; invites: { invitedEmail: string }[] };
    expect(Array.isArray(body.members)).toBe(true);
    expect(body.members.length).toBeGreaterThanOrEqual(1);
    expect(body.invites.some((i) => i.invitedEmail === 'pending@example.com')).toBe(true);
  });

  it('non-admin member sees empty invites array', async () => {
    const aliceCookie = await registerAndLogin(app, 'alice@example.com');
    const bobCookie = await registerAndLogin(app, 'bob@example.com');
    await app.inject({ method: 'POST', url: '/api/orgs', headers: { cookie: aliceCookie }, payload: { name: 'SecretOrg', slug: 'secret-org' } });
    const bob = await db.select().from(schema.users).where(eq(schema.users.email, 'bob@example.com')).get();
    const orgRow = await db.select().from(schema.orgs).where(eq(schema.orgs.slug, 'secret-org')).get();
    await db.insert(schema.orgMembers).values({ orgId: orgRow!.id, userId: bob!.id, role: 'member', joinedAt: new Date() });

    const res = await app.inject({ method: 'GET', url: '/api/orgs/secret-org/members', headers: { cookie: bobCookie } });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { invites: unknown[] };
    expect(body.invites).toEqual([]);
  });

  it('non-admin cannot PATCH member role', async () => {
    const aliceCookie = await registerAndLogin(app, 'alice@example.com');
    const bobCookie = await registerAndLogin(app, 'bob@example.com');
    await app.inject({ method: 'POST', url: '/api/orgs', headers: { cookie: aliceCookie }, payload: { name: 'RoleOrg', slug: 'role-org' } });
    const alice = await db.select().from(schema.users).where(eq(schema.users.email, 'alice@example.com')).get();
    const bob = await db.select().from(schema.users).where(eq(schema.users.email, 'bob@example.com')).get();
    const orgRow = await db.select().from(schema.orgs).where(eq(schema.orgs.slug, 'role-org')).get();
    await db.insert(schema.orgMembers).values({ orgId: orgRow!.id, userId: bob!.id, role: 'member', joinedAt: new Date() });

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/orgs/role-org/members/${alice!.id}`,
      headers: { cookie: bobCookie },
      payload: { role: 'member' },
    });
    expect(res.statusCode).toBe(403);
    expect((res.json() as { error: string }).error).toBe('forbidden');
  });
});

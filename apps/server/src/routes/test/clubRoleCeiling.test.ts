// Someone who manages members but isn't an Admin gives only roles with no
// more than their own, whichever way the role reaches a person: changing
// a member's roles (routes/orgs.ts), or an invite to the club, then
// accepted. Otherwise they could invite a second account of theirs to a
// stronger role than they hold.

import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loginAs, resetDb, db, schema } from '../../test/helpers.js';
import { attachUser } from '../../auth/cookie.js';
import { registerApiRoutes } from '../all.js';
import { closeAll } from '../../events/hub.js';
import { clubAccess } from '../../access/clubPermissions.js';

type Who = { cookie: string; id: string };

describe('a role given by someone who manages members', () => {
  let app: FastifyInstance;
  let ann: Who; // the club's admin
  let ben: Who; // manages members, nothing else
  let orgId: string;
  let doorRole: string;

  const as = (who: Who, method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, payload?: Record<string, unknown>) =>
    app.inject({ method, url, headers: { cookie: who.cookie }, ...(payload ? { payload } : method === 'POST' || method === 'PATCH' ? { payload: {} } : {}) });

  beforeEach(async () => {
    resetDb();
    app = Fastify({ logger: false });
    await app.register(cookie);
    app.addHook('preHandler', attachUser);
    await registerApiRoutes(app);
    ann = await loginAs(app, 'ann@x.com');
    ben = await loginAs(app, 'ben@x.com');
    const made = await as(ann, 'POST', '/api/orgs', { name: 'Rail Club' });
    expect(made.statusCode, made.body).toBe(201);
    orgId = made.json().id;
    await db.insert(schema.orgMembers).values({ orgId, userId: ben.id, role: 'member', joinedAt: new Date() });
    const role = await as(ann, 'POST', '/api/orgs/rail-club/roles', { name: 'Door', permissions: ['view_items', 'invite', 'manage_members'] });
    expect(role.statusCode, role.body).toBe(201);
    doorRole = role.json().id;
    expect((await as(ann, 'PATCH', `/api/orgs/rail-club/members/${ben.id}`, { roleIds: [doorRole] })).statusCode).toBe(200);
  });

  afterEach(async () => {
    closeAll();
    await app.close();
  });

  it('can’t be a stronger role by changing roles (as before)', async () => {
    const cat = await loginAs(app, 'cat@x.com');
    await db.insert(schema.orgMembers).values({ orgId, userId: cat.id, role: 'member', joinedAt: new Date() });
    const res = await as(ben, 'PATCH', `/api/orgs/rail-club/members/${cat.id}`, { roleIds: [`${orgId}:manager`] });
    expect(res.statusCode).toBe(403);
  });

  it('can’t be a stronger role by an invite', async () => {
    const res = await as(ben, 'POST', '/api/orgs/rail-club/invites', { email: 'cat@x.com', role: 'manager' });
    expect(res.statusCode).toBe(403);
  });

  it('can’t be a stronger role by accepting an invite sent before', async () => {
    // An invite to Manager that Ben could send before (here written directly).
    await db.insert(schema.orgInvites).values({
      id: 'inv-1',
      orgId,
      invitedEmail: 'cat@x.com',
      invitedBy: ben.id,
      role: 'manager',
      roleId: `${orgId}:manager`,
      token: 'a'.repeat(48),
      expiresAt: new Date(Date.now() + 86_400_000),
      acceptedAt: null,
    });
    const cat = await loginAs(app, 'cat@x.com');
    const res = await as(cat, 'POST', `/api/org-invites/${'a'.repeat(48)}`);
    expect(res.statusCode).toBe(409);
    expect((await clubAccess(cat.id, orgId))?.permissions.has('delete_items') ?? false).toBe(false);
  });

  it('can still be a role with no more than theirs', async () => {
    const res = await as(ben, 'POST', '/api/orgs/rail-club/invites', { email: 'cat@x.com', role: 'member' });
    // Member has edit_layouts / add_parts that Ben lacks: refused too.
    expect(res.statusCode).toBe(403);
    const viewer = await as(ben, 'POST', '/api/orgs/rail-club/invites', { email: 'dan@x.com', roleId: `${orgId}:viewer` });
    expect(viewer.statusCode, viewer.body).toBe(200);
    const cat = await loginAs(app, 'dan@x.com');
    expect((await as(cat, 'POST', `/api/org-invites/${viewer.json().token}`)).statusCode).toBe(200);
  });
});

describe('removing an Admin', () => {
  it('takes an Admin, as taking their Admin role does', async () => {
    resetDb();
    const app = Fastify({ logger: false });
    await app.register(cookie);
    app.addHook('preHandler', attachUser);
    await registerApiRoutes(app);
    try {
      const ann = await loginAs(app, 'ann@x.com');
      const ben = await loginAs(app, 'ben@x.com');
      const eve = await loginAs(app, 'eve@x.com');
      const as = (who: Who, method: 'POST' | 'PATCH' | 'DELETE', url: string, payload?: Record<string, unknown>) =>
        app.inject({ method, url, headers: { cookie: who.cookie }, ...(payload ? { payload } : {}) });
      const orgId = (await as(ann, 'POST', '/api/orgs', { name: 'Rail Club' })).json().id as string;
      for (const u of [ben, eve]) await db.insert(schema.orgMembers).values({ orgId, userId: u.id, role: 'member', joinedAt: new Date() });
      const door = (await as(ann, 'POST', '/api/orgs/rail-club/roles', { name: 'Door', permissions: ['view_items', 'invite', 'manage_members'] })).json().id as string;
      expect((await as(ann, 'PATCH', `/api/orgs/rail-club/members/${ben.id}`, { roleIds: [door] })).statusCode).toBe(200);
      expect((await as(ann, 'PATCH', `/api/orgs/rail-club/members/${eve.id}`, { roleIds: [`${orgId}:admin`] })).statusCode).toBe(200);
      // Ben can't take Eve's Admin role, so he can't remove her either.
      expect((await as(ben, 'PATCH', `/api/orgs/rail-club/members/${eve.id}`, { roleIds: [`${orgId}:member`] })).statusCode).toBe(403);
      expect((await as(ben, 'DELETE', `/api/orgs/rail-club/members/${eve.id}`)).statusCode).toBe(403);
      // An Admin can.
      expect((await as(ann, 'DELETE', `/api/orgs/rail-club/members/${eve.id}`)).statusCode).toBe(200);
    } finally {
      closeAll();
      await app.close();
    }
  });
});

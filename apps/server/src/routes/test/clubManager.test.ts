// The Manager role, between Admin and Member: day-to-day running (invites,
// join requests, removing members, the club's things) without the admin's
// powers (settings, roles, handing over, deleting). Each boundary is checked
// from both sides.

import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { db, loginAs, resetDb, schema } from '../../test/helpers.js';
import { attachUser } from '../../auth/cookie.js';
import { passwordRoutes } from '../auth/password.js';
import { layoutRoutes } from '../layouts.js';
import { orgRoutes } from '../orgs.js';
import { orgInviteRoutes } from '../orgInvites.js';
import { clubJoinRoutes } from '../clubJoin.js';
import { auditRoutes } from '../audit.js';
import { atLeast, clubThingRole } from '../../access/clubRoles.js';

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ bodyLimit: 1024 * 1024 });
  await app.register(cookie);
  app.addHook('preHandler', attachUser);
  await app.register(passwordRoutes);
  await app.register(layoutRoutes);
  await app.register(orgRoutes);
  await app.register(orgInviteRoutes);
  await app.register(clubJoinRoutes);
  await app.register(auditRoutes);
  return app;
}

type Who = { cookie: string; id: string };

describe('club manager role', () => {
  let app: FastifyInstance;
  let admin: Who;
  let manager: Who;
  let member: Who;
  let manager2: Who;
  let outsider: Who;
  let orgId: string;

  const call = (who: Who, method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, payload?: object) =>
    app.inject({ method, url, headers: { cookie: who.cookie }, ...(payload ? { payload } : {}) });
  const roleOf = async (userId: string) =>
    (
      await db
        .select({ role: schema.orgMembers.role })
        .from(schema.orgMembers)
        .where(and(eq(schema.orgMembers.orgId, orgId), eq(schema.orgMembers.userId, userId)))
        .get()
    )?.role;
  const join = (who: Who, role: 'admin' | 'manager' | 'member') =>
    db.insert(schema.orgMembers).values({ orgId, userId: who.id, role, joinedAt: new Date() });

  beforeEach(async () => {
    resetDb();
    app = await buildApp();
    admin = await loginAs(app, 'admin@example.com');
    manager = await loginAs(app, 'manager@example.com');
    member = await loginAs(app, 'member@example.com');
    manager2 = await loginAs(app, 'manager2@example.com');
    outsider = await loginAs(app, 'outsider@example.com');
    orgId = ((await call(admin, 'POST', '/api/orgs', { name: 'ArkLUG', slug: 'arklug' })).json() as { id: string }).id;
    await join(member, 'member');
    await join(manager2, 'manager');
    // An admin makes someone a manager, in the audit log in plain terms.
    await join(manager, 'member');
    expect((await call(admin, 'PATCH', `/api/orgs/arklug/members/${manager.id}`, { role: 'manager' })).statusCode).toBe(200);
  });
  afterEach(async () => {
    await app.close();
  });

  it('ranks admin over manager over member', () => {
    expect(atLeast('admin', 'manager')).toBe(true);
    expect(atLeast('manager', 'manager')).toBe(true);
    expect(atLeast('member', 'manager')).toBe(false);
    expect(atLeast('manager', 'admin')).toBe(false);
    expect(atLeast(null, 'member')).toBe(false);
    expect(clubThingRole('manager')).toBe('owner');
    expect(clubThingRole('member')).toBe('editor');
  });

  it('lets an admin make a manager, and audits it', async () => {
    expect(await roleOf(manager.id)).toBe('manager');
    const ev = db.select().from(schema.auditEvents).where(eq(schema.auditEvents.eventType, 'role_change')).all();
    expect(JSON.parse(ev.at(-1)!.payload!)).toMatchObject({ targetUserId: manager.id, fromRole: 'member', toRole: 'manager' });
    expect((await call(admin, 'PATCH', `/api/orgs/arklug/members/${member.id}`, { role: 'owner' })).statusCode).toBe(400);
  });

  it('never lets a manager change anyone’s role, their own included', async () => {
    for (const [target, role] of [
      [member.id, 'manager'],
      [member.id, 'admin'],
      [manager2.id, 'member'],
      [admin.id, 'member'],
      [manager.id, 'admin'],
    ] as const) {
      expect((await call(manager, 'PATCH', `/api/orgs/arklug/members/${target}`, { role })).statusCode, `${target} → ${role}`).toBe(403);
    }
    expect(await roleOf(member.id)).toBe('member');
    expect(await roleOf(manager2.id)).toBe('manager');
    expect(await roleOf(admin.id)).toBe('admin');
    expect(await roleOf(manager.id)).toBe('manager');
  });

  it('keeps club settings, handing over and deleting for admins', async () => {
    expect((await call(manager, 'PATCH', '/api/orgs/arklug', { name: 'Taken' })).statusCode).toBe(403);
    expect((await call(manager, 'PATCH', '/api/orgs/arklug', { joinPolicy: 'open', listed: true })).statusCode).toBe(403);
    expect((await call(manager, 'POST', '/api/orgs/arklug/hand-over', { userId: member.id })).statusCode).toBe(403);
    expect((await call(manager, 'DELETE', '/api/orgs/arklug', { confirm: 'ArkLUG' })).statusCode).toBe(403);
    const org = db.select().from(schema.orgs).where(eq(schema.orgs.id, orgId)).get()!;
    expect(org).toMatchObject({ name: 'ArkLUG', joinPolicy: 'invite', listed: false });
  });

  it('lets a manager invite members, but only admins invite managers and admins', async () => {
    const asMember = await call(manager, 'POST', '/api/orgs/arklug/invites', { email: 'new@example.com', role: 'member' });
    expect(asMember.statusCode).toBe(200);
    for (const role of ['manager', 'admin']) {
      const res = await call(manager, 'POST', '/api/orgs/arklug/invites', { email: `x-${role}@example.com`, role });
      expect(res.statusCode, role).toBe(403);
      expect(res.json()).toMatchObject({ error: 'only_admins_set_roles' });
    }
    expect((await call(admin, 'POST', '/api/orgs/arklug/invites', { email: 'mgr@example.com', role: 'manager' })).statusCode).toBe(200);
    // Members can't invite at all.
    expect((await call(member, 'POST', '/api/orgs/arklug/invites', { email: 'y@example.com', role: 'member' })).statusCode).toBe(403);
    // A manager sees the invites waiting; a member doesn't.
    const seen = (await call(manager, 'GET', '/api/orgs/arklug/members')).json() as { invites: unknown[] };
    expect(seen.invites).toHaveLength(2);
    expect(((await call(member, 'GET', '/api/orgs/arklug/members')).json() as { invites: unknown[] }).invites).toHaveLength(0);
  });

  it('lets a manager resend and cancel member invites, not an admin’s manager invite', async () => {
    const mine = (await call(manager, 'POST', '/api/orgs/arklug/invites', { email: 'new@example.com', role: 'member' })).json() as { id: string };
    const theirs = (await call(admin, 'POST', '/api/orgs/arklug/invites', { email: 'mgr@example.com', role: 'manager' })).json() as { id: string };
    expect((await call(manager, 'POST', `/api/orgs/arklug/invites/${mine.id}/resend`, {})).statusCode).toBe(200);
    expect((await call(manager, 'POST', `/api/orgs/arklug/invites/${theirs.id}/resend`, {})).statusCode).toBe(403);
    expect((await call(manager, 'DELETE', `/api/orgs/arklug/invites/${theirs.id}`)).statusCode).toBe(403);
    expect(db.select().from(schema.orgInvites).where(eq(schema.orgInvites.id, theirs.id)).get()).toBeTruthy();
    expect((await call(manager, 'DELETE', `/api/orgs/arklug/invites/${mine.id}`)).statusCode).toBe(200);
    expect(db.select().from(schema.orgInvites).where(eq(schema.orgInvites.id, mine.id)).get()).toBeUndefined();
    expect((await call(member, 'DELETE', `/api/orgs/arklug/invites/${theirs.id}`)).statusCode).toBe(403);
  });

  it('honours a manager’s member invite, and voids it once they are a member again', async () => {
    const invitee = await loginAs(app, 'new@example.com');
    const ok = (await call(manager, 'POST', '/api/orgs/arklug/invites', { email: 'new@example.com', role: 'member' })).json() as { token: string };
    expect((await call(invitee, 'POST', `/api/org-invites/${ok.token}`)).statusCode).toBe(200);
    expect(await roleOf(invitee.id)).toBe('member');

    const later = await loginAs(app, 'later@example.com');
    const t = (await call(manager, 'POST', '/api/orgs/arklug/invites', { email: 'later@example.com', role: 'member' })).json() as { token: string };
    await call(admin, 'PATCH', `/api/orgs/arklug/members/${manager.id}`, { role: 'member' });
    expect((await call(later, 'POST', `/api/org-invites/${t.token}`)).statusCode).toBe(409);
    expect(await roleOf(later.id)).toBeUndefined();
  });

  it('voids a manager invite whose inviting admin became a manager', async () => {
    const other = await loginAs(app, 'admin2@example.com');
    await join(other, 'admin');
    const invitee = await loginAs(app, 'mgr@example.com');
    const t = (await call(other, 'POST', '/api/orgs/arklug/invites', { email: 'mgr@example.com', role: 'manager' })).json() as { token: string };
    await call(admin, 'PATCH', `/api/orgs/arklug/members/${other.id}`, { role: 'manager' });
    expect((await call(invitee, 'POST', `/api/org-invites/${t.token}`)).statusCode).toBe(409);
  });

  it('lets a manager remove members, but not another manager or an admin', async () => {
    expect((await call(manager, 'DELETE', `/api/orgs/arklug/members/${manager2.id}`)).statusCode).toBe(403);
    expect((await call(manager, 'DELETE', `/api/orgs/arklug/members/${admin.id}`)).statusCode).toBe(403);
    expect(await roleOf(manager2.id)).toBe('manager');
    expect(await roleOf(admin.id)).toBe('admin');
    expect((await call(manager, 'DELETE', `/api/orgs/arklug/members/${member.id}`)).statusCode).toBe(200);
    expect(await roleOf(member.id)).toBeUndefined();
    // Members still can't remove anyone; a manager may leave.
    expect((await call(manager2, 'DELETE', `/api/orgs/arklug/members/${manager.id}`)).statusCode).toBe(403);
    expect((await call(manager, 'DELETE', `/api/orgs/arklug/members/${manager.id}`)).statusCode).toBe(200);
  });

  it('answers join requests, and counts them for managers too', async () => {
    await call(admin, 'PATCH', '/api/orgs/arklug', { joinPolicy: 'request', listed: true });
    await call(outsider, 'POST', '/api/orgs/arklug/join', { message: 'hi' });
    expect((await call(manager, 'GET', '/api/join-requests/count')).json()).toMatchObject({ count: 1 });
    expect((await call(member, 'GET', '/api/join-requests/count')).json()).toMatchObject({ count: 0 });
    expect((await call(manager, 'GET', '/api/orgs/arklug')).json()).toMatchObject({ pendingRequests: 1, myRole: 'manager' });
    const list = (await call(manager, 'GET', '/api/orgs/arklug/join-requests')).json() as { requests: { id: string }[] };
    expect((await call(member, 'POST', `/api/orgs/arklug/join-requests/${list.requests[0]!.id}/approve`)).statusCode).toBe(403);
    expect((await call(manager, 'POST', `/api/orgs/arklug/join-requests/${list.requests[0]!.id}/approve`)).statusCode).toBe(200);
    expect(await roleOf(outsider.id)).toBe('member');
  });

  it('keeps the last-admin rule: managers don’t count as admins', async () => {
    // The only admin can't step down to manager, nor leave, though there are managers.
    const down = await call(admin, 'PATCH', `/api/orgs/arklug/members/${admin.id}`, { role: 'manager' });
    expect(down.statusCode).toBe(409);
    expect((await call(admin, 'DELETE', `/api/orgs/arklug/members/${admin.id}`)).statusCode).toBe(409);
    expect((await call(manager, 'GET', '/api/orgs/arklug')).json()).toMatchObject({ adminCount: 1 });
  });

  it('gives managers the club’s things like admins, and lets them add when members can’t', async () => {
    await call(admin, 'PATCH', '/api/orgs/arklug', { membersCanCreate: false });
    expect((await call(member, 'POST', '/api/layouts', { title: 'Nope', orgSlug: 'arklug' })).statusCode).toBe(403);
    const made = await call(manager, 'POST', '/api/layouts', { title: 'Show', orgSlug: 'arklug' });
    expect(made.statusCode).toBe(201);
    const id = (made.json() as { id: string }).id;
    const roleIn = async (who: Who) =>
      ((await call(who, 'GET', '/api/layouts')).json() as { layouts: { id: string; role: string }[] }).layouts.find((l) => l.id === id)?.role;
    expect(await roleIn(manager)).toBe('owner');
    expect(await roleIn(admin)).toBe('owner');
    expect(await roleIn(member)).toBe('editor');
    // Delete is an owner's: the manager may, a member may not.
    expect((await call(member, 'DELETE', `/api/layouts/${id}`)).statusCode).toBe(403);
    expect((await call(manager, 'DELETE', `/api/layouts/${id}`)).statusCode).toBe(200);
  });

  it('shows the club’s activity to managers, not members', async () => {
    expect((await call(manager, 'GET', '/api/orgs/arklug/audit')).statusCode).toBe(200);
    expect((await call(member, 'GET', '/api/orgs/arklug/audit')).statusCode).toBe(403);
  });
});

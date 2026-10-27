// Club roles through the routes: admins make, change and delete roles;
// members hold several and get the union; a share adds to a Viewer role;
// a club keeps its last admin; an invite gives its role; the "members can
// add things" switch and the Member role stay in step; the audit log says
// what happened; and an open layout follows a role change at once.

import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import { WebSocket } from 'ws';
import * as Y from 'yjs';
import * as syncProtocol from 'y-protocols/sync';
import * as encoding from 'lib0/encoding';
import { and, eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { db, loginAs, resetDb, schema } from '../../test/helpers.js';
import { attachUser } from '../../auth/cookie.js';
import { registerApiRoutes } from '../all.js';
import { docHub } from '../../ws/docHub.js';
import { closeAll } from '../../events/hub.js';
import { resolveResourceRole } from '../../access/resolveResourceRole.js';

type Who = { cookie: string; id: string };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('club roles', () => {
  let app: FastifyInstance;
  let port: number;
  let ann: Who; // the club's admin
  let ben: Who; // a member
  let orgId: string;
  const opened: string[] = [];
  const sockets: WebSocket[] = [];

  beforeEach(async () => {
    resetDb();
    app = Fastify({ logger: false });
    await app.register(cookie);
    app.addHook('preHandler', attachUser);
    await registerApiRoutes(app);
    await app.listen({ port: 0, host: '127.0.0.1' });
    port = (app.server.address() as { port: number }).port;
    ann = await loginAs(app, 'ann@x.com');
    ben = await loginAs(app, 'ben@x.com');
    const made = await app.inject({ method: 'POST', url: '/api/orgs', headers: { cookie: ann.cookie }, payload: { name: 'Rail Club' } });
    expect(made.statusCode, made.body).toBe(201);
    orgId = made.json().id;
    await db.insert(schema.orgMembers).values({ orgId, userId: ben.id, role: 'member', joinedAt: new Date() });
  });

  afterEach(async () => {
    for (const s of sockets.splice(0)) s.terminate();
    await sleep(30);
    for (const id of opened.splice(0)) await docHub.close(id);
    closeAll();
    await app.close();
  });

  const as = (who: Who, method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, payload?: Record<string, unknown>) =>
    app.inject({ method, url, headers: { cookie: who.cookie }, ...(payload ? { payload } : method !== 'GET' && method !== 'DELETE' ? { payload: {} } : {}) });

  async function makeRole(name: string, permissions: string[]): Promise<string> {
    const res = await as(ann, 'POST', '/api/orgs/rail-club/roles', { name, permissions });
    expect(res.statusCode, res.body).toBe(201);
    return res.json().id;
  }

  const give = (who: Who, roleIds: string[]) => as(ann, 'PATCH', `/api/orgs/rail-club/members/${who.id}`, { roleIds });

  async function clubLayout(): Promise<string> {
    const res = await as(ann, 'POST', '/api/layouts', { title: 'Show', orgSlug: 'rail-club' });
    expect(res.statusCode, res.body).toBe(201);
    opened.push(res.json().id);
    return res.json().id;
  }

  it('a new club starts with Admin, Manager, Member and Viewer, and lists who holds each', async () => {
    const res = await as(ben, 'GET', '/api/orgs/rail-club/roles');
    expect(res.statusCode).toBe(200);
    const roles = res.json().roles as { key: string; name: string; memberCount: number }[];
    expect(roles.map((r) => [r.key, r.name, r.memberCount])).toEqual([
      ['admin', 'Admin', 1],
      ['manager', 'Manager', 0],
      ['member', 'Member', 1],
      ['viewer', 'Viewer', 0],
    ]);
    expect(res.json().isAdmin).toBe(false);
  });

  it('only admins make, change and delete roles; the Admin role and the starting roles stay', async () => {
    expect((await as(ben, 'POST', '/api/orgs/rail-club/roles', { name: 'Mine', permissions: ['edit_layouts'] })).statusCode).toBe(403);
    const crew = await makeRole('Track crew', ['edit_layouts']);
    expect((await as(ann, 'POST', '/api/orgs/rail-club/roles', { name: 'track CREW', permissions: [] })).statusCode).toBe(409);
    expect((await as(ann, 'POST', '/api/orgs/rail-club/roles', { name: 'Bad', permissions: ['fly'] })).statusCode).toBe(400);
    expect((await as(ann, 'PATCH', `/api/orgs/rail-club/roles/${crew}`, { name: 'Track team', permissions: ['edit_layouts', 'add_parts'] })).statusCode).toBe(200);
    expect((await as(ann, 'PATCH', `/api/orgs/rail-club/roles/${orgId}:admin`, { name: 'Boss' })).statusCode).toBe(409);
    expect((await as(ann, 'DELETE', `/api/orgs/rail-club/roles/${orgId}:viewer`)).statusCode).toBe(409);
    // In use: refused, with how many hold it.
    expect((await give(ben, [crew])).statusCode).toBe(200);
    const inUse = await as(ann, 'DELETE', `/api/orgs/rail-club/roles/${crew}`);
    expect(inUse.statusCode).toBe(409);
    expect(inUse.json().message).toMatch(/One member has this role/);
    expect((await give(ben, [`${orgId}:member`])).statusCode).toBe(200);
    expect((await as(ann, 'DELETE', `/api/orgs/rail-club/roles/${crew}`)).statusCode).toBe(200);
    // The audit log has each step, in order.
    const events = await db.select({ t: schema.auditEvents.eventType }).from(schema.auditEvents).where(eq(schema.auditEvents.resourceId, orgId));
    const kinds = events.map((e) => e.t).filter((t) => t.startsWith('role_'));
    expect(kinds).toEqual(['role_create', 'role_edit', 'role_assign', 'role_unassign', 'role_assign', 'role_unassign', 'role_delete']);
  });

  it('several roles add up: Track crew edits layouts but adds no modules, and says which permission it needs', async () => {
    const crew = await makeRole('Track crew', ['edit_layouts']);
    expect((await give(ben, [`${orgId}:viewer`, crew])).statusCode).toBe(200);
    const id = await clubLayout();
    expect((await resolveResourceRole(ben.id, 'layout', id)).role).toBe('editor');
    const mod = await as(ben, 'POST', '/api/modules', { title: 'Bridge', orgSlug: 'rail-club' });
    expect(mod.statusCode).toBe(403);
    expect(mod.json()).toMatchObject({ error: 'only_club_admins_can_add', permission: 'edit_modules' });
    // The clubs list says what Ben's roles allow there.
    const mine = (await as(ben, 'GET', '/api/orgs')).json().orgs[0];
    expect(mine.permissions).toEqual(['view_items', 'edit_layouts']);
    expect(mine.canAdd).toBe(false);
  });

  it('a share adds to a Viewer role: editor on that one layout only', async () => {
    expect((await give(ben, [`${orgId}:viewer`])).statusCode).toBe(200);
    const shared = await clubLayout();
    const other = await clubLayout();
    await db.insert(schema.layoutCollaborators).values({ layoutId: shared, userId: ben.id, role: 'editor', addedAt: new Date() });
    expect((await resolveResourceRole(ben.id, 'layout', shared)).role).toBe('editor');
    expect((await resolveResourceRole(ben.id, 'layout', other)).role).toBe('viewer');
  });

  it('the club keeps its last admin', async () => {
    const res = await give(ann, [`${orgId}:member`]);
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('last_admin');
    // With a second admin, the first may step down.
    expect((await give(ben, [`${orgId}:admin`])).statusCode).toBe(200);
    expect((await give(ann, [`${orgId}:member`])).statusCode).toBe(200);
    const row = await db.select({ role: schema.orgMembers.role }).from(schema.orgMembers).where(and(eq(schema.orgMembers.orgId, orgId), eq(schema.orgMembers.userId, ann.id))).get();
    expect(row?.role).toBe('member');
  });

  it('someone who manages members but isn’t an admin gives no Admin, and can’t change their own roles', async () => {
    const people = await makeRole('People lead', ['manage_members', 'invite']);
    expect((await give(ben, [people])).statusCode).toBe(200);
    const cal = await loginAs(app, 'cal@x.com');
    await db.insert(schema.orgMembers).values({ orgId, userId: cal.id, role: 'member', joinedAt: new Date() });
    expect((await as(ben, 'PATCH', `/api/orgs/rail-club/members/${cal.id}`, { roleIds: [`${orgId}:admin`] })).statusCode).toBe(403);
    expect((await as(ben, 'PATCH', `/api/orgs/rail-club/members/${ben.id}`, { roleIds: [people, `${orgId}:manager`] })).statusCode).toBe(403);
    // Taking Member from Cal would take permissions Ben doesn't have himself; adding Viewer is fine.
    expect((await as(ben, 'PATCH', `/api/orgs/rail-club/members/${cal.id}`, { roleIds: [`${orgId}:viewer`] })).statusCode).toBe(403);
    expect((await as(ben, 'PATCH', `/api/orgs/rail-club/members/${cal.id}`, { roleIds: [`${orgId}:member`, `${orgId}:viewer`] })).statusCode).toBe(200);
  });

  it('an invite gives the role it names', async () => {
    const crew = await makeRole('Track crew', ['edit_layouts']);
    const inv = await as(ann, 'POST', '/api/orgs/rail-club/invites', { email: 'dee@x.com', roleId: crew });
    expect(inv.statusCode, inv.body).toBe(200);
    // The invite page says the role by its name.
    expect((await app.inject({ method: 'GET', url: `/api/org-invites/${inv.json().token}` })).json()).toMatchObject({ roleName: 'Track crew' });
    const dee = await loginAs(app, 'dee@x.com');
    const accepted = await as(dee, 'POST', `/api/org-invites/${inv.json().token}`);
    expect(accepted.statusCode, accepted.body).toBeLessThan(300);
    const held = await db.select({ roleId: schema.memberRoles.roleId }).from(schema.memberRoles).where(eq(schema.memberRoles.userId, dee.id));
    expect(held.map((h) => h.roleId)).toEqual([crew]);
  });

  it('"members can add things" and the Member role stay in step', async () => {
    expect((await as(ann, 'PATCH', '/api/orgs/rail-club', { membersCanCreate: false })).statusCode).toBe(200);
    let member = (await as(ann, 'GET', '/api/orgs/rail-club/roles')).json().roles.find((r: { key: string }) => r.key === 'member');
    expect(member.permissions).toEqual(['view_items', 'edit_layouts', 'add_parts']);
    expect((await as(ben, 'POST', '/api/layouts', { title: 'x', orgSlug: 'rail-club' })).statusCode).toBe(403);
    // …and the other way round.
    expect((await as(ann, 'PATCH', `/api/orgs/rail-club/roles/${orgId}:member`, { permissions: [...member.permissions, 'start_layouts', 'edit_modules'] })).statusCode).toBe(200);
    expect((await as(ann, 'GET', '/api/orgs/rail-club')).json().membersCanCreate).toBe(true);
    member = (await as(ann, 'GET', '/api/orgs/rail-club/roles')).json().roles.find((r: { key: string }) => r.key === 'member');
    expect(member.permissions).toContain('start_layouts');
  });

  it('a member editing a layout becomes read only at once when their role is taken down to Viewer', async () => {
    const id = await clubLayout();
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/layout/${id}`, { headers: { cookie: ben.cookie } });
    ws.on('error', () => {});
    sockets.push(ws);
    await new Promise((r) => ws.once('open', r));
    await sleep(80);
    const edit = (key: string) => {
      const d = new Y.Doc();
      d.getMap('meta').set(key, 'x');
      const enc = encoding.createEncoder();
      encoding.writeVarUint(enc, 0);
      syncProtocol.writeUpdate(enc, Y.encodeStateAsUpdate(d));
      return encoding.toUint8Array(enc);
    };
    const meta = () => docHub.peek(id)!.doc.getMap('meta');
    ws.send(edit('before'));
    await sleep(120);
    expect(meta().get('before')).toBe('x');
    expect((await give(ben, [`${orgId}:viewer`])).statusCode).toBe(200);
    await sleep(80);
    ws.send(edit('after'));
    await sleep(150);
    expect(meta().get('after')).toBeUndefined();
    expect(ws.readyState).toBe(WebSocket.OPEN);
  });

  it('your clubs list says the roles you hold by name', async () => {
    const crew = await makeRole('Track crew', ['edit_layouts']);
    expect((await give(ben, [`${orgId}:viewer`, crew])).statusCode).toBe(200);
    const mine = (await as(ben, 'GET', '/api/orgs')).json().orgs.find((o: { slug: string }) => o.slug === 'rail-club');
    expect(mine.roleNames).toEqual(['Viewer', 'Track crew']);
    // A member added without role rows holds the built-in role org_members names.
    await db.delete(schema.memberRoles).where(and(eq(schema.memberRoles.orgId, orgId), eq(schema.memberRoles.userId, ben.id)));
    const bare = (await as(ben, 'GET', '/api/orgs')).json().orgs.find((o: { slug: string }) => o.slug === 'rail-club');
    expect(bare.roleNames).toEqual(['Member']);
  });

  it('the requests-to-join badge counts for whoever may answer them, by permission', async () => {
    await as(ann, 'PATCH', '/api/orgs/rail-club', { joinPolicy: 'request', listed: true });
    const dee = await loginAs(app, 'dee@x.com');
    expect((await as(dee, 'POST', '/api/orgs/rail-club/join', {})).statusCode).toBeLessThan(300);
    // A custom role that invites people answers requests, so it sees the badge.
    const door = await makeRole('Door', ['invite']);
    expect((await give(ben, [door])).statusCode).toBe(200);
    expect((await as(ben, 'GET', '/api/orgs/rail-club/join-requests')).statusCode).toBe(200);
    expect((await as(ben, 'GET', '/api/join-requests/count')).json()).toEqual({ count: 1, clubs: [{ slug: 'rail-club', count: 1 }] });
    // A Manager whose role no longer invites can't answer them, and sees none.
    const manager = (await as(ann, 'GET', '/api/orgs/rail-club/roles')).json().roles.find((r: { key: string }) => r.key === 'manager');
    expect((await as(ann, 'PATCH', `/api/orgs/rail-club/roles/${manager.id}`, { permissions: ['view_items', 'edit_layouts'] })).statusCode).toBe(200);
    expect((await give(ben, [manager.id])).statusCode).toBe(200);
    expect((await as(ben, 'GET', '/api/orgs/rail-club/join-requests')).statusCode).toBe(403);
    expect((await as(ben, 'GET', '/api/join-requests/count')).json()).toEqual({ count: 0, clubs: [] });
  });
});

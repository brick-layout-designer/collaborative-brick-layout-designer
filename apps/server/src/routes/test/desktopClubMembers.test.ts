// The desktop's read-only club Members view and its club logos, read with
// its API token (layouts:read): names, roles and last active as the person
// may see them on the web, never addresses or invites; and the logo, which
// a token was refused before.

import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import sharp from 'sharp';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { db, issueToken, loginAs, resetDb, schema } from '../../test/helpers.js';
import { attachUser } from '../../auth/cookie.js';
import { registerApiRoutes } from '../all.js';
import { closeAll } from '../../events/hub.js';

type Who = { cookie: string; id: string };
type Member = { userId: string; displayName: string; email: string; roleIds: string[]; lastActive: string | null };
const DAY = 86_400_000;

describe('the desktop reads a club’s members and logo with its token', () => {
  let app: FastifyInstance;
  let ann: Who; // admin
  let ben: Who; // member + Track crew
  let orgId: string;
  let crew: string;

  beforeEach(async () => {
    resetDb();
    app = Fastify({ logger: false });
    await app.register(cookie);
    app.addHook('preHandler', attachUser);
    await registerApiRoutes(app);
    ann = await loginAs(app, 'ann@x.com');
    ben = await loginAs(app, 'ben@x.com');
    const made = await app.inject({ method: 'POST', url: '/api/orgs', headers: { cookie: ann.cookie }, payload: { name: 'Rail Club' } });
    orgId = made.json().id as string;
    await db.insert(schema.orgMembers).values({ orgId, userId: ben.id, role: 'member', joinedAt: new Date() });
    const role = await app.inject({ method: 'POST', url: '/api/orgs/rail-club/roles', headers: { cookie: ann.cookie }, payload: { name: 'Track crew', permissions: ['edit_layouts'] } });
    crew = role.json().id as string;
    await app.inject({ method: 'PATCH', url: `/api/orgs/rail-club/members/${ben.id}`, headers: { cookie: ann.cookie }, payload: { roleIds: [`${orgId}:member`, crew] } });
    await app.inject({ method: 'POST', url: '/api/orgs/rail-club/invites', headers: { cookie: ann.cookie }, payload: { email: 'cy@x.com', role: 'member' } });
    await db.update(schema.users).set({ lastSeenAt: new Date(Date.now() - 3 * DAY) }).where(eq(schema.users.id, ben.id));
  });

  afterEach(async () => {
    closeAll();
    await app.close();
  });

  const withToken = (token: string, url: string) => app.inject({ method: 'GET', url, headers: { authorization: `Bearer ${token}` } });

  it('gives the members, their roles and last active as the web does, without addresses or invites', async () => {
    const token = await issueToken(app, ann.cookie, 'layouts:read');
    const res = await withToken(token, '/api/orgs/rail-club/members');
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json() as { roles: Array<{ id: string; name: string }>; members: Member[]; invites: unknown[] };
    expect(body.roles.map((r) => r.name)).toEqual(['Admin', 'Manager', 'Member', 'Viewer', 'Track crew']);
    const bens = body.members.find((m) => m.userId === ben.id)!;
    expect(bens.roleIds.sort()).toEqual([`${orgId}:member`, crew].sort());
    expect(bens.lastActive).toBe('week');
    expect(body.members.every((m) => m.email === '')).toBe(true);
    expect(body.invites).toEqual([]);
    // The website, signed in, still gets the addresses and invites.
    const web = (await app.inject({ method: 'GET', url: '/api/orgs/rail-club/members', headers: { cookie: ann.cookie } })).json();
    expect(web.invites).toHaveLength(1);
    expect((web.members as Member[]).find((m) => m.userId === ben.id)!.email).toBe('ben@x.com');
  });

  it('a member sees last active only for themselves, as on the web', async () => {
    const token = await issueToken(app, ben.cookie, 'layouts:read');
    const members = (await withToken(token, '/api/orgs/rail-club/members')).json().members as Member[];
    expect(members.find((m) => m.userId === ben.id)!.lastActive).toBe('today');
    expect(members.find((m) => m.userId === ann.id)!.lastActive).toBeNull();
  });

  it('refuses a token without layouts:read, and someone outside the club', async () => {
    const prefsOnly = await issueToken(app, ann.cookie, 'account:prefs');
    expect((await withToken(prefsOnly, '/api/orgs/rail-club/members')).statusCode).toBe(403);
    const cy = await loginAs(app, 'cy@x.com');
    const theirs = await issueToken(app, cy.cookie, 'layouts:read');
    expect((await withToken(theirs, '/api/orgs/rail-club/members')).statusCode).toBe(404);
    expect((await withToken(theirs, '/api/orgs/rail-club/logo')).statusCode).toBe(404);
  });

  it('sends the club’s logo to the desktop', async () => {
    const png = await sharp({ create: { width: 64, height: 64, channels: 4, background: { r: 200, g: 30, b: 30, alpha: 1 } } }).png().toBuffer();
    const put = await app.inject({ method: 'PUT', url: '/api/orgs/rail-club/logo', headers: { cookie: ann.cookie }, payload: { mime: 'image/png', data: png.toString('base64') } });
    expect(put.statusCode, put.body).toBe(200);
    const token = await issueToken(app, ben.cookie, 'layouts:read');
    const pic = await withToken(token, '/api/orgs/rail-club/logo');
    expect(pic.statusCode, pic.body).toBe(200);
    expect(pic.headers['content-type']).toBe('image/webp');
  });
});

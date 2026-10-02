// Who can join a club: invite only (the default), ask to join, or open,
// and whether it's listed in the Clubs directory. Only the club's admins
// change either; unlisted clubs stay hidden from outsiders; the members
// limit applies to every way in.

import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { db, loginAs, resetDb, schema } from '../../test/helpers.js';
import { attachUser } from '../../auth/cookie.js';
import { env } from '../../env.js';
import { passwordRoutes } from '../auth/password.js';
import { orgRoutes } from '../orgs.js';
import { orgInviteRoutes } from '../orgInvites.js';
import { clubJoinRoutes, OPEN_REQUESTS_MAX } from '../clubJoin.js';
import { adminLimitsRoutes } from '../adminLimits.js';

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ bodyLimit: 1024 * 1024 });
  await app.register(cookie);
  app.addHook('preHandler', attachUser);
  await app.register(passwordRoutes);
  await app.register(orgRoutes);
  await app.register(orgInviteRoutes);
  await app.register(clubJoinRoutes);
  await app.register(adminLimitsRoutes);
  return app;
}

type Who = { cookie: string; id: string };

describe('club join settings', () => {
  let app: FastifyInstance;
  let admin: Who;
  let member: Who;
  let outsider: Who;
  let orgId: string;

  const call = (who: Who, method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, payload?: object) =>
    app.inject({ method, url, headers: { cookie: who.cookie }, ...(payload ? { payload } : {}) });
  const settings = (who: Who, body: object) => call(who, 'PATCH', '/api/orgs/arklug', body);
  const isMember = async (userId: string) =>
    Boolean(
      await db
        .select()
        .from(schema.orgMembers)
        .where(and(eq(schema.orgMembers.orgId, orgId), eq(schema.orgMembers.userId, userId)))
        .get(),
    );
  const audits = (type: string) =>
    db.select().from(schema.auditEvents).where(eq(schema.auditEvents.eventType, type)).all();

  beforeEach(async () => {
    resetDb();
    app = await buildApp();
    admin = await loginAs(app, 'admin@example.com');
    member = await loginAs(app, 'member@example.com');
    outsider = await loginAs(app, 'outsider@example.com');
    const res = await call(admin, 'POST', '/api/orgs', { name: 'ArkLUG', slug: 'arklug' });
    orgId = (res.json() as { id: string }).id;
    await db.insert(schema.orgMembers).values({ orgId, userId: member.id, role: 'member', joinedAt: new Date() });
  });
  afterEach(async () => {
    env.limitsEnforceForced = null;
    await app.close();
  });

  it('starts invite only and unlisted, and the club page says so', async () => {
    const org = (await call(admin, 'GET', '/api/orgs/arklug')).json() as Record<string, unknown>;
    expect(org).toMatchObject({ joinPolicy: 'invite', listed: false, pendingRequests: 0 });
    // Members see the settings but not the waiting count.
    const asMember = (await call(member, 'GET', '/api/orgs/arklug')).json() as Record<string, unknown>;
    expect(asMember.joinPolicy).toBe('invite');
    expect(asMember).not.toHaveProperty('pendingRequests');
  });

  it('lets only admins change who can join and the listing, and audits it', async () => {
    expect((await settings(member, { joinPolicy: 'open' })).statusCode).toBe(403);
    expect((await settings(member, { listed: true })).statusCode).toBe(403);
    expect((await settings(outsider, { listed: true })).statusCode).toBe(404);
    expect((await settings(admin, { joinPolicy: 'anyone' })).statusCode).toBe(400);
    expect((await settings(admin, { listed: 'yes' })).statusCode).toBe(400);
    const row = () => db.select().from(schema.orgs).where(eq(schema.orgs.id, orgId)).get()!;
    expect(row()).toMatchObject({ joinPolicy: 'invite', listed: false });

    expect((await settings(admin, { joinPolicy: 'request', listed: true })).statusCode).toBe(200);
    expect(row()).toMatchObject({ joinPolicy: 'request', listed: true });
    const logged = audits('settings');
    expect(logged).toHaveLength(1);
    expect(JSON.parse(logged[0]!.payload!)).toMatchObject({ joinPolicy: 'request', listed: true });
  });

  it('keeps unlisted clubs hidden from people outside them', async () => {
    await settings(admin, { joinPolicy: 'open' });
    expect((await call(outsider, 'GET', '/api/club-directory')).json()).toEqual({ clubs: [] });
    expect((await call(outsider, 'GET', '/api/orgs/arklug/summary')).statusCode).toBe(404);
    expect((await call(outsider, 'GET', '/api/orgs/arklug')).statusCode).toBe(404);
    expect((await call(outsider, 'POST', '/api/orgs/arklug/join')).statusCode).toBe(404);
    expect(await isMember(outsider.id)).toBe(false);
    // Its own members still see the summary.
    expect((await call(member, 'GET', '/api/orgs/arklug/summary')).json()).toMatchObject({ myStatus: 'member' });
  });

  it('lists listed clubs with a public-safe summary, and searches them', async () => {
    await settings(admin, { listed: true, description: 'Trains in Little Rock' });
    await call(outsider, 'POST', '/api/orgs', { name: 'Hidden Club', slug: 'hidden' });
    const all = (await call(outsider, 'GET', '/api/club-directory')).json() as { clubs: Record<string, unknown>[] };
    expect(all.clubs).toHaveLength(1);
    expect(all.clubs[0]).toEqual({
      id: orgId,
      name: 'ArkLUG',
      slug: 'arklug',
      description: 'Trains in Little Rock',
      memberCount: 2,
      joinPolicy: 'invite',
      listed: true,
      myStatus: null,
    });
    expect(JSON.stringify(all)).not.toContain('@example.com');
    expect(((await call(outsider, 'GET', '/api/club-directory?q=little')).json() as { clubs: unknown[] }).clubs).toHaveLength(1);
    expect(((await call(outsider, 'GET', '/api/club-directory?q=castle')).json() as { clubs: unknown[] }).clubs).toHaveLength(0);
    expect((await call(admin, 'GET', '/api/club-directory')).json()).toMatchObject({ clubs: [{ myStatus: 'admin' }] });
    expect((await call(outsider, 'GET', '/api/orgs/arklug/summary')).json()).toMatchObject({ name: 'ArkLUG', myStatus: null });
    // The full club page is still members-only.
    expect((await call(outsider, 'GET', '/api/orgs/arklug')).statusCode).toBe(404);
  });

  it('refuses a listed invite-only club, so the invite stays the only way in', async () => {
    await settings(admin, { listed: true });
    const res = await call(outsider, 'POST', '/api/orgs/arklug/join');
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ error: 'invite_only' });
    expect(await isMember(outsider.id)).toBe(false);
  });

  it('lets anyone join an open listed club with one click, as a member', async () => {
    await settings(admin, { listed: true, joinPolicy: 'open' });
    const res = await call(outsider, 'POST', '/api/orgs/arklug/join');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'member', slug: 'arklug' });
    const m = db.select().from(schema.orgMembers).where(and(eq(schema.orgMembers.orgId, orgId), eq(schema.orgMembers.userId, outsider.id))).get();
    expect(m?.role).toBe('member');
    expect(audits('join')).toHaveLength(1);
    expect((await call(outsider, 'POST', '/api/orgs/arklug/join')).statusCode).toBe(409);
  });

  it('takes a request with a note, which the asker can take back', async () => {
    await settings(admin, { listed: true, joinPolicy: 'request' });
    expect((await call(outsider, 'POST', '/api/orgs/arklug/join', { message: 'x'.repeat(301) })).statusCode).toBe(400);
    const res = await call(outsider, 'POST', '/api/orgs/arklug/join', { message: '  I build trains  ' });
    expect(res.json()).toEqual({ status: 'requested', slug: 'arklug' });
    expect(await isMember(outsider.id)).toBe(false);
    // Asking again doesn't make a second request.
    await call(outsider, 'POST', '/api/orgs/arklug/join', { message: 'again' });
    const list = (await call(admin, 'GET', '/api/orgs/arklug/join-requests')).json() as { requests: Record<string, unknown>[] };
    expect(list.requests).toHaveLength(1);
    expect(list.requests[0]).toMatchObject({ userId: outsider.id, message: 'I build trains', displayName: 'outsider' });
    expect((await call(outsider, 'GET', '/api/orgs/arklug/summary')).json()).toMatchObject({ myStatus: 'requested' });
    expect((await call(admin, 'GET', '/api/orgs/arklug')).json()).toMatchObject({ pendingRequests: 1 });
    expect((await call(admin, 'GET', '/api/join-requests/count')).json()).toEqual({ count: 1, clubs: [{ slug: 'arklug', count: 1 }] });
    // Plain members aren't told; they don't run the club.
    expect((await call(member, 'GET', '/api/join-requests/count')).json()).toEqual({ count: 0, clubs: [] });

    expect((await call(outsider, 'DELETE', '/api/orgs/arklug/join')).statusCode).toBe(200);
    expect((await call(admin, 'GET', '/api/join-requests/count')).json()).toMatchObject({ count: 0 });
    expect((await call(outsider, 'GET', '/api/orgs/arklug/summary')).json()).toMatchObject({ myStatus: null });
  });

  it('lets only admins see, approve and decline requests; approving makes a member and is audited', async () => {
    await settings(admin, { listed: true, joinPolicy: 'request' });
    await call(outsider, 'POST', '/api/orgs/arklug/join');
    const id = db.select().from(schema.orgJoinRequests).get()!.id;

    expect((await call(member, 'GET', '/api/orgs/arklug/join-requests')).statusCode).toBe(403);
    expect((await call(outsider, 'GET', '/api/orgs/arklug/join-requests')).statusCode).toBe(404);
    expect((await call(member, 'POST', `/api/orgs/arklug/join-requests/${id}/approve`)).statusCode).toBe(403);
    expect((await call(outsider, 'POST', `/api/orgs/arklug/join-requests/${id}/approve`)).statusCode).toBe(404);
    expect((await call(member, 'POST', `/api/orgs/arklug/join-requests/${id}/decline`)).statusCode).toBe(403);
    expect(await isMember(outsider.id)).toBe(false);

    expect((await call(admin, 'POST', `/api/orgs/arklug/join-requests/${id}/approve`)).statusCode).toBe(200);
    expect(await isMember(outsider.id)).toBe(true);
    expect(db.select().from(schema.orgJoinRequests).all()).toHaveLength(0);
    const approved = audits('join_approve');
    expect(approved).toHaveLength(1);
    expect(approved[0]!.userId).toBe(admin.id);
    expect(JSON.parse(approved[0]!.payload!)).toEqual({ targetUserId: outsider.id });
  });

  it('declines quietly: the request goes, nobody joins, and the audit log has it', async () => {
    await settings(admin, { listed: true, joinPolicy: 'request' });
    await call(outsider, 'POST', '/api/orgs/arklug/join');
    const id = db.select().from(schema.orgJoinRequests).get()!.id;
    expect((await call(admin, 'POST', `/api/orgs/arklug/join-requests/${id}/decline`)).statusCode).toBe(200);
    expect(await isMember(outsider.id)).toBe(false);
    expect(db.select().from(schema.orgJoinRequests).all()).toHaveLength(0);
    expect(audits('join_decline')).toHaveLength(1);
    // The asker just sees no request; they may ask again.
    expect((await call(outsider, 'GET', '/api/orgs/arklug/summary')).json()).toMatchObject({ myStatus: null });
    expect((await call(admin, 'POST', `/api/orgs/arklug/join-requests/${id}/decline`)).statusCode).toBe(404);
  });

  it('only lets an admin act on requests to their own club', async () => {
    await settings(admin, { listed: true, joinPolicy: 'request' });
    await call(outsider, 'POST', '/api/orgs/arklug/join');
    const id = db.select().from(schema.orgJoinRequests).get()!.id;
    const other = await loginAs(app, 'other@example.com');
    await call(other, 'POST', '/api/orgs', { name: 'Other', slug: 'other' });
    expect((await call(other, 'POST', `/api/orgs/other/join-requests/${id}/approve`)).statusCode).toBe(404);
    expect(await isMember(outsider.id)).toBe(false);
  });

  it('answers an invite accepted while a request is waiting', async () => {
    await settings(admin, { listed: true, joinPolicy: 'request' });
    await call(outsider, 'POST', '/api/orgs/arklug/join');
    const invite = (await call(admin, 'POST', '/api/orgs/arklug/invites', { email: 'outsider@example.com', role: 'member' })).json() as { token: string };
    expect((await call(outsider, 'POST', `/api/org-invites/${invite.token}`)).statusCode).toBe(200);
    expect(db.select().from(schema.orgJoinRequests).all()).toHaveLength(0);
  });

  it('caps how many clubs one person waits on at once', async () => {
    for (let i = 0; i < OPEN_REQUESTS_MAX; i++) {
      await db.insert(schema.orgs).values({ id: `c${i}`, name: `C${i}`, slug: `c${i}`, createdAt: new Date(), joinPolicy: 'request', listed: true });
      await db.insert(schema.orgJoinRequests).values({ id: `r${i}`, orgId: `c${i}`, userId: outsider.id, createdAt: new Date() });
    }
    await settings(admin, { listed: true, joinPolicy: 'request' });
    const res = await call(outsider, 'POST', '/api/orgs/arklug/join');
    expect(res.statusCode).toBe(429);
    expect(res.json()).toMatchObject({ error: 'too_many_requests' });
    // Asking again where you already wait isn't a new request, so it isn't capped.
    await db.update(schema.orgs).set({ joinPolicy: 'request', listed: true }).where(eq(schema.orgs.id, 'c0')).run();
    const again = await call(outsider, 'POST', '/api/orgs/c0/join');
    expect(again.statusCode).toBe(200);
    expect(again.json()).toEqual({ status: 'requested', slug: 'c0' });
  });

  describe('the members limit', () => {
    const globalAdmin = async () => {
      const g = await loginAs(app, 'root@example.com');
      db.update(schema.users).set({ isGlobalAdmin: true }).where(eq(schema.users.id, g.id)).run();
      return g;
    };
    const setMembersLimit = async (n: number) => {
      const res = await call(await globalAdmin(), 'PATCH', '/api/admin/limits', { membersPerClub: n });
      expect(res.statusCode, res.body).toBe(200);
    };

    it('stops a one-click join into a full club', async () => {
      await settings(admin, { listed: true, joinPolicy: 'open' });
      await setMembersLimit(2);
      const res = await call(outsider, 'POST', '/api/orgs/arklug/join');
      expect(res.statusCode).toBe(403);
      expect(res.json()).toMatchObject({ error: 'limit_reached', limit: 'membersPerClub' });
      expect(await isMember(outsider.id)).toBe(false);
    });

    it('stops approving into a full club, and keeps the request', async () => {
      await settings(admin, { listed: true, joinPolicy: 'request' });
      await call(outsider, 'POST', '/api/orgs/arklug/join');
      const id = db.select().from(schema.orgJoinRequests).get()!.id;
      await setMembersLimit(2);
      const res = await call(admin, 'POST', `/api/orgs/arklug/join-requests/${id}/approve`);
      expect(res.json()).toMatchObject({ error: 'limit_reached', limit: 'membersPerClub' });
      expect(await isMember(outsider.id)).toBe(false);
      expect(db.select().from(schema.orgJoinRequests).all()).toHaveLength(1);
    });

    it('is counted but not applied when LIMITS_ENFORCE is off', async () => {
      await settings(admin, { listed: true, joinPolicy: 'open' });
      await setMembersLimit(2);
      env.limitsEnforceForced = 'off';
      expect((await call(outsider, 'POST', '/api/orgs/arklug/join')).statusCode).toBe(200);
      expect(await isMember(outsider.id)).toBe(true);
    });
  });
});

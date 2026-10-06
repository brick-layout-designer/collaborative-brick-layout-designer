// Running a club: settings (name, address, description, who may add
// things), handing the club over, deleting it with a typed confirmation,
// invites with an expiry and resend, and the last-admin guard. Every
// action is the club admins' alone.

import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { privacyTick } from '../../privacy/tick.js';
import { db, loginAs, resetDb, schema } from '../../test/helpers.js';
import { attachUser } from '../../auth/cookie.js';
import { passwordRoutes } from '../auth/password.js';
import { layoutRoutes } from '../layouts.js';
import { moduleRoutes } from '../modules.js';
import { orgRoutes } from '../orgs.js';
import { transferRoutes } from '../transfers.js';
import { moduleTransferRoutes } from '../moduleTransfers.js';
import { venueRoutes } from '../venues.js';

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ bodyLimit: 10 * 1024 * 1024 });
  await app.register(cookie);
  app.addHook('preHandler', attachUser);
  await app.register(passwordRoutes);
  await app.register(layoutRoutes);
  await app.register(moduleRoutes);
  await app.register(orgRoutes);
  await app.register(transferRoutes);
  await app.register(moduleTransferRoutes);
  await app.register(venueRoutes);
  return app;
}

type Who = { cookie: string; id: string };
const DAY = 24 * 60 * 60 * 1000;

describe('club admin', () => {
  let app: FastifyInstance;
  let admin: Who;
  let member: Who;
  let outsider: Who;

  const call = (who: Who, method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, payload?: object) =>
    app.inject({ method, url, headers: { cookie: who.cookie }, ...(payload ? { payload } : {}) });
  const role = async (userId: string) =>
    (await db.select().from(schema.orgMembers).where(eq(schema.orgMembers.userId, userId)).all()).find(() => true)?.role;

  beforeEach(async () => {
    resetDb();
    app = await buildApp();
    admin = await loginAs(app, 'admin@example.com');
    member = await loginAs(app, 'member@example.com');
    outsider = await loginAs(app, 'outsider@example.com');
    const res = await call(admin, 'POST', '/api/orgs', { name: 'ArkLUG' });
    const orgId = (res.json() as { id: string }).id;
    await db.insert(schema.orgMembers).values({ orgId, userId: member.id, role: 'member', joinedAt: new Date() });
  });
  afterEach(async () => {
    await app.close();
  });

  describe('settings', () => {
    it('an admin changes the name, address and description; the page shows them', async () => {
      const res = await call(admin, 'PATCH', '/api/orgs/arklug', {
        name: 'Arkansas LUG',
        slug: 'ark-lug',
        description: 'Trains and towns in Little Rock.',
      });
      expect(res.statusCode).toBe(200);
      const got = (await call(member, 'GET', '/api/orgs/ark-lug')).json() as Record<string, unknown>;
      expect(got).toMatchObject({
        name: 'Arkansas LUG',
        slug: 'ark-lug',
        description: 'Trains and towns in Little Rock.',
        membersCanCreate: true,
        memberCount: 2,
        adminCount: 1,
      });
      expect((await call(member, 'GET', '/api/orgs/arklug')).statusCode).toBe(404);
    });

    it('only admins may change settings; strangers are not told the club exists', async () => {
      expect((await call(member, 'PATCH', '/api/orgs/arklug', { name: 'Mine now' })).statusCode).toBe(403);
      expect((await call(outsider, 'PATCH', '/api/orgs/arklug', { name: 'Mine now' })).statusCode).toBe(404);
      expect(((await call(admin, 'GET', '/api/orgs/arklug')).json() as { name: string }).name).toBe('ArkLUG');
    });

    it('refuses a bad or taken address', async () => {
      await call(outsider, 'POST', '/api/orgs', { name: 'Other' });
      expect((await call(admin, 'PATCH', '/api/orgs/arklug', { slug: 'Bad Slug!' })).statusCode).toBe(400);
      expect((await call(admin, 'PATCH', '/api/orgs/arklug', { slug: 'other' })).statusCode).toBe(409);
      expect((await call(admin, 'PATCH', '/api/orgs/arklug', {})).statusCode).toBe(400);
    });
  });

  describe('who may add things', () => {
    beforeEach(async () => {
      expect((await call(admin, 'PATCH', '/api/orgs/arklug', { membersCanCreate: false })).statusCode).toBe(200);
    });

    it('members cannot add layouts, rooms or modules when only admins may', async () => {
      const room = { name: 'Hall', data: { name: 'Hall', enabled: true, edges: [], obstacles: [], minWalkwayStuds: 0 } };
      for (const [url, body] of [
        ['/api/layouts', { title: 'X' }],
        ['/api/modules', { title: 'X' }],
        ['/api/venues', room],
      ] as const) {
        const res = await call(member, 'POST', url, { ...body, orgSlug: 'arklug' });
        expect(res.statusCode, url).toBe(403);
        expect((res.json() as { error: string }).error).toBe('only_club_admins_can_add');
        expect((await call(admin, 'POST', url, { ...body, orgSlug: 'arklug' })).statusCode, url).toBe(201);
        // Their own things are unaffected.
        expect((await call(member, 'POST', url, body)).statusCode, url).toBe(201);
      }
    });

    it('members cannot move or copy things into the club either', async () => {
      const layout = (await call(member, 'POST', '/api/layouts', { title: 'Mine' })).json() as { id: string };
      expect((await call(member, 'POST', `/api/layouts/${layout.id}/transfer`, { recipientOrgSlug: 'arklug' })).statusCode).toBe(403);
      expect((await call(member, 'POST', `/api/layouts/${layout.id}/copy`, { orgSlug: 'arklug' })).statusCode).toBe(403);
      const mod = (await call(member, 'POST', '/api/modules', { title: 'Mine' })).json() as { id: string };
      expect((await call(member, 'POST', `/api/modules/${mod.id}/transfer`, { recipientOrgSlug: 'arklug' })).statusCode).toBe(403);
    });
  });

  describe('handing the club over', () => {
    it('an admin hands the club to a member: they swap roles', async () => {
      const res = await call(admin, 'POST', '/api/orgs/arklug/hand-over', { userId: member.id });
      expect(res.statusCode).toBe(200);
      expect(await role(member.id)).toBe('admin');
      expect(await role(admin.id)).toBe('member');
      // The former admin can no longer change settings.
      expect((await call(admin, 'PATCH', '/api/orgs/arklug', { name: 'X' })).statusCode).toBe(403);
    });

    it('only an admin may hand over, and only to a member', async () => {
      expect((await call(member, 'POST', '/api/orgs/arklug/hand-over', { userId: member.id })).statusCode).toBe(403);
      expect((await call(admin, 'POST', '/api/orgs/arklug/hand-over', { userId: outsider.id })).statusCode).toBe(404);
      expect((await call(admin, 'POST', '/api/orgs/arklug/hand-over', { userId: admin.id })).statusCode).toBe(400);
      expect(await role(admin.id)).toBe('admin');
    });

    it('the last admin can neither leave nor step down without naming another admin', async () => {
      expect((await call(admin, 'DELETE', `/api/orgs/arklug/members/${admin.id}`)).statusCode).toBe(409);
      expect((await call(admin, 'PATCH', `/api/orgs/arklug/members/${admin.id}`, { role: 'member' })).statusCode).toBe(409);
      // A member leaves freely.
      expect((await call(member, 'DELETE', `/api/orgs/arklug/members/${member.id}`)).statusCode).toBe(200);
    });
  });

  describe('deleting the club', () => {
    it('needs an admin and the club’s name typed out', async () => {
      const layout = (await call(admin, 'POST', '/api/layouts', { title: 'Show', orgSlug: 'arklug' })).json() as { id: string };
      expect((await call(member, 'DELETE', '/api/orgs/arklug', { confirm: 'ArkLUG' })).statusCode).toBe(403);
      expect((await call(outsider, 'DELETE', '/api/orgs/arklug', { confirm: 'ArkLUG' })).statusCode).toBe(404);
      expect((await call(admin, 'DELETE', '/api/orgs/arklug', { confirm: 'arklu' })).statusCode).toBe(400);
      expect((await call(admin, 'DELETE', '/api/orgs/arklug', {})).statusCode).toBe(400);
      expect((await call(admin, 'GET', '/api/orgs/arklug')).statusCode).toBe(200);

      expect((await call(admin, 'DELETE', '/api/orgs/arklug', { confirm: ' arklug ' })).statusCode).toBe(200);
      // Hidden at once...
      expect((await call(admin, 'GET', '/api/orgs/arklug')).statusCode).toBe(404);
      expect(await db.select().from(schema.layouts).where(eq(schema.layouts.id, layout.id)).get()).toBeDefined();
      // ...and its things go with it once the wait is over.
      await privacyTick(new Date(Date.now() + 15 * DAY));
      expect(await db.select().from(schema.layouts).where(eq(schema.layouts.id, layout.id)).get()).toBeUndefined();
    });
  });

  describe('invites', () => {
    it('lasts as long as the admin picks, 1 to 30 days', async () => {
      const before = Date.now();
      const res = await call(admin, 'POST', '/api/orgs/arklug/invites', { email: 'new@example.com', role: 'member', expiresInDays: 3 });
      expect(res.statusCode).toBe(200);
      const { expiresAt } = res.json() as { expiresAt: number };
      expect(expiresAt).toBeGreaterThanOrEqual(before + 3 * DAY);
      expect(expiresAt).toBeLessThan(before + 3 * DAY + 60_000);
      for (const bad of [0, 31, 2.5, '7']) {
        const r = await call(admin, 'POST', '/api/orgs/arklug/invites', { email: 'x@example.com', role: 'member', expiresInDays: bad });
        expect(r.statusCode, String(bad)).toBe(400);
      }
      const plain = (await call(admin, 'POST', '/api/orgs/arklug/invites', { email: 'y@example.com', role: 'member' })).json() as { expiresAt: number };
      expect(plain.expiresAt).toBeGreaterThanOrEqual(before + 14 * DAY);
    });

    it('admins see pending invites with their link and can resend them with a fresh expiry', async () => {
      const made = (await call(admin, 'POST', '/api/orgs/arklug/invites', { email: 'new@example.com', role: 'member', expiresInDays: 1 })).json() as { id: string; inviteUrl: string };
      const list = (await call(admin, 'GET', '/api/orgs/arklug/members')).json() as { invites: { id: string; inviteUrl: string }[] };
      expect(list.invites).toHaveLength(1);
      expect(list.invites[0]!.inviteUrl).toBe(made.inviteUrl);
      // Members don't see the invite list.
      expect(((await call(member, 'GET', '/api/orgs/arklug/members')).json() as { invites: unknown[] }).invites).toEqual([]);

      const before = Date.now();
      const resent = await call(admin, 'POST', `/api/orgs/arklug/invites/${made.id}/resend`, { expiresInDays: 7 });
      expect(resent.statusCode).toBe(200);
      const body = resent.json() as { inviteUrl: string; expiresAt: number };
      expect(body.inviteUrl).toBe(made.inviteUrl);
      expect(body.expiresAt).toBeGreaterThanOrEqual(before + 7 * DAY);
      const row = await db.select().from(schema.orgInvites).where(eq(schema.orgInvites.id, made.id)).get();
      expect(row!.expiresAt.getTime()).toBe(body.expiresAt);

      expect((await call(member, 'POST', `/api/orgs/arklug/invites/${made.id}/resend`, {})).statusCode).toBe(403);
      expect((await call(admin, 'POST', '/api/orgs/arklug/invites/nope/resend', {})).statusCode).toBe(404);
      // Cancelling removes it.
      expect((await call(admin, 'DELETE', `/api/orgs/arklug/invites/${made.id}`)).statusCode).toBe(200);
      expect(((await call(admin, 'GET', '/api/orgs/arklug/members')).json() as { invites: unknown[] }).invites).toEqual([]);
    });
  });
});

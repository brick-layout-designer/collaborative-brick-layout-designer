// Warnings: site warnings (admins and moderators, to a person or a club),
// club warnings (a club's admins and managers, to members), the notices
// people see and acknowledge, the history, the audit log, and exactly who
// the live hint goes to.

import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import fastifyMultipart from '@fastify/multipart';
import { and, eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { db, loginAs, resetDb, schema } from '../../test/helpers.js';
import { attachUser } from '../../auth/cookie.js';
import { registerApiRoutes } from '../all.js';
import { ROUTE_HINTS, registerChangeHints, type HintCtx } from '../../events/routeHints.js';
import { mayWarn, parseWarningInput } from '../warnings.js';

type Who = { cookie: string; id: string };

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify();
  await app.register(cookie);
  await app.register(fastifyMultipart);
  app.addHook('preHandler', attachUser);
  registerChangeHints(app);
  await registerApiRoutes(app);
  return app;
}

describe('parseWarningInput', () => {
  it('takes a severity, a reason and an optional link on this site', () => {
    expect(parseWarningInput({ severity: 'note', reason: 'Please tidy up', link: '/editor/abc' })).toEqual({ severity: 'note', reason: 'Please tidy up', link: '/editor/abc' });
    expect(parseWarningInput({ severity: 'final', reason: '  spam  ' })).toEqual({ severity: 'final', reason: 'spam', link: null });
  });
  it('refuses anything else', () => {
    expect(parseWarningInput({ severity: 'ban', reason: 'x y z' })).toEqual({ error: 'invalid_severity' });
    expect(parseWarningInput({ severity: 'note', reason: 'no' })).toEqual({ error: 'invalid_reason' });
    expect(parseWarningInput({ severity: 'note', reason: 'x'.repeat(2001) })).toEqual({ error: 'invalid_reason' });
    for (const link of ['https://evil.example', '//evil.example', 'javascript:alert(1)', '/a b', '/\\evil']) {
      expect(parseWarningInput({ severity: 'note', reason: 'fine', link })).toEqual({ error: 'invalid_link' });
    }
  });
});

describe('mayWarn', () => {
  it('managers warn members; admins warn members and managers; nobody warns an admin', () => {
    expect(mayWarn('manager', 'member')).toBe(true);
    expect(mayWarn('manager', 'manager')).toBe(false);
    expect(mayWarn('admin', 'manager')).toBe(true);
    expect(mayWarn('admin', 'member')).toBe(true);
    expect(mayWarn('admin', 'admin')).toBe(false);
    expect(mayWarn('member', 'member')).toBe(false);
  });
});

describe('warnings', () => {
  let app: FastifyInstance;
  let admin: Who, mod: Who, ann: Who, bob: Who, cat: Who, dan: Who;
  let orgId: string;
  let slug: string;

  const post = (who: Who, url: string, payload: unknown = {}) => app.inject({ method: 'POST', url, headers: { cookie: who.cookie }, payload: payload as object });
  const get = (who: Who, url: string) => app.inject({ method: 'GET', url, headers: { cookie: who.cookie } });
  const notices = async (who: Who) => (await get(who, '/api/notices')).json() as { notices: Array<Record<string, unknown>> };

  beforeEach(async () => {
    resetDb();
    app = await buildApp();
    admin = await loginAs(app, 'admin@example.com');
    mod = await loginAs(app, 'mod@example.com');
    ann = await loginAs(app, 'ann@example.com'); // club admin
    bob = await loginAs(app, 'bob@example.com'); // club manager
    cat = await loginAs(app, 'cat@example.com'); // club member
    dan = await loginAs(app, 'dan@example.com'); // not in the club
    await db.update(schema.users).set({ isGlobalAdmin: true }).where(eq(schema.users.id, admin.id));
    await db.update(schema.users).set({ isModerator: true }).where(eq(schema.users.id, mod.id));
    ({ id: orgId, slug } = (await post(ann, '/api/orgs', { name: 'Train Club' })).json() as { id: string; slug: string });
    await db.insert(schema.orgMembers).values([
      { orgId, userId: bob.id, role: 'manager', joinedAt: new Date() },
      { orgId, userId: cat.id, role: 'member', joinedAt: new Date() },
    ]);
  });
  afterEach(async () => {
    await app.close();
  });

  describe('site warnings', () => {
    it('a moderator warns a person, who sees it (without who sent it) and acknowledges it', async () => {
      const res = await post(mod, '/api/admin/warnings', { subjectKind: 'user', subjectId: dan.id, severity: 'warning', reason: 'Spam in the catalog', link: '/catalog' });
      expect(res.statusCode).toBe(201);
      const id = (res.json() as { id: string }).id;
      const mine = await notices(dan);
      expect(mine.notices).toHaveLength(1);
      expect(mine.notices[0]).toMatchObject({ id, scope: 'site', severity: 'warning', reason: 'Spam in the catalog', link: '/catalog', acknowledgedAt: null, issuedBy: null });
      // Nobody else can acknowledge it.
      expect((await post(cat, `/api/notices/${id}/acknowledge`)).statusCode).toBe(404);
      expect((await post(dan, `/api/notices/${id}/acknowledge`)).statusCode).toBe(200);
      expect((await notices(dan)).notices[0]!.acknowledgedAt).toEqual(expect.any(Number));
      // The history shows it, acknowledged, with who sent it.
      const hist = (await get(admin, `/api/admin/warnings?subjectKind=user&subjectId=${dan.id}`)).json() as { warnings: Array<Record<string, unknown>> };
      expect(hist.warnings[0]).toMatchObject({ id, acknowledgedAt: expect.any(Number), issuedBy: { id: mod.id } });
      // Audit-logged: the warning and the acknowledgement.
      const audit = await db.select().from(schema.auditEvents).where(and(eq(schema.auditEvents.resourceKind, 'user'), eq(schema.auditEvents.resourceId, dan.id))).all();
      expect(audit.map((a) => a.eventType).sort()).toEqual(['warn', 'warn_ack']);
    });

    it('only site admins and moderators can warn or read the history', async () => {
      const body = { subjectKind: 'user', subjectId: dan.id, severity: 'note', reason: 'Just a note' };
      expect((await post(ann, '/api/admin/warnings', body)).statusCode).toBe(403);
      expect((await get(ann, `/api/admin/warnings?subjectKind=user&subjectId=${dan.id}`)).statusCode).toBe(403);
      expect((await post(admin, '/api/admin/warnings', body)).statusCode).toBe(201);
      expect((await post(mod, '/api/admin/warnings', { ...body, subjectId: mod.id })).statusCode).toBe(400);
      expect((await post(mod, '/api/admin/warnings', { ...body, subjectId: 'nobody' })).statusCode).toBe(404);
      expect((await post(mod, '/api/admin/warnings', { ...body, link: 'https://evil.example' })).statusCode).toBe(400);
    });

    it("a warning to a club reaches its admins and managers, not its members", async () => {
      const res = await post(admin, '/api/admin/warnings', { subjectKind: 'org', subjectId: orgId, severity: 'final', reason: 'Offensive layout names' });
      const id = (res.json() as { id: string }).id;
      expect((await notices(ann)).notices.map((n) => n.id)).toEqual([id]);
      expect((await notices(bob)).notices.map((n) => n.id)).toEqual([id]);
      expect((await notices(bob)).notices[0]).toMatchObject({ to: { kind: 'org', slug } });
      expect((await notices(cat)).notices).toEqual([]);
      expect((await post(cat, `/api/notices/${id}/acknowledge`)).statusCode).toBe(404);
      expect((await post(bob, `/api/notices/${id}/acknowledge`)).statusCode).toBe(200);
    });
  });

  describe('club warnings', () => {
    it('a manager warns a member, who sees it as from the club', async () => {
      const res = await post(bob, `/api/orgs/${slug}/warnings`, { userId: cat.id, severity: 'note', reason: 'Please ask before moving the yard' });
      expect(res.statusCode).toBe(201);
      const n = (await notices(cat)).notices;
      expect(n[0]).toMatchObject({ scope: 'club', club: { slug }, issuedBy: null });
      // The club's runners see what the club sent; members don't.
      expect(((await get(ann, `/api/orgs/${slug}/warnings`)).json() as { warnings: unknown[] }).warnings).toHaveLength(1);
      expect((await get(cat, `/api/orgs/${slug}/warnings`)).statusCode).toBe(403);
      expect((await get(dan, `/api/orgs/${slug}/warnings`)).statusCode).toBe(404);
      // Site admins see it in the person's history; moderators see only site warnings.
      const forAdmin = (await get(admin, `/api/admin/warnings?subjectKind=user&subjectId=${cat.id}`)).json() as { warnings: unknown[] };
      expect(forAdmin.warnings).toHaveLength(1);
      const forMod = (await get(mod, `/api/admin/warnings?subjectKind=user&subjectId=${cat.id}`)).json() as { warnings: unknown[] };
      expect(forMod.warnings).toHaveLength(0);
      const audit = await db.select().from(schema.auditEvents).where(eq(schema.auditEvents.eventType, 'club_warn')).all();
      expect(audit).toHaveLength(1);
    });

    it('managers warn members only; admins warn managers; nobody warns an admin, themselves, or outsiders', async () => {
      const w = (by: Who, userId: string) => post(by, `/api/orgs/${slug}/warnings`, { userId, severity: 'warning', reason: 'Reason here' });
      expect((await w(bob, ann.id)).statusCode).toBe(403);
      expect((await w(ann, bob.id)).statusCode).toBe(201);
      expect((await w(bob, bob.id)).statusCode).toBe(400);
      expect((await w(cat, bob.id)).statusCode).toBe(403);
      // A plain member can't warn another member either.
      await db.insert(schema.orgMembers).values({ orgId, userId: mod.id, role: 'member', joinedAt: new Date() });
      const refused = await w(cat, mod.id);
      expect(refused.statusCode).toBe(403);
      // …and isn't told about admins and managers: just no.
      expect(refused.json()).toEqual({ error: 'forbidden' });
      expect((await w(ann, dan.id)).statusCode).toBe(404);
      expect((await w(dan, cat.id)).statusCode).toBe(404);
      await db.insert(schema.orgMembers).values({ orgId, userId: dan.id, role: 'manager', joinedAt: new Date() });
      expect((await w(bob, dan.id)).statusCode).toBe(403);
    });
  });

  describe('the live hint goes to exactly who may see it', () => {
    async function audienceOf(route: string, ctx: Partial<HintCtx>): Promise<Set<string>> {
      const out = await ROUTE_HINTS[route]!.after({ req: { routeOptions: { url: route.split(' ')[1] }, method: 'POST' } as never, params: {}, body: {}, reply: null, userId: null, before: {}, ...ctx });
      expect(out).toHaveLength(1);
      expect(out[0]!.hint.kind).toBe('warning');
      expect(out[0]!.reach?.ownerless).toBe(true);
      return new Set((out[0]!.reach?.users ?? []).filter((u): u is string => !!u));
    }

    it('a club warning: the member, the club admins and managers, and site admins', async () => {
      const id = ((await post(bob, `/api/orgs/${slug}/warnings`, { userId: cat.id, severity: 'note', reason: 'Reason here' })).json() as { id: string }).id;
      const who = await audienceOf('POST /api/orgs/:slug/warnings', { reply: { id } });
      expect(who).toEqual(new Set([cat.id, ann.id, bob.id, admin.id]));
    });

    it('a site warning to a person: the person, site admins and moderators', async () => {
      const id = ((await post(mod, '/api/admin/warnings', { subjectKind: 'user', subjectId: cat.id, severity: 'note', reason: 'Reason here' })).json() as { id: string }).id;
      const who = await audienceOf('POST /api/admin/warnings', { reply: { id } });
      expect(who).toEqual(new Set([cat.id, admin.id, mod.id]));
      // Acknowledging tells the same people.
      expect(await audienceOf('POST /api/notices/:id/acknowledge', { params: { id } })).toEqual(new Set([cat.id, admin.id, mod.id]));
    });
  });
});

// Pending shares and take-back follow the current owner
// (access/pendingShares.ts): a layout's pending invites go when it changes
// hands, an invite holds only while its sender still manages the layout,
// and an author who handed a layout to someone else doesn't get it back.

import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import fastifyMultipart from '@fastify/multipart';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { attachUser } from '../../auth/cookie.js';
import { registerApiRoutes } from '../all.js';
import { closeAll } from '../../events/hub.js';
import { invalidateLimitCaches } from '../../limits/limits.js';
import { writeAuditEvent } from '../../audit/writeAuditEvent.js';
import { db, loginAs, resetDb, schema } from '../../test/helpers.js';

type Who = { cookie: string; id: string };

describe('pending shares and take-back follow the current owner', () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    app = Fastify({ bodyLimit: 10 * 1024 * 1024 });
    await app.register(cookie);
    await app.register(fastifyMultipart);
    app.addHook('preHandler', attachUser);
    await registerApiRoutes(app);
    await app.ready();
  });
  afterAll(async () => {
    closeAll();
    await app.close();
  });
  beforeEach(() => {
    resetDb();
    invalidateLimitCaches();
  });

  const call = (who: Who, method: 'GET' | 'POST' | 'DELETE', url: string, payload?: object) =>
    app.inject({ method, url, headers: { cookie: who.cookie }, ...(payload ? { payload } : {}) });

  async function club(slug: string, members: [Who, 'admin' | 'manager' | 'member'][]) {
    const id = randomUUID();
    const now = new Date();
    await db.insert(schema.orgs).values({ id, name: slug, slug, createdAt: now, createdBy: members[0]![0].id, membersCanCreate: true });
    for (const [w, role] of members) await db.insert(schema.orgMembers).values({ orgId: id, userId: w.id, role, joinedAt: now });
    return id;
  }
  async function newLayout(who: Who, orgSlug?: string) {
    const r = await call(who, 'POST', '/api/layouts', { title: 'Yard', ...(orgSlug ? { orgSlug } : {}) });
    expect(r.statusCode).toBe(201);
    return (r.json() as { id: string }).id;
  }
  async function handOver(from: Who, to: Who, toEmail: string, layoutId: string) {
    const t = await call(from, 'POST', `/api/layouts/${layoutId}/transfer`, { recipientEmail: toEmail });
    expect(t.statusCode).toBe(200);
    expect((await call(to, 'POST', `/api/transfers/${(t.json() as { token: string }).token}`)).statusCode).toBe(200);
  }
  async function toClub(who: Who, layoutId: string, slug: string) {
    expect((await call(who, 'POST', `/api/layouts/${layoutId}/transfer`, { recipientOrgSlug: slug })).statusCode).toBe(200);
  }
  async function invite(who: Who, layoutId: string, email: string) {
    const r = await call(who, 'POST', `/api/layouts/${layoutId}/invites`, { email, role: 'editor' });
    expect(r.statusCode).toBe(200);
    return r.json() as { id: string; token: string };
  }
  const owner = async (id: string) => db.select().from(schema.layouts).where(eq(schema.layouts.id, id)).get();
  const pendingInvites = async (layoutId: string) => db.select().from(schema.layoutInvites).where(eq(schema.layoutInvites.layoutId, layoutId)).all();
  async function creditOf(who: Who, layoutId: string) {
    const r = await call(who, 'GET', '/api/layouts');
    const all = (r.json() as { layouts: { id: string; credit: { canTakeBack: boolean; canGiveBack: boolean } | null }[] }).layouts;
    return all.find((l) => l.id === layoutId)?.credit;
  }

  // ---- take-back -----------------------------------------------------------
  it('an author who handed a layout to someone else can’t take it back from the club it went to', async () => {
    const alice = await loginAs(app, 'alice@example.com');
    const bob = await loginAs(app, 'bob@example.com');
    const layout = await newLayout(alice);
    await handOver(alice, bob, 'bob@example.com', layout);
    await club('bobs-club', [[bob, 'admin'], [alice, 'member']]);
    await toClub(bob, layout, 'bobs-club');

    expect((await creditOf(alice, layout))?.canTakeBack).toBe(false);
    const take = await call(alice, 'POST', `/api/layouts/${layout}/take-back`);
    expect(take.statusCode).toBe(409);
    expect((take.json() as { error: string }).error).toBe('author_handed_it_over');
    const row = await owner(layout);
    expect(row!.ownerOrgId).not.toBeNull();
    expect(row!.ownerUserId).toBeNull();
  });

  it('nor do the club’s runners give it back to that author', async () => {
    const alice = await loginAs(app, 'alice@example.com');
    const bob = await loginAs(app, 'bob@example.com');
    const layout = await newLayout(alice);
    await handOver(alice, bob, 'bob@example.com', layout);
    await club('bobs-club', [[bob, 'admin'], [alice, 'member']]);
    await toClub(bob, layout, 'bobs-club');

    expect((await creditOf(bob, layout))?.canGiveBack).toBe(false);
    const give = await call(bob, 'POST', `/api/layouts/${layout}/give-back`);
    expect(give.statusCode).toBe(409);
    expect((give.json() as { error: string }).error).toBe('author_handed_it_over');
    expect((await owner(layout))!.ownerUserId).toBeNull();
  });

  it('an author whose layout was handed back to them can still take it back', async () => {
    const alice = await loginAs(app, 'alice@example.com');
    const bob = await loginAs(app, 'bob@example.com');
    const layout = await newLayout(alice);
    await handOver(alice, bob, 'bob@example.com', layout);
    await handOver(bob, alice, 'alice@example.com', layout);
    await club('a-club', [[alice, 'member']]);
    await toClub(alice, layout, 'a-club');

    expect((await creditOf(alice, layout))?.canTakeBack).toBe(true);
    expect((await call(alice, 'POST', `/api/layouts/${layout}/take-back`)).statusCode).toBe(200);
    expect((await owner(layout))!.ownerUserId).toBe(alice.id);
  });

  // ---- pending invites go when the layout changes hands ---------------------
  it('a pending invite goes when the layout is handed to another person', async () => {
    const alice = await loginAs(app, 'alice@example.com');
    const bob = await loginAs(app, 'bob@example.com');
    const layout = await newLayout(alice);
    const inv = await invite(alice, layout, 'carol@example.com');
    await handOver(alice, bob, 'bob@example.com', layout);

    expect(await pendingInvites(layout)).toHaveLength(0);
    const carol = await loginAs(app, 'carol@example.com');
    expect((await call(carol, 'POST', `/api/invites/${inv.token}`)).statusCode).toBe(404);
    expect((await call(carol, 'GET', `/api/layouts/${layout}`)).statusCode).toBe(404);
  });

  it('a pending invite goes when the layout moves into a club', async () => {
    const alice = await loginAs(app, 'alice@example.com');
    const layout = await newLayout(alice);
    const inv = await invite(alice, layout, 'carol@example.com');
    await club('a-club', [[alice, 'member']]);
    await toClub(alice, layout, 'a-club');
    await db.delete(schema.orgMembers).where(eq(schema.orgMembers.userId, alice.id));

    expect(await pendingInvites(layout)).toHaveLength(0);
    const carol = await loginAs(app, 'carol@example.com');
    expect((await call(carol, 'POST', `/api/invites/${inv.token}`)).statusCode).toBe(404);
    expect((await call(carol, 'GET', `/api/layouts/${layout}`)).statusCode).toBe(404);
  });

  it('pending invites go on take-back, give-back and moving everything out of a club', async () => {
    const adm = await loginAs(app, 'adm@example.com');
    const sam = await loginAs(app, 'sam@example.com');
    await club('c', [[adm, 'admin'], [sam, 'member']]);

    const taken = await newLayout(sam, 'c');
    await invite(adm, taken, 'x@example.com');
    expect((await call(sam, 'POST', `/api/layouts/${taken}/take-back`)).statusCode).toBe(200);
    expect(await pendingInvites(taken)).toHaveLength(0);

    const given = await newLayout(sam, 'c');
    await invite(adm, given, 'x@example.com');
    expect((await call(adm, 'POST', `/api/layouts/${given}/give-back`)).statusCode).toBe(200);
    expect(await pendingInvites(given)).toHaveLength(0);

    const moved = await newLayout(sam, 'c');
    await invite(adm, moved, 'x@example.com');
    expect((await call(adm, 'POST', '/api/orgs/c/move-all', { kind: 'layouts', toUserId: sam.id })).statusCode).toBe(200);
    expect(await pendingInvites(moved)).toHaveLength(0);
  });

  // ---- an invite holds while its sender manages the layout -------------------
  it('an invite from a club manager who has since left the club no longer works', async () => {
    const adm = await loginAs(app, 'adm@example.com');
    const mo = await loginAs(app, 'mo@example.com');
    await club('c', [[adm, 'admin'], [mo, 'manager']]);
    const layout = await newLayout(adm, 'c');
    const inv = await invite(mo, layout, 'carol@example.com');
    expect((await db.select().from(schema.layoutInvites).where(eq(schema.layoutInvites.id, inv.id)).get())!.invitedBy).toBe(mo.id);
    expect((await call(adm, 'DELETE', `/api/orgs/c/members/${mo.id}`)).statusCode).toBe(200);

    const carol = await loginAs(app, 'carol@example.com');
    const preview = await call(carol, 'GET', `/api/invites/${inv.token}`);
    expect(preview.statusCode).toBe(410);
    expect((preview.json() as { error: string }).error).toBe('invite_no_longer_valid');
    const acc = await call(carol, 'POST', `/api/invites/${inv.token}`);
    expect(acc.statusCode).toBe(410);
    expect((acc.json() as { error: string }).error).toBe('invite_no_longer_valid');
    expect((await call(carol, 'GET', `/api/layouts/${layout}`)).statusCode).toBe(404);
  });

  it('an invite from someone who still manages the layout works', async () => {
    const adm = await loginAs(app, 'adm@example.com');
    const mo = await loginAs(app, 'mo@example.com');
    await club('c', [[adm, 'admin'], [mo, 'manager']]);
    const layout = await newLayout(adm, 'c');
    const inv = await invite(mo, layout, 'carol@example.com');
    const carol = await loginAs(app, 'carol@example.com');
    expect((await call(carol, 'GET', `/api/invites/${inv.token}`)).statusCode).toBe(200);
    expect((await call(carol, 'POST', `/api/invites/${inv.token}`)).statusCode).toBe(200);
    expect((await call(carol, 'GET', `/api/layouts/${layout}`)).json()).toMatchObject({ role: 'editor' });
  });

  it('an invite made before senders were recorded holds by the audit log’s sender', async () => {
    const alice = await loginAs(app, 'alice@example.com');
    const bob = await loginAs(app, 'bob@example.com');
    const layout = await newLayout(alice);
    const now = new Date();
    const later = new Date(now.getTime() + 86_400_000);
    // One the owner sent (audit row names Alice), one nobody is recorded for.
    const sent = { id: randomUUID(), token: `t-${randomUUID()}` };
    const orphan = { id: randomUUID(), token: `t-${randomUUID()}` };
    for (const i of [sent, orphan]) {
      await db.insert(schema.layoutInvites).values({ id: i.id, layoutId: layout, invitedEmail: 'bob@example.com', role: 'viewer', token: i.token, expiresAt: later });
    }
    await writeAuditEvent({ layoutId: layout, userId: alice.id, eventType: 'share', payload: { invitedEmail: 'bob@example.com', role: 'viewer', inviteId: sent.id } });

    expect((await call(bob, 'POST', `/api/invites/${orphan.token}`)).statusCode).toBe(410);
    expect((await call(bob, 'POST', `/api/invites/${sent.token}`)).statusCode).toBe(200);
    const row = await db
      .select()
      .from(schema.layoutCollaborators)
      .where(and(eq(schema.layoutCollaborators.layoutId, layout), eq(schema.layoutCollaborators.userId, bob.id)))
      .get();
    expect(row?.role).toBe('viewer');
  });
});

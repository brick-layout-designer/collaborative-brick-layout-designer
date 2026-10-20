// Sharing a module by an invite link (routes/moduleInvites.ts): the same
// answer whether or not the address has an account, nobody added before
// they accept, accepted only by the invited verified email, once, before
// it expires, and only while the sender still manages the module.

import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import fastifyMultipart from '@fastify/multipart';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { attachUser } from '../../auth/cookie.js';
import { createSession } from '../../auth/session.js';
import { registerApiRoutes } from '../all.js';
import { closeAll } from '../../events/hub.js';
import { invalidateLimitCaches } from '../../limits/limits.js';
import { db, loginAs, resetDb, schema } from '../../test/helpers.js';

type Who = { cookie: string; id: string };

describe('module invite links', () => {
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

  const call = (who: Who | null, method: 'GET' | 'POST' | 'DELETE', url: string, payload?: object) =>
    app.inject({ method, url, headers: who ? { cookie: who.cookie } : {}, ...(payload ? { payload } : {}) });

  async function newModule(who: Who, orgSlug?: string) {
    const r = await call(who, 'POST', '/api/modules', { title: 'Turntable', ...(orgSlug ? { orgSlug } : {}) });
    expect(r.statusCode).toBe(201);
    return (r.json() as { id: string }).id;
  }
  async function invite(who: Who, moduleId: string, email: string, role: 'viewer' | 'editor' = 'editor') {
    const r = await call(who, 'POST', `/api/modules/${moduleId}/invites`, { email, role });
    expect(r.statusCode).toBe(200);
    return r.json() as { id: string; token: string; inviteUrl: string; emailDelivered: boolean; expiresAt: number };
  }
  async function club(slug: string, members: [Who, 'admin' | 'manager' | 'member'][]) {
    const id = randomUUID();
    const now = new Date();
    await db.insert(schema.orgs).values({ id, name: slug, slug, createdAt: now, createdBy: members[0]![0].id, membersCanCreate: true });
    for (const [w, role] of members) await db.insert(schema.orgMembers).values({ orgId: id, userId: w.id, role, joinedAt: now });
  }
  const myModules = async (who: Who) => ((await call(who, 'GET', '/api/modules')).json() as { modules: { id: string }[] }).modules.map((m) => m.id);
  const errorOf = (r: { json: () => unknown }) => (r.json() as { error: string }).error;

  it('answers the same whether or not the address has an account, and adds nobody yet', async () => {
    const alice = await loginAs(app, 'alice@example.com');
    const bob = await loginAs(app, 'bob@example.com');
    const id = await newModule(alice);
    const known = await call(alice, 'POST', `/api/modules/${id}/invites`, { email: 'bob@example.com', role: 'viewer' });
    const unknown = await call(alice, 'POST', `/api/modules/${id}/invites`, { email: 'nobody@example.com', role: 'viewer' });
    expect(known.statusCode).toBe(200);
    expect(unknown.statusCode).toBe(200);
    expect(Object.keys(known.json() as object).sort()).toEqual(Object.keys(unknown.json() as object).sort());
    expect(await myModules(bob)).not.toContain(id);
    expect(await db.select().from(schema.moduleCollaborators).all()).toHaveLength(0);
  });

  it('the invited person previews it, accepts it, and has the module with the invited role', async () => {
    const alice = await loginAs(app, 'alice@example.com');
    const id = await newModule(alice);
    const inv = await invite(alice, id, 'Bob@Example.com', 'viewer');
    expect(inv.inviteUrl.endsWith(`/module-invite/${inv.token}`)).toBe(true);
    expect(inv.token).toMatch(/^[0-9a-f]{48}$/);

    // Signed out, the address is masked.
    const preview = await call(null, 'GET', `/api/module-invites/${inv.token}`);
    expect(preview.statusCode).toBe(200);
    expect(preview.json()).toMatchObject({ role: 'viewer', moduleId: id, moduleTitle: 'Turntable', forYou: null });
    expect((preview.json() as { invitedEmail: string }).invitedEmail).not.toBe('bob@example.com');

    const bob = await loginAs(app, 'bob@example.com');
    expect((await call(bob, 'GET', `/api/module-invites/${inv.token}`)).json()).toMatchObject({ invitedEmail: 'bob@example.com', forYou: true });
    const acc = await call(bob, 'POST', `/api/module-invites/${inv.token}`);
    expect(acc.statusCode).toBe(200);
    expect(acc.json()).toEqual({ moduleId: id, role: 'viewer' });
    expect(await myModules(bob)).toContain(id);
    expect((await call(bob, 'GET', `/api/modules/${id}`)).json()).toMatchObject({ role: 'viewer' });

    // Single use.
    const again = await call(bob, 'POST', `/api/module-invites/${inv.token}`);
    expect(again.statusCode).toBe(410);
    expect(errorOf(again)).toBe('invite_already_accepted');
  });

  it('is refused for another account, an unverified one, once expired, once cancelled, or signed out', async () => {
    const alice = await loginAs(app, 'alice@example.com');
    const eve = await loginAs(app, 'eve@example.com');
    const id = await newModule(alice);
    const inv = await invite(alice, id, 'bob@example.com');

    expect((await call(null, 'POST', `/api/module-invites/${inv.token}`)).statusCode).toBe(401);
    const wrong = await call(eve, 'POST', `/api/module-invites/${inv.token}`);
    expect(wrong.statusCode).toBe(403);
    expect(errorOf(wrong)).toBe('email_mismatch');

    const squatterId = randomUUID();
    await db.insert(schema.users).values({ id: squatterId, email: 'bob@example.com', displayName: 'bob', passwordHash: null, emailVerified: false, createdAt: new Date() });
    const squatter = { cookie: `cld_session=${(await createSession(squatterId)).token}`, id: squatterId };
    const unverified = await call(squatter, 'POST', `/api/module-invites/${inv.token}`);
    expect(unverified.statusCode).toBe(403);
    expect(errorOf(unverified)).toBe('email_not_verified');
    expect(await db.select().from(schema.moduleCollaborators).all()).toHaveLength(0);
    await db.delete(schema.users).where(eq(schema.users.id, squatterId));

    const bob = await loginAs(app, 'bob@example.com');
    await db.update(schema.moduleInvites).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(schema.moduleInvites.id, inv.id));
    const expired = await call(bob, 'POST', `/api/module-invites/${inv.token}`);
    expect(expired.statusCode).toBe(410);
    expect(errorOf(expired)).toBe('invite_expired');

    const inv2 = await invite(alice, id, 'bob@example.com');
    expect((await call(alice, 'DELETE', `/api/modules/${id}/invites/${inv2.id}`)).statusCode).toBe(200);
    expect((await call(bob, 'POST', `/api/module-invites/${inv2.token}`)).statusCode).toBe(404);
    expect(await myModules(bob)).not.toContain(id);
  });

  it('holds only while its sender still manages the module', async () => {
    const adm = await loginAs(app, 'adm@example.com');
    const mo = await loginAs(app, 'mo@example.com');
    await club('c', [[adm, 'admin'], [mo, 'manager']]);
    const id = await newModule(adm, 'c');
    const inv = await invite(mo, id, 'carol@example.com');
    expect((await call(adm, 'DELETE', `/api/orgs/c/members/${mo.id}`)).statusCode).toBe(200);

    const carol = await loginAs(app, 'carol@example.com');
    const preview = await call(carol, 'GET', `/api/module-invites/${inv.token}`);
    expect(preview.statusCode).toBe(410);
    expect(errorOf(preview)).toBe('module_invite_no_longer_valid');
    const acc = await call(carol, 'POST', `/api/module-invites/${inv.token}`);
    expect(acc.statusCode).toBe(410);
    expect(await myModules(carol)).not.toContain(id);
  });

  it('pending invites go when the module moves into a club or is taken back', async () => {
    const sam = await loginAs(app, 'sam@example.com');
    await club('c', [[sam, 'member']]);
    const id = await newModule(sam);
    await invite(sam, id, 'carol@example.com');
    expect((await call(sam, 'POST', `/api/modules/${id}/transfer`, { recipientOrgSlug: 'c' })).statusCode).toBe(200);
    expect(await db.select().from(schema.moduleInvites).all()).toHaveLength(0);

    const adm = await loginAs(app, 'adm@example.com');
    await db.insert(schema.orgMembers).values({ orgId: (await db.select().from(schema.orgs).get())!.id, userId: adm.id, role: 'admin', joinedAt: new Date() });
    await invite(adm, id, 'carol@example.com');
    expect((await call(sam, 'POST', `/api/modules/${id}/take-back`)).statusCode).toBe(200);
    expect(await db.select().from(schema.moduleInvites).all()).toHaveLength(0);
  });

  it('its owners see pending invites on the share list and cancel them; others see none', async () => {
    const alice = await loginAs(app, 'alice@example.com');
    const bob = await loginAs(app, 'bob@example.com');
    const id = await newModule(alice);
    const other = await newModule(bob);
    await db.insert(schema.moduleCollaborators).values({ moduleId: id, userId: bob.id, role: 'viewer', addedAt: new Date() });
    const first = await invite(alice, id, 'carol@example.com', 'viewer');
    // Inviting the same address again replaces the waiting invite.
    const inv = await invite(alice, id, 'carol@example.com', 'editor');
    expect((await call(alice, 'POST', `/api/module-invites/${first.token}`)).statusCode).toBe(404);

    const list = (await call(alice, 'GET', `/api/modules/${id}/collaborators`)).json() as { invites: { id: string; invitedEmail: string; role: string }[] };
    expect(list.invites).toEqual([expect.objectContaining({ id: inv.id, invitedEmail: 'carol@example.com', role: 'editor' })]);
    const asViewer = (await call(bob, 'GET', `/api/modules/${id}/collaborators`)).json() as { invites: unknown[] };
    expect(asViewer.invites).toEqual([]);
    // Someone already on the list needs a role change, not an invite.
    expect((await call(alice, 'POST', `/api/modules/${id}/invites`, { email: 'bob@example.com', role: 'editor' })).statusCode).toBe(409);
    // A viewer can't invite or cancel.
    expect((await call(bob, 'POST', `/api/modules/${id}/invites`, { email: 'dan@example.com', role: 'viewer' })).statusCode).toBe(403);
    expect((await call(bob, 'DELETE', `/api/modules/${id}/invites/${inv.id}`)).statusCode).toBe(403);
    // Cancelling through another module does nothing.
    await call(bob, 'DELETE', `/api/modules/${other}/invites/${inv.id}`);
    expect(await db.select().from(schema.moduleInvites).where(eq(schema.moduleInvites.id, inv.id)).get()).toBeTruthy();
    expect((await call(alice, 'DELETE', `/api/modules/${id}/invites/${inv.id}`)).statusCode).toBe(200);
    expect(((await call(alice, 'GET', `/api/modules/${id}/collaborators`)).json() as { invites: unknown[] }).invites).toEqual([]);
  });
});

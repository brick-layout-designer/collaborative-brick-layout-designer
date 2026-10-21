// Sharing a custom part by an invite link (routes/customPartInvites.ts):
// the same answer whether or not the address has an account, nobody added
// before they accept, accepted only by the invited verified email, once,
// before it expires, only while the sender still manages the part, and
// pending invites go when the part changes hands. People a part was shared
// with before invite links keep it.

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

const FAKE_GIF = Buffer.from('GIF89a    \xff\xff\xff   !\xf9    ,       D ;', 'binary').toString('base64');
const SAMPLE_XML = Buffer.from('<?xml version="1.0"?><part/>').toString('base64');

describe('custom part invite links', () => {
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

  let n = 0;
  async function newPart(who: Who, orgSlug?: string) {
    const partNumber = `CP${++n}`;
    const r = await call(who, 'POST', '/api/custom-parts', {
      partNumber,
      displayName: 'Signal tower',
      xmlBase64: SAMPLE_XML,
      spriteBase64: FAKE_GIF,
      spriteMime: 'image/gif',
      ...(orgSlug ? { orgSlug } : {}),
    });
    expect(r.statusCode).toBe(201);
    return (r.json() as { id: string }).id;
  }
  async function invite(who: Who, partId: string, email: string, role: 'viewer' | 'editor' = 'editor') {
    const r = await call(who, 'POST', `/api/custom-parts/${partId}/invites`, { email, role });
    expect(r.statusCode).toBe(200);
    return r.json() as { id: string; token: string; inviteUrl: string; emailDelivered: boolean; expiresAt: number };
  }
  async function club(slug: string, members: [Who, 'admin' | 'manager' | 'member'][]) {
    const id = randomUUID();
    const now = new Date();
    await db.insert(schema.orgs).values({ id, name: slug, slug, createdAt: now, createdBy: members[0]![0].id, membersCanCreate: true });
    for (const [w, role] of members) await db.insert(schema.orgMembers).values({ orgId: id, userId: w.id, role, joinedAt: now });
    return id;
  }
  const myParts = async (who: Who) => ((await call(who, 'GET', '/api/custom-parts')).json() as { parts: { id: string }[] }).parts.map((p) => p.id);
  const errorOf = (r: { json: () => unknown }) => (r.json() as { error: string }).error;
  const pending = async () => db.select().from(schema.customPartInvites).all();

  it('answers the same whether or not the address has an account, and adds nobody yet', async () => {
    const alice = await loginAs(app, 'alice@example.com');
    const bob = await loginAs(app, 'bob@example.com');
    const id = await newPart(alice);
    const known = await call(alice, 'POST', `/api/custom-parts/${id}/invites`, { email: 'bob@example.com', role: 'viewer' });
    const unknown = await call(alice, 'POST', `/api/custom-parts/${id}/invites`, { email: 'nobody@example.com', role: 'viewer' });
    expect(known.statusCode).toBe(200);
    expect(unknown.statusCode).toBe(200);
    expect(Object.keys(known.json() as object).sort()).toEqual(Object.keys(unknown.json() as object).sort());
    expect(await myParts(bob)).not.toContain(id);
    expect(await db.select().from(schema.customPartCollaborators).all()).toHaveLength(0);
  });

  it('the invited person previews it, accepts it, and has the part with the invited role', async () => {
    const alice = await loginAs(app, 'alice@example.com');
    const id = await newPart(alice);
    const inv = await invite(alice, id, 'Bob@Example.com', 'viewer');
    expect(inv.inviteUrl.endsWith(`/part-invite/${inv.token}`)).toBe(true);
    expect(inv.token).toMatch(/^[0-9a-f]{48}$/);

    // Signed out, the address is masked.
    const preview = await call(null, 'GET', `/api/part-invites/${inv.token}`);
    expect(preview.statusCode).toBe(200);
    expect(preview.json()).toMatchObject({ role: 'viewer', partId: id, partName: 'Signal tower', invitedEmail: 'b…@example.com', forYou: null });

    const bob = await loginAs(app, 'bob@example.com');
    expect((await call(bob, 'GET', `/api/part-invites/${inv.token}`)).json()).toMatchObject({ invitedEmail: 'bob@example.com', forYou: true });
    const acc = await call(bob, 'POST', `/api/part-invites/${inv.token}`);
    expect(acc.statusCode).toBe(200);
    expect(acc.json()).toEqual({ partId: id, role: 'viewer' });
    expect(await myParts(bob)).toContain(id);
    expect((await call(bob, 'GET', `/api/custom-parts/${id}`)).json()).toMatchObject({ role: 'viewer' });

    // Single use.
    const again = await call(bob, 'POST', `/api/part-invites/${inv.token}`);
    expect(again.statusCode).toBe(410);
    expect(errorOf(again)).toBe('invite_already_accepted');
  });

  it('is refused for another account, an unverified one, once expired, once cancelled, or signed out', async () => {
    const alice = await loginAs(app, 'alice@example.com');
    const eve = await loginAs(app, 'eve@example.com');
    const id = await newPart(alice);
    const inv = await invite(alice, id, 'bob@example.com');

    expect((await call(null, 'POST', `/api/part-invites/${inv.token}`)).statusCode).toBe(401);
    const wrong = await call(eve, 'POST', `/api/part-invites/${inv.token}`);
    expect(wrong.statusCode).toBe(403);
    expect(errorOf(wrong)).toBe('email_mismatch');
    expect((await call(eve, 'GET', `/api/part-invites/${inv.token}`)).json()).toMatchObject({ invitedEmail: 'b…@example.com', forYou: false });

    const squatterId = randomUUID();
    await db.insert(schema.users).values({ id: squatterId, email: 'bob@example.com', displayName: 'bob', passwordHash: null, emailVerified: false, createdAt: new Date() });
    const squatter = { cookie: `cld_session=${(await createSession(squatterId)).token}`, id: squatterId };
    const unverified = await call(squatter, 'POST', `/api/part-invites/${inv.token}`);
    expect(unverified.statusCode).toBe(403);
    expect(errorOf(unverified)).toBe('email_not_verified');
    expect(await db.select().from(schema.customPartCollaborators).all()).toHaveLength(0);
    await db.delete(schema.users).where(eq(schema.users.id, squatterId));

    const bob = await loginAs(app, 'bob@example.com');
    await db.update(schema.customPartInvites).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(schema.customPartInvites.id, inv.id));
    const expired = await call(bob, 'POST', `/api/part-invites/${inv.token}`);
    expect(expired.statusCode).toBe(410);
    expect(errorOf(expired)).toBe('invite_expired');

    const inv2 = await invite(alice, id, 'bob@example.com');
    expect((await call(alice, 'DELETE', `/api/custom-parts/${id}/invites/${inv2.id}`)).statusCode).toBe(200);
    expect((await call(bob, 'POST', `/api/part-invites/${inv2.token}`)).statusCode).toBe(404);
    expect(await myParts(bob)).not.toContain(id);
  });

  it('holds only while its sender still manages the part', async () => {
    const adm = await loginAs(app, 'adm@example.com');
    const mo = await loginAs(app, 'mo@example.com');
    await club('c', [[adm, 'admin'], [mo, 'manager']]);
    const id = await newPart(adm, 'c');
    const inv = await invite(mo, id, 'carol@example.com');
    expect((await call(adm, 'DELETE', `/api/orgs/c/members/${mo.id}`)).statusCode).toBe(200);

    const carol = await loginAs(app, 'carol@example.com');
    const preview = await call(carol, 'GET', `/api/part-invites/${inv.token}`);
    expect(preview.statusCode).toBe(410);
    expect(errorOf(preview)).toBe('part_invite_no_longer_valid');
    const acc = await call(carol, 'POST', `/api/part-invites/${inv.token}`);
    expect(acc.statusCode).toBe(410);
    expect(await myParts(carol)).not.toContain(id);
  });

  it('pending invites go when the part moves into a club, is taken back or given back', async () => {
    const sam = await loginAs(app, 'sam@example.com');
    const adm = await loginAs(app, 'adm@example.com');
    await club('c', [[adm, 'admin'], [sam, 'member']]);

    // Moved into a club.
    const id = await newPart(sam);
    await invite(sam, id, 'carol@example.com');
    expect((await call(sam, 'POST', `/api/custom-parts/${id}/move`, { orgSlug: 'c' })).statusCode).toBe(200);
    expect(await pending()).toHaveLength(0);

    // Taken back by its author.
    await invite(adm, id, 'carol@example.com');
    expect((await call(sam, 'POST', `/api/custom-parts/${id}/take-back`)).statusCode).toBe(200);
    expect(await pending()).toHaveLength(0);

    // Given back by the club.
    const other = await newPart(sam);
    expect((await call(sam, 'POST', `/api/custom-parts/${other}/move`, { orgSlug: 'c' })).statusCode).toBe(200);
    await invite(adm, other, 'carol@example.com');
    expect((await call(adm, 'POST', `/api/custom-parts/${other}/give-back`)).statusCode).toBe(200);
    expect(await pending()).toHaveLength(0);
  });

  it('its owners see pending invites on the share list and cancel them; others see none', async () => {
    const alice = await loginAs(app, 'alice@example.com');
    const bob = await loginAs(app, 'bob@example.com');
    const id = await newPart(alice);
    const other = await newPart(bob);
    await db.insert(schema.customPartCollaborators).values({ customPartId: id, userId: bob.id, role: 'viewer', addedAt: new Date() });
    const first = await invite(alice, id, 'carol@example.com', 'viewer');
    // Inviting the same address again replaces the waiting invite.
    const inv = await invite(alice, id, 'carol@example.com', 'editor');
    expect((await call(alice, 'POST', `/api/part-invites/${first.token}`)).statusCode).toBe(404);

    const list = (await call(alice, 'GET', `/api/custom-parts/${id}/collaborators`)).json() as { invites: { id: string; invitedEmail: string; role: string }[] };
    expect(list.invites).toEqual([expect.objectContaining({ id: inv.id, invitedEmail: 'carol@example.com', role: 'editor' })]);
    const asViewer = (await call(bob, 'GET', `/api/custom-parts/${id}/collaborators`)).json() as { invites: unknown[] };
    expect(asViewer.invites).toEqual([]);
    // Someone already on the list needs a role change, not an invite.
    expect((await call(alice, 'POST', `/api/custom-parts/${id}/invites`, { email: 'bob@example.com', role: 'editor' })).statusCode).toBe(409);
    // A viewer can't invite or cancel.
    expect((await call(bob, 'POST', `/api/custom-parts/${id}/invites`, { email: 'dan@example.com', role: 'viewer' })).statusCode).toBe(403);
    expect((await call(bob, 'DELETE', `/api/custom-parts/${id}/invites/${inv.id}`)).statusCode).toBe(403);
    // Cancelling through another part does nothing.
    await call(bob, 'DELETE', `/api/custom-parts/${other}/invites/${inv.id}`);
    expect(await db.select().from(schema.customPartInvites).where(eq(schema.customPartInvites.id, inv.id)).get()).toBeTruthy();
    expect((await call(alice, 'DELETE', `/api/custom-parts/${id}/invites/${inv.id}`)).statusCode).toBe(200);
    expect(((await call(alice, 'GET', `/api/custom-parts/${id}/collaborators`)).json() as { invites: unknown[] }).invites).toEqual([]);
  });

  it('people a part was shared with before invite links keep it', async () => {
    const alice = await loginAs(app, 'alice@example.com');
    const bob = await loginAs(app, 'bob@example.com');
    const id = await newPart(alice);
    // A share made by the old direct-add route: a collaborator row, no invite.
    await db.insert(schema.customPartCollaborators).values({ customPartId: id, userId: bob.id, role: 'editor', addedAt: new Date() });
    expect(await myParts(bob)).toContain(id);
    expect((await call(bob, 'GET', `/api/custom-parts/${id}`)).json()).toMatchObject({ role: 'editor' });
    // Inviting someone else leaves them be.
    await invite(alice, id, 'carol@example.com');
    const list = (await call(alice, 'GET', `/api/custom-parts/${id}/collaborators`)).json() as { collaborators: { userId: string; role: string }[] };
    expect(list.collaborators).toEqual([expect.objectContaining({ userId: bob.id, role: 'editor' })]);
  });

  it('an invite with no recorded sender (made before invite links) never holds', async () => {
    const alice = await loginAs(app, 'alice@example.com');
    const id = await newPart(alice);
    await db.insert(schema.customPartInvites).values({ id: randomUUID(), customPartId: id, invitedEmail: 'bob@example.com', role: 'viewer', token: 'legacy', expiresAt: new Date(Date.now() + 86_400_000) });
    const bob = await loginAs(app, 'bob@example.com');
    const acc = await call(bob, 'POST', '/api/part-invites/legacy');
    expect(acc.statusCode).toBe(410);
    expect(errorOf(acc)).toBe('part_invite_no_longer_valid');
  });
});

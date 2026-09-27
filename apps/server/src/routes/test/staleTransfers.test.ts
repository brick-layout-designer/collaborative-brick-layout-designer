// Regression tests: a transfer / invite token must only be redeemable
// while the authority that issued it still holds.
//   - layout + module user->user transfers: initiator must still own it
//   - any ownership change voids the other pending transfers
//   - org invites: the inviter must still be an org admin

import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import { and, eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { db, loginAs, resetDb, schema } from '../../test/helpers.js';
import { attachUser } from '../../auth/cookie.js';
import { passwordRoutes } from '../auth/password.js';
import { orgRoutes } from '../orgs.js';
import { orgInviteRoutes } from '../orgInvites.js';
import { layoutRoutes } from '../layouts.js';
import { transferRoutes } from '../transfers.js';
import { moduleRoutes } from '../modules.js';
import { moduleTransferRoutes } from '../moduleTransfers.js';

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ bodyLimit: 10 * 1024 * 1024 });
  await app.register(cookie);
  app.addHook('preHandler', attachUser);
  await app.register(passwordRoutes);
  await app.register(orgRoutes);
  await app.register(orgInviteRoutes);
  await app.register(layoutRoutes);
  await app.register(transferRoutes);
  await app.register(moduleRoutes);
  await app.register(moduleTransferRoutes);
  return app;
}

type Who = { cookie: string; id: string };

async function post(app: FastifyInstance, who: Who, url: string, payload: object = {}) {
  return app.inject({ method: 'POST', url, headers: { cookie: who.cookie }, payload });
}

describe('stale transfer / invite tokens', () => {
  let app: FastifyInstance;
  let alice: Who;
  let bob: Who;
  let carol: Who;

  beforeEach(async () => {
    resetDb();
    app = await buildApp();
    alice = await loginAs(app, 'alice@x.com');
    bob = await loginAs(app, 'bob@x.com');
    carol = await loginAs(app, 'carol@x.com');
  });

  it('once one layout transfer is accepted, the other pending token cannot take the layout', async () => {
    const L = (await post(app, alice, '/api/layouts', { title: 't' })).json().id as string;
    const t1 = (await post(app, alice, `/api/layouts/${L}/transfer`, { recipientEmail: 'bob@x.com' })).json().token;
    const t2 = (await post(app, alice, `/api/layouts/${L}/transfer`, { recipientEmail: 'carol@x.com' })).json().token;

    expect((await post(app, bob, `/api/transfers/${t1}`)).statusCode).toBe(200);
    const r2 = await post(app, carol, `/api/transfers/${t2}`);
    expect([404, 409]).toContain(r2.statusCode);

    const row = await db.select().from(schema.layouts).where(eq(schema.layouts.id, L)).get();
    expect(row!.ownerUserId).toBe(bob.id);
  });

  it('a pending user transfer cannot pull a layout back out of an org', async () => {
    await post(app, carol, '/api/orgs', { name: 'Org' });
    const L = (await post(app, carol, '/api/layouts', { title: 't2' })).json().id as string;
    const t = (await post(app, carol, `/api/layouts/${L}/transfer`, { recipientEmail: 'bob@x.com' })).json().token;
    expect((await post(app, carol, `/api/layouts/${L}/transfer`, { recipientOrgSlug: 'org' })).statusCode).toBe(200);

    const r = await post(app, bob, `/api/transfers/${t}`);
    expect([404, 409]).toContain(r.statusCode);
    const row = await db.select().from(schema.layouts).where(eq(schema.layouts.id, L)).get();
    expect(row!.ownerUserId).toBeNull();
    expect(row!.ownerOrgId).not.toBeNull();
  });

  it('rejects a transfer whose initiator no longer owns the layout (409)', async () => {
    const L = (await post(app, alice, '/api/layouts', { title: 't' })).json().id as string;
    const t = (await post(app, alice, `/api/layouts/${L}/transfer`, { recipientEmail: 'bob@x.com' })).json().token;
    // Ownership changes behind the token's back (e.g. an admin tool).
    await db.update(schema.layouts).set({ ownerUserId: carol.id }).where(eq(schema.layouts.id, L));
    const r = await post(app, bob, `/api/transfers/${t}`);
    expect(r.statusCode).toBe(409);
    expect(r.json().error).toBe('transfer_stale');
    const row = await db.select().from(schema.layouts).where(eq(schema.layouts.id, L)).get();
    expect(row!.ownerUserId).toBe(carol.id);
  });

  it('module transfers: a stale token cannot take a module from its new owner', async () => {
    const M = (await post(app, alice, '/api/modules', { title: 'm' })).json().id as string;
    const t1 = (await post(app, alice, `/api/modules/${M}/transfer`, { recipientEmail: 'bob@x.com' })).json().token;
    const t2 = (await post(app, alice, `/api/modules/${M}/transfer`, { recipientEmail: 'carol@x.com' })).json().token;
    expect((await post(app, bob, `/api/module-transfers/${t1}`)).statusCode).toBe(200);
    const r2 = await post(app, carol, `/api/module-transfers/${t2}`);
    expect([404, 409]).toContain(r2.statusCode);
    const row = await db.select().from(schema.modules).where(eq(schema.modules.id, M)).get();
    expect(row!.ownerUserId).toBe(bob.id);
  });

  it('org invites issued by an admin who was later demoted are void', async () => {
    const org = (await post(app, alice, '/api/orgs', { name: 'Acme' })).json() as { id: string; slug: string };
    const slug = org.slug ?? 'acme';
    // Alice makes Bob an admin; Bob invites Carol as admin.
    const inv = (await post(app, alice, `/api/orgs/${slug}/invites`, { email: 'bob@x.com', role: 'admin' })).json();
    expect((await post(app, bob, `/api/org-invites/${inv.token}`)).statusCode).toBe(200);
    const bobsInvite = (await post(app, bob, `/api/orgs/${slug}/invites`, { email: 'carol@x.com', role: 'admin' })).json();
    expect(bobsInvite.token).toBeTruthy();

    // Alice demotes Bob.
    const demote = await app.inject({
      method: 'PATCH',
      url: `/api/orgs/${slug}/members/${bob.id}`,
      headers: { cookie: alice.cookie },
      payload: { role: 'member' },
    });
    expect(demote.statusCode).toBe(200);

    const r = await post(app, carol, `/api/org-invites/${bobsInvite.token}`);
    expect(r.statusCode).toBe(409);
    const orgRow = await db.select().from(schema.orgs).where(eq(schema.orgs.slug, slug)).get();
    const m = await db
      .select()
      .from(schema.orgMembers)
      .where(and(eq(schema.orgMembers.orgId, orgRow!.id), eq(schema.orgMembers.userId, carol.id)))
      .get();
    expect(m).toBeUndefined();
  });
});

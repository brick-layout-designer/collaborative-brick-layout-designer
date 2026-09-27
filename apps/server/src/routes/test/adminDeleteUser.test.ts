// Regression test: DELETE /api/admin/users/:id used to 500 (FOREIGN KEY
// constraint failed) for any user referenced by a column without an
// ON DELETE action — created_by, initiated_by, invited_by.

import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { db, loginAs, resetDb, schema } from '../../test/helpers.js';
import { attachUser } from '../../auth/cookie.js';
import { passwordRoutes } from '../auth/password.js';
import { layoutRoutes } from '../layouts.js';
import { orgRoutes } from '../orgs.js';
import { adminRoutes } from '../admin.js';
import { transferRoutes } from '../transfers.js';
import { moduleRoutes } from '../modules.js';
import { moduleTransferRoutes } from '../moduleTransfers.js';

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify();
  await app.register(cookie);
  app.addHook('preHandler', attachUser);
  await app.register(passwordRoutes);
  await app.register(layoutRoutes);
  await app.register(orgRoutes);
  await app.register(adminRoutes);
  await app.register(transferRoutes);
  await app.register(moduleRoutes);
  await app.register(moduleTransferRoutes);
  return app;
}

describe('DELETE /api/admin/users/:id', () => {
  beforeEach(() => resetDb());

  it('deletes a user who created org content, sent invites and started transfers', async () => {
    const app = await buildApp();
    const admin = await loginAs(app, 'admin@x.com');
    await db.update(schema.users).set({ isGlobalAdmin: true }).where(eq(schema.users.id, admin.id));
    const u = await loginAs(app, 'u@x.com');
    const bob = await loginAs(app, 'bob@x.com');
    const h = { cookie: u.cookie };

    await app.inject({ method: 'POST', url: '/api/orgs', headers: h, payload: { name: 'Org' } });
    const orgLayout = (
      await app.inject({ method: 'POST', url: '/api/layouts', headers: h, payload: { orgSlug: 'org' } })
    ).json().id as string;
    const orgModule = (
      await app.inject({ method: 'POST', url: '/api/modules', headers: h, payload: { title: 'm', orgSlug: 'org' } })
    ).json().id as string;
    await app.inject({ method: 'POST', url: '/api/orgs/org/invites', headers: h, payload: { email: 'z@x.com', role: 'member' } });
    // A layout u created and handed to Bob (so u is only created_by).
    const given = (await app.inject({ method: 'POST', url: '/api/layouts', headers: h, payload: {} })).json().id as string;
    const t = (await app.inject({ method: 'POST', url: `/api/layouts/${given}/transfer`, headers: h, payload: { recipientEmail: 'bob@x.com' } })).json().token;
    expect((await app.inject({ method: 'POST', url: `/api/transfers/${t}`, headers: { cookie: bob.cookie } })).statusCode).toBe(200);
    // A pending module transfer from u.
    const mine = (await app.inject({ method: 'POST', url: '/api/modules', headers: h, payload: { title: 'p' } })).json().id as string;
    await app.inject({ method: 'POST', url: `/api/modules/${mine}/transfer`, headers: h, payload: { recipientEmail: 'bob@x.com' } });

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/admin/users/${u.id}`,
      headers: { cookie: admin.cookie },
    });
    expect(res.statusCode).toBe(200);

    expect(await db.select().from(schema.users).where(eq(schema.users.id, u.id)).get()).toBeUndefined();
    // Org-owned content survives, re-attributed to the acting admin.
    const ol = await db.select().from(schema.layouts).where(eq(schema.layouts.id, orgLayout)).get();
    expect(ol!.createdBy).toBe(admin.id);
    const om = await db.select().from(schema.modules).where(eq(schema.modules.id, orgModule)).get();
    expect(om!.createdBy).toBe(admin.id);
    // Personally-owned content goes to its current owner.
    const gl = await db.select().from(schema.layouts).where(eq(schema.layouts.id, given)).get();
    expect(gl!.createdBy).toBe(bob.id);
    // u's own module cascaded away; their invites/transfers are gone.
    expect(await db.select().from(schema.modules).where(eq(schema.modules.id, mine)).get()).toBeUndefined();
    expect(await db.select().from(schema.orgInvites).all()).toHaveLength(0);
    expect(await db.select().from(schema.moduleTransfers).all()).toHaveLength(0);
    await app.close();
  });
});

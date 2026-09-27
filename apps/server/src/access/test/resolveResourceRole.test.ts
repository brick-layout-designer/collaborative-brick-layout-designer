// Regression tests for resolveResourceRole's handling of global custom
// parts. A global part must be *visible* (viewer) to every signed-in user
// without making that user its owner.

import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { db, loginAs, resetDb, schema } from '../../test/helpers.js';
import { attachUser } from '../../auth/cookie.js';
import { passwordRoutes } from '../../routes/auth/password.js';
import { customPartRoutes } from '../../routes/customParts.js';
import { resolveResourceRole } from '../resolveResourceRole.js';

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ bodyLimit: 10 * 1024 * 1024 });
  await app.register(cookie);
  app.addHook('preHandler', attachUser);
  await app.register(passwordRoutes);
  await app.register(customPartRoutes);
  return app;
}

async function insertGlobalPart(ownerUserId: string | null, createdBy: string): Promise<string> {
  const id = randomUUID();
  const now = new Date();
  await db.insert(schema.customParts).values({
    id,
    partNumber: `G-${id.slice(0, 6)}`,
    displayName: 'Global',
    ownerUserId,
    ownerOrgId: null,
    createdBy,
    isGlobal: true,
    xmlBlob: Buffer.from('<part/>'),
    spriteBlob: Buffer.from('GIF89a'),
    spriteMime: 'image/gif',
    createdAt: now,
    updatedAt: now,
  });
  return id;
}

describe('resolveResourceRole — global custom parts', () => {
  beforeEach(() => resetDb());

  it('gives a non-owner viewer (not owner) on a global part', async () => {
    const app = await buildApp();
    const admin = await loginAs(app, 'admin@x.com');
    const eve = await loginAs(app, 'eve@x.com');
    const id = await insertGlobalPart(admin.id, admin.id);

    expect((await resolveResourceRole(eve.id, 'custom_part', id)).role).toBe('viewer');
    // The real owner keeps owner.
    expect((await resolveResourceRole(admin.id, 'custom_part', id)).role).toBe('owner');
    await app.close();
  });

  it('admin-created global parts (no owner row) are viewer for everyone', async () => {
    const app = await buildApp();
    const admin = await loginAs(app, 'admin@x.com');
    const id = await insertGlobalPart(null, admin.id);
    expect((await resolveResourceRole(admin.id, 'custom_part', id)).role).toBe('viewer');
    await app.close();
  });

  it('an explicit editor share on a global part is still honoured', async () => {
    const app = await buildApp();
    const admin = await loginAs(app, 'admin@x.com');
    const bob = await loginAs(app, 'bob@x.com');
    const id = await insertGlobalPart(admin.id, admin.id);
    await db.insert(schema.customPartCollaborators).values({
      customPartId: id,
      userId: bob.id,
      role: 'editor',
      addedAt: new Date(),
    });
    expect((await resolveResourceRole(bob.id, 'custom_part', id)).role).toBe('editor');
    await app.close();
  });

  it('a non-owner cannot DELETE a global part', async () => {
    const app = await buildApp();
    const admin = await loginAs(app, 'admin@x.com');
    const eve = await loginAs(app, 'eve@x.com');
    const id = await insertGlobalPart(admin.id, admin.id);

    const del = await app.inject({
      method: 'DELETE',
      url: `/api/custom-parts/${id}`,
      headers: { cookie: eve.cookie },
    });
    expect(del.statusCode).toBe(403);
    const row = await db.select().from(schema.customParts).where(eq(schema.customParts.id, id)).get();
    expect(row).toBeDefined();
    await app.close();
  });
});

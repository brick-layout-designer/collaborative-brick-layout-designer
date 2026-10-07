// The Catalog page's lists: every kind that's on at once (`kind=all`), a
// page at a time (`limit`, `offset`, `nextOffset`), and the old default
// (200, one kind) for the desktop app.

import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, resetDb, schema } from '../../test/helpers.js';
import { attachUser } from '../../auth/cookie.js';
import { catalogRoutes } from '../catalog.js';
import { getPlatformSettings, PLATFORM_SETTINGS_ID } from '../../auth/platformSettings.js';

async function settings(patch: Partial<typeof schema.platformSettings.$inferInsert>) {
  await getPlatformSettings();
  await db.update(schema.platformSettings).set(patch).where(eq(schema.platformSettings.id, PLATFORM_SETTINGS_ID));
}

describe('catalog paging', () => {
  let app: FastifyInstance;
  const get = async (url: string) => {
    const r = await app.inject({ method: 'GET', url });
    return { status: r.statusCode, body: r.json() as { items: { title: string; kind: string }[]; nextOffset: number | null } };
  };

  beforeEach(async () => {
    resetDb();
    app = Fastify();
    await app.register(cookie);
    await app.register(rateLimit, { global: false });
    app.addHook('preHandler', attachUser);
    await app.register(catalogRoutes);
    await settings({ moduleCatalogEnabled: true, partsCatalogEnabled: true, layoutCatalogEnabled: false, catalogAnonymousBrowse: true });
    const userId = randomUUID();
    await db.insert(schema.users).values({ id: userId, email: 'ada@example.com', displayName: 'Ada', createdAt: new Date() } as typeof schema.users.$inferInsert);
    const base = Date.now();
    const rows: (typeof schema.catalogItems.$inferInsert)[] = [];
    for (let i = 0; i < 5; i++) {
      for (const kind of ['module', 'part', 'layout'] as const) {
        rows.push({
          id: randomUUID(),
          kind,
          sourceId: randomUUID(),
          ownerUserId: userId,
          title: `${kind} ${i}`,
          status: 'public',
          publicVersion: 1,
          createdAt: new Date(base + i * 1000),
          updatedAt: new Date(base + i * 1000),
        });
      }
    }
    await db.insert(schema.catalogItems).values(rows);
  });
  afterEach(async () => {
    await app.close();
  });

  it('pages through one kind, newest first', async () => {
    const a = await get('/api/catalog/items?kind=module&limit=2');
    expect(a.body.items.map((i) => i.title)).toEqual(['module 4', 'module 3']);
    expect(a.body.nextOffset).toBe(2);
    const b = await get('/api/catalog/items?kind=module&limit=2&offset=4');
    expect(b.body.items.map((i) => i.title)).toEqual(['module 0']);
    expect(b.body.nextOffset).toBeNull();
    // No limit: everything (up to 200), as the desktop app asks.
    expect((await get('/api/catalog/items?kind=module')).body.items).toHaveLength(5);
  });

  it('kind=all lists every kind that is on, and only those', async () => {
    const all = await get('/api/catalog/items?kind=all&limit=50');
    expect(all.body.items).toHaveLength(10);
    expect(new Set(all.body.items.map((i) => i.kind))).toEqual(new Set(['module', 'part']));
    expect((await get('/api/catalog/items?kind=all&q=part%203')).body.items.map((i) => i.title)).toEqual(['part 3']);
    await settings({ moduleCatalogEnabled: false, partsCatalogEnabled: false });
    expect((await get('/api/catalog/items?kind=all')).status).toBe(404);
  });
});

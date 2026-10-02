// The desktop app's module library, catalog and notices with an API token:
// layouts:read lists modules, reads their contents and pictures, browses the
// catalog and its collections and shows your warnings; layouts:write saves,
// republishes, renames and deletes modules and adds catalog modules; a token
// with neither gets nothing, and routes outside the allow-list stay closed.

import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { db, issueToken, loginAs, resetDb, schema } from '../../test/helpers.js';
import { attachUser } from '../../auth/cookie.js';
import { passwordRoutes } from '../auth/password.js';
import { deviceRoutes } from '../auth/device.js';
import { moduleRoutes } from '../modules.js';
import { catalogRoutes } from '../catalog.js';
import { collectionRoutes } from '../collections.js';
import { warningRoutes } from '../warnings.js';
import { getPlatformSettings, PLATFORM_SETTINGS_ID } from '../../auth/platformSettings.js';

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ bodyLimit: 10 * 1024 * 1024 });
  await app.register(cookie);
  await app.register(rateLimit, { global: false });
  app.addHook('preHandler', attachUser);
  await app.register(passwordRoutes);
  await app.register(deviceRoutes);
  await app.register(moduleRoutes);
  await app.register(catalogRoutes);
  await app.register(collectionRoutes);
  await app.register(warningRoutes);
  return app;
}

// A real 1×1 PNG: the server re-encodes pictures (as WebP), so it must decode.
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

describe('modules, catalog and notices with API tokens', () => {
  let app: FastifyInstance;
  let user: { cookie: string; id: string };
  beforeEach(async () => {
    resetDb();
    app = await buildApp();
    user = await loginAs(app, 'desk@example.com');
  });
  afterEach(async () => {
    await app.close();
  });

  const bearer = (t: string) => ({ authorization: `Bearer ${t}` });

  it('layouts:write saves and republishes a module that layouts:read then lists and reads', async () => {
    const writer = await issueToken(app, user.cookie, 'layouts:write');
    const created = await app.inject({ method: 'POST', url: '/api/modules', headers: bearer(writer), payload: { title: 'Yard' } });
    expect(created.statusCode).toBe(201);
    const id = (created.json() as { id: string }).id;
    const put = (note: string) =>
      app.inject({
        method: 'PUT',
        url: `/api/modules/${id}/snapshot?note=${encodeURIComponent(note)}`,
        headers: { ...bearer(writer), 'content-type': 'application/octet-stream' },
        payload: Buffer.from([1, 2, 3]),
      });
    expect((await put('First')).json()).toMatchObject({ version: 1 });
    expect((await put('Longer siding')).json()).toMatchObject({ version: 2 });
    const thumb = await app.inject({ method: 'PUT', url: `/api/modules/${id}/thumbnail`, headers: bearer(writer), payload: { mime: 'image/png', data: PNG } });
    expect(thumb.statusCode).toBe(200);
    expect((await app.inject({ method: 'PATCH', url: `/api/modules/${id}`, headers: bearer(writer), payload: { title: 'Freight yard' } })).statusCode).toBe(200);

    const reader = await issueToken(app, user.cookie, 'layouts:read');
    const list = await app.inject({ method: 'GET', url: '/api/modules', headers: bearer(reader) });
    expect(list.statusCode).toBe(200);
    expect((list.json() as { modules: { id: string; title: string; latestVersion: number }[] }).modules).toMatchObject([
      { id, title: 'Freight yard', latestVersion: 2 },
    ]);
    const snap = await app.inject({ method: 'GET', url: `/api/modules/${id}/snapshot`, headers: bearer(reader) });
    expect([...snap.rawPayload]).toEqual([1, 2, 3]);
    expect((await app.inject({ method: 'GET', url: `/api/modules/${id}/thumbnail`, headers: bearer(reader) })).headers['content-type']).toBe('image/webp');
    const versions = await app.inject({ method: 'GET', url: `/api/modules/${id}/versions`, headers: bearer(reader) });
    expect((versions.json() as { versions: { note: string }[] }).versions.map((v) => v.note)).toEqual(['Longer siding', 'First']);

    // Reading is not writing.
    expect((await app.inject({ method: 'DELETE', url: `/api/modules/${id}`, headers: bearer(reader) })).json().error).toBe('insufficient_scope');
    expect((await app.inject({ method: 'DELETE', url: `/api/modules/${id}`, headers: bearer(writer) })).statusCode).toBe(200);
  });

  it('refuses tokens without a layouts scope, and module routes outside the allow-list', async () => {
    const partsOnly = await issueToken(app, user.cookie, 'parts:read venues:read');
    expect((await app.inject({ method: 'GET', url: '/api/modules', headers: bearer(partsOnly) })).json().error).toBe('insufficient_scope');
    expect((await app.inject({ method: 'GET', url: '/api/notices', headers: bearer(partsOnly) })).json().error).toBe('insufficient_scope');
    const writer = await issueToken(app, user.cookie, 'layouts:write');
    const id = ((await app.inject({ method: 'POST', url: '/api/modules', headers: bearer(writer), payload: { title: 'Yard' } })).json() as { id: string }).id;
    // Sharing a module with someone is for the website only.
    const invite = await app.inject({ method: 'POST', url: `/api/modules/${id}/invites`, headers: bearer(writer), payload: { email: 'x@example.com', role: 'viewer' } });
    expect(invite.statusCode).toBe(403);
    expect(invite.json().error).toBe('token_not_allowed');
  });

  it('a token browses the catalog and its collections, and adds a module', async () => {
    await getPlatformSettings();
    await db
      .update(schema.platformSettings)
      .set({ moduleCatalogEnabled: true, catalogReview: 'none' })
      .where(eq(schema.platformSettings.id, PLATFORM_SETTINGS_ID));
    const sharer = await loginAs(app, 'sharer@example.com');
    const m = (await app.inject({ method: 'POST', url: '/api/modules', headers: { cookie: sharer.cookie }, payload: { title: 'Engine shed' } })).json() as { id: string };
    const item = (
      await app.inject({ method: 'POST', url: '/api/catalog/submissions', headers: { cookie: sharer.cookie }, payload: { kind: 'module', sourceId: m.id, title: 'Engine shed' } })
    ).json() as { id: string };

    const reader = await issueToken(app, user.cookie, 'layouts:read');
    expect((await app.inject({ method: 'GET', url: '/api/catalog/settings', headers: bearer(reader) })).json()).toMatchObject({ modules: true });
    const items = await app.inject({ method: 'GET', url: '/api/catalog/items?kind=module', headers: bearer(reader) });
    expect((items.json() as { items: { id: string }[] }).items.map((i) => i.id)).toEqual([item.id]);
    expect((await app.inject({ method: 'GET', url: '/api/catalog/collections', headers: bearer(reader) })).statusCode).toBe(200);
    expect((await app.inject({ method: 'POST', url: `/api/catalog/items/${item.id}/add`, headers: bearer(reader), payload: {} })).json().error).toBe(
      'insufficient_scope',
    );

    const writer = await issueToken(app, user.cookie, 'layouts:write');
    const added = await app.inject({ method: 'POST', url: `/api/catalog/items/${item.id}/add`, headers: bearer(writer), payload: {} });
    expect(added.statusCode).toBe(201);
    expect(added.json()).toMatchObject({ kind: 'module' });
  });

  it('a token lists your notices and acknowledges one', async () => {
    const now = new Date();
    await db.insert(schema.warnings).values({
      id: 'w-1',
      scope: 'site',
      subjectUserId: user.id,
      severity: 'warning',
      reason: 'Please keep titles friendly.',
      createdAt: now,
    });
    const reader = await issueToken(app, user.cookie, 'layouts:read');
    const list = await app.inject({ method: 'GET', url: '/api/notices', headers: bearer(reader) });
    expect((list.json() as { notices: { id: string; acknowledgedAt: number | null }[] }).notices).toMatchObject([{ id: 'w-1', acknowledgedAt: null }]);
    const ack = await app.inject({ method: 'POST', url: '/api/notices/w-1/acknowledge', headers: bearer(reader), payload: {} });
    expect(ack.statusCode).toBe(200);
    const after = await app.inject({ method: 'GET', url: '/api/notices', headers: bearer(reader) });
    expect((after.json() as { notices: { acknowledgedAt: number | null }[] }).notices[0]!.acknowledgedAt).not.toBeNull();
  });
});

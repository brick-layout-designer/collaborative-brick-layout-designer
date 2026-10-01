// Desktop sync P1b: API tokens reach the parts catalog and custom parts —
// parts:read lists and downloads them, parts:write uploads — and nothing
// else a token lacks the scope for.

import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { issueToken, loginAs, resetDb } from '../../test/helpers.js';
import { attachUser } from '../../auth/cookie.js';
import { passwordRoutes } from '../auth/password.js';
import { deviceRoutes } from '../auth/device.js';
import { customPartRoutes } from '../customParts.js';
import { partsRoutes } from '../parts.js';

const FAKE_GIF = Buffer.from('GIF89a\x01\x00\x01\x00\x00\xff\x00,\x00\x00\x00\x00\x01\x00\x01\x00\x00\x02\x00;').toString('base64');
const XML = Buffer.from('<part><Author>me</Author></part>').toString('base64');

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ bodyLimit: 10 * 1024 * 1024 });
  await app.register(cookie);
  app.addHook('preHandler', attachUser);
  await app.register(passwordRoutes);
  await app.register(deviceRoutes);
  await app.register(customPartRoutes);
  await app.register(partsRoutes);
  return app;
}

describe('parts routes with API tokens', () => {
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
  const upload = (headers: Record<string, string>) =>
    app.inject({
      method: 'POST',
      url: '/api/custom-parts',
      headers,
      payload: { partNumber: 'DESK1', displayName: 'Desk part', xmlBase64: XML, spriteBase64: FAKE_GIF, spriteMime: 'image/gif' },
    });

  it('parts:write uploads a custom part that parts:read then lists and downloads', async () => {
    const writer = await issueToken(app, user.cookie, 'parts:write');
    const up = await upload(bearer(writer));
    expect(up.statusCode).toBe(201);
    const id = (up.json() as { id: string }).id;

    const reader = await issueToken(app, user.cookie, 'parts:read');
    const list = await app.inject({ method: 'GET', url: '/api/custom-parts', headers: bearer(reader) });
    expect(list.statusCode).toBe(200);
    expect((list.json() as { parts: { id: string }[] }).parts.map((p) => p.id)).toEqual([id]);
    const xml = await app.inject({ method: 'GET', url: `/api/custom-parts/${id}/xml`, headers: bearer(reader) });
    expect(xml.body).toBe('<part><Author>me</Author></part>');
    const sprite = await app.inject({ method: 'GET', url: `/api/custom-parts/${id}/sprite`, headers: bearer(reader) });
    expect(sprite.headers['content-type']).toBe('image/gif');
    const catalog = await app.inject({ method: 'GET', url: '/api/parts/catalog', headers: bearer(reader) });
    expect(catalog.statusCode).toBe(200);
    expect((catalog.json() as { parts: { customPartId: string | null }[] }).parts.some((p) => p.customPartId === id)).toBe(true);
  });

  it('refuses tokens without the scope, and routes outside the allow-list', async () => {
    const layoutsOnly = await issueToken(app, user.cookie, 'layouts:read layouts:write');
    expect((await upload(bearer(layoutsOnly))).statusCode).toBe(403);
    expect((await app.inject({ method: 'GET', url: '/api/custom-parts', headers: bearer(layoutsOnly) })).json().error).toBe('insufficient_scope');

    const reader = await issueToken(app, user.cookie, 'parts:read');
    expect((await upload(bearer(reader))).json().error).toBe('insufficient_scope');
    // Deleting a part is not on the token allow-list at all.
    const writer = await issueToken(app, user.cookie, 'parts:write');
    const id = ((await upload(bearer(writer))).json() as { id: string }).id;
    const del = await app.inject({ method: 'DELETE', url: `/api/custom-parts/${id}`, headers: bearer(writer) });
    expect(del.statusCode).toBe(403);
    expect(del.json().error).toBe('token_not_allowed');
  });

  it('serves public part files to a desktop that sends its token with them', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cld-libfiles-'));
    try {
      mkdirSync(join(dir, 'bricktracks'));
      writeFileSync(join(dir, 'bricktracks', 'R056.8.xml'), '<part/>');
      const files = Fastify();
      await files.register(cookie);
      files.addHook('preHandler', attachUser);
      await files.register(fastifyStatic, { root: dir, prefix: '/parts/libraries/', decorateReply: false });
      await files.register(customPartRoutes);
      const reader = await issueToken(app, user.cookie, 'parts:read');
      const got = await files.inject({ method: 'GET', url: '/parts/libraries/bricktracks/R056.8.xml', headers: bearer(reader) });
      expect(got.statusCode).toBe(200);
      expect(got.body).toBe('<part/>');
      // Anything else still refuses a token it isn't allowed.
      const del = await files.inject({ method: 'DELETE', url: '/api/custom-parts/x', headers: bearer(reader) });
      expect(del.json().error).toBe('token_not_allowed');
      await files.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

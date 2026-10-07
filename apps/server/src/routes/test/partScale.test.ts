// An uploaded part keeps its size in studs through the server: the shared
// fixture (packages/parts-catalog/fixtures/part-scale, the same files as
// the desktop repo's) sent as the desktop sends it, then read back the way
// the web editor (the catalog) and a desktop (the XML and sprite) read it.

import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { footprint, imageSize, parsePartXml } from '@cld/parts-catalog';
import { db, resetDb, schema } from '../../test/helpers.js';
import { attachUser } from '../../auth/cookie.js';
import { passwordRoutes } from '../auth/password.js';
import { sessionRoutes } from '../auth/session.js';
import { customPartRoutes } from '../customParts.js';
import { partsRoutes, invalidatePartsCache } from '../parts.js';

const FIXTURE = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../../packages/parts-catalog/fixtures/part-scale');
const expected = JSON.parse(readFileSync(join(FIXTURE, 'expected.json'), 'utf8')) as { key: string; studs: { w: number; h: number } };
const file = (ext: string) => readFileSync(join(FIXTURE, `${expected.key}${ext}`));

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ bodyLimit: 10 * 1024 * 1024 });
  await app.register(cookie);
  app.addHook('preHandler', attachUser);
  await app.register(passwordRoutes);
  await app.register(sessionRoutes);
  await app.register(customPartRoutes);
  await app.register(partsRoutes);
  return app;
}

async function login(app: FastifyInstance, email: string): Promise<string> {
  await app.inject({ method: 'POST', url: '/api/auth/password/register', payload: { email, password: 'correct horse battery', displayName: email } });
  const user = await db.select().from(schema.users).where(eq(schema.users.email, email)).get();
  const v = await db.select().from(schema.emailVerifications).where(eq(schema.emailVerifications.userId, user!.id)).get();
  const res = await app.inject({ method: 'POST', url: `/api/auth/password/verify-email/${v!.token}` });
  const setCookie = res.headers['set-cookie'];
  return Array.isArray(setCookie) ? setCookie.join('; ') : (setCookie ?? '');
}

interface WirePart {
  partNumber: string;
  customPartId: string | null;
  pxPerStud: number;
  spriteSize?: { w: number; h: number };
  hullPts: { x: number; y: number }[];
  pickShape?: { x: number; y: number }[][];
}

describe('an uploaded part keeps its size in studs', () => {
  let app: FastifyInstance;
  let cookieHeader: string;
  beforeEach(async () => {
    resetDb();
    invalidatePartsCache();
    app = await buildApp();
    cookieHeader = await login(app, 'scale@example.com');
  });
  afterEach(async () => {
    await app.close();
  });

  async function send(partNumber: string, sprite: Buffer, spriteMime: string, method: 'POST' | 'PUT' = 'POST', id = '', xml = file('.xml')) {
    const res = await app.inject({
      method,
      url: id ? `/api/custom-parts/${id}` : '/api/custom-parts',
      headers: { cookie: cookieHeader },
      payload: { partNumber, displayName: partNumber, xmlBase64: xml.toString('base64'), spriteBase64: sprite.toString('base64'), spriteMime },
    });
    expect([200, 201]).toContain(res.statusCode);
    return (res.json() as { id: string }).id;
  }
  async function wire(partNumber: string): Promise<WirePart> {
    const res = await app.inject({ method: 'GET', url: '/api/parts/catalog', headers: { cookie: cookieHeader } });
    return (res.json() as { parts: WirePart[] }).parts.find((p) => p.partNumber === partNumber)!;
  }
  // What a desktop reads after downloading the part: the XML's resolution,
  // forced to 8 for a .gif (PartsLibrary::scanFile), over the sprite's size.
  async function desktopStuds(id: string) {
    const xml = (await app.inject({ method: 'GET', url: `/api/custom-parts/${id}/xml`, headers: { cookie: cookieHeader } })).body;
    const sprite = await app.inject({ method: 'GET', url: `/api/custom-parts/${id}/sprite`, headers: { cookie: cookieHeader } });
    const isGif = String(sprite.headers['content-type']).includes('gif');
    const px = isGif ? 8 : parsePartXml(xml, { partNumber: 'X', colorCode: '', spritePath: '' }).pxPerStud;
    const size = imageSize(sprite.rawPayload)!;
    return { w: size.w / px, h: size.h / px };
  }

  it('the hi-res .png the desktop sends', async () => {
    const id = await send('SCALEPNG', file('.png'), 'image/png');
    const part = await wire('SCALEPNG');
    expect(part.pxPerStud).toBe(32);
    expect(footprint(part, 0)?.size).toEqual(expected.studs);
    expect(await desktopStuds(id)).toEqual(expected.studs);
  });

  it("a .gif sent with the hi-res .png's XML, as older desktops did", async () => {
    const id = await send('SCALEGIF', file('.gif'), 'image/gif');
    const part = await wire('SCALEGIF');
    expect(part.pxPerStud).toBe(8);
    expect(footprint(part, 0)?.size).toEqual(expected.studs);
    expect(await desktopStuds(id)).toEqual(expected.studs);
    const xml = (await app.inject({ method: 'GET', url: `/api/custom-parts/${id}/xml`, headers: { cookie: cookieHeader } })).body;
    expect(xml).not.toContain('PixelsPerStud');
    expect(xml).toContain('3 × 2 studs');
  });

  it('a part replaced with a .gif is stored the same way', async () => {
    const id = await send('SCALESWAP', file('.png'), 'image/png');
    await send('SCALESWAP', file('.gif'), 'image/gif', 'PUT', id);
    const part = await wire('SCALESWAP');
    expect(part.pxPerStud).toBe(8);
    expect(footprint(part, 0)?.size).toEqual(expected.studs);
  });

  it("keeps an import's <PickShape> through the round trip, and its footprint", async () => {
    const pt = (x: number, y: number) => `<point><x>${x}</x><y>${y}</y></point>`;
    const shape = `<PickShape><ring>${pt(-1.5, -1)}${pt(0, -1)}${pt(0, 0)}${pt(1.5, 0)}${pt(1.5, 1)}${pt(-1.5, 1)}</ring></PickShape>`;
    const xml = Buffer.from(file('.xml').toString('utf8').replace('</part>', `${shape}</part>`));
    const id = await send('SCALESHAPE', file('.png'), 'image/png', 'POST', '', xml);
    const part = await wire('SCALESHAPE');
    expect(part.pickShape).toEqual([[{ x: -1.5, y: -1 }, { x: 0, y: -1 }, { x: 0, y: 0 }, { x: 1.5, y: 0 }, { x: 1.5, y: 1 }, { x: -1.5, y: 1 }]]);
    expect(part.hullPts).toEqual([]);
    expect(footprint(part, 0)?.size).toEqual(expected.studs);
    const back = (await app.inject({ method: 'GET', url: `/api/custom-parts/${id}/xml`, headers: { cookie: cookieHeader } })).body;
    expect(back).toContain('<PickShape>');
  });
});

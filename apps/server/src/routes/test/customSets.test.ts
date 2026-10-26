// A set of custom parts (a `<group>` XML, as BlueBrick's `.set.xml` and
// Brick Track Designer's "Layout parts" export write it) uploads without a
// sprite, and the catalog, the manifest and the lists say it is a set.

import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, resetDb, schema, testVerificationToken } from '../../test/helpers.js';
import { attachUser } from '../../auth/cookie.js';
import { passwordRoutes } from '../auth/password.js';
import { sessionRoutes } from '../auth/session.js';
import { customPartRoutes, EMPTY_GIF } from '../customParts.js';
import { partsRoutes, invalidatePartsCache } from '../parts.js';
import { partsManifestRoutes } from '../partsManifest.js';
import { FEATURES } from '../../compat.js';

// Brick Track Designer's "Left switch cut 150": its set, and one of its parts.
const SET_XML = `<?xml version="1.0" encoding="utf-8"?>
<group>
  <Author>Brick Track Designer</Author>
  <Description><en>Left switch cut 150 (all 3 parts, as designed)</en></Description>
  <SortingKey>0</SortingKey>
  <CanUngroup>true</CanUngroup>
  <SubPartList>
    <SubPart id="Left_switch_cut_150.switch-base1"><position><x>-1</x><y>-11.5</y></position><angle>0</angle></SubPart>
    <SubPart id="Left_switch_cut_150.switch-base2"><position><x>1.5</x><y>0.5</y></position><angle>0</angle></SubPart>
    <SubPart id="Left_switch_cut_150.switch-base3"><position><x>5.5</x><y>12</y></position><angle>0</angle></SubPart>
  </SubPartList>
</group>`;
const PART_XML = `<part><Description><en>Left switch cut 150: switch-base1</en></Description>
  <ConnexionList><connexion><type>1</type><position><x>6</x><y>4.9688</y></position><angle>90</angle></connexion></ConnexionList></part>`;
const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64');

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ bodyLimit: 10 * 1024 * 1024 });
  await app.register(cookie);
  app.addHook('preHandler', attachUser);
  await app.register(passwordRoutes);
  await app.register(sessionRoutes);
  await app.register(customPartRoutes);
  await app.register(partsRoutes);
  await app.register(partsManifestRoutes);
  return app;
}

async function login(app: FastifyInstance, email: string): Promise<string> {
  await app.inject({ method: 'POST', url: '/api/auth/password/register', payload: { email, password: 'correct horse battery', displayName: email } });
  const user = await db.select().from(schema.users).where(eq(schema.users.email, email)).get();
  const v = await db.select().from(schema.emailVerifications).where(eq(schema.emailVerifications.userId, user!.id)).get();
  const res = await app.inject({ method: 'POST', url: `/api/auth/password/verify-email/${await testVerificationToken(v!)}` });
  const setCookie = res.headers['set-cookie'];
  return Array.isArray(setCookie) ? setCookie.join('; ') : (setCookie ?? '');
}

interface WirePart {
  key: string;
  partNumber: string;
  kind: 'leaf' | 'group';
  subparts: { subKey: string; x: number; y: number; angle: number }[];
  noSprite?: true;
  canUngroup?: false;
}

describe('a set of custom parts', () => {
  let app: FastifyInstance;
  let cookieHeader: string;
  beforeEach(async () => {
    resetDb();
    invalidatePartsCache();
    app = await buildApp();
    cookieHeader = await login(app, 'sets@example.com');
  });
  afterEach(async () => {
    await app.close();
  });

  const upload = (payload: Record<string, unknown>, method: 'POST' | 'PUT' = 'POST', id = '') =>
    app.inject({ method, url: id ? `/api/custom-parts/${id}` : '/api/custom-parts', headers: { cookie: cookieHeader }, payload });
  const uploadSet = (xml = SET_XML, method: 'POST' | 'PUT' = 'POST', id = '') =>
    upload({ partNumber: 'Left_switch_cut_150.whole', displayName: 'Left switch cut 150 (all 3 parts)', xmlBase64: b64(xml) }, method, id);
  const catalog = async () =>
    ((await app.inject({ method: 'GET', url: '/api/parts/catalog', headers: { cookie: cookieHeader } })).json() as { parts: WirePart[] }).parts;

  it('uploads without a sprite and the catalog lists it as a set of its parts', async () => {
    const res = await uploadSet();
    expect(res.statusCode).toBe(201);
    const part = (await catalog()).find((p) => p.partNumber === 'Left_switch_cut_150.whole')!;
    expect(part.kind).toBe('group');
    expect(part.noSprite).toBe(true);
    // (Lower-cased, as for the bundled sets: the editor looks parts up that way.)
    expect(part.subparts.map((s) => s.subKey)).toEqual([
      'left_switch_cut_150.switch-base1',
      'left_switch_cut_150.switch-base2',
      'left_switch_cut_150.switch-base3',
    ]);
    expect(part.subparts[0]).toMatchObject({ x: -1, y: -11.5, angle: 0 });
    expect(part.canUngroup).toBeUndefined();
  });

  it('a part with its sprite stays a part, with none of the set fields', async () => {
    const res = await upload({
      partNumber: 'Left_switch_cut_150.switch-base1',
      displayName: 'switch-base1',
      xmlBase64: b64(PART_XML),
      spriteBase64: EMPTY_GIF.toString('base64'),
      spriteMime: 'image/gif',
    });
    expect(res.statusCode).toBe(201);
    const part = (await catalog()).find((p) => p.partNumber === 'Left_switch_cut_150.switch-base1')!;
    expect(part.kind).toBe('leaf');
    expect(part.noSprite).toBeUndefined();
  });

  it('its sprite URL serves an empty picture, so older desktops and lists still get an image', async () => {
    const { id } = (await uploadSet()).json() as { id: string };
    const sprite = await app.inject({ method: 'GET', url: `/api/custom-parts/${id}/sprite`, headers: { cookie: cookieHeader } });
    expect(sprite.statusCode).toBe(200);
    expect(sprite.headers['content-type']).toBe('image/gif');
    expect(Buffer.compare(sprite.rawPayload, EMPTY_GIF)).toBe(0);
  });

  it('the manifest and the list say it is a set', async () => {
    const { id } = (await uploadSet()).json() as { id: string };
    const manifest = (await app.inject({ method: 'GET', url: '/api/parts/manifest', headers: { cookie: cookieHeader } })).json() as {
      customParts: { id: string; kind?: string; spriteUrl: string }[];
    };
    expect(manifest.customParts.find((p) => p.id === id)).toMatchObject({ kind: 'set', spriteUrl: `/api/custom-parts/${id}/sprite` });
    const list = (await app.inject({ method: 'GET', url: '/api/custom-parts', headers: { cookie: cookieHeader } })).json() as {
      parts: { id: string; kind?: string }[];
    };
    expect(list.parts.find((p) => p.id === id)?.kind).toBe('set');
  });

  it('is replaced by a new set, keeping its id', async () => {
    const { id } = (await uploadSet()).json() as { id: string };
    const fewer = SET_XML.replace(/\s*<SubPart id="Left_switch_cut_150.switch-base3">.*<\/SubPart>/, '');
    const res = await uploadSet(fewer, 'PUT', id);
    expect(res.statusCode).toBe(200);
    invalidatePartsCache();
    const part = (await catalog()).find((p) => p.partNumber === 'Left_switch_cut_150.whole')!;
    expect(part.subparts).toHaveLength(2);
  });

  it('without a sprite, only a <group> with parts is taken', async () => {
    const send = (xml: string) => upload({ partNumber: 'NOPE', displayName: 'Nope', xmlBase64: b64(xml) });
    expect((await send(PART_XML)).json()).toEqual({ error: 'invalid_set' });
    expect((await send('<group><SubPartList/></group>')).statusCode).toBe(400);
    expect((await send('not xml at all <')).statusCode).toBe(400);
    expect((await upload({ partNumber: 'NOPE', displayName: 'Nope', xmlBase64: '' })).json()).toEqual({ error: 'empty_payload' });
    // A part still needs its sprite.
    expect((await upload({ partNumber: 'NOPE', displayName: 'Nope', xmlBase64: b64(PART_XML), spriteMime: 'image/gif' })).statusCode).toBe(400);
  });

  it('servers say they take sets, so a desktop knows to send them', () => {
    expect(FEATURES).toContain('uploadSets');
  });
});

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
  setVersion?: string;
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

  it('a set has a version that changes with its parts or name, so placed copies can say Update available', async () => {
    const { id } = (await uploadSet()).json() as { id: string };
    const version = async () => (await catalog()).find((p) => p.key === `custom:${id}`)?.setVersion;
    const v1 = await version();
    expect(v1).toMatch(/^[0-9a-f]{16}$/);
    // The same set sent again: the same version.
    await uploadSet(SET_XML, 'PUT', id);
    invalidatePartsCache();
    expect(await version()).toBe(v1);
    // A part moved.
    await uploadSet(SET_XML.replace('<x>5.5</x>', '<x>6</x>'), 'PUT', id);
    invalidatePartsCache();
    const v2 = await version();
    expect(v2).not.toBe(v1);
    // Renamed.
    await uploadSet(SET_XML.replace('<x>5.5</x>', '<x>6</x>').replace('as designed', 'as built'), 'PUT', id);
    invalidatePartsCache();
    expect(await version()).not.toBe(v2);
    // A part has none.
    await upload({ partNumber: 'P1', displayName: 'P1', xmlBase64: b64(PART_XML), spriteBase64: EMPTY_GIF.toString('base64'), spriteMime: 'image/gif' });
    invalidatePartsCache();
    expect((await catalog()).find((p) => p.partNumber === 'P1')?.setVersion).toBeUndefined();
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

  it('refuses a set named like one of its own parts, which would nest copies of itself when placed', async () => {
    const res = await upload({ partNumber: 'left_switch_cut_150.SWITCH-BASE2', displayName: 'Base 2', xmlBase64: b64(SET_XML) });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'set_named_like_its_part' });
    // Renaming one to such a number is refused too; keeping the number (a rename) still works.
    const { id } = (await uploadSet()).json() as { id: string };
    const renumbered = await upload({ partNumber: 'Left_switch_cut_150.switch-base1', displayName: 'Base 1', xmlBase64: b64(SET_XML) }, 'PUT', id);
    expect(renumbered.json()).toEqual({ error: 'set_named_like_its_part' });
    const renamed = await upload({ partNumber: 'Left_switch_cut_150.whole', displayName: 'Renamed', xmlBase64: b64(SET_XML) }, 'PUT', id);
    expect(renamed.statusCode).toBe(200);
  });

  // Save selection as set, as the website sends it: a stock part and one of
  // your own parts (by its number), in "My sets", and later renamed.
  const WEB_SET = `<?xml version="1.0" encoding="utf-8"?>
<group>
	<Author>Collaborative Brick Layout Designer</Author>
	<Description>
		<en>Station yard</en>
	</Description>
	<CanUngroup>true</CanUngroup>
	<SubPartList>
		<SubPart id="3001.1">
			<position>
				<x>-8.000000</x>
				<y>0.000000</y>
			</position>
			<angle>90.0000</angle>
		</SubPart>
		<SubPart id="Left_switch_cut_150.switch-base1">
			<position>
				<x>8.000000</x>
				<y>0.000000</y>
			</position>
			<angle>0.0000</angle>
		</SubPart>
	</SubPartList>
</group>
`;
  // The desktop's Save selection as set (saveload::writeSetXml), sent by its
  // "Also put it on the server": XML only, named as its file.
  const DESKTOP_SET = `<?xml version="1.0" encoding="UTF-8"?>
<group>
 <Author>Collaborative Brick Layout Designer</Author>
 <Description>
  <en>Desktop yard</en>
 </Description>
 <CanUngroup>true</CanUngroup>
 <SubPartList>
  <SubPart id="3001.1">
   <position>
    <x>-4</x>
    <y>0</y>
   </position>
   <angle>0</angle>
  </SubPart>
  <SubPart id="3001.1">
   <position>
    <x>4</x>
    <y>0</y>
   </position>
   <angle>0</angle>
  </SubPart>
 </SubPartList>
</group>
`;

  it('takes a set saved on the website, of stock and custom parts, renames it and deletes it', async () => {
    const res = await upload({ partNumber: 'Station yard', displayName: 'Station yard', xmlBase64: b64(WEB_SET), category: 'My sets' });
    expect(res.statusCode).toBe(201);
    const { id } = res.json() as { id: string };
    const listed = (await catalog()).find((p) => p.partNumber === 'Station yard') as WirePart & { category: string; description: string };
    expect(listed).toMatchObject({ kind: 'group', noSprite: true, category: 'My sets', description: 'Station yard' });
    expect(listed.subparts.map((s) => s.subKey)).toEqual(['3001.1', 'left_switch_cut_150.switch-base1']);
    expect(listed.subparts[0]).toMatchObject({ x: -8, y: 0, angle: 90 });

    // Rename: the same number, a new name in the lists and in its XML.
    const renamed = await upload({ partNumber: 'Station yard', displayName: 'North yard', xmlBase64: b64(WEB_SET.replace('Station yard', 'North yard')) }, 'PUT', id);
    expect(renamed.statusCode).toBe(200);
    invalidatePartsCache();
    const after = (await catalog()).find((p) => p.partNumber === 'Station yard') as WirePart & { category: string; description: string };
    expect(after).toMatchObject({ description: 'North yard', category: 'My sets', kind: 'group' });
    const xml = await app.inject({ method: 'GET', url: `/api/custom-parts/${id}/xml`, headers: { cookie: cookieHeader } });
    expect(xml.body).toContain('<en>North yard</en>');

    // The same name again is refused, so the website asks for another.
    expect((await upload({ partNumber: 'Station yard', displayName: 'Again', xmlBase64: b64(WEB_SET) })).json()).toEqual({ error: 'part_number_taken' });

    const gone = await app.inject({ method: 'DELETE', url: `/api/custom-parts/${id}`, headers: { cookie: cookieHeader } });
    expect(gone.statusCode).toBe(200);
    invalidatePartsCache();
    expect((await catalog()).some((p) => p.partNumber === 'Station yard')).toBe(false);
  });

  it('takes a set saved on the desktop and lists it as a set you own', async () => {
    const res = await upload({ partNumber: 'Desktop yard', displayName: 'Desktop yard', xmlBase64: b64(DESKTOP_SET) });
    expect(res.statusCode).toBe(201);
    const listed = (await catalog()).find((p) => p.partNumber === 'Desktop yard')!;
    expect(listed).toMatchObject({ kind: 'group', noSprite: true });
    expect(listed.subparts).toHaveLength(2);
    expect(listed.subparts.map((s) => s.x)).toEqual([-4, 4]);
    const list = (await app.inject({ method: 'GET', url: '/api/custom-parts', headers: { cookie: cookieHeader } })).json() as {
      parts: { partNumber: string; kind?: string; role: string }[];
    };
    expect(list.parts.find((p) => p.partNumber === 'Desktop yard')).toMatchObject({ kind: 'set', role: 'owner' });
  });

  it('servers say they take sets, so a desktop knows to send them', () => {
    expect(FEATURES).toContain('uploadSets');
  });
});

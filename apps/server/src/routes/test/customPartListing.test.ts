// Parts only used inside sets (BlueBrick's <NotListedInLibrary>): the
// catalog says so for a part whose XML has it, and PATCH .../listing sets or
// clears it in the XML for the people who may change the part.

import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import fastifyMultipart from '@fastify/multipart';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { attachUser } from '../../auth/cookie.js';
import { registerApiRoutes } from '../all.js';
import { closeAll } from '../../events/hub.js';
import { invalidateLimitCaches } from '../../limits/limits.js';
import { invalidatePartsCache } from '../parts.js';
import { withNotListed } from '../../utils/partXml.js';
import { loginAs, resetDb } from '../../test/helpers.js';

type Who = { cookie: string; id: string };
const FAKE_GIF = Buffer.from('GIF89a    \xff\xff\xff   !\xf9    ,       D ;', 'binary').toString('base64');
const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64');

describe('parts only used inside sets', () => {
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
    invalidatePartsCache();
  });

  const call = (who: Who, method: 'GET' | 'POST' | 'PATCH', url: string, payload?: object) =>
    app.inject({ method, url, headers: { cookie: who.cookie }, ...(payload ? { payload } : {}) });
  const part = async (who: Who, partNumber: string, xml = '<?xml version="1.0"?>\n<part>\n\t<Author>Me</Author>\n</part>') =>
    ((await call(who, 'POST', '/api/custom-parts', { partNumber, displayName: partNumber, xmlBase64: b64(xml), spriteBase64: FAKE_GIF, spriteMime: 'image/gif' })).json() as { id: string }).id;
  const listed = async (who: Who, id: string) => {
    invalidatePartsCache();
    const parts = ((await call(who, 'GET', '/api/parts/catalog')).json() as { parts: { key: string; notListed?: true }[] }).parts;
    return parts.find((p) => p.key === `custom:${id}`)?.notListed !== true;
  };

  it('the catalog says a part whose XML has NotListedInLibrary is only used inside sets', async () => {
    const alice = await loginAs(app, 'alice@example.com');
    const hidden = await part(alice, 'HALF', '<part><NotListedInLibrary>True</NotListedInLibrary></part>');
    const shown = await part(alice, 'WHOLE', '<part><NotListedInLibrary>false</NotListedInLibrary></part>');
    expect(await listed(alice, hidden)).toBe(false);
    expect(await listed(alice, shown)).toBe(true);
  });

  it('its owner (or an editor) sets it and clears it; the XML carries it, as BlueBrick reads it', async () => {
    const alice = await loginAs(app, 'alice@example.com');
    const bob = await loginAs(app, 'bob@example.com');
    const id = await part(alice, 'HALF');
    expect(await listed(alice, id)).toBe(true);
    const set = await call(alice, 'PATCH', `/api/custom-parts/${id}/listing`, { notListed: true });
    expect(set.json()).toEqual({ id, notListed: true });
    expect(await listed(alice, id)).toBe(false);
    const xml = (await call(alice, 'GET', `/api/custom-parts/${id}/xml`)).body;
    expect(xml).toBe('<?xml version="1.0"?>\n<part>\n\t<NotListedInLibrary>true</NotListedInLibrary>\n\t<Author>Me</Author>\n</part>');
    // Again: still once.
    await call(alice, 'PATCH', `/api/custom-parts/${id}/listing`, { notListed: true });
    expect([...(await call(alice, 'GET', `/api/custom-parts/${id}/xml`)).body.matchAll(/NotListedInLibrary>true/g)]).toHaveLength(1);
    await call(alice, 'PATCH', `/api/custom-parts/${id}/listing`, { notListed: false });
    expect(await listed(alice, id)).toBe(true);
    expect((await call(alice, 'GET', `/api/custom-parts/${id}/xml`)).body).toBe('<?xml version="1.0"?>\n<part>\n\t<Author>Me</Author>\n</part>');
    // Someone else can't; a bad body is refused.
    expect((await call(bob, 'PATCH', `/api/custom-parts/${id}/listing`, { notListed: true })).statusCode).toBe(404);
    expect((await call(alice, 'PATCH', `/api/custom-parts/${id}/listing`, { notListed: 'yes' })).statusCode).toBe(400);
  });

  it('withNotListed works on a set too, and on a self-closing tag', () => {
    expect(withNotListed('<group><SubPartList/></group>', true)).toBe('<group>\n\t<NotListedInLibrary>true</NotListedInLibrary><SubPartList/></group>');
    expect(withNotListed('<part> <NotListedInLibrary/></part>', false)).toBe('<part></part>');
  });
});

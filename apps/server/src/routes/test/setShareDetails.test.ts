// A part's or set's people list says which of the owner's parts come along
// with a set, and which sets brought a part to whom. That's for the people
// who manage its sharing: someone it's shared with sees the people, and
// only their own sets, not the owner's other parts and sets.

import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { attachUser } from '../../auth/cookie.js';
import { registerApiRoutes } from '../all.js';
import { closeAll } from '../../events/hub.js';
import { invalidateLimitCaches } from '../../limits/limits.js';
import { loginAs, resetDb } from '../../test/helpers.js';

type Who = { cookie: string; id: string };
type People = { setParts?: { id: string }[]; collaborators: { userId: string; viaSets?: string[] }[] };

const FAKE_GIF = Buffer.from('GIF89a    \xff\xff\xff   !\xf9    ,       D ;', 'binary').toString('base64');
const PART_XML = Buffer.from('<?xml version="1.0"?><part/>').toString('base64');
const setXml = (name: string, ids: string[]) =>
  Buffer.from(
    `<group><Description><en>${name}</en></Description><SubPartList>` +
      ids.map((id, i) => `<SubPart id="${id}"><position><x>${i * 8}</x><y>0</y></position><angle>0</angle></SubPart>`).join('') +
      '</SubPartList></group>',
  ).toString('base64');

describe('who sees a set’s parts and the sets that brought a part', () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    app = Fastify({ bodyLimit: 10 * 1024 * 1024 });
    await app.register(cookie);
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
  });

  const call = (who: Who, method: 'GET' | 'POST', url: string, payload?: object) =>
    app.inject({ method, url, headers: { cookie: who.cookie }, ...(payload ? { payload } : {}) });
  const make = async (who: Who, payload: object) => {
    const r = await call(who, 'POST', '/api/custom-parts', payload);
    expect(r.statusCode, r.body).toBe(201);
    return (r.json() as { id: string }).id;
  };
  const share = async (from: Who, id: string, to: Who, email: string) => {
    const token = ((await call(from, 'POST', `/api/custom-parts/${id}/invites`, { email, role: 'viewer' })).json() as { token: string }).token;
    expect((await call(to, 'POST', `/api/part-invites/${token}`)).statusCode).toBe(200);
  };
  const people = async (who: Who, id: string) => (await call(who, 'GET', `/api/custom-parts/${id}/collaborators`)).json() as People;

  it('owners see both; someone it’s shared with sees only their own sets', async () => {
    const alice = await loginAs(app, 'alice@example.com');
    const bob = await loginAs(app, 'bob@example.com');
    const cat = await loginAs(app, 'cat@example.com');
    const tower = await make(alice, { partNumber: 'TOWER', displayName: 'Tower', xmlBase64: PART_XML, spriteBase64: FAKE_GIF, spriteMime: 'image/gif' });
    await make(alice, { partNumber: 'SECRET', displayName: 'Secret prototype', xmlBase64: PART_XML, spriteBase64: FAKE_GIF, spriteMime: 'image/gif' });
    const yard = await make(alice, { partNumber: 'Yard', displayName: 'Yard', xmlBase64: setXml('Yard', ['TOWER']) });
    const depot = await make(alice, { partNumber: 'Depot', displayName: 'Depot for the private show', xmlBase64: setXml('Depot', ['TOWER', 'SECRET']) });
    await share(alice, yard, bob, 'bob@example.com');
    await share(alice, depot, cat, 'cat@example.com');

    // Alice manages sharing: she sees what comes along, and how each has Tower.
    expect((await people(alice, depot)).setParts?.length).toBe(2);
    const towerForAlice = await people(alice, tower);
    expect(towerForAlice.collaborators.find((c) => c.userId === bob.id)?.viaSets).toEqual(['Yard']);
    expect(towerForAlice.collaborators.find((c) => c.userId === cat.id)?.viaSets).toEqual(['Depot for the private show']);

    // Bob sees the people on Tower, his own set, and nothing of Cat's set.
    const towerForBob = await people(bob, tower);
    expect(towerForBob.collaborators.find((c) => c.userId === bob.id)?.viaSets).toEqual(['Yard']);
    expect(towerForBob.collaborators.find((c) => c.userId === cat.id)).toBeDefined();
    expect(towerForBob.collaborators.find((c) => c.userId === cat.id)?.viaSets).toBeUndefined();
    // Cat sees Depot's people, not the list of Alice's parts in it.
    expect((await people(cat, depot)).setParts).toBeUndefined();
  });
});

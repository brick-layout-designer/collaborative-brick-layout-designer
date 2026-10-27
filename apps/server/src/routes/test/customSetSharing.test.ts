// Sharing a set brings its custom parts (access/setShares.ts): the invite
// says which of the sender's own parts come along, accepting it shares them
// too (as a viewer), and taking the set back takes them back, unless they
// were shared on their own or another shared set still brings them. Also:
// a set saved without a category goes in "My sets", whichever app sent it.

import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import fastifyMultipart from '@fastify/multipart';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { attachUser } from '../../auth/cookie.js';
import { registerApiRoutes } from '../all.js';
import { closeAll } from '../../events/hub.js';
import { invalidateLimitCaches } from '../../limits/limits.js';
import { db, loginAs, resetDb, schema } from '../../test/helpers.js';

type Who = { cookie: string; id: string };

const FAKE_GIF = Buffer.from('GIF89a    \xff\xff\xff   !\xf9    ,       D ;', 'binary').toString('base64');
const PART_XML = Buffer.from('<?xml version="1.0"?><part/>').toString('base64');
const setXml = (name: string, ids: string[]) =>
  Buffer.from(
    `<?xml version="1.0" encoding="utf-8"?>\n<group>\n\t<Description><en>${name}</en></Description>\n\t<SubPartList>\n` +
      ids.map((id, i) => `\t\t<SubPart id="${id}"><position><x>${i * 8}</x><y>0</y></position><angle>0</angle></SubPart>\n`).join('') +
      '\t</SubPartList>\n</group>\n',
  ).toString('base64');

describe('sharing a set brings its custom parts', () => {
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
  });

  const call = (who: Who | null, method: 'GET' | 'POST' | 'DELETE', url: string, payload?: object) =>
    app.inject({ method, url, headers: who ? { cookie: who.cookie } : {}, ...(payload ? { payload } : {}) });
  async function part(who: Who, partNumber: string) {
    const r = await call(who, 'POST', '/api/custom-parts', { partNumber, displayName: `${partNumber} name`, xmlBase64: PART_XML, spriteBase64: FAKE_GIF, spriteMime: 'image/gif' });
    expect(r.statusCode).toBe(201);
    return (r.json() as { id: string }).id;
  }
  async function set(who: Who, partNumber: string, ids: string[], extra: object = {}) {
    const r = await call(who, 'POST', '/api/custom-parts', { partNumber, displayName: partNumber, xmlBase64: setXml(partNumber, ids), ...extra });
    expect(r.statusCode).toBe(201);
    return (r.json() as { id: string }).id;
  }
  async function share(from: Who, id: string, to: Who, email: string, role: 'viewer' | 'editor' = 'viewer') {
    const inv = await call(from, 'POST', `/api/custom-parts/${id}/invites`, { email, role });
    expect(inv.statusCode).toBe(200);
    const token = (inv.json() as { token: string }).token;
    const acc = await call(to, 'POST', `/api/part-invites/${token}`);
    expect(acc.statusCode).toBe(200);
    return acc.json() as { partId: string; setParts?: { id: string; partNumber: string }[] };
  }
  const mine = async (who: Who) =>
    ((await call(who, 'GET', '/api/custom-parts')).json() as { parts: { id: string; role: string }[] }).parts;
  const has = async (who: Who, id: string) => (await mine(who)).some((p) => p.id === id);

  it('says which of your parts come along, in the share dialog and the invite', async () => {
    const alice = await loginAs(app, 'alice@example.com');
    const eve = await loginAs(app, 'eve@example.com');
    const tower = await part(alice, 'TOWER');
    const shed = await part(alice, 'Shed');
    await part(eve, 'BARN'); // someone else's part with a number the set names: not alice's to share
    const yard = await set(alice, 'Yard', ['3001.1', 'tower', 'SHED', 'BARN']);
    const people = (await call(alice, 'GET', `/api/custom-parts/${yard}/collaborators`)).json() as { setParts?: { id: string; partNumber: string }[] };
    expect(people.setParts?.map((p) => p.id).sort()).toEqual([shed, tower].sort());
    // A part that isn't a set has none.
    expect((await call(alice, 'GET', `/api/custom-parts/${tower}/collaborators`)).json()).not.toHaveProperty('setParts');

    const inv = (await call(alice, 'POST', `/api/custom-parts/${yard}/invites`, { email: 'bob@example.com', role: 'viewer' })).json() as { token: string };
    const preview = (await call(null, 'GET', `/api/part-invites/${inv.token}`)).json() as { setParts?: { partNumber: string; displayName: string }[] };
    expect(preview.setParts).toEqual([
      { partNumber: 'Shed', displayName: 'Shed name' },
      { partNumber: 'TOWER', displayName: 'TOWER name' },
    ]);
  });

  it('accepting gives the set and its parts; taking the set back takes them back', async () => {
    const alice = await loginAs(app, 'alice@example.com');
    const bob = await loginAs(app, 'bob@example.com');
    const tower = await part(alice, 'TOWER');
    const shed = await part(alice, 'SHED');
    const yard = await set(alice, 'Yard', ['TOWER', 'SHED', '3001.1']);
    const acc = await share(alice, yard, bob, 'bob@example.com', 'editor');
    expect(acc.setParts?.map((p) => p.id).sort()).toEqual([shed, tower].sort());
    const list = await mine(bob);
    expect(list.find((p) => p.id === yard)?.role).toBe('editor');
    expect(list.find((p) => p.id === tower)?.role).toBe('viewer');
    expect(list.find((p) => p.id === shed)?.role).toBe('viewer');
    // The part's own list says how they have it.
    const towerPeople = (await call(alice, 'GET', `/api/custom-parts/${tower}/collaborators`)).json() as { collaborators: { userId: string; viaSets?: string[] }[] };
    expect(towerPeople.collaborators.find((c) => c.userId === bob.id)?.viaSets).toEqual(['Yard']);

    expect((await call(alice, 'DELETE', `/api/custom-parts/${yard}/collaborators/${bob.id}`)).statusCode).toBe(200);
    expect(await has(bob, yard)).toBe(false);
    expect(await has(bob, tower)).toBe(false);
    expect(await has(bob, shed)).toBe(false);
    expect(await db.select().from(schema.customPartSetShares).all()).toHaveLength(0);
  });

  it('leaves a part shared on its own, and one another shared set still brings', async () => {
    const alice = await loginAs(app, 'alice@example.com');
    const bob = await loginAs(app, 'bob@example.com');
    const tower = await part(alice, 'TOWER');
    const shed = await part(alice, 'SHED');
    const signal = await part(alice, 'SIGNAL');
    await share(alice, tower, bob, 'bob@example.com'); // on its own, first
    const yard = await set(alice, 'Yard', ['TOWER', 'SHED', 'SIGNAL']);
    const depot = await set(alice, 'Depot', ['SHED']);
    await share(alice, yard, bob, 'bob@example.com');
    await share(alice, depot, bob, 'bob@example.com');
    // SIGNAL came only with the yard; then it's shared on its own too (allowed although Bob has it).
    await share(alice, signal, bob, 'bob@example.com', 'editor');
    expect((await mine(bob)).find((p) => p.id === signal)?.role).toBe('editor');

    // Bob leaves the yard himself.
    expect((await call(bob, 'DELETE', `/api/custom-parts/${yard}/collaborators/${bob.id}`)).statusCode).toBe(200);
    expect(await has(bob, yard)).toBe(false);
    expect(await has(bob, tower)).toBe(true); // shared on its own
    expect(await has(bob, shed)).toBe(true); // the depot still brings it
    expect(await has(bob, signal)).toBe(true); // shared on its own since

    // Deleting the depot takes its part back too.
    expect((await call(alice, 'DELETE', `/api/custom-parts/${depot}`)).statusCode).toBe(200);
    expect(await has(bob, shed)).toBe(false);
    expect(await has(bob, tower)).toBe(true);
  });

  it("doesn't add a part the person already has, and a set inside the set brings its parts", async () => {
    const alice = await loginAs(app, 'alice@example.com');
    const bob = await loginAs(app, 'bob@example.com');
    const tower = await part(alice, 'TOWER');
    const shed = await part(alice, 'SHED');
    const platform = await set(alice, 'Platform', ['SHED']);
    const station = await set(alice, 'Station', ['TOWER', 'Platform']);
    const acc = await share(alice, station, bob, 'bob@example.com');
    expect(acc.setParts?.map((p) => p.id).sort()).toEqual([platform, shed, tower].sort());
    expect(await has(bob, platform)).toBe(true);
    expect(await has(bob, shed)).toBe(true);
    // Sharing it again changes nothing for parts he has.
    expect((await call(alice, 'POST', `/api/custom-parts/${station}/invites`, { email: 'bob@example.com', role: 'viewer' })).statusCode).toBe(409);
    // His own part with the same number as one in someone's set is left alone.
    const carol = await loginAs(app, 'carol@example.com');
    const carolsTower = await part(carol, 'TOWER2');
    const carolsSet = await set(carol, 'Carol yard', ['TOWER2']);
    await share(carol, carolsTower, alice, 'alice@example.com'); // alice has it on its own
    await share(carol, carolsSet, alice, 'alice@example.com');
    expect(await db.select().from(schema.customPartSetShares).all()).toHaveLength(3); // only bob's three
  });

  it('puts a set without a category in "My sets", from the website or a desktop', async () => {
    const alice = await loginAs(app, 'alice@example.com');
    await part(alice, 'TOWER');
    const fromDesktop = await set(alice, 'Desktop yard', ['TOWER']);
    const fromWeb = await set(alice, 'Web yard', ['TOWER'], { category: 'My sets' });
    const other = await set(alice, 'Named', ['TOWER'], { category: 'Stations' });
    const rows = await db.select({ id: schema.customParts.id, category: schema.customParts.category }).from(schema.customParts).all();
    const category = (id: string) => rows.find((r) => r.id === id)?.category;
    expect(category(fromDesktop)).toBe('My sets');
    expect(category(fromWeb)).toBe('My sets');
    expect(category(other)).toBe('Stations');
    expect(rows.find((r) => r.category === 'Custom')).toBeTruthy(); // the part itself
  });
});

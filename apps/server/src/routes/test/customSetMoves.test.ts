// Moving a set to a club brings your custom parts in it (access/setMoves.ts):
// the move plan says which come along, the move takes them (and the parts of
// a set inside it), a part another of your sets still uses stays yours while
// the club gets a copy, a number the club already has is left to the club's
// part, and pending invites go as for any move. Copying a set to a club
// brings copies of your custom parts in it (planSetCopy), with the same
// plan in the dialog (copy-plan).

import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import fastifyMultipart from '@fastify/multipart';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { attachUser } from '../../auth/cookie.js';
import { registerApiRoutes } from '../all.js';
import { closeAll } from '../../events/hub.js';
import { invalidateLimitCaches } from '../../limits/limits.js';
import { db, loginAs, resetDb, schema } from '../../test/helpers.js';

type Who = { cookie: string; id: string };
interface Listed {
  id: string;
  partNumber: string;
  ownerUserId: string | null;
  ownerOrgId: string | null;
}

const FAKE_GIF = Buffer.from('GIF89a    \xff\xff\xff   !\xf9    ,       D ;', 'binary').toString('base64');
const PART_XML = Buffer.from('<?xml version="1.0"?><part/>').toString('base64');
const setXml = (name: string, ids: string[]) =>
  Buffer.from(
    `<?xml version="1.0" encoding="utf-8"?>\n<group>\n\t<Description><en>${name}</en></Description>\n\t<SubPartList>\n` +
      ids.map((id, i) => `\t\t<SubPart id="${id}"><position><x>${i * 8}</x><y>0</y></position><angle>0</angle></SubPart>\n`).join('') +
      '\t</SubPartList>\n</group>\n',
  ).toString('base64');

describe('moving a set to a club brings its custom parts', () => {
  let app: FastifyInstance;
  let alice: Who;
  let bob: Who;
  let clubId: string;
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
  beforeEach(async () => {
    resetDb();
    invalidateLimitCaches();
    alice = await loginAs(app, 'alice@example.com');
    bob = await loginAs(app, 'bob@example.com');
    const club = await call(alice, 'POST', '/api/orgs', { name: 'Rail Club' });
    expect(club.statusCode).toBe(201);
    clubId = (club.json() as { id: string }).id;
    await db.insert(schema.orgMembers).values({ orgId: clubId, userId: bob.id, role: 'member', joinedAt: new Date() });
  });

  const call = (who: Who | null, method: 'GET' | 'POST' | 'DELETE', url: string, payload?: object) =>
    app.inject({ method, url, headers: who ? { cookie: who.cookie } : {}, ...(payload ? { payload } : {}) });
  async function part(who: Who, partNumber: string, orgSlug?: string) {
    const r = await call(who, 'POST', '/api/custom-parts', {
      partNumber,
      displayName: `${partNumber} name`,
      xmlBase64: PART_XML,
      spriteBase64: FAKE_GIF,
      spriteMime: 'image/gif',
      ...(orgSlug ? { orgSlug } : {}),
    });
    expect(r.statusCode).toBe(201);
    return (r.json() as { id: string }).id;
  }
  async function set(who: Who, partNumber: string, ids: string[]) {
    const r = await call(who, 'POST', '/api/custom-parts', { partNumber, displayName: partNumber, xmlBase64: setXml(partNumber, ids) });
    expect(r.statusCode).toBe(201);
    return (r.json() as { id: string }).id;
  }
  const all = async (who: Who) => ((await call(who, 'GET', '/api/custom-parts')).json() as { parts: Listed[] }).parts;
  const ownerOf = async (id: string) => {
    const row = await db.select({ u: schema.customParts.ownerUserId, o: schema.customParts.ownerOrgId }).from(schema.customParts).where(eq(schema.customParts.id, id)).get();
    return row?.o ? `club` : row?.u ? 'alice' : 'gone';
  };
  const plan = async (id: string) =>
    (await call(alice, 'GET', `/api/custom-parts/${id}/move-plan?orgSlug=rail-club`)).json() as {
      parts: Record<'move' | 'copy' | 'inClub' | 'notYours', { partNumber: string }[]>;
    };
  const numbers = (list: { partNumber: string }[]) => list.map((p) => p.partNumber);

  it('lists the parts that come along, then moves them with the set, a set inside it too', async () => {
    const tower = await part(alice, 'TOWER');
    const shed = await part(alice, 'Shed');
    const lamp = await part(alice, 'LAMP');
    const inner = await set(alice, 'Lights', ['LAMP']);
    await part(bob, 'BARN'); // someone else's part with a number the set names: not alice's
    const yard = await set(alice, 'Yard', ['3001.1', 'tower', 'SHED', 'BARN', 'Lights']);

    expect(numbers((await plan(yard)).parts.move)).toEqual(['LAMP', 'Lights', 'Shed', 'TOWER']);
    // A part that isn't a set brings nothing.
    expect((await plan(tower)).parts).toEqual({ move: [], copy: [], inClub: [], notYours: [] });

    const res = await call(alice, 'POST', `/api/custom-parts/${yard}/move`, { orgSlug: 'rail-club' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true, id: yard, parts: { moved: ['LAMP', 'Lights', 'Shed', 'TOWER'], copied: [], inClub: [] } });
    for (const id of [yard, tower, shed, lamp, inner]) expect(await ownerOf(id)).toBe('club');
    // Bob, in the club, now has the set and every part it needs.
    const bobs = await all(bob);
    for (const id of [yard, tower, shed, lamp, inner]) expect(bobs.find((p) => p.id === id)?.ownerOrgId).toBe(clubId);
    // Each part's move is audit-logged with the set it went with.
    const audit = await db
      .select()
      .from(schema.auditEvents)
      .where(and(eq(schema.auditEvents.resourceId, tower), eq(schema.auditEvents.eventType, 'transfer')))
      .get();
    expect(JSON.parse(String(audit?.payload))).toMatchObject({ to: { kind: 'org', orgId: clubId }, withSet: yard });
  });

  it('a part another of your sets uses stays yours, and the club gets its own copy', async () => {
    const tower = await part(alice, 'TOWER');
    const shed = await part(alice, 'SHED');
    const yard = await set(alice, 'Yard', ['TOWER', 'SHED']);
    const depot = await set(alice, 'Depot', ['shed']);
    const p = (await plan(yard)).parts;
    expect(numbers(p.move)).toEqual(['TOWER']);
    expect(numbers(p.copy)).toEqual(['SHED']);

    const res = await call(alice, 'POST', `/api/custom-parts/${yard}/move`, { orgSlug: 'rail-club' });
    expect(res.json()).toMatchObject({ parts: { moved: ['TOWER'], copied: ['SHED'] } });
    expect(await ownerOf(tower)).toBe('club');
    expect(await ownerOf(shed)).toBe('alice');
    expect(await ownerOf(depot)).toBe('alice');
    // The club's copy, credited to alice, pointing at hers.
    const copy = await db
      .select()
      .from(schema.customParts)
      .where(and(eq(schema.customParts.ownerOrgId, clubId), eq(schema.customParts.partNumber, 'SHED')))
      .get();
    expect(copy).toMatchObject({ createdBy: alice.id, copiedFromId: shed, spriteMime: 'image/gif' });
    expect((await all(bob)).some((x) => x.id === copy!.id)).toBe(true);
  });

  it('a number the club already has is left to the club’s part', async () => {
    const clubTower = await part(alice, 'TOWER', 'rail-club');
    const tower = await part(alice, 'TOWER');
    const yard = await set(alice, 'Yard', ['TOWER']);
    expect(numbers((await plan(yard)).parts.inClub)).toEqual(['TOWER']);
    const res = await call(alice, 'POST', `/api/custom-parts/${yard}/move`, { orgSlug: 'rail-club' });
    expect(res.json()).toMatchObject({ parts: { moved: [], inClub: ['TOWER'] } });
    expect(await ownerOf(tower)).toBe('alice');
    expect(await ownerOf(clubTower)).toBe('club');
    expect(await ownerOf(yard)).toBe('club');
  });

  it('pending invites to the parts that move go, as for any move; people the set was shared with keep its parts', async () => {
    const carol = await loginAs(app, 'carol@example.com');
    const tower = await part(alice, 'TOWER');
    const yard = await set(alice, 'Yard', ['TOWER']);
    // Carol has the set, and its part through it.
    const inv = (await call(alice, 'POST', `/api/custom-parts/${yard}/invites`, { email: 'carol@example.com', role: 'viewer' })).json() as { token: string };
    expect((await call(carol, 'POST', `/api/part-invites/${inv.token}`)).statusCode).toBe(200);
    // Dan's invites to the set and to the part are still waiting.
    await call(alice, 'POST', `/api/custom-parts/${yard}/invites`, { email: 'dan@example.com', role: 'viewer' });
    await call(alice, 'POST', `/api/custom-parts/${tower}/invites`, { email: 'dan@example.com', role: 'viewer' });
    expect(await db.select().from(schema.customPartInvites).where(eq(schema.customPartInvites.invitedEmail, 'dan@example.com')).all()).toHaveLength(2);

    expect((await call(alice, 'POST', `/api/custom-parts/${yard}/move`, { orgSlug: 'rail-club' })).statusCode).toBe(200);
    expect(await db.select().from(schema.customPartInvites).where(eq(schema.customPartInvites.invitedEmail, 'dan@example.com')).all()).toHaveLength(0);
    const carols = await all(carol);
    expect(carols.some((p) => p.id === yard)).toBe(true);
    expect(carols.some((p) => p.id === tower)).toBe(true);
    expect(await db.select().from(schema.customPartSetShares).all()).toHaveLength(1);
  });

  it('the plan and the move are only for those who may move the set', async () => {
    await part(alice, 'TOWER');
    const yard = await set(alice, 'Yard', ['TOWER']);
    expect((await call(bob, 'GET', `/api/custom-parts/${yard}/move-plan?orgSlug=rail-club`)).statusCode).toBe(404);
    expect((await call(alice, 'GET', `/api/custom-parts/${yard}/move-plan`)).statusCode).toBe(400);
    expect((await call(null, 'GET', `/api/custom-parts/${yard}/move-plan?orgSlug=rail-club`)).statusCode).toBe(401);
  });
  // ---- copying a set to a club ------------------------------------------------
  const copyPlan = async (who: Who, id: string, slug = 'rail-club') =>
    (await call(who, 'GET', `/api/custom-parts/${id}/copy-plan?orgSlug=${slug}`)).json() as {
      parts: Record<'move' | 'copy' | 'inClub' | 'notYours', { partNumber: string }[]>;
    };
  const clubPart = (n: string) =>
    db.select().from(schema.customParts).where(and(eq(schema.customParts.ownerOrgId, clubId), eq(schema.customParts.partNumber, n))).get();

  it('copying a set to a club brings copies of your custom parts in it, a set inside it too', async () => {
    const tower = await part(alice, 'TOWER');
    const lamp = await part(alice, 'LAMP');
    const inner = await set(alice, 'Lights', ['LAMP']);
    await part(bob, 'BARN'); // someone else's part with a number the set names: not alice's
    const yard = await set(alice, 'Yard', ['3001.1', 'tower', 'BARN', 'Lights']);
    // Another of her sets uses the tower: it's copied all the same.
    await set(alice, 'Depot', ['TOWER']);

    const p = (await copyPlan(alice, yard)).parts;
    expect(p.move).toEqual([]);
    expect(numbers(p.copy)).toEqual(['LAMP', 'Lights', 'TOWER']);
    // A part that isn't a set brings nothing.
    expect((await copyPlan(alice, tower)).parts).toEqual({ move: [], copy: [], inClub: [], notYours: [] });

    const res = await call(alice, 'POST', `/api/custom-parts/${yard}/copy`, { orgSlug: 'rail-club' });
    expect(res.statusCode).toBe(201);
    const body = res.json() as { id: string; parts: { copied: string[]; inClub: string[]; notYours: string[] } };
    expect(body.parts).toEqual({ copied: ['LAMP', 'Lights', 'TOWER'], inClub: [], notYours: [] });
    // Hers stay hers; the club has its own, credited to her and pointing at hers.
    for (const id of [yard, tower, lamp, inner]) expect(await ownerOf(id)).toBe('alice');
    expect(await ownerOf(body.id)).toBe('club');
    for (const [n, from] of [['TOWER', tower], ['LAMP', lamp], ['Lights', inner]] as const) {
      expect(await clubPart(n)).toMatchObject({ createdBy: alice.id, copiedFromId: from, ownerUserId: null });
    }
    expect((await clubPart('TOWER'))!.spriteMime).toBe('image/gif');
    // Bob, in the club, has the set's copy and every part it needs.
    const bobs = await all(bob);
    for (const n of ['Yard', 'TOWER', 'LAMP', 'Lights']) expect(bobs.some((x) => x.partNumber === n && x.ownerOrgId === clubId)).toBe(true);
    // Each copy is audit-logged with the set it came with.
    const audit = await db
      .select()
      .from(schema.auditEvents)
      .where(and(eq(schema.auditEvents.resourceId, (await clubPart('TOWER'))!.id), eq(schema.auditEvents.eventType, 'create')))
      .get();
    expect(JSON.parse(String(audit?.payload))).toMatchObject({ copiedFrom: tower, owner: { kind: 'org', id: clubId }, withSet: body.id });
  });

  it('copying: a number the club already has is left to the club’s part', async () => {
    const clubTower = await part(alice, 'TOWER', 'rail-club');
    await part(alice, 'TOWER');
    await part(alice, 'SHED');
    const yard = await set(alice, 'Yard', ['TOWER', 'SHED']);
    const p = (await copyPlan(alice, yard)).parts;
    expect(numbers(p.inClub)).toEqual(['TOWER']);
    expect(numbers(p.copy)).toEqual(['SHED']);
    const res = await call(alice, 'POST', `/api/custom-parts/${yard}/copy`, { orgSlug: 'rail-club' });
    expect((res.json() as { parts: unknown }).parts).toEqual({ copied: ['SHED'], inClub: ['TOWER'], notYours: [] });
    const towers = await db.select().from(schema.customParts).where(and(eq(schema.customParts.ownerOrgId, clubId), eq(schema.customParts.partNumber, 'TOWER'))).all();
    expect(towers.map((t) => t.id)).toEqual([clubTower]);
  });

  it('copying someone else’s set: their parts aren’t yours, so they aren’t copied', async () => {
    const carol = await loginAs(app, 'carol@example.com');
    await part(alice, 'TOWER');
    const yard = await set(alice, 'Yard', ['TOWER']);
    const inv = (await call(alice, 'POST', `/api/custom-parts/${yard}/invites`, { email: 'carol@example.com', role: 'viewer' })).json() as { token: string };
    expect((await call(carol, 'POST', `/api/part-invites/${inv.token}`)).statusCode).toBe(200);
    expect((await call(carol, 'POST', '/api/orgs', { name: 'Carol Club' })).statusCode).toBe(201);
    expect(numbers((await copyPlan(carol, yard, 'carol-club')).parts.notYours)).toEqual(['TOWER']);
    const res = await call(carol, 'POST', `/api/custom-parts/${yard}/copy`, { orgSlug: 'carol-club' });
    expect(res.statusCode).toBe(201);
    expect((res.json() as { parts: unknown }).parts).toEqual({ copied: [], inClub: [], notYours: ['TOWER'] });
  });

  it('the copy plan is for those who may see the set and add parts to the club', async () => {
    await part(alice, 'TOWER');
    const yard = await set(alice, 'Yard', ['TOWER']);
    expect((await call(bob, 'GET', `/api/custom-parts/${yard}/copy-plan?orgSlug=rail-club`)).statusCode).toBe(404);
    expect((await call(alice, 'GET', `/api/custom-parts/${yard}/copy-plan`)).statusCode).toBe(400);
    expect((await call(null, 'GET', `/api/custom-parts/${yard}/copy-plan?orgSlug=rail-club`)).statusCode).toBe(401);
  });
});

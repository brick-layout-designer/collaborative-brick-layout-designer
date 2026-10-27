// The desktop deletes your own part or set with its API token (the
// deletePartsFromDesktop feature): DELETE /api/custom-parts/:id takes a
// parts:write token under exactly the website's checks. The owner, or a
// club role that manages the club's parts, may; a non-owner, a viewer, a
// revoked token or a token without parts:write may not. A set deleted this
// way takes back the parts it brought along, and its pending invites go.

import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import fastifyMultipart from '@fastify/multipart';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { attachUser } from '../../auth/cookie.js';
import { registerApiRoutes } from '../all.js';
import { closeAll } from '../../events/hub.js';
import { invalidateLimitCaches } from '../../limits/limits.js';
import { FEATURES } from '../../compat.js';
import { db, issueToken, loginAs, resetDb, schema } from '../../test/helpers.js';

type Who = { cookie: string; id: string };

const FAKE_GIF = Buffer.from('GIF89a    \xff\xff\xff   !\xf9    ,       D ;', 'binary').toString('base64');
const PART_XML = Buffer.from('<?xml version="1.0"?><part/>').toString('base64');
const setXml = (name: string, ids: string[]) =>
  Buffer.from(
    `<?xml version="1.0" encoding="utf-8"?>\n<group>\n\t<Description><en>${name}</en></Description>\n\t<SubPartList>\n` +
      ids.map((id, i) => `\t\t<SubPart id="${id}"><position><x>${i * 8}</x><y>0</y></position><angle>0</angle></SubPart>\n`).join('') +
      '\t</SubPartList>\n</group>\n',
  ).toString('base64');

describe('deleting a custom part or set with a desktop token', () => {
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

  const call = (who: Who, method: 'GET' | 'POST' | 'DELETE', url: string, payload?: object) =>
    app.inject({ method, url, headers: { cookie: who.cookie }, ...(payload ? { payload } : {}) });
  const withToken = (token: string, id: string) =>
    app.inject({ method: 'DELETE', url: `/api/custom-parts/${id}`, headers: { authorization: `Bearer ${token}` } });
  async function part(who: Who, partNumber: string, extra: object = {}) {
    const r = await call(who, 'POST', '/api/custom-parts', { partNumber, displayName: `${partNumber} name`, xmlBase64: PART_XML, spriteBase64: FAKE_GIF, spriteMime: 'image/gif', ...extra });
    expect(r.statusCode).toBe(201);
    return (r.json() as { id: string }).id;
  }
  async function set(who: Who, partNumber: string, ids: string[]) {
    const r = await call(who, 'POST', '/api/custom-parts', { partNumber, displayName: partNumber, xmlBase64: setXml(partNumber, ids) });
    expect(r.statusCode).toBe(201);
    return (r.json() as { id: string }).id;
  }
  async function share(from: Who, id: string, to: Who, email: string) {
    const inv = await call(from, 'POST', `/api/custom-parts/${id}/invites`, { email, role: 'viewer' });
    expect(inv.statusCode).toBe(200);
    const acc = await call(to, 'POST', `/api/part-invites/${(inv.json() as { token: string }).token}`);
    expect(acc.statusCode).toBe(200);
  }
  const exists = async (id: string) => !!(await db.select().from(schema.customParts).where(eq(schema.customParts.id, id)).get());
  const has = async (who: Who, id: string) =>
    ((await call(who, 'GET', '/api/custom-parts')).json() as { parts: { id: string }[] }).parts.some((p) => p.id === id);

  it('is advertised as a server feature', () => {
    expect(FEATURES).toContain('deletePartsFromDesktop');
  });

  it('lets the owner delete a shared set, with the same audit event and share and invite cleanup as the website', async () => {
    const sam = await loginAs(app, 'sam@example.com');
    const bea = await loginAs(app, 'bea@example.com');
    const tower = await part(sam, 'Tower');
    const yard = await set(sam, 'Yard', ['3001.1', 'Tower']);
    await share(sam, yard, bea, 'bea@example.com');
    expect(await has(bea, yard)).toBe(true);
    expect(await has(bea, tower)).toBe(true);
    const pending = await call(sam, 'POST', `/api/custom-parts/${yard}/invites`, { email: 'cy@example.com', role: 'viewer' });
    expect(pending.statusCode).toBe(200);

    const token = await issueToken(app, sam.cookie, 'parts:write');
    const res = await withToken(token, yard);
    expect(res.statusCode).toBe(200);
    expect(await exists(yard)).toBe(false);
    // The set and the part it brought along leave Bea's parts; Sam's part stays his.
    expect(await has(bea, yard)).toBe(false);
    expect(await has(bea, tower)).toBe(false);
    expect(await exists(tower)).toBe(true);
    expect(await db.select().from(schema.customPartInvites).where(eq(schema.customPartInvites.customPartId, yard)).all()).toEqual([]);
    const audit = await db
      .select()
      .from(schema.auditEvents)
      .where(and(eq(schema.auditEvents.resourceKind, 'custom_part'), eq(schema.auditEvents.resourceId, yard), eq(schema.auditEvents.eventType, 'delete')))
      .all();
    expect(audit).toHaveLength(1);
    expect(audit[0]!.userId).toBe(sam.id);
  });

  it("refuses someone else's token, a viewer's, a revoked one and one without parts:write", async () => {
    const sam = await loginAs(app, 'sam@example.com');
    const bea = await loginAs(app, 'bea@example.com');
    const eve = await loginAs(app, 'eve@example.com');
    const yard = await set(sam, 'Yard', ['3001.1']);
    await share(sam, yard, bea, 'bea@example.com');

    // Eve has no access at all: it isn't there for her.
    expect((await withToken(await issueToken(app, eve.cookie, 'parts:write'), yard)).statusCode).toBe(404);
    // Bea only views it.
    expect((await withToken(await issueToken(app, bea.cookie, 'parts:write'), yard)).statusCode).toBe(403);
    // Sam's own token, but only to read parts.
    expect((await withToken(await issueToken(app, sam.cookie, 'parts:read'), yard)).statusCode).toBe(403);
    // Sam's token, revoked.
    const revoked = await issueToken(app, sam.cookie, 'parts:write');
    const tokens = (await call(sam, 'GET', '/api/tokens')).json() as { tokens: { id: string }[] };
    for (const t of tokens.tokens) expect((await call(sam, 'DELETE', `/api/tokens/${t.id}`)).statusCode).toBe(200);
    expect((await withToken(revoked, yard)).statusCode).toBe(401);
    expect(await exists(yard)).toBe(true);
  });

  it("lets a club role that manages the club's parts delete one, and not a plain member", async () => {
    const ann = await loginAs(app, 'ann@example.com');
    const max = await loginAs(app, 'max@example.com');
    const orgId = 'org-yard';
    await db.insert(schema.orgs).values({ id: orgId, name: 'Yard Club', slug: 'yard-club', createdAt: new Date(), membersCanCreate: false });
    await db.insert(schema.orgMembers).values({ orgId, userId: ann.id, role: 'admin', joinedAt: new Date() });
    await db.insert(schema.orgMembers).values({ orgId, userId: max.id, role: 'member', joinedAt: new Date() });
    const clubPart = await part(ann, 'Signal', { orgSlug: 'yard-club' });

    expect((await withToken(await issueToken(app, max.cookie, 'parts:write'), clubPart)).statusCode).toBe(403);
    expect(await exists(clubPart)).toBe(true);
    expect((await withToken(await issueToken(app, ann.cookie, 'parts:write'), clubPart)).statusCode).toBe(200);
    expect(await exists(clubPart)).toBe(false);
  });
});

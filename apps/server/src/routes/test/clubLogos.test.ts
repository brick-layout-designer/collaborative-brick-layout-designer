// Club logos (routes/clubLogos.ts, images/logos.ts): a club admin sets
// one (PNG, JPEG, WebP or a plain SVG), stored and served only as a WebP no
// bigger than 512 px a side; who may set it and who may see it; the SVG
// and size rules; removing it; and where it shows (club lists, the club
// page, the directory) and goes (the club's data download).

import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import sharp from 'sharp';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { db, loginAs, resetDb, schema } from '../../test/helpers.js';
import { sqlite } from '../../db/index.js';
import { attachUser } from '../../auth/cookie.js';
import { registerApiRoutes } from '../all.js';
import { closeAll } from '../../events/hub.js';
import { settleExports } from '../../privacy/exports.js';
import { readZip } from '../../test/zip.js';
import { svgProblem } from '../../images/logos.js';

type Who = { cookie: string; id: string };

describe('club logos', () => {
  let app: FastifyInstance;
  let ann: Who; // admin
  let ben: Who; // member
  let cy: Who; // not in it
  let orgId: string;

  beforeEach(async () => {
    resetDb();
    sqlite.exec('DELETE FROM data_exports;');
    app = Fastify({ logger: false, bodyLimit: 20 * 1024 * 1024 });
    await app.register(cookie);
    app.addHook('preHandler', attachUser);
    await registerApiRoutes(app);
    ann = await loginAs(app, 'ann@x.com');
    ben = await loginAs(app, 'ben@x.com');
    cy = await loginAs(app, 'cy@x.com');
    const made = await app.inject({ method: 'POST', url: '/api/orgs', headers: { cookie: ann.cookie }, payload: { name: 'Rail Club' } });
    expect(made.statusCode, made.body).toBe(201);
    orgId = made.json().id;
    await db.insert(schema.orgMembers).values({ orgId, userId: ben.id, role: 'member', joinedAt: new Date() });
  });

  afterEach(async () => {
    await settleExports();
    closeAll();
    await app.close();
  });

  const put = (who: Who, mime: string, bytes: Buffer) =>
    app.inject({ method: 'PUT', url: '/api/orgs/rail-club/logo', headers: { cookie: who.cookie }, payload: { mime, data: bytes.toString('base64') } });
  const get = (who: Who, url = '/api/orgs/rail-club/logo') => app.inject({ method: 'GET', url, headers: { cookie: who.cookie } });
  const png = (w: number, h: number) => sharp({ create: { width: w, height: h, channels: 4, background: { r: 200, g: 30, b: 30, alpha: 1 } } }).png().toBuffer();
  const svg = (inner: string) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">${inner}</svg>`);

  it('a club admin sets it; it is kept as a WebP no bigger than 512 px, and shows in the club lists', async () => {
    const res = await put(ann, 'image/png', await png(1200, 600));
    expect(res.statusCode, res.body).toBe(200);
    const url = res.json().logoUrl as string;
    expect(url).toMatch(/^\/api\/orgs\/rail-club\/logo\?v=\d+$/);
    const pic = await get(ben, url);
    expect(pic.statusCode).toBe(200);
    expect(pic.headers['content-type']).toBe('image/webp');
    expect(pic.headers['x-content-type-options']).toBe('nosniff');
    expect(pic.headers['content-security-policy']).toBe("default-src 'none'");
    const meta = await sharp(pic.rawPayload).metadata();
    expect([meta.format, meta.width, meta.height]).toEqual(['webp', 512, 256]);
    // My clubs, the club page.
    expect((await get(ben, '/api/orgs')).json().orgs[0].logoUrl).toBe(url);
    expect((await get(ben, '/api/orgs/rail-club')).json().logoUrl).toBe(url);
    const events = await db.select({ t: schema.auditEvents.eventType }).from(schema.auditEvents).where(eq(schema.auditEvents.resourceId, orgId));
    expect(events.map((e) => e.t)).toContain('club_logo_set');
  });

  it('only its admins may set or remove it; outsiders see it only when the club is listed', async () => {
    expect((await put(ben, 'image/png', await png(64, 64))).statusCode).toBe(403);
    expect((await put(cy, 'image/png', await png(64, 64))).statusCode).toBe(404);
    expect((await put(ann, 'image/png', await png(64, 64))).statusCode).toBe(200);
    expect((await get(cy)).statusCode).toBe(404);
    await db.update(schema.orgs).set({ listed: true }).where(eq(schema.orgs.id, orgId));
    expect((await get(cy)).statusCode).toBe(200);
    // The directory shows it too.
    const listed = (await get(cy, '/api/club-directory')).json().clubs;
    expect(listed[0].logoUrl).toMatch(/\/logo\?v=/);
    expect((await app.inject({ method: 'DELETE', url: '/api/orgs/rail-club/logo', headers: { cookie: ben.cookie } })).statusCode).toBe(403);
    expect((await app.inject({ method: 'DELETE', url: '/api/orgs/rail-club/logo', headers: { cookie: ann.cookie } })).statusCode).toBe(200);
    expect((await get(ann)).statusCode).toBe(404);
    expect((await get(ann, '/api/orgs/rail-club')).json().logoUrl).toBeNull();
  });

  it('takes a plain SVG, drawn into a WebP; never one that reaches outside itself', async () => {
    const ok = await put(ann, 'image/svg+xml', svg('<defs><linearGradient id="g"><stop offset="0" stop-color="red"/></linearGradient></defs><rect width="64" height="64" fill="url(#g)"/><use href="#g"/>'));
    expect(ok.statusCode, ok.body).toBe(200);
    const pic = await get(ann);
    expect(pic.headers['content-type']).toBe('image/webp');
    expect((await sharp(pic.rawPayload).metadata()).format).toBe('webp');
    const refused = [
      svg('<script>alert(1)</script>'),
      svg('<SCRIPT>alert(1)</SCRIPT>'),
      svg('<image href="https://example.com/x.png" width="10" height="10"/>'),
      svg('<image xlink:href="file:///etc/passwd"/>'),
      svg('<image xmlns:z="http://www.w3.org/1999/xlink" z:href="https://example.com/x.png" width="10" height="10"/>'),
      svg('<image xmlns:a.b-c="http://www.w3.org/1999/xlink" a.b-c:href="https://example.com/x.png"/>'),
      svg('<rect style="fill:url(https://example.com/x)" width="1" height="1"/>'),
      svg('<rect onload="x()" width="1" height="1"/>'),
      svg('<foreignObject><div/></foreignObject>'),
      svg('<rect style="fill:u\\72l(https://e.com)" width="1" height="1"/>'),
      Buffer.from('<?xml version="1.0"?><!DOCTYPE svg [<!ENTITY x "y">]><svg xmlns="http://www.w3.org/2000/svg">&x;</svg>'),
      Buffer.from('not an svg'),
    ];
    for (const bytes of refused) {
      const res = await put(ann, 'image/svg+xml', bytes);
      expect(res.statusCode, bytes.toString()).toBe(400);
      expect(res.json().error).toBe('invalid_logo');
    }
    expect(svgProblem(svg('<rect width="1" height="1"/>'))).toBeNull();
  });

  it('refuses what isn’t the picture it says, and anything too big', async () => {
    const fake = await put(ann, 'image/png', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'));
    expect(fake.statusCode).toBe(400);
    expect((await put(ann, 'image/gif', await png(8, 8))).statusCode).toBe(400);
    const big = await put(ann, 'image/svg+xml', svg(`<desc>${'x'.repeat(300 * 1024)}</desc>`));
    expect(big.statusCode).toBe(413);
    expect(big.json()).toMatchObject({ error: 'logo_too_large', maxBytes: 256 * 1024 });
  });

  it('goes in the club’s data download', async () => {
    expect((await put(ann, 'image/png', await png(64, 64))).statusCode).toBe(200);
    expect((await app.inject({ method: 'POST', url: '/api/orgs/rail-club/exports', headers: { cookie: ann.cookie } })).statusCode).toBe(202);
    await settleExports();
    const url = (await get(ann, '/api/orgs/rail-club/exports')).json().exports[0].downloadUrl as string;
    const zip = readZip((await get(ann, url)).rawPayload);
    expect([...zip.keys()]).toContain('club-logo.webp');
  });
});

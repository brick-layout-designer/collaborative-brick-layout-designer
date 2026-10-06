// Catalog items' own cover pictures (modules and parts): the same rules as a
// collection's cover. Checked and re-encoded, reviewed while the item is
// public (the old picture stays up), trusted clubs review their own,
// counted in the owner's space and cleaned up when replaced or removed.

import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, resetDb, schema } from '../../test/helpers.js';
import { attachUser } from '../../auth/cookie.js';
import { passwordRoutes } from '../auth/password.js';
import { sessionRoutes } from '../auth/session.js';
import { orgRoutes } from '../orgs.js';
import { moduleRoutes } from '../modules.js';
import { catalogRoutes } from '../catalog.js';
import { collectionRoutes } from '../collections.js';
import { clubReviewRoutes } from '../clubReview.js';
import { itemCoverRoutes } from '../itemCovers.js';
import { getPlatformSettings, PLATFORM_SETTINGS_ID } from '../../auth/platformSettings.js';
import { usageOf } from '../../limits/limits.js';

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ bodyLimit: 1024 * 1024 });
  await app.register(cookie);
  await app.register(rateLimit, { global: false });
  app.addHook('preHandler', attachUser);
  await app.register(passwordRoutes);
  await app.register(sessionRoutes);
  await app.register(orgRoutes);
  await app.register(moduleRoutes);
  await app.register(catalogRoutes);
  await app.register(collectionRoutes);
  await app.register(clubReviewRoutes);
  await app.register(itemCoverRoutes);
  return app;
}

async function login(app: FastifyInstance, email: string): Promise<string> {
  await app.inject({ method: 'POST', url: '/api/auth/password/register', payload: { email, password: 'correct horse battery', displayName: email.split('@')[0] } });
  const user = await db.select().from(schema.users).where(eq(schema.users.email, email)).get();
  const v = await db.select().from(schema.emailVerifications).where(eq(schema.emailVerifications.userId, user!.id)).get();
  const res = await app.inject({ method: 'POST', url: `/api/auth/password/verify-email/${v!.token}` });
  const c = res.headers['set-cookie'];
  return Array.isArray(c) ? c.join('; ') : (c ?? '');
}

async function settings(patch: Partial<typeof schema.platformSettings.$inferInsert>) {
  await getPlatformSettings();
  await db.update(schema.platformSettings).set(patch).where(eq(schema.platformSettings.id, PLATFORM_SETTINGS_ID));
}

const userId = async (email: string) => (await db.select().from(schema.users).where(eq(schema.users.email, email)).get())!.id;

/** A photo-like JPEG with a camera's EXIF. */
const photo = () =>
  sharp({ create: { width: 2000, height: 1000, channels: 3, background: { r: 200, g: 40, b: 40 } } })
    .jpeg()
    .withExif({ IFD0: { Make: 'PhoneCam', Copyright: 'secret-exif' } })
    .toBuffer();
const png = (w = 300, h = 200) => sharp({ create: { width: w, height: h, channels: 4, background: { r: 0, g: 90, b: 200, alpha: 1 } } }).png().toBuffer();

type Card = { id: string; coverUrl: string; customCover: boolean; previewUrl: string };
type Put = { status: 'public' | 'in_review'; customCoverUrl: string | null; pendingCoverUrl: string | null; coverReason: string | null };

describe('catalog item covers', () => {
  let app: FastifyInstance;
  let ada: string; // a person, and the ArkLUG admin
  let max: string; // ArkLUG manager
  let mel: string; // ArkLUG member
  let out: string; // nobody in particular
  let mod: string; // site moderator
  let orgId: string;

  const req = (method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, cookie?: string, payload?: unknown) =>
    app.inject({ method, url, headers: cookie ? { cookie } : {}, ...(payload !== undefined ? { payload: payload as Record<string, unknown> } : {}) });
  const put = (id: string, cookie: string, bytes: Buffer, mime = 'image/png') => req('PUT', `/api/catalog/items/${id}/cover`, cookie, { mime, data: bytes.toString('base64') });
  const covers = (id: string) => db.select().from(schema.catalogItemCovers).where(eq(schema.catalogItemCovers.itemId, id));
  const card = async (id: string, cookie?: string) =>
    ((await req('GET', '/api/catalog/items?kind=module', cookie)).json() as { items: Card[] }).items.find((i) => i.id === id);
  /** A module shared to the catalog: public when `publicNow` (review off while sharing). */
  const share = async (cookie: string, publicNow: boolean, orgSlug?: string) => {
    if (publicNow) await settings({ catalogReview: 'none' });
    const m = ((await req('POST', '/api/modules', cookie, { title: 'Station', ...(orgSlug ? { orgSlug } : {}) })).json() as { id: string }).id;
    // Its drawn picture (lists only point at a picture that exists).
    const thumb = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
    expect((await req('PUT', `/api/modules/${m}/thumbnail`, cookie, { mime: 'image/png', data: thumb })).statusCode).toBe(200);
    const r = await req('POST', '/api/catalog/submissions', cookie, { kind: 'module', sourceId: m, title: 'Station' });
    expect(r.statusCode).toBe(201);
    await settings({ catalogReview: 'moderators' });
    return (r.json() as { id: string }).id;
  };

  beforeEach(async () => {
    resetDb();
    app = await buildApp();
    ada = await login(app, 'ada@example.com');
    max = await login(app, 'max@example.com');
    mel = await login(app, 'mel@example.com');
    out = await login(app, 'out@example.com');
    mod = await login(app, 'mod@example.com');
    await db.update(schema.users).set({ isModerator: true }).where(eq(schema.users.id, await userId('mod@example.com')));
    await settings({ moduleCatalogEnabled: true, partsCatalogEnabled: true, catalogReview: 'moderators', catalogAnonymousBrowse: true });
    orgId = ((await req('POST', '/api/orgs', ada, { name: 'ArkLUG', slug: 'arklug' })).json() as { id: string }).id;
    const now = new Date();
    await db.insert(schema.orgMembers).values({ orgId, userId: await userId('max@example.com'), role: 'manager', joinedAt: now });
    await db.insert(schema.orgMembers).values({ orgId, userId: await userId('mel@example.com'), role: 'member', joinedAt: now });
  });
  afterEach(async () => {
    await app.close();
  });

  it('refuses other types, a mislabelled file, and pictures over the size an admin set', async () => {
    const id = await share(ada, true);
    const gif = Buffer.from('GIF89a\x01\x00\x01\x00\x80\x00\x00\xff\xff\xff\x00\x00\x00!\xf9\x04\x00\x00\x00\x00\x00,\x00\x00\x00\x00\x01\x00\x01\x00\x00\x02\x02D\x01\x00;', 'latin1');
    expect((await put(id, ada, gif, 'image/gif')).json()).toEqual({ error: 'invalid_cover' });
    expect((await put(id, ada, gif, 'image/png')).statusCode).toBe(400);
    expect((await req('PUT', `/api/catalog/items/${id}/cover`, ada, { mime: 'image/png', data: 'not base64!' })).statusCode).toBe(400);
    const small = await png();
    await settings({ collectionCoverMaxBytes: small.length - 1 });
    const big = await put(id, ada, small);
    expect(big.statusCode).toBe(413);
    expect(big.json()).toEqual({ error: 'cover_too_large', maxBytes: small.length - 1 });
    expect(await covers(id)).toHaveLength(0);
    await settings({ collectionCoverMaxBytes: small.length });
    expect((await put(id, ada, small)).statusCode).toBe(200);
  });

  it('stores a WebP with the EXIF gone, and serves the card copy', async () => {
    const id = await share(ada, false);
    // Not public yet: it's set at once, and reviewed with the item.
    const r = (await put(id, ada, await photo(), 'image/jpeg')).json() as Put;
    expect(r.status).toBe('public');
    const [row] = await covers(id);
    const meta = await sharp(Buffer.from(row!.image as Uint8Array)).metadata();
    expect(meta).toMatchObject({ format: 'webp', width: 1200, height: 600 });
    expect(Buffer.from(row!.image as Uint8Array).includes('secret-exif')).toBe(false);
    const got = await req('GET', r.customCoverUrl!, ada);
    expect(got.headers['content-type']).toBe('image/webp');
    expect((await sharp(got.rawPayload).metadata()).width).toBe(480);
    // The moderator sees it with the submission; the public doesn't, yet.
    const q = ((await req('GET', '/api/moderation/items', mod)).json() as { queue: { itemId: string; coverUrl: string | null }[] }).queue;
    expect(q).toEqual([expect.objectContaining({ itemId: id, coverUrl: r.customCoverUrl })]);
    expect((await req('GET', r.customCoverUrl!, mod)).statusCode).toBe(200);
    expect((await req('GET', r.customCoverUrl!, out)).statusCode).toBe(404);
    expect((await req('GET', r.customCoverUrl!)).statusCode).toBe(404);
  });

  it('on a public item a new picture waits for review while the old one stays up', async () => {
    const id = await share(ada, true);
    const before = (await card(id, out))!;
    expect(before.customCover).toBe(false);
    expect(before.coverUrl).toBe(before.previewUrl);
    const r = (await put(id, ada, await png())).json() as Put;
    expect(r.status).toBe('in_review');
    expect(r.customCoverUrl).toBeNull();
    // The public still sees the drawn picture, and can't fetch the new one.
    expect((await card(id, out))!.coverUrl).toBe(before.coverUrl);
    expect((await req('GET', r.pendingCoverUrl!, out)).statusCode).toBe(404);
    expect((await req('GET', r.pendingCoverUrl!)).statusCode).toBe(404);
    // The moderator sees old and new side by side.
    const m = (await req('GET', '/api/moderation/items', mod)).json() as { covers: { itemId: string; oldUrl: string; newUrl: string }[] };
    expect(m.covers).toEqual([expect.objectContaining({ itemId: id, oldUrl: before.previewUrl, newUrl: r.pendingCoverUrl })]);
    expect((await req('GET', r.pendingCoverUrl!, mod)).statusCode).toBe(200);
    // Only moderators decide.
    expect((await req('POST', `/api/moderation/items/${id}/cover/approve`, ada, {})).statusCode).toBe(403);
    expect((await req('POST', `/api/moderation/items/${id}/cover/approve`, mod, {})).statusCode).toBe(200);
    const after = (await card(id, out))!;
    expect(after.customCover).toBe(true);
    expect(after.coverUrl).toBe(r.pendingCoverUrl);
    expect((await req('GET', after.coverUrl)).statusCode).toBe(200);
    // Nothing more waiting.
    expect((await req('POST', `/api/moderation/items/${id}/cover/approve`, mod, {})).statusCode).toBe(404);
  });

  it('a declined picture goes, says why, and the one showing stays', async () => {
    const id = await share(ada, true);
    await put(id, ada, await png());
    await req('POST', `/api/moderation/items/${id}/cover/approve`, mod, {});
    const live = (await card(id, out))!.coverUrl;
    await put(id, ada, await png(640, 480));
    expect(await covers(id)).toHaveLength(2);
    expect((await req('POST', `/api/moderation/items/${id}/cover/decline`, mod, { reason: 'Blurry' })).statusCode).toBe(200);
    expect(await covers(id)).toHaveLength(1);
    expect((await card(id, out))!.coverUrl).toBe(live);
    const mine = (await req('GET', '/api/catalog/mine', ada)).json() as { items: { id: string; coverReason: string | null; pendingCoverUrl: string | null }[] };
    expect(mine.items.find((i) => i.id === id)).toMatchObject({ coverReason: 'Blurry', pendingCoverUrl: null });
  });

  it('with review off, or for a moderator, it shows at once', async () => {
    const id = await share(ada, true);
    await settings({ catalogReview: 'none' });
    expect(((await put(id, ada, await png())).json() as Put).status).toBe('public');
    await settings({ catalogReview: 'moderators' });
    const modItem = await share(mod, true);
    expect(((await put(modItem, mod, await png())).json() as Put).status).toBe('public');
  });

  it('a trusted club publishes its own at once, and approves a member’s in its own queue', async () => {
    const id = await share(ada, true, 'arklug');
    // Not trusted: a member may not; a manager's waits for the site.
    expect((await put(id, mel, await png())).statusCode).toBe(403);
    expect(((await put(id, max, await png())).json() as Put).status).toBe('in_review');
    expect((await req('POST', '/api/moderation/clubs/arklug/trust', mod, { trusted: true })).statusCode).toBe(200);
    // Trusted: what waits is the club's to decide.
    const m = (await req('GET', '/api/moderation/items', mod)).json() as { covers: unknown[]; trustedCovers: { itemId: string }[] };
    expect(m.covers).toHaveLength(0);
    expect(m.trustedCovers).toEqual([expect.objectContaining({ itemId: id })]);
    expect((await req('POST', `/api/orgs/arklug/review/items/${id}/cover/approve`, mel, {})).statusCode).toBe(403);
    expect((await req('POST', `/api/orgs/arklug/review/items/${id}/cover/approve`, max, {})).statusCode).toBe(200);
    expect((await card(id, out))!.customCover).toBe(true);
    // A member's new one waits in the club's queue; the manager's is up at once.
    const waiting = (await put(id, mel, await png(400, 300))).json() as Put;
    expect(waiting.status).toBe('in_review');
    const club = (await req('GET', '/api/orgs/arklug/review', max)).json() as { covers: { itemId: string; newUrl: string }[] };
    expect(club.covers).toEqual([expect.objectContaining({ itemId: id, newUrl: waiting.pendingCoverUrl })]);
    expect((await req('GET', waiting.pendingCoverUrl!, max)).statusCode).toBe(200);
    expect((await req('POST', `/api/orgs/arklug/review/items/${id}/cover/decline`, max, { reason: 'Not ours' })).statusCode).toBe(200);
    expect(((await put(id, max, await png(500, 300))).json() as Put).status).toBe('public');
    // Another club can't decide for it.
    await req('POST', '/api/orgs', out, { name: 'Other', slug: 'other' });
    await req('POST', '/api/moderation/clubs/other/trust', mod, { trusted: true });
    await put(id, mel, await png(200, 200));
    expect((await req('POST', `/api/orgs/other/review/items/${id}/cover/approve`, out, {})).statusCode).toBe(404);
  });

  it('only those who manage it change it: 403 to those who can see it, 404 to others', async () => {
    const pub = await share(ada, true);
    const waiting = await share(ada, false);
    const img = await png();
    expect((await put(pub, out, img)).statusCode).toBe(403);
    expect((await put(pub, out, Buffer.from('nope'))).statusCode).toBe(403);
    expect((await put(waiting, out, img)).statusCode).toBe(404);
    expect((await req('DELETE', `/api/catalog/items/${pub}/cover`, out)).statusCode).toBe(403);
    expect((await req('DELETE', `/api/catalog/items/${waiting}/cover`, out)).statusCode).toBe(404);
    expect((await put(pub, mod, img)).statusCode).toBe(403);
    expect((await req('PUT', `/api/catalog/items/${pub}/cover`, undefined, { mime: 'image/png', data: img.toString('base64') })).statusCode).toBe(401);
    expect(await db.select().from(schema.catalogItemCovers)).toHaveLength(0);
  });

  it('deletes old pictures when replaced or removed, and goes back to the drawn one', async () => {
    const id = await share(ada, false);
    await put(id, ada, await png());
    const second = (await put(id, ada, await png(500, 400))).json() as Put;
    expect(await covers(id)).toHaveLength(1);
    expect(second.customCoverUrl).toContain((await covers(id))[0]!.id);
    const del = await req('DELETE', `/api/catalog/items/${id}/cover`, ada);
    expect(del.statusCode).toBe(200);
    expect(del.json()).toMatchObject({ customCoverUrl: null, pendingCoverUrl: null });
    expect(await covers(id)).toHaveLength(0);
    // A public item: removing is at once, and takes a waiting one too.
    const pub = await share(ada, true);
    await put(pub, ada, await png());
    await req('POST', `/api/moderation/items/${pub}/cover/approve`, mod, {});
    await put(pub, ada, await png(320, 240));
    expect(await covers(pub)).toHaveLength(2);
    expect((await req('DELETE', `/api/catalog/items/${pub}/cover`, ada)).statusCode).toBe(200);
    expect(await covers(pub)).toHaveLength(0);
    expect((await card(pub, out))!.customCover).toBe(false);
  });

  it('counts toward the owner’s or club’s space', async () => {
    const mine = await share(ada, false);
    const club = await share(ada, false, 'arklug');
    const before = usageOf({ kind: 'user', id: await userId('ada@example.com') }).storageBytes;
    const clubBefore = usageOf({ kind: 'org', id: orgId }).storageBytes;
    await put(mine, ada, await photo(), 'image/jpeg');
    await put(club, max, await photo(), 'image/jpeg');
    const [a] = await covers(mine);
    const size = (a!.image as Uint8Array).length + (a!.small as Uint8Array).length;
    expect(usageOf({ kind: 'user', id: await userId('ada@example.com') }).storageBytes).toBe(before + size);
    expect(usageOf({ kind: 'org', id: orgId }).storageBytes).toBeGreaterThan(clubBefore);
    expect(usageOf({ kind: 'user', id: await userId('max@example.com') }).storageBytes).toBe(0);
  });
});

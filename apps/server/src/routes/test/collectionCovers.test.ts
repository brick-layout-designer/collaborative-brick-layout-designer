// Collection covers: a curator's own picture, checked, re-encoded, reviewed
// like the title on a public collection, counted in the owner's space and
// cleaned up when it's replaced, removed or its collection goes.

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
import { getPlatformSettings, PLATFORM_SETTINGS_ID } from '../../auth/platformSettings.js';
import { usageOf } from '../../limits/limits.js';
import { COVER_BODY_LIMIT, COVER_MAX_CEILING } from '../../images/covers.js';

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

/** A photo-like JPEG, 2000 × 1000, with a camera's EXIF (and where it was taken). */
const photo = () =>
  sharp({ create: { width: 2000, height: 1000, channels: 3, background: { r: 200, g: 40, b: 40 } } })
    .jpeg()
    .withExif({ IFD0: { Make: 'PhoneCam', Copyright: 'secret-exif' }, IFD3: { GPSLatitudeRef: 'N' } })
    .toBuffer();
const png = (w = 300, h = 200) => sharp({ create: { width: w, height: h, channels: 4, background: { r: 0, g: 90, b: 200, alpha: 1 } } }).png().toBuffer();

type Detail = { collection: { coverUrl: string | null; coverImageId: string | null; pending: { coverImageId: string | null; coverUrl: string | null } | null; status: string } };

describe('cover size ceiling', () => {
  it('keeps the biggest allowed upload under a 10 MiB WAF body limit', () => {
    // CrowdSec AppSec refuses bodies past about 10 MiB before the app sees them.
    expect(COVER_BODY_LIMIT).toBeLessThan(10 * 1024 * 1024);
    expect(COVER_MAX_CEILING).toBeGreaterThanOrEqual(5 * 1024 * 1024);
  });
});

describe('collection covers', () => {
  let app: FastifyInstance;
  let ada: string; // a person, and the ArkLUG admin
  let max: string; // ArkLUG manager
  let mel: string; // ArkLUG member
  let out: string; // nobody in particular
  let mod: string; // site moderator
  let orgId: string;

  const req = (method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', url: string, cookie?: string, payload?: unknown) =>
    app.inject({ method, url, headers: cookie ? { cookie } : {}, ...(payload !== undefined ? { payload: payload as Record<string, unknown> } : {}) });
  const put = async (id: string, cookie: string, bytes: Buffer, mime = 'image/png') => req('PUT', `/api/catalog/collections/${id}/cover`, cookie, { mime, data: bytes.toString('base64') });
  const detail = async (id: string, cookie = ada) => (await req('GET', `/api/catalog/collections/${id}`, cookie)).json() as Detail;
  const covers = async (id: string) => db.select().from(schema.catalogCollectionCovers).where(eq(schema.catalogCollectionCovers.collectionId, id));
  const make = async (cookie: string, audience: 'everyone' | 'private', clubSlug?: string) => {
    const m = ((await req('POST', '/api/modules', cookie, { title: 'Station', ...(clubSlug ? { orgSlug: clubSlug } : {}) })).json() as { id: string }).id;
    const r = await req('POST', '/api/catalog/collections', cookie, { title: 'Town', entries: [{ source: 'library', kind: 'module', id: m }], audience, ...(clubSlug ? { clubSlug } : {}) });
    expect(r.statusCode).toBe(201);
    return (r.json() as { id: string }).id;
  };
  /** A public collection, its module public too (made with review off; it's on again after). */
  const makePublic = async (cookie = ada, clubSlug?: string) => {
    await settings({ catalogReview: 'none' });
    const id = await make(cookie, 'everyone', clubSlug);
    await settings({ catalogReview: 'moderators' });
    expect((await detail(id, out)).collection.status).toBe('public');
    return id;
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
    await settings({ moduleCatalogEnabled: true, partsCatalogEnabled: true, catalogReview: 'moderators' });
    orgId = ((await req('POST', '/api/orgs', ada, { name: 'ArkLUG', slug: 'arklug' })).json() as { id: string }).id;
    const now = new Date();
    await db.insert(schema.orgMembers).values({ orgId, userId: await userId('max@example.com'), role: 'manager', joinedAt: now });
    await db.insert(schema.orgMembers).values({ orgId, userId: await userId('mel@example.com'), role: 'member', joinedAt: now });
  });
  afterEach(async () => {
    await app.close();
  });

  it('refuses other types, a mislabelled file, and pictures over the size an admin set', async () => {
    const id = await make(ada, 'private');
    const gif = Buffer.from('GIF89a\x01\x00\x01\x00\x80\x00\x00\xff\xff\xff\x00\x00\x00!\xf9\x04\x00\x00\x00\x00\x00,\x00\x00\x00\x00\x01\x00\x01\x00\x00\x02\x02D\x01\x00;', 'latin1');
    expect((await put(id, ada, gif, 'image/gif')).json()).toEqual({ error: 'invalid_cover' });
    // Says PNG, isn't.
    expect((await put(id, ada, gif, 'image/png')).statusCode).toBe(400);
    expect((await put(id, ada, Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'), 'image/png')).statusCode).toBe(400);
    expect((await req('PUT', `/api/catalog/collections/${id}/cover`, ada, { mime: 'image/png', data: 'not base64!' })).statusCode).toBe(400);
    const small = await png();
    await settings({ collectionCoverMaxBytes: small.length - 1 });
    const big = await put(id, ada, small);
    expect(big.statusCode).toBe(413);
    expect(big.json()).toEqual({ error: 'cover_too_large', maxBytes: small.length - 1 });
    expect(await covers(id)).toHaveLength(0);
    await settings({ collectionCoverMaxBytes: small.length });
    expect((await put(id, ada, small)).statusCode).toBe(200);
  });

  it('stores a WebP no wider than 1200 px with the EXIF gone, and a card copy', async () => {
    const id = await make(ada, 'private');
    const r = await put(id, ada, await photo(), 'image/jpeg');
    expect(r.statusCode).toBe(200);
    const [row] = await covers(id);
    const meta = await sharp(Buffer.from(row!.image as Uint8Array)).metadata();
    expect(meta).toMatchObject({ format: 'webp', width: 1200, height: 600 });
    expect(meta.exif).toBeUndefined();
    expect(Buffer.from(row!.image as Uint8Array).includes('secret-exif')).toBe(false);
    expect((await sharp(Buffer.from(row!.small as Uint8Array)).metadata()).width).toBe(480);
    // It's what's served, at both sizes.
    const url = (await detail(id)).collection.coverUrl!;
    expect(url).toContain('size=small');
    const got = await req('GET', url, ada);
    expect(got.headers['content-type']).toBe('image/webp');
    expect((await sharp(got.rawPayload).metadata()).width).toBe(480);
    expect((await sharp((await req('GET', url.replace('&size=small', ''), ada)).rawPayload).metadata()).width).toBe(1200);
  });

  it('a private collection’s cover changes at once, never reviewed', async () => {
    const id = await make(ada, 'private');
    const r = (await put(id, ada, await png())).json() as { coverImageId: string; pending: boolean };
    expect(r.pending).toBe(false);
    const d = await detail(id);
    expect(d.collection.coverImageId).toBe(r.coverImageId);
    expect(d.collection.pending).toBeNull();
    expect(((await req('GET', '/api/moderation/collections', mod)).json() as { queue: unknown[] }).queue).toHaveLength(0);
  });

  it('on a public collection a new cover waits for review while the old one stays up', async () => {
    const id = await makePublic();
    const first = ((await req('GET', '/api/catalog/collections', out)).json() as { collections: { id: string; coverUrl: string }[] }).collections[0]!.coverUrl;
    const r = (await put(id, ada, await png())).json() as { coverImageId: string; pending: boolean };
    expect(r.pending).toBe(true);
    // The public still sees the old cover, and can't fetch the new one.
    expect(((await req('GET', '/api/catalog/collections', out)).json() as { collections: { coverUrl: string }[] }).collections[0]!.coverUrl).toBe(first);
    expect((await req('GET', `/api/catalog/collections/${id}/cover?image=${r.coverImageId}`, out)).statusCode).toBe(404);
    // The moderator sees old and new side by side.
    const q = ((await req('GET', '/api/moderation/collections', mod)).json() as { queue: { id: string; coverUrl: string; old: { coverUrl: string } }[] }).queue;
    expect(q).toEqual([expect.objectContaining({ id, coverUrl: `/api/catalog/collections/${id}/cover?image=${r.coverImageId}` })]);
    expect(q[0]!.old.coverUrl).not.toBe(q[0]!.coverUrl);
    expect((await req('GET', q[0]!.coverUrl, mod)).statusCode).toBe(200);
    expect((await req('POST', `/api/moderation/collections/${id}/approve`, mod, {})).statusCode).toBe(200);
    expect((await detail(id, out)).collection.coverImageId).toBe(r.coverImageId);
    expect((await req('GET', `/api/catalog/collections/${id}/cover?image=${r.coverImageId}`, out)).statusCode).toBe(200);
  });

  it('a trusted club publishes its own at once, and approves one that waited in its own queue', async () => {
    const id = await makePublic(ada, 'arklug');
    const waiting = (await put(id, max, await png())).json() as { coverImageId: string; pending: boolean };
    expect(waiting.pending).toBe(true);
    expect((await req('POST', '/api/moderation/clubs/arklug/trust', mod, { trusted: true })).statusCode).toBe(200);
    const club = (await req('GET', '/api/orgs/arklug/review', max)).json() as { collections: { id: string; coverUrl: string }[] };
    expect(club.collections).toEqual([expect.objectContaining({ id, coverUrl: `/api/catalog/collections/${id}/cover?image=${waiting.coverImageId}` })]);
    expect((await req('GET', club.collections[0]!.coverUrl, max)).statusCode).toBe(200);
    expect((await req('POST', `/api/orgs/arklug/review/collections/${id}/approve`, max, {})).statusCode).toBe(200);
    expect((await detail(id, out)).collection.coverImageId).toBe(waiting.coverImageId);
    // Trusted now: the next one is up at once.
    const next = (await put(id, max, await png(400, 300))).json() as { coverImageId: string; pending: boolean };
    expect(next.pending).toBe(false);
    expect((await detail(id, out)).collection.coverImageId).toBe(next.coverImageId);
  });

  it('deletes old pictures when replaced, removed, declined, or when the collection or club goes', async () => {
    const id = await make(ada, 'private');
    await put(id, ada, await png());
    const second = ((await put(id, ada, await png(500, 400))).json() as { coverImageId: string }).coverImageId;
    expect((await covers(id)).map((c) => c.id)).toEqual([second]);
    expect((await req('DELETE', `/api/catalog/collections/${id}/cover`, ada)).statusCode).toBe(200);
    expect(await covers(id)).toHaveLength(0);
    expect((await detail(id)).collection.coverImageId).toBeNull();

    // Public: a declined new cover goes, the one showing stays.
    const pub = await makePublic();
    await put(pub, ada, await png());
    await req('POST', `/api/moderation/collections/${pub}/approve`, mod, {});
    const live = (await detail(pub)).collection.coverImageId;
    await put(pub, ada, await png(640, 480));
    expect(await covers(pub)).toHaveLength(2);
    await req('POST', `/api/moderation/collections/${pub}/decline`, mod, { reason: 'Blurry' });
    expect((await covers(pub)).map((c) => c.id)).toEqual([live]);
    // Withdrawn while one waits: that one goes too.
    await put(pub, ada, await png(320, 240));
    expect(await covers(pub)).toHaveLength(2);
    expect((await req('POST', `/api/catalog/collections/${pub}/withdraw`, ada, {})).statusCode).toBe(200);
    expect((await covers(pub)).map((c) => c.id)).toEqual([live]);
    expect((await req('DELETE', `/api/catalog/collections/${pub}`, ada)).statusCode).toBe(200);
    expect(await db.select().from(schema.catalogCollectionCovers)).toHaveLength(0);

    const clubs = await make(ada, 'private', 'arklug');
    await put(clubs, max, await png());
    expect(await covers(clubs)).toHaveLength(1);
    expect((await req('DELETE', '/api/orgs/arklug', ada, { confirm: 'ArkLUG' })).statusCode).toBe(200);
    expect(await db.select().from(schema.catalogCollectionCovers)).toHaveLength(0);
  });

  it('counts toward the owner’s or club’s space', async () => {
    const mine = await make(ada, 'private');
    const club = await make(ada, 'private', 'arklug');
    const before = usageOf({ kind: 'user', id: await userId('ada@example.com') }).storageBytes;
    const clubBefore = usageOf({ kind: 'org', id: orgId }).storageBytes;
    await put(mine, ada, await photo(), 'image/jpeg');
    await put(club, max, await photo(), 'image/jpeg');
    const [a] = await covers(mine);
    const size = (a!.image as Uint8Array).length + (a!.small as Uint8Array).length;
    expect(usageOf({ kind: 'user', id: await userId('ada@example.com') }).storageBytes).toBe(before + size);
    expect(usageOf({ kind: 'org', id: orgId }).storageBytes).toBeGreaterThan(clubBefore);
    // Not the manager's own space.
    expect(usageOf({ kind: 'user', id: await userId('max@example.com') }).storageBytes).toBe(0);
  });

  it('only curators change it: 403 to those who can see it, 404 to others', async () => {
    const priv = await make(ada, 'private');
    const club = await make(ada, 'private', 'arklug');
    const pub = await makePublic();
    const img = await png();
    expect((await put(priv, out, img)).statusCode).toBe(404);
    // Refused before the picture is even looked at.
    expect((await put(priv, out, Buffer.from('nope'))).statusCode).toBe(404);
    expect((await put(club, mel, Buffer.from('nope'))).statusCode).toBe(403);
    expect((await req('DELETE', `/api/catalog/collections/${priv}/cover`, out)).statusCode).toBe(404);
    expect((await put(club, mel, img)).statusCode).toBe(403);
    expect((await req('DELETE', `/api/catalog/collections/${club}/cover`, mel)).statusCode).toBe(403);
    expect((await put(club, out, img)).statusCode).toBe(404);
    expect((await put(pub, out, img)).statusCode).toBe(403);
    expect((await put(pub, mel, img)).statusCode).toBe(403);
    expect(await db.select().from(schema.catalogCollectionCovers)).toHaveLength(0);
    // The club's manager may; a private one's picture is only for insiders.
    const ok = (await put(club, max, img)).json() as { coverImageId: string };
    expect((await req('GET', `/api/catalog/collections/${club}/cover?image=${ok.coverImageId}`, mel)).statusCode).toBe(200);
    expect((await req('GET', `/api/catalog/collections/${club}/cover?image=${ok.coverImageId}`, out)).statusCode).toBe(404);
    expect((await req('GET', `/api/catalog/collections/${club}/cover?image=${ok.coverImageId}`)).statusCode).toBe(404);
  });
});

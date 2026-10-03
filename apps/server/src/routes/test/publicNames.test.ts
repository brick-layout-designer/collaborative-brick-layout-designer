// Display names that are email addresses (older accounts got their email
// as their name) never reach anyone but the person and site admins.
import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, resetDb, schema } from '../../test/helpers.js';
import { attachUser } from '../../auth/cookie.js';
import { passwordRoutes } from '../auth/password.js';
import { sessionRoutes } from '../auth/session.js';
import { orgRoutes } from '../orgs.js';
import { clubJoinRoutes } from '../clubJoin.js';
import { catalogRoutes } from '../catalog.js';
import { collectionRoutes } from '../collections.js';
import { getPlatformSettings, PLATFORM_SETTINGS_ID } from '../../auth/platformSettings.js';
import { fallbackName, looksLikeEmail, nameFor, needsName, publicName, suggestedName } from '../../utils/publicName.js';

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify();
  await app.register(cookie);
  await app.register(rateLimit, { global: false });
  app.addHook('preHandler', attachUser);
  await app.register(passwordRoutes);
  await app.register(sessionRoutes);
  await app.register(orgRoutes);
  await app.register(clubJoinRoutes);
  await app.register(catalogRoutes);
  await app.register(collectionRoutes);
  return app;
}

const userId = async (email: string) => (await db.select().from(schema.users).where(eq(schema.users.email, email)).get())!.id;

describe('publicName helper', () => {
  it('hides names that look like an email, and empty ones', () => {
    expect(looksLikeEmail('ann@example.com')).toBe(true);
    expect(looksLikeEmail('Ann')).toBe(false);
    expect(needsName('')).toBe(true);
    expect(needsName('  ')).toBe(true);
    expect(needsName('ann@example.com')).toBe(true);
    expect(needsName('Ann')).toBe(false);
    expect(publicName('abc12345-0000', 'ann@example.com')).toBe('Builder #abc123');
    expect(publicName('abc12345-0000', '')).toBe(fallbackName('abc12345-0000'));
    expect(publicName('abc12345-0000', ' Ann ')).toBe('Ann');
  });
  it('shows the stored name only to the person and site admins', () => {
    expect(nameFor({ id: 'u1' }, 'u1', 'ann@example.com')).toBe('ann@example.com');
    expect(nameFor({ id: 'a', isGlobalAdmin: true }, 'u1', 'ann@example.com')).toBe('ann@example.com');
    expect(nameFor({ id: 'u2' }, 'u1', 'ann@example.com')).not.toContain('@');
    expect(nameFor(null, 'u1', 'ann@example.com')).not.toContain('@');
    // No name yet: even the person sees "Builder #…", never a blank.
    expect(nameFor({ id: 'u1' }, 'u1', '')).toBe(fallbackName('u1'));
  });
  it('suggests the part before the @', () => {
    expect(suggestedName('ann.smith@example.com')).toBe('ann smith');
  });
});

describe('display names never leak an email', () => {
  let app: FastifyInstance;
  const cookies: Record<string, string> = {};

  const req = (method: 'GET' | 'POST' | 'PATCH', url: string, cookie?: string, payload?: unknown) =>
    app.inject({ method, url, headers: cookie ? { cookie } : {}, ...(payload !== undefined ? { payload: payload as Record<string, unknown> } : {}) });

  async function signUp(email: string, displayName?: string): Promise<string> {
    const res = await req('POST', '/api/auth/password/register', undefined, { email, password: 'correct horse battery', ...(displayName !== undefined ? { displayName } : {}) });
    expect(res.statusCode).toBe(200);
    const c = res.headers['set-cookie'];
    return Array.isArray(c) ? c.join('; ') : (c ?? '');
  }

  beforeEach(async () => {
    resetDb();
    await getPlatformSettings();
    await db
      .update(schema.platformSettings)
      .set({ requireEmailVerification: false, moduleCatalogEnabled: true, partsCatalogEnabled: true })
      .where(eq(schema.platformSettings.id, PLATFORM_SETTINGS_ID));
    app = await buildApp();
    for (const n of ['ann', 'bob', 'cat']) cookies[n] = await signUp(`${n}@example.com`, n === 'ann' ? undefined : n.toUpperCase());
    // Ann is an older account whose name is her email address.
    await db.update(schema.users).set({ displayName: 'ann@example.com' }).where(eq(schema.users.email, 'ann@example.com'));
  });
  afterEach(async () => {
    await app.close();
  });

  it('sign-up never stores the email as the name', async () => {
    await signUp('dan@example.com');
    await signUp('eve@example.com', 'eve@example.com');
    await signUp('fay@example.com', '  Fay ');
    const names = Object.fromEntries((await db.select().from(schema.users).all()).map((u) => [u.email, u.displayName]));
    expect(names['dan@example.com']).toBe('');
    expect(names['eve@example.com']).toBe('');
    expect(names['fay@example.com']).toBe('Fay');
  });

  it('asks the person for a name, and refuses an email as one', async () => {
    const me = (await req('GET', '/api/auth/me', cookies.ann)).json() as { user: { displayName: string; publicName: string; needsName: boolean; suggestedName: string } };
    expect(me.user.displayName).toBe('ann@example.com'); // the person sees their own
    expect(me.user.publicName).not.toContain('@');
    expect(me.user.needsName).toBe(true);
    expect(me.user.suggestedName).toBe('ann');
    expect((await req('PATCH', '/api/auth/me', cookies.ann, { displayName: 'ann@example.com' })).statusCode).toBe(400);
    expect((await req('PATCH', '/api/auth/me', cookies.ann, { displayName: 'Ann' })).statusCode).toBe(200);
    expect(((await req('GET', '/api/auth/me', cookies.ann)).json() as { user: { needsName: boolean } }).user.needsName).toBe(false);
  });

  it('club member lists and join requests show no address from a name', async () => {
    const created = await req('POST', '/api/orgs', cookies.bob, { name: 'Brick Club', slug: 'brick-club' });
    expect(created.statusCode).toBeLessThan(300);
    const org = (await db.select().from(schema.orgs).where(eq(schema.orgs.slug, 'brick-club')).get())!;
    const now = new Date();
    await db.insert(schema.orgMembers).values([
      { orgId: org.id, userId: await userId('ann@example.com'), role: 'member', joinedAt: now },
      { orgId: org.id, userId: await userId('cat@example.com'), role: 'member', joinedAt: now },
    ]);
    // A plain member sees other people's names only: no '@' anywhere but their own row.
    const asCat = await req('GET', '/api/orgs/brick-club/members', cookies.cat);
    expect(asCat.statusCode).toBe(200);
    const cat = await userId('cat@example.com');
    const others = (asCat.json() as { members: { userId: string }[] }).members.filter((m) => m.userId !== cat);
    expect(others).toHaveLength(2);
    expect(JSON.stringify(others)).not.toContain('@');
    // The club's admin may see addresses, but never as a name.
    const asBob = (await req('GET', '/api/orgs/brick-club/members', cookies.bob)).json() as { members: { email: string; displayName: string }[] };
    expect(asBob.members.find((m) => m.email === 'ann@example.com')?.displayName).toMatch(/^Builder #/);
    // Join requests: the admin sees the name, not the address.
    await db.insert(schema.orgJoinRequests).values({ id: randomUUID(), orgId: org.id, userId: await userId('ann@example.com'), message: null, createdAt: now });
    await db.delete(schema.orgMembers).where(eq(schema.orgMembers.userId, await userId('ann@example.com')));
    const requests = await req('GET', '/api/orgs/brick-club/join-requests', cookies.bob);
    expect(requests.statusCode).toBe(200);
    expect(requests.body).toContain('Builder #');
    expect(requests.body).not.toContain('@');
    // The club's user search never matches inside an email-looking name.
    const search = await req('GET', '/api/orgs/brick-club/user-search?q=example', cookies.bob);
    expect(search.statusCode).toBe(200);
    expect((search.json() as { users: unknown[] }).users).toEqual([]);
  });

  it('the public catalog and its collections show no address in a "by" line', async () => {
    const ann = await userId('ann@example.com');
    const now = new Date();
    const itemId = randomUUID();
    await db.insert(schema.catalogItems).values({
      id: itemId, kind: 'module', sourceId: randomUUID(), ownerUserId: ann, ownerOrgId: null, title: 'Yard', status: 'public', publicVersion: 1, createdAt: now, updatedAt: now,
    });
    const collId = randomUUID();
    await db.insert(schema.catalogCollections).values({ id: collId, title: 'Trains', ownerUserId: ann, status: 'public', audience: 'everyone', createdAt: now, updatedAt: now });
    await db.insert(schema.catalogCollectionItems).values({ collectionId: collId, itemId, position: 0 });

    for (const url of ['/api/catalog/items?kind=module', `/api/catalog/items/${itemId}`, '/api/catalog/collections', `/api/catalog/collections/${collId}`]) {
      const res = await req('GET', url, cookies.cat);
      expect(res.statusCode, url).toBe(200);
      expect(res.body, url).toContain('Builder #');
      expect(res.body, url).not.toContain('@');
    }
  });
});

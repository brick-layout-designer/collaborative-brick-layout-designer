// "My things and my clubs' things together": the list endpoints return the
// caller's own items plus every club's they're in, each tagged with its
// owner, narrowed by ?owner=all|me|<club>; a stranger never sees a club's
// items. Also the copy (layouts, modules, rooms) and move (rooms) routes
// behind "Move or copy…".

import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { db, loginAs, resetDb, schema } from '../../test/helpers.js';
import { attachUser } from '../../auth/cookie.js';
import { passwordRoutes } from '../auth/password.js';
import { layoutRoutes } from '../layouts.js';
import { moduleRoutes } from '../modules.js';
import { orgRoutes } from '../orgs.js';
import { venueRoutes } from '../venues.js';
import { customPartRoutes } from '../customParts.js';

const VENUE = { name: 'Hall', enabled: true, edges: [], obstacles: [], minWalkwayStuds: 0 };

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ bodyLimit: 10 * 1024 * 1024 });
  await app.register(cookie);
  app.addHook('preHandler', attachUser);
  await app.register(passwordRoutes);
  await app.register(layoutRoutes);
  await app.register(moduleRoutes);
  await app.register(orgRoutes);
  await app.register(venueRoutes);
  await app.register(customPartRoutes);
  return app;
}

type Who = { cookie: string; id: string };
interface Owner { kind: 'user' | 'org'; id: string; name: string; slug: string | null }
interface Item { id: string; title?: string; name?: string; owner: Owner | null; role?: string; canManage?: boolean }

describe('owner-tagged lists', () => {
  let app: FastifyInstance;
  let alice: Who; // club admin
  let bob: Who; // club member
  let carol: Who; // not in the club
  let ids: Record<string, string>;

  async function call(who: Who, method: 'GET' | 'POST', url: string, payload?: object) {
    return app.inject({ method, url, headers: { cookie: who.cookie }, ...(payload ? { payload } : {}) });
  }
  async function list(who: Who, kind: 'layouts' | 'modules' | 'venues', owner?: string): Promise<Item[]> {
    const res = await call(who, 'GET', `/api/${kind}${owner ? `?owner=${owner}` : ''}`);
    expect(res.statusCode).toBe(200);
    return (res.json() as Record<string, Item[]>)[kind]!;
  }
  async function make(who: Who, kind: 'layouts' | 'modules' | 'venues', label: string, orgSlug?: string) {
    const body = kind === 'venues' ? { name: label, data: { ...VENUE, name: label } } : { title: label };
    const res = await call(who, 'POST', `/api/${kind}`, { ...body, ...(orgSlug ? { orgSlug } : {}) });
    expect(res.statusCode).toBe(201);
    return (res.json() as { id: string }).id;
  }
  const label = (i: Item) => i.title ?? i.name;

  beforeEach(async () => {
    resetDb();
    app = await buildApp();
    alice = await loginAs(app, 'alice@example.com');
    bob = await loginAs(app, 'bob@example.com');
    carol = await loginAs(app, 'carol@example.com');
    const club = await call(alice, 'POST', '/api/orgs', { name: 'ArkLUG' });
    expect(club.statusCode).toBe(201);
    const clubId = (club.json() as { id: string }).id;
    await db.insert(schema.orgMembers).values({ orgId: clubId, userId: bob.id, role: 'member', joinedAt: new Date() });
    await call(carol, 'POST', '/api/orgs', { name: 'Other Club' });

    ids = {};
    for (const kind of ['layouts', 'modules', 'venues'] as const) {
      ids[`${kind}:bob`] = await make(bob, kind, `Bob ${kind}`);
      ids[`${kind}:club`] = await make(alice, kind, `Club ${kind}`, 'arklug');
      ids[`${kind}:carol`] = await make(carol, kind, `Carol ${kind}`);
    }
  });
  afterEach(async () => {
    await app.close();
  });

  for (const kind of ['layouts', 'modules', 'venues'] as const) {
    describe(kind, () => {
      it('lists mine and my clubs\' items together, each with its owner', async () => {
        const items = await list(bob, kind);
        expect(items.map(label).sort()).toEqual([`Bob ${kind}`, `Club ${kind}`]);
        const mine = items.find((i) => i.id === ids[`${kind}:bob`])!;
        expect(mine.owner).toEqual({ kind: 'user', id: bob.id, name: 'bob@example.com', slug: null });
        const club = items.find((i) => i.id === ids[`${kind}:club`])!;
        expect(club.owner).toMatchObject({ kind: 'org', name: 'ArkLUG', slug: 'arklug' });
      });

      it('?owner=me and ?owner=<club> narrow the list', async () => {
        expect((await list(bob, kind, 'me')).map(label)).toEqual([`Bob ${kind}`]);
        expect((await list(bob, kind, 'arklug')).map(label)).toEqual([`Club ${kind}`]);
        expect((await list(bob, kind, 'ARKLUG')).map(label)).toEqual([`Club ${kind}`]);
        expect((await list(bob, kind, 'all')).length).toBe(2);
      });

      it('never shows a club\'s items to someone outside it', async () => {
        expect((await list(carol, kind)).map(label)).toEqual([`Carol ${kind}`]);
        const res = await call(carol, 'GET', `/api/${kind}?owner=arklug`);
        expect(res.statusCode).toBe(404);
        const unknown = await call(bob, 'GET', `/api/${kind}?owner=no-such-club`);
        expect(unknown.statusCode).toBe(404);
      });
    });
  }

  it('says what the caller may do with each item', async () => {
    const aliceLayouts = await list(alice, 'layouts');
    const bobLayouts = await list(bob, 'layouts');
    expect(aliceLayouts.find((l) => l.id === ids['layouts:club'])!.role).toBe('owner');
    expect(bobLayouts.find((l) => l.id === ids['layouts:club'])!.role).toBe('editor');
    expect(bobLayouts.find((l) => l.id === ids['layouts:bob'])!.role).toBe('owner');
    expect((await list(bob, 'modules')).find((m) => m.id === ids['modules:club'])!.role).toBe('editor');
    expect((await list(alice, 'modules')).find((m) => m.id === ids['modules:club'])!.role).toBe('owner');
    // A club's rooms are its admins' to change.
    expect((await list(alice, 'venues')).find((v) => v.id === ids['venues:club'])!.canManage).toBe(true);
    expect((await list(bob, 'venues')).find((v) => v.id === ids['venues:club'])!.canManage).toBe(false);
    expect((await list(bob, 'venues')).find((v) => v.id === ids['venues:bob'])!.canManage).toBe(true);
  });

  describe('custom parts', () => {
    const GIF = Buffer.from('GIF89a    \xff\xff\xff   !\xf9    ,       D ;', 'binary').toString('base64');
    const XML = Buffer.from('<?xml version="1.0"?><part><Author>Test</Author></part>').toString('base64');
    async function part(who: Who, partNumber: string, orgSlug?: string) {
      const res = await call(who, 'POST', '/api/custom-parts', {
        partNumber, displayName: partNumber, xmlBase64: XML, spriteBase64: GIF, spriteMime: 'image/gif',
        ...(orgSlug ? { orgSlug } : {}),
      });
      expect(res.statusCode).toBe(201);
      return (res.json() as { id: string }).id;
    }
    async function parts(who: Who, owner?: string): Promise<(Item & { partNumber: string })[]> {
      const res = await call(who, 'GET', `/api/custom-parts${owner ? `?owner=${owner}` : ''}`);
      expect(res.statusCode).toBe(200);
      return (res.json() as { parts: (Item & { partNumber: string })[] }).parts;
    }
    const num = (p: { partNumber: string }) => p.partNumber;
    let clubPart: string;
    beforeEach(async () => {
      await part(bob, 'BOB.1');
      clubPart = await part(alice, 'CLUB.1', 'arklug');
      await part(carol, 'CAROL.1');
    });

    it('lists mine and my clubs\' parts, each with its owner and my role', async () => {
      const items = await parts(bob);
      expect(items.map(num).sort()).toEqual(['BOB.1', 'CLUB.1']);
      expect(items.find((p) => p.partNumber === 'BOB.1')!.owner).toEqual({ kind: 'user', id: bob.id, name: 'bob@example.com', slug: null });
      expect(items.find((p) => p.id === clubPart)!.owner).toMatchObject({ kind: 'org', name: 'ArkLUG', slug: 'arklug' });
      expect(items.find((p) => p.id === clubPart)!.role).toBe('editor');
      expect(items.find((p) => p.partNumber === 'BOB.1')!.role).toBe('owner');
      expect((await parts(alice)).find((p) => p.id === clubPart)!.role).toBe('owner');
    });

    it('?owner=me and ?owner=<club> narrow the list', async () => {
      expect((await parts(bob, 'me')).map(num)).toEqual(['BOB.1']);
      expect((await parts(bob, 'arklug')).map(num)).toEqual(['CLUB.1']);
      expect((await parts(bob, 'all')).length).toBe(2);
    });

    it('never shows a club\'s parts to someone outside it', async () => {
      expect((await parts(carol)).map(num)).toEqual(['CAROL.1']);
      expect((await call(carol, 'GET', '/api/custom-parts?owner=arklug')).statusCode).toBe(404);
      expect((await call(bob, 'GET', '/api/custom-parts?owner=no-such-club')).statusCode).toBe(404);
    });

    it('a part shared with someone shows who shared it', async () => {
      await db.insert(schema.customPartCollaborators).values({ customPartId: (await parts(bob, 'me'))[0]!.id, userId: carol.id, role: 'viewer', addedAt: new Date() });
      const shared = (await parts(carol)).find((p) => p.partNumber === 'BOB.1')!;
      expect(shared.owner).toMatchObject({ kind: 'user', id: bob.id });
      expect(shared.role).toBe('viewer');
      expect((await parts(carol, 'me')).map(num)).toEqual(['CAROL.1']);
    });
  });

  describe('copy', () => {
    for (const kind of ['layouts', 'modules', 'venues'] as const) {
      it(`${kind}: a member copies a club item to themselves, and their own to the club`, async () => {
        const toMe = await call(bob, 'POST', `/api/${kind}/${ids[`${kind}:club`]}/copy`, {});
        expect(toMe.statusCode).toBe(201);
        const mine = await list(bob, kind, 'me');
        expect(mine.map(label).sort()).toEqual([`Bob ${kind}`, `Club ${kind}`]);

        const toClub = await call(bob, 'POST', `/api/${kind}/${ids[`${kind}:bob`]}/copy`, { orgSlug: 'arklug' });
        expect(toClub.statusCode).toBe(201);
        const club = await list(alice, kind, 'arklug');
        expect(club.map(label).sort()).toEqual([`Bob ${kind}`, `Club ${kind}`]);
        // The original stays where it was.
        expect((await list(bob, kind, 'me')).some((i) => i.id === ids[`${kind}:bob`])).toBe(true);
      });

      it(`${kind}: a stranger cannot copy a club item, nor copy into a club they're not in`, async () => {
        const res = await call(carol, 'POST', `/api/${kind}/${ids[`${kind}:club`]}/copy`, {});
        expect(res.statusCode).toBe(404);
        const into = await call(carol, 'POST', `/api/${kind}/${ids[`${kind}:carol`]}/copy`, { orgSlug: 'arklug' });
        expect(into.statusCode).toBe(403);
        expect((await list(alice, kind, 'arklug')).length).toBe(1);
      });
    }

    it('a copy to the same owner is named "(copy)"', async () => {
      const res = await call(bob, 'POST', `/api/layouts/${ids['layouts:bob']}/copy`, {});
      expect((res.json() as { title: string }).title).toBe('Bob layouts (copy)');
      const v = await call(bob, 'POST', `/api/venues/${ids['venues:bob']}/copy`, {});
      expect((v.json() as { name: string }).name).toBe('Bob venues (copy)');
    });
  });

  describe('moving a room', () => {
    it('the owner moves their room into a club', async () => {
      const res = await call(bob, 'POST', `/api/venues/${ids['venues:bob']}/move`, { orgSlug: 'arklug' });
      expect(res.statusCode).toBe(200);
      expect((await list(bob, 'venues', 'me')).length).toBe(0);
      expect((await list(alice, 'venues', 'arklug')).map(label).sort()).toEqual(['Bob venues', 'Club venues']);
    });

    it('only a club admin may move a club room, and never out to one person', async () => {
      const member = await call(bob, 'POST', `/api/venues/${ids['venues:club']}/move`, { orgSlug: 'arklug' });
      expect(member.statusCode).toBe(403);
      const out = await call(alice, 'POST', `/api/venues/${ids['venues:club']}/move`, {});
      expect(out.statusCode).toBe(400);
      const stranger = await call(carol, 'POST', `/api/venues/${ids['venues:club']}/move`, { orgSlug: 'other-club' });
      expect(stranger.statusCode).toBe(404);
    });

    it('refuses a club that already has a room of that name', async () => {
      await make(alice, 'venues', 'Bob venues', 'arklug');
      const res = await call(bob, 'POST', `/api/venues/${ids['venues:bob']}/move`, { orgSlug: 'arklug' });
      expect(res.statusCode).toBe(409);
    });

    it('cannot move into a club the caller is not in', async () => {
      const res = await call(bob, 'POST', `/api/venues/${ids['venues:bob']}/move`, { orgSlug: 'other-club' });
      expect(res.statusCode).toBe(403);
    });
  });
});

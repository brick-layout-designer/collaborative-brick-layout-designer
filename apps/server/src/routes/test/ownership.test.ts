// Author credit and handing a club's thing back to its author
// (routes/credits.ts, routes/ownership.ts): who may take back or give
// back, that the club keeps a copy credited to the author, the note to
// the club's runners, and the credit lines in every list.

import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, loginAs, resetDb, schema } from '../../test/helpers.js';
import { attachUser } from '../../auth/cookie.js';
import { passwordRoutes } from '../auth/password.js';
import { layoutRoutes } from '../layouts.js';
import { moduleRoutes } from '../modules.js';
import { moduleTransferRoutes } from '../moduleTransfers.js';
import { transferRoutes } from '../transfers.js';
import { orgRoutes } from '../orgs.js';
import { venueRoutes } from '../venues.js';
import { customPartRoutes } from '../customParts.js';
import { warningRoutes } from '../warnings.js';
import { catalogRoutes } from '../catalog.js';
import { ownershipRoutes } from '../ownership.js';
import { fallbackName } from '../../utils/publicName.js';
import { creditLookup } from '../credits.js';

const VENUE = { name: 'Hall', enabled: true, edges: [], obstacles: [], minWalkwayStuds: 0 };
const GIF = Buffer.from('GIF89a    \xff\xff\xff   !\xf9    ,       D ;', 'binary').toString('base64');
const XML = Buffer.from('<?xml version="1.0"?><part><Author>Test</Author></part>').toString('base64');

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ bodyLimit: 10 * 1024 * 1024 });
  await app.register(cookie);
  app.addHook('preHandler', attachUser);
  await app.register(passwordRoutes);
  await app.register(layoutRoutes);
  await app.register(moduleRoutes);
  await app.register(moduleTransferRoutes);
  await app.register(transferRoutes);
  await app.register(orgRoutes);
  await app.register(venueRoutes);
  await app.register(customPartRoutes);
  await app.register(warningRoutes);
  await app.register(catalogRoutes);
  await app.register(ownershipRoutes);
  return app;
}

type Who = { cookie: string; id: string };
interface Credit {
  by: string | null;
  authorName: string | null;
  club: string | null;
  basedOn: { id: string; title: string; by: string | null } | null;
  canTakeBack: boolean;
  canGiveBack: boolean;
}
interface Item { id: string; title?: string; name?: string; displayName?: string; ownerOrgId: string | null; ownerUserId: string | null; credit: Credit | null }
type Kind = 'layouts' | 'modules' | 'venues' | 'custom-parts';
const LIST_KEY: Record<Kind, string> = { layouts: 'layouts', modules: 'modules', venues: 'venues', 'custom-parts': 'parts' };

describe('author credit and taking things back', () => {
  let app: FastifyInstance;
  let alice: Who; // ArkLUG admin
  let sam: Who; // ArkLUG member, the author
  let mo: Who; // ArkLUG manager
  let bob: Who; // ArkLUG member, not the author
  let clubId: string;

  async function call(who: Who, method: 'GET' | 'POST' | 'DELETE' | 'PUT', url: string, payload?: object) {
    return app.inject({ method, url, headers: { cookie: who.cookie }, ...(payload ? { payload } : {}) });
  }
  async function list(who: Who, kind: Kind): Promise<Item[]> {
    const res = await call(who, 'GET', `/api/${kind}`);
    expect(res.statusCode).toBe(200);
    return (res.json() as Record<string, Item[]>)[LIST_KEY[kind]]!;
  }
  async function find(who: Who, kind: Kind, id: string): Promise<Item | undefined> {
    return (await list(who, kind)).find((i) => i.id === id);
  }
  async function make(who: Who, kind: Kind, label: string, orgSlug?: string): Promise<string> {
    const body =
      kind === 'venues'
        ? { name: label, data: { ...VENUE, name: label } }
        : kind === 'custom-parts'
          ? { partNumber: label, displayName: label, xmlBase64: XML, spriteBase64: GIF, spriteMime: 'image/gif' }
          : { title: label };
    const res = await call(who, 'POST', `/api/${kind}`, { ...body, ...(orgSlug ? { orgSlug } : {}) });
    expect(res.statusCode).toBe(201);
    return (res.json() as { id: string }).id;
  }
  /** Sam's own thing, moved into ArkLUG the way each kind moves. */
  async function samsInClub(kind: Kind, label: string): Promise<string> {
    const id = await make(sam, kind, label);
    const res =
      kind === 'layouts'
        ? await call(sam, 'POST', `/api/layouts/${id}/transfer`, { recipientOrgSlug: 'arklug' })
        : kind === 'modules'
          ? await call(sam, 'POST', `/api/modules/${id}/transfer`, { recipientOrgSlug: 'arklug' })
          : await call(sam, 'POST', `/api/${kind}/${id}/move`, { orgSlug: 'arklug' });
    expect(res.statusCode).toBe(200);
    return id;
  }

  beforeEach(async () => {
    resetDb();
    app = await buildApp();
    alice = await loginAs(app, 'alice@example.com');
    sam = await loginAs(app, 'sam@example.com');
    mo = await loginAs(app, 'mo@example.com');
    bob = await loginAs(app, 'bob@example.com');
    const club = await call(alice, 'POST', '/api/orgs', { name: 'ArkLUG' });
    expect(club.statusCode).toBe(201);
    clubId = (club.json() as { id: string }).id;
    const now = new Date();
    await db.insert(schema.orgMembers).values([
      { orgId: clubId, userId: sam.id, role: 'member', joinedAt: now },
      { orgId: clubId, userId: mo.id, role: 'manager', joinedAt: now },
      { orgId: clubId, userId: bob.id, role: 'member', joinedAt: now },
    ]);
  });
  afterEach(async () => {
    await app.close();
  });

  for (const kind of ['layouts', 'modules', 'venues', 'custom-parts'] as const) {
    describe(kind, () => {
      it('credits the author in the club, and the author sees "you"', async () => {
        const id = await samsInClub(kind, 'Yard');
        expect((await find(bob, kind, id))!.credit).toMatchObject({ by: 'sam', club: 'ArkLUG', basedOn: null, canTakeBack: false, canGiveBack: false });
        expect((await find(sam, kind, id))!.credit).toMatchObject({ by: 'you', club: 'ArkLUG', canTakeBack: true, canGiveBack: false });
        expect((await find(alice, kind, id))!.credit).toMatchObject({ by: 'sam', authorName: 'sam', canTakeBack: false, canGiveBack: true });
      });

      it('the author takes it back; the club keeps a copy credited to them', async () => {
        const id = await samsInClub(kind, 'Yard');
        const res = await call(sam, 'POST', `/api/${kind}/${id}/take-back`);
        expect(res.statusCode).toBe(200);
        const { keptCopyId, ownerUserId } = res.json() as { keptCopyId: string; ownerUserId: string };
        expect(ownerUserId).toBe(sam.id);
        const mine = (await find(sam, kind, id))!;
        expect(mine.ownerOrgId).toBeNull();
        expect(mine.ownerUserId).toBe(sam.id);
        expect(mine.credit).toMatchObject({ by: 'you', club: null, canTakeBack: false });
        const kept = (await find(bob, kind, keptCopyId))!;
        expect(kept.ownerOrgId).toBe(clubId);
        expect(kept.credit).toMatchObject({ by: 'sam', club: 'ArkLUG', basedOn: { id, title: 'Yard', by: 'sam' } });
        // The original left the club: Bob no longer sees it.
        expect(await find(bob, kind, id)).toBeUndefined();
        // The club's copy can't be taken (or given) back again: Sam has the original.
        expect((await find(sam, kind, keptCopyId))!.credit).toMatchObject({ canTakeBack: false });
        expect((await find(alice, kind, keptCopyId))!.credit).toMatchObject({ canGiveBack: false });
        expect((await call(sam, 'POST', `/api/${kind}/${keptCopyId}/take-back`)).statusCode).toBe(409);
        expect((await call(alice, 'POST', `/api/${kind}/${keptCopyId}/give-back`)).statusCode).toBe(409);
      });

      it('someone else in the club can\'t take it back', async () => {
        const id = await samsInClub(kind, 'Yard');
        expect((await call(bob, 'POST', `/api/${kind}/${id}/take-back`)).statusCode).toBe(403);
        // Not even the club's admin: they give it back instead.
        expect((await call(alice, 'POST', `/api/${kind}/${id}/take-back`)).statusCode).toBe(403);
        expect((await find(bob, kind, id))!.ownerOrgId).toBe(clubId);
      });

      it('the author can\'t take it back once they left the club', async () => {
        const id = await samsInClub(kind, 'Yard');
        await db.delete(schema.orgMembers).where(eq(schema.orgMembers.userId, sam.id));
        expect((await call(sam, 'POST', `/api/${kind}/${id}/take-back`)).statusCode).toBe(404);
        const credit = (await creditLookup(kind === 'custom-parts' ? 'custom-part' : (kind.slice(0, -1) as 'layout' | 'module' | 'venue'), [id], sam.id))(id);
        expect(credit).toMatchObject({ by: 'a former member', canTakeBack: false });
        expect((await find(bob, kind, id))!.credit).toMatchObject({ by: 'a former member', club: 'ArkLUG' });
        // The club can still give it back to them.
        expect((await find(alice, kind, id))!.credit).toMatchObject({ canGiveBack: true });
        const give = await call(alice, 'POST', `/api/${kind}/${id}/give-back`);
        expect(give.statusCode).toBe(200);
        expect((give.json() as { ownerUserId: string }).ownerUserId).toBe(sam.id);
      });

      it('admins and managers give it back, only ever to the author', async () => {
        const id = await samsInClub(kind, 'Yard');
        // Asking to give it to someone else changes nothing: it goes to Sam.
        const res = await call(mo, 'POST', `/api/${kind}/${id}/give-back`, { userId: mo.id, ownerUserId: mo.id });
        expect(res.statusCode).toBe(200);
        expect((res.json() as { ownerUserId: string }).ownerUserId).toBe(sam.id);
        expect((await find(sam, kind, id))!.ownerUserId).toBe(sam.id);
        expect(await find(mo, kind, id)).toBeUndefined();
      });

      it('a member without rights can\'t give it back', async () => {
        const id = await samsInClub(kind, 'Yard');
        expect((await call(bob, 'POST', `/api/${kind}/${id}/give-back`)).statusCode).toBe(403);
        expect((await find(bob, kind, id))!.ownerOrgId).toBe(clubId);
      });

      it('someone outside the club gets not found, and a person\'s own thing has nothing to take back', async () => {
        const id = await samsInClub(kind, 'Yard');
        const carol = await loginAs(app, 'carol@example.com');
        expect((await call(carol, 'POST', `/api/${kind}/${id}/take-back`)).statusCode).toBe(404);
        expect((await call(carol, 'POST', `/api/${kind}/${id}/give-back`)).statusCode).toBe(404);
        const own = await make(sam, kind, 'Mine');
        expect((await call(sam, 'POST', `/api/${kind}/${own}/take-back`)).statusCode).toBe(409);
        expect((await call(alice, 'POST', `/api/${kind}/${own}/give-back`)).statusCode).toBe(404);
      });

      it('the club\'s admins and managers get a note, and the move is audit-logged', async () => {
        const id = await samsInClub(kind, 'Yard');
        expect((await call(sam, 'POST', `/api/${kind}/${id}/take-back`)).statusCode).toBe(200);
        for (const runner of [alice, mo]) {
          const notes = (await call(runner, 'GET', '/api/notices')).json() as { notices: { severity: string; reason: string; to: { kind: string } }[] };
          expect(notes.notices).toHaveLength(1);
          expect(notes.notices[0]).toMatchObject({ severity: 'note', to: { kind: 'org' } });
          expect(notes.notices[0]!.reason).toContain('sam took back');
          expect(notes.notices[0]!.reason).not.toContain('@');
        }
        expect(((await call(bob, 'GET', '/api/notices')).json() as { notices: unknown[] }).notices).toHaveLength(0);
        const audit = await db.select().from(schema.auditEvents).where(eq(schema.auditEvents.eventType, 'take_back')).all();
        expect(audit).toHaveLength(1);
        expect(audit[0]!.userId).toBe(sam.id);
      });
    });
  }

  it('a deleted author reads "Builder #…" and can\'t be given anything back', async () => {
    const id = await samsInClub('modules', 'Yard');
    await db.update(schema.modules).set({ createdBy: alice.id, deletedAuthorId: sam.id }).where(eq(schema.modules.id, id));
    expect((await find(bob, 'modules', id))!.credit).toMatchObject({ by: fallbackName(sam.id), authorName: null });
    expect((await find(alice, 'modules', id))!.credit).toMatchObject({ canGiveBack: false, canTakeBack: false });
    expect((await call(alice, 'POST', `/api/modules/${id}/give-back`)).statusCode).toBe(409);
    expect((await call(alice, 'POST', `/api/modules/${id}/take-back`)).statusCode).toBe(403);
  });

  it('a copy says what it is based on', async () => {
    const id = await make(sam, 'layouts', 'Main yard', 'arklug');
    const copy = await call(bob, 'POST', `/api/layouts/${id}/copy`, {});
    expect(copy.statusCode).toBe(201);
    const copyId = (copy.json() as { id: string }).id;
    expect((await find(bob, 'layouts', copyId))!.credit).toMatchObject({ by: 'you', club: null, basedOn: { id, title: 'Main yard', by: 'sam' } });
    const venue = await make(sam, 'venues', 'Hall');
    const vcopy = await call(sam, 'POST', `/api/venues/${venue}/copy`, { orgSlug: 'arklug' });
    const vcopyId = (vcopy.json() as { id: string }).id;
    expect((await find(bob, 'venues', vcopyId))!.credit).toMatchObject({ by: 'sam', basedOn: { id: venue, title: 'Hall', by: 'sam' } });
    // Sam made the club's copy from their own: they already have it, nothing to take back.
    expect((await find(sam, 'venues', vcopyId))!.credit).toMatchObject({ canTakeBack: false });
    const part = await make(sam, 'custom-parts', '3001x');
    const pcopy = await call(sam, 'POST', `/api/custom-parts/${part}/copy`, { orgSlug: 'arklug' });
    expect(pcopy.statusCode).toBe(201);
    expect((await find(bob, 'custom-parts', (pcopy.json() as { id: string }).id))!.credit).toMatchObject({ by: 'sam', basedOn: { id: part } });
  });

  it('venues record who made them', async () => {
    const id = await make(alice, 'venues', 'Gym', 'arklug');
    const row = await db.select().from(schema.venueLibrary).where(eq(schema.venueLibrary.id, id)).get();
    expect(row!.createdBy).toBe(alice.id);
    const one = (await call(bob, 'GET', `/api/venues/${id}`)).json() as { credit: Credit };
    expect(one.credit).toMatchObject({ by: 'alice', club: 'ArkLUG' });
  });

  it('custom parts move into a club, never out to a person, and keep their number in the club after a take-back', async () => {
    const id = await make(sam, 'custom-parts', '3001x');
    expect((await call(bob, 'POST', `/api/custom-parts/${id}/move`, { orgSlug: 'arklug' })).statusCode).toBe(404);
    expect((await call(sam, 'POST', `/api/custom-parts/${id}/move`, {})).statusCode).toBe(400);
    expect((await call(sam, 'POST', `/api/custom-parts/${id}/move`, { orgSlug: 'arklug' })).statusCode).toBe(200);
    // A club member can't move the club's part on.
    expect((await call(bob, 'POST', `/api/custom-parts/${id}/move`, { orgSlug: 'arklug' })).statusCode).toBe(403);
    // The club already has 3001x: a second one can't move in.
    const other = await make(bob, 'custom-parts', '3001x');
    expect((await call(bob, 'POST', `/api/custom-parts/${other}/move`, { orgSlug: 'arklug' })).statusCode).toBe(409);
    const back = await call(sam, 'POST', `/api/custom-parts/${id}/take-back`);
    expect(back.statusCode).toBe(200);
    const kept = (back.json() as { keptCopyId: string }).keptCopyId;
    const row = await db.select().from(schema.customParts).where(eq(schema.customParts.id, kept)).get();
    expect(row).toMatchObject({ partNumber: '3001x', ownerOrgId: clubId, createdBy: sam.id, copiedFromId: id });
  });

  it('journey: a module moves to the club, Sam takes it back, the club keeps a copy and its layout is unchanged', async () => {
    const id = await samsInClub('modules', 'Station');
    expect((await find(bob, 'modules', id))!.credit).toMatchObject({ by: 'sam', club: 'ArkLUG' });
    // A club layout using the module: placed modules carry their parts in the layout.
    const layoutId = await make(alice, 'layouts', 'Show', 'arklug');
    const before = await db.select().from(schema.layouts).where(eq(schema.layouts.id, layoutId)).get();
    const res = await call(sam, 'POST', `/api/modules/${id}/take-back`);
    expect(res.statusCode).toBe(200);
    const kept = (res.json() as { keptCopyId: string }).keptCopyId;
    expect((await find(bob, 'modules', kept))!.credit).toMatchObject({ by: 'sam', club: 'ArkLUG', basedOn: { id, title: 'Station', by: 'sam' } });
    expect((await find(sam, 'modules', id))!.ownerUserId).toBe(sam.id);
    const after = await db.select().from(schema.layouts).where(eq(schema.layouts.id, layoutId)).get();
    expect(after).toEqual(before);
    const src = await db.select().from(schema.modules).where(eq(schema.modules.id, id)).get();
    const copy = await db.select().from(schema.modules).where(eq(schema.modules.id, kept)).get();
    expect(Buffer.compare(Buffer.from(copy!.docSnapshot as Uint8Array), Buffer.from(src!.docSnapshot as Uint8Array))).toBe(0);
  });
});

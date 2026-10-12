// Data safety: what erasing an account or a club, the clean-up jobs and the
// data download do to a full, mixed database. Every test seeds the same
// "world" (three people, a club, each kind of thing owned by each of them
// and by the club, shares between them), runs one operation, and compares
// table dumps before and after, so anything that goes (or stays) without
// being expected fails here.

import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import fastifyMultipart from '@fastify/multipart';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { eq } from 'drizzle-orm';
import { readBbm } from '@cld/bbm';
import type { BbmMap } from '@cld/model';
import { encodeDoc, seedFromBbm } from '@cld/ydoc';
import { db, issueToken, loginAs, resetDb, schema } from '../test/helpers.js';
import { sqlite } from '../db/index.js';
import { readZip } from '../test/zip.js';
import { attachUser } from '../auth/cookie.js';
import { registerApiRoutes } from '../routes/all.js';
import { writeAuditEvent } from '../audit/writeAuditEvent.js';
import { invalidatePrivacyCache } from './settings.js';
import { settleExports } from './exports.js';
import { privacyTick } from './tick.js';
import { sweepRollup } from '../metrics/rollup.js';
import { sweepUsage } from '../metrics/usage.js';
import { dailyCompaction } from '../workers/index.js';
import { runDemoReset } from '../demo/reset.js';
import { DEMO_USER_ID } from '../demo/demoAccount.js';
import { closeAll } from '../events/hub.js';

const DAY = 86_400_000;
const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), '../../../../packages/bbm/tests/fixtures/fordyce-2026.bbm');

/** A small map: the fixture's first brick sheet, three bricks, the first one a server custom part. */
let baseMap: BbmMap | null = null;
function smallMap(customPartId: string | null): BbmMap {
  baseMap ??= readBbm(readFileSync(FIXTURE, 'utf-8')).map;
  const map = structuredClone(baseMap);
  const brick = map.layers.find((l) => l.type === 'brick');
  if (!brick || brick.type !== 'brick') throw new Error('fixture has no brick sheet');
  brick.bricks = brick.bricks.slice(0, 3);
  brick.groups = [];
  if (customPartId) brick.bricks[0]!.partNumber = `custom:${customPartId}`;
  map.layers = [brick];
  return map;
}
const docOf = (customPartId: string | null = null) => Buffer.from(encodeDoc(seedFromBbm(smallMap(customPartId))));

type Who = { cookie: string; id: string; email: string; name: string };

/** Every table, as sorted plain rows (blobs as a hash), for before/after comparisons. */
function dump(): Record<string, string[]> {
  const tables = (sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '__drizzle%'").all() as { name: string }[]).map((t) => t.name);
  const out: Record<string, string[]> = {};
  for (const t of tables) {
    const rows = sqlite.prepare(`SELECT * FROM "${t}"`).all() as Record<string, unknown>[];
    out[t] = rows
      .map((r) =>
        JSON.stringify(
          Object.fromEntries(Object.entries(r).map(([k, v]) => [k, Buffer.isBuffer(v) ? `blob:${createHash('sha1').update(v).digest('hex')}` : v])),
        ),
      )
      .sort();
  }
  return out;
}

/** Rows that mention none of `needles` (ids, emails) anywhere. */
const without = (rows: string[], needles: string[]) => rows.filter((r) => !needles.some((n) => r.includes(n)));

/** The tables that hold people's things and access to them. */
const LIVE_TABLES = [
  'users',
  'orgs',
  'org_members',
  'layouts',
  'layout_collaborators',
  'modules',
  'module_collaborators',
  'module_versions',
  'custom_parts',
  'custom_part_collaborators',
  'venue_library',
  'user_preferences',
  'catalog_items',
  'catalog_collections',
] as const;

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ bodyLimit: 20 * 1024 * 1024 });
  await app.register(cookie);
  await app.register(fastifyMultipart);
  app.addHook('preHandler', attachUser);
  await registerApiRoutes(app);
  return app;
}

interface World {
  ann: Who;
  bob: Who;
  cy: Who;
  root: Who;
  clubId: string;
  annToken: string;
  /** Ids by owner and kind. */
  ids: Record<'ann' | 'bob' | 'cy' | 'clubByAnn' | 'clubByBob', { layout: string; module: string; part: string; venue: string }>;
  annPartNumber: string;
}

async function seedWorld(app: FastifyInstance): Promise<World> {
  const who = async (email: string): Promise<Who> => {
    const w = await loginAs(app, email);
    return { ...w, email, name: email.split('@')[0]! };
  };
  const ann = await who('ann@example.com');
  const bob = await who('bob@example.com');
  const cy = await who('cy@example.com');
  const root = await who('root@example.com');
  await db.update(schema.users).set({ isGlobalAdmin: true }).where(eq(schema.users.id, root.id));
  const annToken = await issueToken(app, ann.cookie);
  await issueToken(app, bob.cookie);

  const now = new Date();
  const clubId = randomUUID();
  await db.insert(schema.orgs).values({ id: clubId, name: 'Train Club', slug: 'train-club', createdAt: now, createdBy: bob.id, listed: true });
  await db.insert(schema.orgMembers).values([
    { orgId: clubId, userId: bob.id, role: 'admin', joinedAt: new Date(now.getTime() - 3000) },
    { orgId: clubId, userId: ann.id, role: 'member', joinedAt: new Date(now.getTime() - 2000) },
    { orgId: clubId, userId: cy.id, role: 'manager', joinedAt: new Date(now.getTime() - 1000) },
  ]);

  const things = async (key: string, owner: { user?: string; org?: string }, by: string) => {
    const part = randomUUID();
    const partNumber = `${key.toUpperCase()}-PART.1`;
    await db.insert(schema.customParts).values({
      id: part,
      partNumber,
      displayName: `${key} part`,
      ownerUserId: owner.user ?? null,
      ownerOrgId: owner.org ?? null,
      createdBy: by,
      xmlBlob: Buffer.from(`<part><Author>${key}</Author></part>`),
      spriteBlob: Buffer.from([0x89, 0x50, 0x4e, 0x47, key.length]),
      spriteMime: 'image/png',
      createdAt: now,
      updatedAt: now,
    });
    const layout = randomUUID();
    await db.insert(schema.layouts).values({
      id: layout,
      title: `${key} layout`,
      ownerUserId: owner.user ?? null,
      ownerOrgId: owner.org ?? null,
      createdBy: by,
      createdAt: now,
      updatedAt: now,
      docSnapshot: docOf(part),
      publicShareToken: `share-${key}-${randomUUID()}`,
    });
    const mod = randomUUID();
    await db.insert(schema.modules).values({
      id: mod,
      title: `${key} module`,
      ownerUserId: owner.user ?? null,
      ownerOrgId: owner.org ?? null,
      createdBy: by,
      docSnapshot: docOf(part),
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(schema.moduleVersions).values({ id: randomUUID(), moduleId: mod, version: 1, docSnapshot: docOf(part), authorId: by, createdAt: now });
    const venue = randomUUID();
    await db.insert(schema.venueLibrary).values({
      id: venue,
      name: `${key} venue`,
      ownerUserId: owner.user ?? null,
      ownerOrgId: owner.org ?? null,
      createdBy: by,
      data: JSON.stringify({ name: `${key} venue`, enabled: true, edges: [], obstacles: [], minWalkwayStuds: 0 }),
      createdAt: now,
    });
    return { layout, module: mod, part, venue, partNumber };
  };
  const a = await things('ann', { user: ann.id }, ann.id);
  const b = await things('bob', { user: bob.id }, bob.id);
  const c = await things('cy', { user: cy.id }, cy.id);
  const ca = await things('clubann', { org: clubId }, ann.id);
  const cb = await things('clubbob', { org: clubId }, bob.id);

  // Shares both ways.
  await db.insert(schema.layoutCollaborators).values([
    { layoutId: b.layout, userId: ann.id, role: 'editor', addedAt: now },
    { layoutId: a.layout, userId: bob.id, role: 'viewer', addedAt: now },
  ]);
  await db.insert(schema.moduleCollaborators).values({ moduleId: b.module, userId: ann.id, role: 'editor', addedAt: now });
  await db.insert(schema.customPartCollaborators).values({ customPartId: b.part, userId: ann.id, role: 'viewer', addedAt: now });
  // Ann saved a version of Bob's module.
  await db.insert(schema.moduleVersions).values({ id: randomUUID(), moduleId: b.module, version: 2, docSnapshot: docOf(null), authorId: ann.id, createdAt: now });

  // Preferences for everyone.
  for (const w of [ann, bob, cy]) {
    await db.insert(schema.userPreferences).values({ userId: w.id, prefs: JSON.stringify({ theme: 'dark', who: w.name }), updatedAt: now });
  }
  // Public catalog items: Ann's own, and one of the club's.
  await db.insert(schema.catalogItems).values([
    { id: randomUUID(), kind: 'module', sourceId: a.module, ownerUserId: ann.id, title: 'Ann public', status: 'public', publicVersion: 1, createdAt: now, updatedAt: now },
    { id: randomUUID(), kind: 'module', sourceId: cb.module, ownerOrgId: clubId, title: 'Club public', status: 'public', publicVersion: 1, createdAt: now, updatedAt: now },
    { id: randomUUID(), kind: 'module', sourceId: b.module, ownerUserId: bob.id, title: 'Bob public', status: 'public', publicVersion: 1, createdAt: now, updatedAt: now },
  ]);

  // Audit rows by Ann, about Ann, and naming her address in someone else's row.
  await writeAuditEvent({ resourceKind: 'user', resourceId: ann.id, userId: ann.id, eventType: 'settings', payload: { displayName: 'ann', email: ann.email } } as never);
  await writeAuditEvent({ layoutId: b.layout, userId: bob.id, eventType: 'share', payload: { email: ann.email, role: 'editor' } } as never);
  await writeAuditEvent({ layoutId: b.layout, userId: bob.id, eventType: 'edit', payload: { note: 'bob only' } } as never);

  const strip = (x: typeof a) => ({ layout: x.layout, module: x.module, part: x.part, venue: x.venue });
  return { ann, bob, cy, root, clubId, annToken, ids: { ann: strip(a), bob: strip(b), cy: strip(c), clubByAnn: strip(ca), clubByBob: strip(cb) }, annPartNumber: a.partNumber };
}

function clearAll(): void {
  resetDb();
  sqlite.exec(`
    DELETE FROM data_exports; DELETE FROM erasures; DELETE FROM privacy_request_events; DELETE FROM privacy_requests;
    DELETE FROM catalog_collection_items; DELETE FROM catalog_collection_modules; DELETE FROM catalog_collection_parts;
    DELETE FROM catalog_collection_covers; DELETE FROM catalog_item_covers; DELETE FROM catalog_copies;
    DELETE FROM catalog_item_versions; DELETE FROM catalog_collections; DELETE FROM catalog_items;
    DELETE FROM venue_library; DELETE FROM module_versions;
  `);
}

describe('data safety on a full, mixed database', () => {
  let app: FastifyInstance;
  let w: World;

  beforeEach(async () => {
    clearAll();
    invalidatePrivacyCache();
    app = await buildApp();
    w = await seedWorld(app);
  });
  afterEach(async () => {
    await settleExports();
    closeAll();
    await app.close();
  });

  const row = (t: 'layouts' | 'modules' | 'customParts', id: string) => db.select().from(schema[t]).where(eq(schema[t].id, id)).get();
  const venue = (id: string) => db.select().from(schema.venueLibrary).where(eq(schema.venueLibrary.id, id)).get();

  describe('account erasure after the 14-day wait', () => {
    it('removes the person and everything personal; keeps club things, other people’s things and the anonymised log', async () => {
      const { ann } = w;
      const before = dump();
      expect((await app.inject({ method: 'POST', url: '/api/me/deletion', headers: { cookie: ann.cookie }, payload: { confirm: ann.email } })).statusCode).toBe(202);
      expect((await privacyTick(new Date(Date.now() + 13 * DAY))).accountsErased).toBe(0);
      expect((await privacyTick(new Date(Date.now() + 15 * DAY))).accountsErased).toBe(1);
      const after = dump();

      // The user and their personal things are gone.
      expect(await db.select().from(schema.users).where(eq(schema.users.id, ann.id)).get()).toBeUndefined();
      expect(await row('layouts', w.ids.ann.layout)).toBeUndefined();
      expect(await row('modules', w.ids.ann.module)).toBeUndefined();
      expect(await row('customParts', w.ids.ann.part)).toBeUndefined();
      expect(await venue(w.ids.ann.venue)).toBeUndefined();
      // Tokens, sessions, device codes, preferences, shares, memberships: none left that name her.
      for (const t of ['sessions', 'api_tokens', 'device_codes', 'user_preferences', 'layout_collaborators', 'module_collaborators', 'custom_part_collaborators', 'org_members', 'email_verifications', 'oauth_accounts']) {
        expect(after[t]!.filter((r) => r.includes(ann.id)), t).toEqual([]);
      }
      // Her desktop token no longer works.
      expect((await app.inject({ method: 'GET', url: '/api/layouts', headers: { authorization: `Bearer ${w.annToken}` } })).statusCode).toBe(401);
      // Her public catalog item went with her; the club's and Bob's stayed.
      expect(after.catalog_items!.map((r) => JSON.parse(r).title).sort()).toEqual(['Bob public', 'Club public']);

      // The club's things she made stay, credited to "Builder #…".
      for (const t of ['layouts', 'modules', 'customParts'] as const) {
        const id = t === 'customParts' ? w.ids.clubByAnn.part : t === 'layouts' ? w.ids.clubByAnn.layout : w.ids.clubByAnn.module;
        const r = await row(t, id);
        expect(r, t).toBeDefined();
        expect(r!.deletedAuthorId, t).toBe(ann.id);
        expect(r!.createdBy, t).not.toBe(ann.id);
      }
      expect(await venue(w.ids.clubByAnn.venue)).toBeDefined();

      // Everything that never mentioned her or her own things is exactly as it was.
      const hersNeedles = [ann.id, ann.email, w.ids.ann.layout, w.ids.ann.module, w.ids.ann.part, w.ids.ann.venue];
      for (const t of LIVE_TABLES) {
        if (t === 'module_versions') continue; // her versions lose her name (checked below)
        expect(without(after[t]!, hersNeedles), t).toEqual(without(before[t]!, hersNeedles));
      }
      // The version she saved of Bob's module stays, without her name.
      const v = await db.select().from(schema.moduleVersions).where(eq(schema.moduleVersions.moduleId, w.ids.bob.module)).all();
      expect(v.map((x) => x.version).sort()).toEqual([1, 2]);
      expect(v.every((x) => x.authorId !== ann.id)).toBe(true);

      // The audit log: no row points at her or carries her address; her rows say "Deleted user #…".
      const audit = await db.select().from(schema.auditEvents).all();
      expect(audit.filter((a) => a.userId === ann.id)).toEqual([]);
      expect(audit.filter((a) => a.payload.includes(ann.email))).toEqual([]);
      const hers = audit.filter((a) => a.eventType === 'settings' && a.resourceId === ann.id);
      expect(hers).toHaveLength(1);
      expect(hers[0]!.actorLabel).toMatch(/^Deleted user #[0-9a-z]{6}$/);
      expect(hers[0]!.payload).not.toContain('"ann"');
      // Someone else's row that only named her address keeps the event, and Bob.
      const share = audit.find((a) => a.eventType === 'share');
      expect(share!.userId).toBe(w.bob.id);
      expect(share!.payload).toContain('(erased)');
      expect(audit.find((a) => a.eventType === 'edit')!.payload).toBe(JSON.stringify({ note: 'bob only' }));
    });

    it('cancelled before the deadline (she signs in): nothing goes', async () => {
      const { ann } = w;
      const before = dump();
      await app.inject({ method: 'POST', url: '/api/me/deletion', headers: { cookie: ann.cookie }, payload: { confirm: ann.email } });
      const login = await app.inject({ method: 'POST', url: '/api/auth/password/login', payload: { email: ann.email, password: 'correct horse battery' } });
      expect(login.statusCode).toBe(200);
      expect((await privacyTick(new Date(Date.now() + 20 * DAY))).accountsErased).toBe(0);
      const after = dump();
      for (const t of LIVE_TABLES) {
        if (t === 'users') continue;
        expect(after[t], t).toEqual(before[t]);
      }
      const strip = (rows: string[]) => rows.map((r) => ({ ...JSON.parse(r), last_seen_at: null }));
      expect(strip(after.users!)).toEqual(strip(before.users!));
      // Her desktop sign-in still works.
      expect((await app.inject({ method: 'GET', url: '/api/layouts', headers: { authorization: `Bearer ${w.annToken}` } })).statusCode).toBe(200);
    });
  });

  describe('club erasure', () => {
    const clubThings = () => [w.ids.clubByAnn, w.ids.clubByBob];
    const personal = () => [w.ids.ann, w.ids.bob, w.ids.cy];

    async function expectClubGoneMembersKept(before: Record<string, string[]>) {
      expect(await db.select().from(schema.orgs).where(eq(schema.orgs.id, w.clubId)).get()).toBeUndefined();
      for (const c of clubThings()) {
        expect(await row('layouts', c.layout)).toBeUndefined();
        expect(await row('modules', c.module)).toBeUndefined();
        expect(await row('customParts', c.part)).toBeUndefined();
        expect(await venue(c.venue)).toBeUndefined();
      }
      for (const p of personal()) {
        expect(await row('layouts', p.layout)).toBeDefined();
        expect(await row('modules', p.module)).toBeDefined();
        expect(await row('customParts', p.part)).toBeDefined();
        expect(await venue(p.venue)).toBeDefined();
      }
      // Every row that didn't mention the club is as it was (people, their things, shares).
      const after = dump();
      const clubNeedles = [w.clubId, ...clubThings().flatMap((c) => [c.layout, c.module, c.part, c.venue])];
      for (const t of LIVE_TABLES) {
        if (t === 'catalog_items') continue; // the club's public item is handed over (checked below)
        expect(without(after[t]!, clubNeedles), t).toEqual(without(before[t]!, clubNeedles));
      }
    }

    it('after the wait, the club’s things go and members’ personal things stay', async () => {
      const before = dump();
      const res = await app.inject({ method: 'DELETE', url: '/api/orgs/train-club', headers: { cookie: w.bob.cookie }, payload: { confirm: 'Train Club', catalog: 'hand', heirUserId: w.cy.id } });
      expect(res.statusCode).toBe(200);
      expect((await privacyTick(new Date(Date.now() + 13 * DAY))).clubsErased).toBe(0);
      // Still all there during the wait.
      for (const c of clubThings()) expect(await row('layouts', c.layout)).toBeDefined();
      expect((await privacyTick(new Date(Date.now() + 15 * DAY))).clubsErased).toBe(1);
      await expectClubGoneMembersKept(before);
      const handed = (await db.select().from(schema.catalogItems).all()).find((i) => i.title === 'Club public');
      expect(handed).toMatchObject({ ownerUserId: w.cy.id, ownerOrgId: null });
    });

    it('“Erase now” does the same at once', async () => {
      const before = dump();
      const res = await app.inject({ method: 'POST', url: `/api/admin/orgs/${w.clubId}/erase`, headers: { cookie: w.root.cookie }, payload: { confirm: 'Train Club', catalog: 'takedown' } });
      expect(res.statusCode).toBe(200);
      await expectClubGoneMembersKept(before);
      expect((await db.select().from(schema.catalogItems).all()).map((i) => i.title).sort()).toEqual(['Ann public', 'Bob public']);
    });

    it('restored before the deadline, everything comes back as it was', async () => {
      const before = dump();
      await app.inject({ method: 'DELETE', url: '/api/orgs/train-club', headers: { cookie: w.bob.cookie }, payload: { confirm: 'Train Club', catalog: 'hand', heirUserId: w.cy.id } });
      expect((await app.inject({ method: 'POST', url: '/api/orgs/train-club/restore', headers: { cookie: w.bob.cookie } })).statusCode).toBe(200);
      expect((await privacyTick(new Date(Date.now() + 20 * DAY))).clubsErased).toBe(0);
      const after = dump();
      for (const t of LIVE_TABLES) expect(after[t], t).toEqual(before[t]);
    });
  });

  describe('retention clean-up', () => {
    it('removes exactly the expired records and never a live layout, module, part, user or club', async () => {
      const now = new Date();
      const long = new Date(now.getTime() - 400 * DAY);
      const ancient = new Date(now.getTime() - 1200 * DAY); // past the 1095-day record keeping
      // Things that have ended long ago, one of each kind the clean-up removes.
      await db.insert(schema.sessions).values({ id: 'old-session', userId: w.bob.id, expiresAt: long });
      await db.insert(schema.apiTokens).values({ id: 'old-token', userId: w.bob.id, name: 'old', tokenHash: 'h-old', prefix: 'p', last4: '0000', scopes: 'read', createdAt: long, expiresAt: long });
      await db.insert(schema.apiTokens).values({ id: 'revoked-token', userId: w.bob.id, name: 'rev', tokenHash: 'h-rev', prefix: 'p', last4: '0001', scopes: 'read', createdAt: long, expiresAt: new Date(now.getTime() + 30 * DAY), revokedAt: long });
      await db.insert(schema.layoutInvites).values({ id: 'old-invite', layoutId: w.ids.bob.layout, invitedEmail: 'x@example.com', role: 'viewer', token: 'old-inv', expiresAt: long });
      await db.insert(schema.layoutInvites).values({ id: 'live-invite', layoutId: w.ids.bob.layout, invitedEmail: 'y@example.com', role: 'viewer', token: 'live-inv', expiresAt: new Date(now.getTime() + 7 * DAY) });
      await db.insert(schema.layoutTransfers).values({ id: 'old-transfer', layoutId: w.ids.bob.layout, initiatedBy: w.bob.id, recipientEmail: 'z@example.com', token: 'old-tr', expiresAt: long, createdAt: long });
      await db.insert(schema.erasures).values({ id: 'old-erasure', kind: 'user', ref: 'Deleted user #000000', how: 'self', requestedAt: ancient, erasedAt: ancient, counts: '{}' });
      await db.insert(schema.auditEvents).values({ layoutId: w.ids.bob.layout, userId: w.bob.id, eventType: 'share', payload: JSON.stringify({ email: 'old@example.com', ip: '1.2.3.4' }), createdAt: long });
      // The demo account, with things of its own.
      await runDemoReset(now);
      const demoBefore = (await db.select({ id: schema.layouts.id }).from(schema.layouts).where(eq(schema.layouts.ownerUserId, DEMO_USER_ID)).all()).map((r) => r.id);
      expect(demoBefore.length).toBeGreaterThan(0);

      const before = dump();
      // Every clean-up job the server runs, an hour after the seed and a
      // year and a bit later.
      const tick1 = await privacyTick(new Date(now.getTime() + 3600_000));
      sweepRollup(now.getTime());
      sweepUsage(now.getTime());
      await dailyCompaction();
      await runDemoReset(new Date(now.getTime() + 2 * DAY));
      const after = dump();

      // What it removed, exactly.
      expect(tick1.retention).toMatchObject({ sessions: 1, apiTokens: 2, invites: 1, transfers: 1, erasures: 1, auditScrubbed: 1 });
      const gone = (t: string) => before[t]!.filter((r) => !after[t]!.includes(r));
      expect(gone('sessions').map((r) => JSON.parse(r).id)).toEqual(['old-session']);
      expect(gone('api_tokens').map((r) => JSON.parse(r).id).sort()).toEqual(['old-token', 'revoked-token']);
      expect(gone('layout_invites').map((r) => JSON.parse(r).id)).toEqual(['old-invite']);
      expect(gone('layout_transfers').map((r) => JSON.parse(r).id)).toEqual(['old-transfer']);
      expect(gone('erasures').map((r) => JSON.parse(r).id)).toEqual(['old-erasure']);

      // Live things: identical, apart from the demo account's own (reset) things.
      const demoNeedles = [DEMO_USER_ID, ...demoBefore];
      for (const t of LIVE_TABLES) {
        expect(without(after[t]!, demoNeedles), t).toEqual(without(before[t]!, demoNeedles));
      }
      // And the same again much later: still nothing live goes.
      await privacyTick(new Date(now.getTime() + 400 * DAY));
      const later = dump();
      for (const t of LIVE_TABLES) {
        expect(without(later[t]!, demoNeedles), t).toEqual(without(before[t]!, demoNeedles));
      }
    });
  });

  describe('data download contents', () => {
    async function download(who: Who) {
      const res = await app.inject({ method: 'POST', url: '/api/me/privacy/exports', headers: { cookie: who.cookie } });
      expect(res.statusCode).toBe(202);
      await settleExports();
      const list = (await app.inject({ method: 'GET', url: '/api/me/privacy/exports', headers: { cookie: who.cookie } })).json();
      const dl = await app.inject({ method: 'GET', url: list.exports[0].downloadUrl, headers: { cookie: who.cookie } });
      expect(dl.statusCode).toBe(200);
      return readZip(dl.rawPayload);
    }

    it('holds every layout, module, venue and part of hers as files, nothing of anyone else’s, and no secrets', async () => {
      const zip = await download(w.ann);
      const names = [...zip.keys()];
      expect(names).toContain('layouts/ann layout.bld-layout');
      expect(names).toContain('modules/ann module.bld-layout');
      expect(names).toContain('venues/ann venue.json');
      expect(names).toContain(`parts/${w.annPartNumber}.xml`);
      expect(names).toContain(`parts/${w.annPartNumber}.png`);
      expect(zip.get(`parts/${w.annPartNumber}.xml`)!.toString()).toBe('<part><Author>ann</Author></part>');
      // Club things she made are listed in data/, but their files belong to the club.
      expect(names.some((n) => n.startsWith('layouts/clubann'))).toBe(false);
      // Nothing of Bob's or Cy's as files.
      expect(names.filter((n) => /bob|cy |clubbob/i.test(n))).toEqual([]);

      const everything = [...zip.values()].map((b) => b.toString('latin1')).join('\n');
      // No one else's address, part or things.
      expect(everything).not.toContain(w.bob.email);
      expect(everything).not.toContain(w.cy.email);
      expect(everything).not.toContain('CY-PART.1');
      expect(everything).not.toContain('cy venue');
      // No secrets: password hashes, session ids, token hashes, share tokens.
      const secrets: string[] = [];
      for (const u of await db.select().from(schema.users).all()) if (u.passwordHash) secrets.push(u.passwordHash);
      for (const s of await db.select().from(schema.sessions).all()) secrets.push(s.id);
      for (const t of await db.select().from(schema.apiTokens).all()) secrets.push(t.tokenHash);
      for (const d of await db.select().from(schema.deviceCodes).all()) secrets.push(d.deviceCodeHash, d.userCodeHash);
      for (const l of await db.select().from(schema.layouts).all()) if (l.publicShareToken) secrets.push(l.publicShareToken);
      secrets.push(w.annToken);
      for (const s of secrets) expect(everything, 'a secret is in the download').not.toContain(s);
    });

    it('names custom parts by their real number inside each .bld-layout, never "custom:<id>"', async () => {
      const zip = await download(w.ann);
      for (const name of ['layouts/ann layout.bld-layout', 'modules/ann module.bld-layout']) {
        const inner = readZip(zip.get(name)!);
        const bbm = inner.get('layout.bbm')!.toString('utf8');
        expect(bbm, name).toContain(w.annPartNumber);
        expect(bbm, name).not.toMatch(/custom:/i);
        for (const [entry, data] of inner) expect(data.toString('utf8'), `${name} › ${entry}`).not.toMatch(/custom:[0-9a-f-]{8}/i);
      }
    });
  });
});

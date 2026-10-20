// Catalog review rules: an update to a public item keeps its approved text
// until it's approved, a moderator's takedown stays down until a moderator
// brings it back, and an item belongs to whoever shared it.

import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import fastifyMultipart from '@fastify/multipart';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { attachUser } from '../../auth/cookie.js';
import { registerApiRoutes } from '../all.js';
import { closeAll } from '../../events/hub.js';
import { seedProbeWorld, type ProbeWorld } from '../../test/probeWorld.js';
import { db, schema } from '../../test/helpers.js';

let app: FastifyInstance;
let w: ProbeWorld;

async function build() {
  const a = Fastify({ bodyLimit: 10 * 1024 * 1024 });
  await a.register(cookie);
  await a.register(fastifyMultipart);
  a.addHook('preHandler', attachUser);
  await registerApiRoutes(a);
  await a.ready();
  return a;
}

type M = 'GET' | 'POST' | 'PATCH';
const call = (method: M, url: string, cookieStr: string, payload?: Record<string, unknown>) =>
  app.inject({ method, url, headers: { cookie: cookieStr }, ...(method === 'GET' ? {} : { payload: payload ?? {} }) });

const settings = (patch: Record<string, unknown>) => call('PATCH', '/api/admin/settings', w.root.cookie, patch);

async function newModule(who: string, title: string, orgSlug?: string): Promise<string> {
  const r = await call('POST', '/api/modules', who, { title, ...(orgSlug ? { orgSlug } : {}) });
  expect(r.statusCode, r.body).toBe(201);
  return (r.json() as { id: string }).id;
}

const share = (who: string, sourceId: string, extra: Record<string, unknown> = {}) =>
  call('POST', '/api/catalog/submissions', who, { kind: 'module', sourceId, title: 'Station', description: 'A small station', tags: ['station'], ...extra });

async function waitingVersion(itemId: string): Promise<string | undefined> {
  const v = await db
    .select()
    .from(schema.catalogItemVersions)
    .where(and(eq(schema.catalogItemVersions.itemId, itemId), eq(schema.catalogItemVersions.status, 'in_review')))
    .get();
  return v?.id;
}

type Listed = { id: string; title: string; description: string; tags: string[]; version: number };
const publicListing = async () => ((await call('GET', '/api/catalog/items?kind=module', w.viewer.cookie)).json() as { items: Listed[] }).items;
const listed = async (itemId: string) => (await publicListing()).find((i) => i.id === itemId);
const approve = async (versionId: string) => (await call('POST', `/api/moderation/versions/${versionId}/approve`, w.mod.cookie)).statusCode;

beforeEach(async () => {
  app = await build();
  w = await seedProbeWorld(app);
});
afterEach(async () => {
  closeAll();
  await app.close();
});

describe('updates to public items', () => {
  it('an update to a public item keeps the approved text until it is approved', async () => {
    expect((await settings({ catalogReview: 'moderators' })).statusCode).toBe(200);
    const mod = await newModule(w.stranger.cookie, 'Yard');
    const itemId = ((await share(w.stranger.cookie, mod)).json() as { id: string }).id;
    expect(await approve((await waitingVersion(itemId))!)).toBe(200);
    expect((await listed(itemId))?.title).toBe('Station');

    const upd = await share(w.stranger.cookie, mod, { title: 'Grand station', description: 'Now with a roof', tags: ['station', 'roof'] });
    expect((upd.json() as { status: string }).status).toBe('in_review');
    // The public still sees the approved text.
    const live = (await listed(itemId))!;
    expect(live).toMatchObject({ title: 'Station', description: 'A small station', tags: ['station'], version: 1 });

    // The moderators' queue shows the proposed text, and what's public now.
    const q = (await call('GET', '/api/moderation/catalog?view=waiting', w.mod.cookie)).json() as {
      rows: { itemId: string; title: string; description: string; tags: string[]; current: { title: string } | null }[];
    };
    const row = q.rows.find((r) => r.itemId === itemId)!;
    expect(row).toMatchObject({ title: 'Grand station', description: 'Now with a roof', tags: ['station', 'roof'], current: { title: 'Station' } });
    const legacy = (await call('GET', '/api/moderation/items', w.mod.cookie)).json() as { queue: { itemId: string; title: string; current: { title: string } | null }[] };
    expect(legacy.queue.find((r) => r.itemId === itemId)).toMatchObject({ title: 'Grand station', current: { title: 'Station' } });
    // The owner sees it too.
    const mine = (await call('GET', '/api/catalog/mine', w.stranger.cookie)).json() as { items: { id: string; title: string; pendingText: { title: string } | null }[] };
    expect(mine.items.find((i) => i.id === itemId)).toMatchObject({ title: 'Station', pendingText: { title: 'Grand station' } });

    // Approved: the new text is public.
    expect(await approve((await waitingVersion(itemId))!)).toBe(200);
    expect(await listed(itemId)).toMatchObject({ title: 'Grand station', description: 'Now with a roof', tags: ['station', 'roof'], version: 2 });
  });

  it('a declined update leaves the approved text as it was', async () => {
    expect((await settings({ catalogReview: 'moderators' })).statusCode).toBe(200);
    const mod = await newModule(w.stranger.cookie, 'Yard');
    const itemId = ((await share(w.stranger.cookie, mod)).json() as { id: string }).id;
    expect(await approve((await waitingVersion(itemId))!)).toBe(200);
    await share(w.stranger.cookie, mod, { title: 'Something else', description: 'Other words' });
    const decline = await call('POST', `/api/moderation/versions/${(await waitingVersion(itemId))!}/decline`, w.mod.cookie, { reason: 'Not this' });
    expect(decline.statusCode).toBe(200);
    expect(await listed(itemId)).toMatchObject({ title: 'Station', description: 'A small station', version: 1 });
  });

  it('a club member’s update to a trusted club’s public item waits for the club with the approved text showing', async () => {
    expect((await call('POST', '/api/moderation/clubs/olive-club/trust', w.mod.cookie, { trusted: true })).statusCode).toBe(200);
    await db.update(schema.orgs).set({ membersCanCreate: true }).where(eq(schema.orgs.id, w.ids.club!));
    const mod = await newModule(w.olive.cookie, 'Club yard', 'olive-club');
    const first = await share(w.olive.cookie, mod, { title: 'Olive Club yard' });
    expect((first.json() as { status: string }).status).toBe('public');
    const itemId = (first.json() as { id: string }).id;
    const upd = await share(w.member.cookie, mod, { title: 'Club yard, second edition' });
    expect((upd.json() as { status: string }).status).toBe('in_review');
    expect((await listed(itemId))?.title).toBe('Olive Club yard');
    // The club's own queue shows what was sent.
    const review = (await call('GET', '/api/orgs/olive-club/review', w.olive.cookie)).json() as { items: { itemId: string; title: string }[] };
    expect(review.items.find((i) => i.itemId === itemId)?.title).toBe('Club yard, second edition');
    const vid = (await waitingVersion(itemId))!;
    expect((await call('POST', `/api/orgs/olive-club/review/versions/${vid}/approve`, w.olive.cookie)).statusCode).toBe(200);
    expect((await listed(itemId))?.title).toBe('Club yard, second edition');
  });

  it('with review off, an update’s text is public at once', async () => {
    expect((await settings({ catalogReview: 'none' })).statusCode).toBe(200);
    const mod = await newModule(w.stranger.cookie, 'Yard');
    const itemId = ((await share(w.stranger.cookie, mod)).json() as { id: string }).id;
    await share(w.stranger.cookie, mod, { title: 'Grand station' });
    expect(await listed(itemId)).toMatchObject({ title: 'Grand station', version: 2 });
  });
});

describe('takedowns', () => {
  it('with review off, an item a moderator unpublished goes to review when shared again, and a moderator brings it back', async () => {
    expect((await settings({ catalogReview: 'none' })).statusCode).toBe(200);
    const mod = await newModule(w.stranger.cookie, 'Yard');
    const itemId = ((await share(w.stranger.cookie, mod)).json() as { id: string }).id;
    expect((await call('POST', `/api/moderation/items/${itemId}/unpublish`, w.mod.cookie, { reason: 'Not for the catalog' })).statusCode).toBe(200);
    const again = await share(w.stranger.cookie, mod, { title: 'Station again' });
    expect((again.json() as { status: string }).status).toBe('in_review');
    expect(await listed(itemId)).toBeUndefined();
    // Withdrawn and shared again: still for review.
    expect((await call('POST', `/api/catalog/items/${itemId}/withdraw`, w.stranger.cookie)).statusCode).toBe(200);
    expect(((await share(w.stranger.cookie, mod)).json() as { status: string }).status).toBe('in_review');
    expect(await listed(itemId)).toBeUndefined();
    // It's in the site's queue, and approving brings it back.
    const q = (await call('GET', '/api/moderation/catalog?view=waiting', w.mod.cookie)).json() as { rows: { itemId: string; versionId: string }[] };
    const row = q.rows.find((r) => r.itemId === itemId)!;
    expect(await approve(row.versionId)).toBe(200);
    expect(await listed(itemId)).toBeTruthy();
    // Back up: the next share is public at once again.
    expect(((await share(w.stranger.cookie, mod, { title: 'Station, later' })).json() as { status: string }).status).toBe('public');
  });

  it('a declined return keeps the item unpublished, and a moderator can restore it as it was', async () => {
    expect((await settings({ catalogReview: 'moderators' })).statusCode).toBe(200);
    const mod = await newModule(w.stranger.cookie, 'Yard');
    const itemId = ((await share(w.stranger.cookie, mod)).json() as { id: string }).id;
    expect(await approve((await waitingVersion(itemId))!)).toBe(200);
    expect((await call('POST', `/api/moderation/items/${itemId}/unpublish`, w.mod.cookie, { reason: 'Check this' })).statusCode).toBe(200);
    await share(w.stranger.cookie, mod, { title: 'Station again' });
    expect((await call('POST', `/api/moderation/versions/${(await waitingVersion(itemId))!}/decline`, w.mod.cookie, { reason: 'No' })).statusCode).toBe(200);
    const unpublished = (await call('GET', '/api/moderation/catalog?view=unpublished', w.mod.cookie)).json() as { rows: { id: string }[] };
    expect(unpublished.rows.map((r) => r.id)).toContain(itemId);

    // Owners can't restore; a moderator can.
    expect((await call('POST', `/api/moderation/items/${itemId}/restore`, w.stranger.cookie)).statusCode).toBe(403);
    expect((await call('POST', `/api/moderation/items/${itemId}/restore`, w.mod.cookie)).statusCode).toBe(200);
    expect(await listed(itemId)).toMatchObject({ title: 'Station', version: 1 });
    expect((await call('POST', `/api/moderation/items/${itemId}/restore`, w.mod.cookie)).statusCode).toBe(409);
  });

  it('a trusted club can’t bring back an item a site moderator unpublished', async () => {
    expect((await settings({ catalogReview: 'moderators' })).statusCode).toBe(200);
    expect((await call('POST', '/api/moderation/clubs/olive-club/trust', w.mod.cookie, { trusted: true })).statusCode).toBe(200);
    const mod = await newModule(w.olive.cookie, 'Club yard', 'olive-club');
    const itemId = ((await share(w.olive.cookie, mod)).json() as { id: string }).id;
    expect((await call('POST', `/api/moderation/items/${itemId}/unpublish`, w.mod.cookie, { reason: 'Site takedown' })).statusCode).toBe(200);
    // The club's manager shares it again: it waits for the site's moderators.
    expect(((await share(w.olive.cookie, mod)).json() as { status: string }).status).toBe('in_review');
    expect(await listed(itemId)).toBeUndefined();
    const vid = (await waitingVersion(itemId))!;
    const review = (await call('GET', '/api/orgs/olive-club/review', w.olive.cookie)).json() as { items: { itemId: string }[] };
    expect(review.items.some((i) => i.itemId === itemId)).toBe(false);
    expect((await call('POST', `/api/orgs/olive-club/review/versions/${vid}/approve`, w.olive.cookie)).statusCode).toBe(404);
    expect(await listed(itemId)).toBeUndefined();
    // In the site's queue, not the club's.
    const site = (await call('GET', '/api/moderation/catalog?view=waiting', w.mod.cookie)).json() as { rows: { itemId: string }[] };
    expect(site.rows.some((r) => r.itemId === itemId)).toBe(true);
    const trusted = (await call('GET', '/api/moderation/catalog?view=trusted', w.mod.cookie)).json() as { rows: { itemId: string }[] };
    expect(trusted.rows.some((r) => r.itemId === itemId)).toBe(false);
    expect(await approve(vid)).toBe(200);
    expect(await listed(itemId)).toBeTruthy();
  });

  it('a trusted club’s own takedown its managers can bring back', async () => {
    expect((await settings({ catalogReview: 'moderators' })).statusCode).toBe(200);
    expect((await call('POST', '/api/moderation/clubs/olive-club/trust', w.mod.cookie, { trusted: true })).statusCode).toBe(200);
    const mod = await newModule(w.olive.cookie, 'Club yard', 'olive-club');
    const itemId = ((await share(w.olive.cookie, mod)).json() as { id: string }).id;
    expect((await call('POST', `/api/orgs/olive-club/review/items/${itemId}/unpublish`, w.olive.cookie, { reason: 'Club takedown' })).statusCode).toBe(200);
    expect(((await share(w.olive.cookie, mod)).json() as { status: string }).status).toBe('public');
    expect(await listed(itemId)).toBeTruthy();
  });

  it('with review off, a collection a moderator unpublished goes back through review after private, everyone, or a withdrawal', async () => {
    expect((await settings({ catalogReview: 'none' })).statusCode).toBe(200);
    const made = await call('POST', '/api/catalog/collections', w.stranger.cookie, { title: 'My picks', entries: [{ source: 'catalog', id: w.ids.publicItem }] });
    expect(made.statusCode, made.body).toBe(201);
    const id = (made.json() as { id: string }).id;
    const publicIds = async () => ((await call('GET', '/api/catalog/collections', w.viewer.cookie)).json() as { collections: { id: string }[] }).collections.map((c) => c.id);
    expect((await call('POST', `/api/moderation/collections/${id}/unpublish`, w.mod.cookie, { reason: 'Not for the catalog' })).statusCode).toBe(200);

    expect((await call('PATCH', `/api/catalog/collections/${id}`, w.stranger.cookie, { audience: 'private' })).statusCode).toBe(200);
    const back = await call('PATCH', `/api/catalog/collections/${id}`, w.stranger.cookie, { audience: 'everyone' });
    expect((back.json() as { status: string }).status).toBe('in_review');
    expect(await publicIds()).not.toContain(id);

    expect((await call('POST', `/api/catalog/collections/${id}/withdraw`, w.stranger.cookie)).statusCode).toBe(200);
    const again = await call('PATCH', `/api/catalog/collections/${id}`, w.stranger.cookie, { audience: 'everyone' });
    expect((again.json() as { status: string }).status).toBe('in_review');
    expect(await publicIds()).not.toContain(id);

    // A moderator approves it from the queue: it's back, and later changes are public at once again.
    const q = (await call('GET', '/api/moderation/collections/list?view=queue', w.mod.cookie)).json() as { rows: { id: string }[] };
    expect(q.rows.map((r) => r.id)).toContain(id);
    expect((await call('POST', `/api/moderation/collections/${id}/approve`, w.mod.cookie)).statusCode).toBe(200);
    expect(await publicIds()).toContain(id);
    const later = await call('PATCH', `/api/catalog/collections/${id}`, w.stranger.cookie, { title: 'My picks, revised' });
    expect((later.json() as { status: string }).status).toBe('public');
  });

  it('a moderator can restore an unpublished collection; its curator can’t', async () => {
    expect((await settings({ catalogReview: 'none' })).statusCode).toBe(200);
    const id = ((await call('POST', '/api/catalog/collections', w.stranger.cookie, { title: 'My picks', entries: [{ source: 'catalog', id: w.ids.publicItem }] })).json() as { id: string }).id;
    expect((await call('POST', `/api/moderation/collections/${id}/unpublish`, w.mod.cookie, { reason: 'Check' })).statusCode).toBe(200);
    expect((await call('POST', `/api/moderation/collections/${id}/restore`, w.stranger.cookie)).statusCode).toBe(403);
    expect((await call('POST', `/api/moderation/collections/${id}/restore`, w.mod.cookie)).statusCode).toBe(200);
    const listedIds = ((await call('GET', '/api/catalog/collections', w.viewer.cookie)).json() as { collections: { id: string }[] }).collections.map((c) => c.id);
    expect(listedIds).toContain(id);
  });

  it('a trusted club can’t bring back a collection a site moderator unpublished', async () => {
    expect((await settings({ catalogReview: 'moderators' })).statusCode).toBe(200);
    expect((await call('POST', '/api/moderation/clubs/olive-club/trust', w.mod.cookie, { trusted: true })).statusCode).toBe(200);
    const made = await call('POST', '/api/catalog/collections', w.olive.cookie, { title: 'Club picks', clubSlug: 'olive-club', entries: [{ source: 'catalog', id: w.ids.publicItem }] });
    expect(made.statusCode, made.body).toBe(201);
    const id = (made.json() as { id: string; status: string }).id;
    expect((made.json() as { status: string }).status).toBe('public');
    expect((await call('POST', `/api/moderation/collections/${id}/unpublish`, w.mod.cookie, { reason: 'Site takedown' })).statusCode).toBe(200);
    const edit = await call('PATCH', `/api/catalog/collections/${id}`, w.olive.cookie, { title: 'Club picks again' });
    expect((edit.json() as { status: string }).status).toBe('in_review');
    expect((await call('POST', `/api/orgs/olive-club/review/collections/${id}/approve`, w.olive.cookie)).statusCode).toBe(404);
    const review = (await call('GET', '/api/orgs/olive-club/review', w.olive.cookie)).json() as { collections: { id: string }[] };
    expect(review.collections.some((c) => c.id === id)).toBe(false);
    const q = (await call('GET', '/api/moderation/collections/list?view=queue', w.mod.cookie)).json() as { rows: { id: string }[] };
    expect(q.rows.map((r) => r.id)).toContain(id);
    expect((await call('POST', `/api/moderation/collections/${id}/approve`, w.mod.cookie)).statusCode).toBe(200);
  });
});

describe('who an item belongs to', () => {
  it('a share from a module that changed owner makes a new item, and the earlier owner’s item stays as it was', async () => {
    expect((await settings({ catalogReview: 'none' })).statusCode).toBe(200);
    const mod = await newModule(w.olive.cookie, 'Club yard', 'olive-club');
    const itemId = ((await share(w.olive.cookie, mod, { title: 'Olive Club official yard' })).json() as { id: string }).id;
    expect((await call('POST', '/api/orgs/olive-club/move-all', w.olive.cookie, { kind: 'modules', toUserId: w.member.id })).statusCode).toBe(200);
    const upd = await share(w.member.cookie, mod, { title: 'My yard' });
    expect(upd.statusCode).toBe(201);
    const newId = (upd.json() as { id: string }).id;
    expect(newId).not.toBe(itemId);
    const club = await db.select().from(schema.catalogItems).where(eq(schema.catalogItems.id, itemId)).get();
    expect(club).toMatchObject({ ownerOrgId: w.ids.club, title: 'Olive Club official yard', publicVersion: 1 });
    const mine = await db.select().from(schema.catalogItems).where(eq(schema.catalogItems.id, newId)).get();
    expect(mine).toMatchObject({ ownerUserId: w.member.id, ownerOrgId: null, title: 'My yard' });
  });
});

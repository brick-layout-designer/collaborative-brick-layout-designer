// "Last active" in a club's members list: roughly when each member last
// used the site (today, this week, this month, longer ago), never the
// exact time; shown to the people who run the club (invite or manage
// members) and to each person about themselves; and hidden when the member
// turns off Settings › Privacy › "Show club admins when I was last active".

import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { db, loginAs, resetDb, schema } from '../../test/helpers.js';
import { attachUser } from '../../auth/cookie.js';
import { registerApiRoutes } from '../all.js';
import { closeAll } from '../../events/hub.js';
import { lastActiveBucket } from '../preferences.js';

type Who = { cookie: string; id: string };
const DAY = 86_400_000;

describe('last active in a club', () => {
  let app: FastifyInstance;
  let ann: Who; // admin
  let ben: Who; // member
  let cy: Who; // member

  beforeEach(async () => {
    resetDb();
    app = Fastify({ logger: false });
    await app.register(cookie);
    app.addHook('preHandler', attachUser);
    await registerApiRoutes(app);
    ann = await loginAs(app, 'ann@x.com');
    ben = await loginAs(app, 'ben@x.com');
    cy = await loginAs(app, 'cy@x.com');
    const made = await app.inject({ method: 'POST', url: '/api/orgs', headers: { cookie: ann.cookie }, payload: { name: 'Rail Club' } });
    expect(made.statusCode, made.body).toBe(201);
    const orgId = made.json().id as string;
    for (const u of [ben, cy]) await db.insert(schema.orgMembers).values({ orgId, userId: u.id, role: 'member', joinedAt: new Date() });
    // Ben was last seen 3 days ago; Cy 40 days ago.
    await db.update(schema.users).set({ lastSeenAt: new Date(Date.now() - 3 * DAY) }).where(eq(schema.users.id, ben.id));
    await db.update(schema.users).set({ lastSeenAt: new Date(Date.now() - 40 * DAY) }).where(eq(schema.users.id, cy.id));
  });

  afterEach(async () => {
    closeAll();
    await app.close();
  });

  const members = async (who: Who) => {
    const res = await app.inject({ method: 'GET', url: '/api/orgs/rail-club/members', headers: { cookie: who.cookie } });
    expect(res.statusCode).toBe(200);
    return Object.fromEntries((res.json().members as { userId: string; lastActive: string | null }[]).map((m) => [m.userId, m.lastActive]));
  };

  it('says roughly when, never the time', () => {
    const now = Date.now();
    expect(lastActiveBucket(new Date(now - 60_000), now)).toBe('today');
    expect(lastActiveBucket(new Date(now - 3 * DAY), now)).toBe('week');
    expect(lastActiveBucket(new Date(now - 20 * DAY), now)).toBe('month');
    expect(lastActiveBucket(new Date(now - 40 * DAY), now)).toBe('older');
    expect(lastActiveBucket(null, now)).toBe('older');
  });

  it('shows the club’s admins when each member was last active; a member sees only their own', async () => {
    const seen = await members(ann);
    expect(seen[ben.id]).toBe('week');
    expect(seen[cy.id]).toBe('older');
    expect(seen[ann.id]).toBe('today');
    const bens = await members(ben);
    expect(bens[ben.id]).toBe('today');
    expect(bens[ann.id]).toBeNull();
    expect(bens[cy.id]).toBeNull();
  });

  it('hides it when the member turns it off, and shows it again when they turn it back on', async () => {
    const off = await app.inject({ method: 'PUT', url: '/api/me/preferences', headers: { cookie: ben.cookie }, payload: { prefs: { shareLastActive: false } } });
    expect(off.statusCode, off.body).toBe(200);
    expect(off.json().prefs.shareLastActive).toBe(false);
    expect((await members(ann))[ben.id]).toBeNull();
    // Ben still sees his own.
    expect((await members(ben))[ben.id]).toBe('today');
    await app.inject({ method: 'PUT', url: '/api/me/preferences', headers: { cookie: ben.cookie }, payload: { prefs: { shareLastActive: true } } });
    expect((await members(ann))[ben.id]).toBe('week');
  });

  it('is on until changed, and takes only true or false', async () => {
    const got = await app.inject({ method: 'GET', url: '/api/me/preferences', headers: { cookie: cy.cookie } });
    expect(got.json().prefs.shareLastActive).toBe(true);
    const bad = await app.inject({ method: 'PUT', url: '/api/me/preferences', headers: { cookie: cy.cookie }, payload: { prefs: { shareLastActive: 'no' } } });
    expect(bad.statusCode).toBe(400);
  });
});

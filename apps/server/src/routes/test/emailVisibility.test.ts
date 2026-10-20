// Who sees whose email address: club invites picked by name, club and
// layout audit logs, the collections review queue, and a club's data
// download after its requester stops running the club.

import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import fastifyMultipart from '@fastify/multipart';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { attachUser } from '../../auth/cookie.js';
import { registerApiRoutes } from '../all.js';
import { closeAll } from '../../events/hub.js';
import { seedProbeWorld, type ProbeWorld } from '../../test/probeWorld.js';
import { maskEmail } from '../../utils/maskEmail.js';
import { db, schema } from '../../test/helpers.js';
import { eq } from 'drizzle-orm';

let app: FastifyInstance;
let w: ProbeWorld;

type M = 'GET' | 'POST' | 'PATCH' | 'DELETE';
const call = (method: M, url: string, cookieStr: string | null, payload?: Record<string, unknown>) =>
  app.inject({
    method,
    url,
    headers: cookieStr ? { cookie: cookieStr } : {},
    ...(payload !== undefined ? { payload } : method === 'POST' || method === 'PATCH' ? { payload: {} } : {}),
  });

beforeEach(async () => {
  app = Fastify({ bodyLimit: 10 * 1024 * 1024 });
  await app.register(cookie);
  await app.register(fastifyMultipart);
  app.addHook('preHandler', attachUser);
  await registerApiRoutes(app);
  await app.ready();
  w = await seedProbeWorld(app);
});
afterEach(async () => {
  closeAll();
  await app.close();
});

describe('maskEmail', () => {
  it('keeps the first letter and the domain', () => {
    expect(maskEmail('sid@example.com')).toBe('s…@example.com');
    expect(maskEmail('élan@example.org')).toBe('é…@example.org');
    expect(maskEmail('nope')).toBe('…');
  });
});

describe('club invites', () => {
  it("an invite to a person picked by name doesn't show their address to the club", async () => {
    expect((await call('PATCH', `/api/orgs/olive-club/members/${w.member.id}`, w.olive.cookie, { role: 'manager' })).statusCode).toBe(200);
    const inv = await call('POST', '/api/orgs/olive-club/invites', w.member.cookie, { userId: w.stranger.id, role: 'member' });
    expect(inv.statusCode).toBe(200);
    const token = (inv.json() as { token: string }).token;

    const members = await call('GET', '/api/orgs/olive-club/members', w.member.cookie);
    expect(members.body).not.toContain('sid@example.com');
    expect((members.json() as { invites: { invitedEmail: string }[] }).invites.map((i) => i.invitedEmail)).toContain('s…@example.com');

    for (const url of ['/api/orgs/olive-club/audit', `/api/audit?kind=org&id=${w.ids.club}`]) {
      const audit = await call('GET', url, w.member.cookie);
      expect(audit.statusCode, url).toBe(200);
      expect(audit.body, url).not.toContain('sid@example.com');
    }

    // The link's preview: masked for anyone but the person it's for.
    const asManager = (await call('GET', `/api/org-invites/${token}`, w.member.cookie)).json() as { invitedEmail: string; forYou: boolean | null };
    expect(asManager).toMatchObject({ invitedEmail: 's…@example.com', forYou: false });
    const signedOut = (await call('GET', `/api/org-invites/${token}`, null)).json() as { invitedEmail: string; forYou: boolean | null };
    expect(signedOut).toMatchObject({ invitedEmail: 's…@example.com', forYou: null });
    const asThem = (await call('GET', `/api/org-invites/${token}`, w.stranger.cookie)).json() as { invitedEmail: string; forYou: boolean | null };
    expect(asThem).toMatchObject({ invitedEmail: 'sid@example.com', forYou: true });
    expect((await call('POST', `/api/org-invites/${token}`, w.stranger.cookie)).statusCode).toBe(200);
  });

  it('site admins still see full addresses in the audit log', async () => {
    const inv = await call('POST', '/api/orgs/olive-club/invites', w.olive.cookie, { email: 'new@example.com', role: 'member' });
    expect(inv.statusCode).toBe(200);
    // The club's own admin sees the masked form; once a site admin, the full one.
    const asClubAdmin = await call('GET', `/api/audit?kind=org&id=${w.ids.club}`, w.olive.cookie);
    expect(asClubAdmin.body).not.toContain('new@example.com');
    await db.update(schema.users).set({ isGlobalAdmin: true }).where(eq(schema.users.id, w.olive.id));
    const asAdmin = await call('GET', `/api/audit?kind=org&id=${w.ids.club}`, w.olive.cookie);
    expect(asAdmin.statusCode).toBe(200);
    expect(asAdmin.body).toContain('new@example.com');
  });
});

describe('collections review queue', () => {
  it("shows curators' addresses to site admins only", async () => {
    expect((await call('PATCH', '/api/admin/settings', w.root.cookie, { catalogReview: 'moderators' })).statusCode).toBe(200);
    const made = await call('POST', '/api/catalog/collections', w.stranger.cookie, { title: 'Review me', entries: [{ source: 'catalog', id: w.ids.publicItem }] });
    expect((made.json() as { status: string }).status).toBe('in_review');
    for (const url of ['/api/moderation/collections', '/api/moderation/collections/list?view=queue']) {
      const asMod = await call('GET', url, w.mod.cookie);
      expect(asMod.statusCode, url).toBe(200);
      expect(asMod.body, url).not.toContain('sid@example.com');
      const asAdmin = await call('GET', url, w.root.cookie);
      expect(asAdmin.body, url).toContain('sid@example.com');
    }
  });
});

describe("a club's data download", () => {
  it('is only for someone who still runs the club', async () => {
    const { settleExports } = await import('../../privacy/exports.js');
    expect((await call('PATCH', `/api/orgs/olive-club/members/${w.member.id}`, w.olive.cookie, { role: 'admin' })).statusCode).toBe(200);
    const ex = await call('POST', '/api/orgs/olive-club/exports', w.member.cookie);
    expect(ex.statusCode).toBe(202);
    const exportId = (ex.json() as { export: { id: string } }).export.id;
    await settleExports();
    expect((await call('GET', `/api/privacy/exports/${exportId}/download`, w.member.cookie)).statusCode).toBe(200);
    expect((await call('PATCH', `/api/orgs/olive-club/members/${w.member.id}`, w.olive.cookie, { role: 'member' })).statusCode).toBe(200);
    expect((await call('GET', `/api/privacy/exports/${exportId}/download`, w.member.cookie)).statusCode).toBe(404);
    expect((await call('DELETE', `/api/orgs/olive-club/members/${w.member.id}`, w.olive.cookie)).statusCode).toBe(200);
    expect((await call('GET', `/api/privacy/exports/${exportId}/download`, w.member.cookie)).statusCode).toBe(404);
  });
});

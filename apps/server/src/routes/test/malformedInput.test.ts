// Correctness probes (audit 2026-10-20, track B): every route, called by
// someone allowed to call it (the owner, and a site admin), with bodies
// and query strings of the wrong shape. A bad request is a 4xx; nothing
// answers 500. security/routeProbes.test.ts covers who may call what; this
// covers what they send.

import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import fastifyMultipart from '@fastify/multipart';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { attachUser } from '../../auth/cookie.js';
import { registerApiRoutes } from '../all.js';
import { closeAll } from '../../events/hub.js';
import { concreteUrl, seedProbeWorld, type ProbeWorld } from '../../test/probeWorld.js';
import { createSession, SESSION_COOKIE } from '../../auth/session.js';

interface Route {
  key: string;
  method: string;
  url: string;
}

// Every field name a route body reads, set to the wrong type.
const FIELDS = [
  'title', 'name', 'description', 'email', 'role', 'password', 'currentPassword', 'newPassword', 'token', 'slug',
  'userId', 'orgId', 'itemId', 'moduleId', 'layoutId', 'venueId', 'partNumber', 'displayName', 'kind', 'status',
  'reason', 'note', 'message', 'audience', 'visibility', 'tags', 'items', 'ids', 'order', 'limit', 'offset',
  'version', 'data', 'doc', 'venue', 'settings', 'value', 'enabled', 'scopes', 'expiresAt', 'severity', 'scope',
  'recipientEmail', 'invitedEmail', 'joinPolicy', 'listed', 'public', 'code', 'state', 'next', 'url', 'color',
  'width', 'height', 'x', 'y', 'type', 'action', 'decision', 'comment', 'body', 'subject', 'target', 'to',
];

function shaped(make: (field: string) => unknown): Record<string, unknown> {
  return Object.fromEntries(FIELDS.map((f) => [f, make(f)]));
}

const BODIES: { label: string; payload: string }[] = [
  { label: 'an array', payload: '[]' },
  { label: 'a string', payload: '"x"' },
  { label: 'a number', payload: '7' },
  { label: 'null', payload: 'null' },
  { label: 'not JSON', payload: '{"title":' },
  { label: 'numbers for every field', payload: JSON.stringify(shaped(() => 12345)) },
  { label: 'objects for every field', payload: JSON.stringify(shaped(() => ({ a: { b: [1] } }))) },
  { label: 'arrays for every field', payload: JSON.stringify(shaped(() => ['a', 1, null])) },
  { label: 'nulls for every field', payload: JSON.stringify(shaped(() => null)) },
  { label: 'odd strings for every field', payload: JSON.stringify(shaped((f) => (f.length % 2 ? '\u0000\ud800💥'.repeat(3) : ' '.repeat(5)))) },
  { label: 'huge numbers for every field', payload: JSON.stringify(shaped(() => 1e308)) },
];

const QUERIES = [
  'limit=abc&offset=-5&page=1e999&cursor=%00&q=%25_%5C&sort=__proto__',
  'limit=99999999999&offset=99999999999999999999&before=not-a-date&after=2026-13-45',
  'q[]=a&q[]=b&limit[]=1&status[x]=y',
  'q=' + encodeURIComponent('🚂'.repeat(500)),
];

describe('wrong-shaped input from someone allowed to send it', () => {
  let app: FastifyInstance;
  let w: ProbeWorld;
  const routes: Route[] = [];

  beforeAll(async () => {
    app = Fastify({ bodyLimit: 10 * 1024 * 1024 });
    await app.register(cookie);
    await app.register(fastifyMultipart);
    app.addHook('preHandler', attachUser);
    app.addHook('onRoute', (r) => {
      for (const m of Array.isArray(r.method) ? r.method : [r.method]) {
        if (m === 'HEAD' || m === 'OPTIONS') continue;
        if (r.url.startsWith('/ws/') || r.url === '/api/events') continue; // streams
        routes.push({ key: `${m} ${r.url}`, method: m, url: r.url });
      }
    });
    await registerApiRoutes(app);
    await app.ready();
    w = await seedProbeWorld(app);
    // Ones that end the session or remove the seeded things last.
    const late = (r: Route) => Number(/logout|erase|delete|leave|transfer|revoke|restore|move-all/.test(r.url) || r.method === 'DELETE');
    routes.sort((a, b) => late(a) - late(b));
  });
  afterAll(async () => {
    closeAll();
    await app.close();
  });

  // A fresh session per route: a route that signs out, or that a site
  // admin uses to suspend the owner, mustn't turn the rest into 401s.
  async function sessions(): Promise<string[]> {
    const out: string[] = [];
    for (const id of [w.olive.id, w.root.id]) out.push(`${SESSION_COOKIE}=${(await createSession(id)).token}`);
    return out;
  }

  it('no route answers 5xx to a body of the wrong shape', async () => {
    const fives: string[] = [];
    let calls = 0;
    let signedOut = 0;
    for (const r of routes.filter((r) => r.method === 'POST' || r.method === 'PUT' || r.method === 'PATCH')) {
      for (const who of await sessions()) {
        for (const b of BODIES) {
          const res = await app.inject({
            method: r.method as 'POST',
            url: concreteUrl(r.url, w),
            headers: { cookie: who, 'content-type': 'application/json' },
            payload: b.payload,
          });
          calls++;
          if (res.statusCode === 401) signedOut++;
          if (res.statusCode >= 500) fives.push(`${r.key} with ${b.label}: ${res.statusCode} ${res.body.slice(0, 160)}`);
        }
      }
    }
    expect(fives).toEqual([]);
    // The probes got past sign-in, so they reached each route's checks.
    expect(signedOut / calls).toBeLessThan(0.05);
  }, 300_000);

  it('a layout named in any script downloads in every format, under its name', async () => {
    const [olive] = await sessions();
    const title = '東京 Yard 🚂 "Zürich"\u007f';
    const patch = await app.inject({ method: 'PATCH', url: `/api/layouts/${w.ids.layout}`, headers: { cookie: olive! }, payload: { title } });
    expect(patch.statusCode).toBe(200);
    for (const ext of ['bbm', 'bld-layout', 'zip']) {
      const res = await app.inject({ method: 'GET', url: `/api/layouts/${w.ids.layout}/export.${ext}`, headers: { cookie: olive! } });
      expect(res.statusCode, ext).toBe(200);
      const cd = String(res.headers['content-disposition']);
      expect(cd).toMatch(/^attachment; filename="[\x20-\x7e]+"; filename\*=UTF-8''/);
      const encoded = /filename\*=UTF-8''(.+)$/.exec(cd)![1]!;
      expect(decodeURIComponent(encoded)).toBe(`東京 Yard 🚂 _Zürich_.${ext}`);
    }
  });

  it('no route answers 5xx to an odd query string', async () => {
    const fives: string[] = [];
    for (const r of routes.filter((r) => r.method === 'GET')) {
      for (const who of await sessions()) {
        for (const q of QUERIES) {
          const res = await app.inject({ method: 'GET', url: `${concreteUrl(r.url, w)}?${q}`, headers: { cookie: who } });
          if (res.statusCode >= 500) fives.push(`${r.key}?${q.slice(0, 40)}: ${res.statusCode} ${res.body.slice(0, 160)}`);
        }
      }
    }
    expect(fives).toEqual([]);
  }, 300_000);
});

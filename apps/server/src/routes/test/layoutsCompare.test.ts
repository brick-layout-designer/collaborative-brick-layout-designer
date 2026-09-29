// POST /api/layouts/:id/compare (sync P1b): the desktop's reconnect
// preview against the layout as it is on the server now.

import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { issueToken, loginAs, resetDb } from '../../test/helpers.js';
import { attachUser } from '../../auth/cookie.js';
import { passwordRoutes } from '../auth/password.js';
import { deviceRoutes } from '../auth/device.js';
import { layoutRoutes } from '../layouts.js';

const BBM = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../../../../packages/bbm/tests/fixtures/tight-corner.bbm'), 'utf8');

/** The .bbm with the first brick moved along X by `dx` studs. */
function moveFirstBrick(bbm: string, dx: number): string {
  return bbm.replace(/(<Brick id="[^"]+">\s*<DisplayArea>\s*<X>)([^<]+)(<\/X>)/, (_m, a: string, x: string, b: string) => `${a}${Number(x) + dx}${b}`);
}

describe('layout compare', () => {
  let app: FastifyInstance;
  let user: { cookie: string; id: string };
  let id: string;
  let exported: string;
  beforeEach(async () => {
    resetDb();
    app = Fastify({ bodyLimit: 20 * 1024 * 1024 });
    await app.register(cookie);
    app.addHook('preHandler', attachUser);
    await app.register(passwordRoutes);
    await app.register(deviceRoutes);
    await app.register(layoutRoutes);
    user = await loginAs(app, 'desk@example.com');
    const res = await app.inject({ method: 'POST', url: '/api/layouts', headers: { cookie: user.cookie }, payload: { title: 'Show', bbm: BBM } });
    id = (res.json() as { id: string }).id;
    exported = (await app.inject({ method: 'GET', url: `/api/layouts/${id}/export.bbm`, headers: { cookie: user.cookie } })).body;
  });
  afterEach(async () => {
    await app.close();
  });

  const compare = (headers: Record<string, string>, body: unknown) =>
    app.inject({ method: 'POST', url: `/api/layouts/${id}/compare`, headers, payload: body as object });

  it('lists what the desktop changed offline against the current layout', async () => {
    const res = await compare({ cookie: user.cookie }, { base: { bbm: exported }, mine: { bbm: moveFirstBrick(exported, 8) } });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { changes: { kind: string; status: string; mine: string; server: string }[]; conflicts: number };
    expect(body.conflicts).toBe(0);
    expect(body.changes.map((c) => [c.kind, c.status, c.mine, c.server])).toEqual([['brick', 'mine', 'edited', 'unchanged']]);
  });

  it('works with a layouts:read token; refuses other scopes, strangers and bad input', async () => {
    const reader = await issueToken(app, user.cookie, 'layouts:read');
    const ok = await compare({ authorization: `Bearer ${reader}` }, { base: { bbm: exported }, mine: { bbm: exported } });
    expect(ok.json()).toEqual({ changes: [], conflicts: 0 });

    const parts = await issueToken(app, user.cookie, 'parts:read');
    expect((await compare({ authorization: `Bearer ${parts}` }, { base: { bbm: exported }, mine: { bbm: exported } })).statusCode).toBe(403);

    const stranger = await loginAs(app, 'other@example.com');
    expect((await compare({ cookie: stranger.cookie }, { base: { bbm: exported }, mine: { bbm: exported } })).statusCode).toBe(404);

    for (const body of [{}, { base: { bbm: exported } }, { base: { bbm: 'not xml' }, mine: { bbm: exported } }, { base: { bbm: exported, sidecar: 5 }, mine: { bbm: exported } }]) {
      expect((await compare({ cookie: user.cookie }, body)).statusCode).toBe(400);
    }
  });
});

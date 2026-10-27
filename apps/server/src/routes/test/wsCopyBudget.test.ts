// The grid guard works most updates out from the keys they touch, and a
// few on a copy of the room's document (ws/gridGuard.ts). A copy costs the
// layout's size, so how much of that one person's updates may take is
// limited (ws/pacing.ts copyBudget): a client sending small hand-made
// updates that each need one is slowed down (1013) instead of keeping the
// server copying the layout.

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import { WebSocket } from 'ws';
import * as encoding from 'lib0/encoding';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loginAs, resetDb } from '../../test/helpers.js';
import { attachUser } from '../../auth/cookie.js';
import { passwordRoutes } from '../auth/password.js';
import { layoutRoutes } from '../layouts.js';
import { wsRoutes } from '../ws.js';
import { docHub } from '../../ws/docHub.js';
import { guardWork } from '../../ws/decoded.js';
import { resetCopyBudgets } from '../../ws/pacing.js';

const FIXTURES = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../../packages/bbm/tests/fixtures');

/** A 50-byte update with two blocks for one client at one clock: the guard works it out on a copy. */
function overlappingUpdate(client: number): Uint8Array {
  const e = encoding.createEncoder();
  encoding.writeVarUint(e, 0); // sync
  encoding.writeVarUint(e, 2); // update
  const u = encoding.createEncoder();
  encoding.writeVarUint(u, 2);
  for (let b = 0; b < 2; b++) {
    encoding.writeVarUint(u, 1);
    encoding.writeVarUint(u, client);
    encoding.writeVarUint(u, 0);
    encoding.writeUint8(u, 8 | 0x20); // values, under a key
    encoding.writeVarUint(u, 1);
    encoding.writeVarString(u, 'meta');
    encoding.writeVarString(u, 'comment');
    encoding.writeVarUint(u, 1);
    encoding.writeUint8(u, 119);
    encoding.writeVarString(u, 'x');
  }
  encoding.writeVarUint(u, 0);
  encoding.writeVarUint8Array(e, encoding.toUint8Array(u));
  return encoding.toUint8Array(e);
}

describe('updates the grid guard works out on a copy', () => {
  let app: FastifyInstance;
  let port: number;
  let owner: { cookie: string; id: string };
  const opened: string[] = [];

  beforeEach(async () => {
    resetDb();
    resetCopyBudgets();
    app = Fastify({ logger: false });
    await app.register(cookie);
    app.addHook('preHandler', attachUser);
    await app.register(passwordRoutes);
    await app.register(layoutRoutes);
    await app.register(wsRoutes);
    await app.listen({ port: 0, host: '127.0.0.1' });
    port = (app.server.address() as { port: number }).port;
    owner = await loginAs(app, 'copier@x.com');
  });

  afterEach(async () => {
    for (const id of opened.splice(0)) await docHub.close(id);
    await app.close();
  });

  it('slow a sender down once they have cost a few dozen copies of the layout', { timeout: 120_000 }, async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/layouts',
      headers: { cookie: owner.cookie },
      payload: { title: 'Fordyce', bbm: readFileSync(join(FIXTURES, 'fordyce-2026.bbm'), 'utf8') },
    });
    const id = res.json().id as string;
    opened.push(id);
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/layout/${id}`, { headers: { cookie: owner.cookie } });
    ws.on('error', () => {});
    const closed = new Promise<[number, string]>((r) => ws.once('close', (code, reason) => r([code, reason.toString()])));
    await new Promise<void>((r) => ws.once('message', () => r()));
    const before = guardWork.docCopies;
    // 300 messages: well inside the message and byte pacing, and each needs a copy.
    for (let i = 0; i < 300 && ws.readyState === WebSocket.OPEN; i++) ws.send(overlappingUpdate(777));
    const outcome = await Promise.race([closed, new Promise<'open'>((r) => setTimeout(() => r('open'), 20_000))]);
    expect(outcome).toEqual([1013, 'slow_down']);
    // 16 MiB of a ~250 KB layout: about 64 copies, not 300.
    expect(guardWork.docCopies - before).toBeLessThan(100);
  });
});

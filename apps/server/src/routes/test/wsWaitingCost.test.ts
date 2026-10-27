// Changes one editor leaves waiting on another editor's next ones land with
// that editor's edits, each worked out on a copy of the layout. Those
// copies are the room's and the leaver's to pay for (ws/pending.ts
// copyPayer), never the editor's whose edits they land with: that editor
// is never slowed down for them, and whoever leaves them is held to the
// room's budget.

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import { WebSocket } from 'ws';
import * as Y from 'yjs';
import * as encoding from 'lib0/encoding';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db, loginAs, resetDb, schema } from '../../test/helpers.js';
import { attachUser } from '../../auth/cookie.js';
import { passwordRoutes } from '../auth/password.js';
import { layoutRoutes } from '../layouts.js';
import { wsRoutes } from '../ws.js';
import { docHub } from '../../ws/docHub.js';
import { guardWork } from '../../ws/decoded.js';
import { copyBudget, resetCopyBudgets, wsPacing } from '../../ws/pacing.js';
import { Peer } from './wsPeer.js';

const FIXTURES = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../../packages/bbm/tests/fixtures');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** `n` values of client `client` (clocks 0..n-1), the k-th placed after `waitOn`'s clock `from + k`, which the room doesn't have yet. */
function waitingOn(client: number, waitOn: number, from: number, n: number): Uint8Array {
  const e = encoding.createEncoder();
  encoding.writeVarUint(e, 0); // sync
  encoding.writeVarUint(e, 2); // update
  const u = encoding.createEncoder();
  encoding.writeVarUint(u, 1); // one client
  encoding.writeVarUint(u, n);
  encoding.writeVarUint(u, client);
  encoding.writeVarUint(u, 0);
  for (let k = 0; k < n; k++) {
    encoding.writeUint8(u, 8 | 0x80); // values, after an origin
    encoding.writeVarUint(u, waitOn);
    encoding.writeVarUint(u, from + k);
    encoding.writeVarUint(u, 1);
    encoding.writeUint8(u, 119);
    encoding.writeVarString(u, 'x');
  }
  encoding.writeVarUint(u, 0); // no deletes
  encoding.writeVarUint8Array(e, encoding.toUint8Array(u));
  return encoding.toUint8Array(e);
}

describe('changes left waiting on another editor', () => {
  let app: FastifyInstance;
  let port: number;
  let owner: { cookie: string; id: string };
  let other: { cookie: string; id: string };
  const opened: string[] = [];
  const saved = { ...wsPacing };

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
    owner = await loginAs(app, 'editor@x.com');
    other = await loginAs(app, 'leaver@x.com');
  });

  afterEach(async () => {
    Object.assign(wsPacing, saved);
    resetCopyBudgets();
    vi.restoreAllMocks();
    for (const id of opened.splice(0)) await docHub.close(id);
    await app.close();
  });

  async function layout(): Promise<string> {
    const res = await app.inject({
      method: 'POST',
      url: '/api/layouts',
      headers: { cookie: owner.cookie },
      payload: { title: 'Fordyce', bbm: readFileSync(join(FIXTURES, 'fordyce-2026.bbm'), 'utf8') },
    });
    const id = res.json().id as string;
    opened.push(id);
    db.insert(schema.layoutCollaborators).values({ layoutId: id, userId: other.id, role: 'editor', addedAt: new Date() }).run();
    return id;
  }

  async function raw(id: string, who: { cookie: string }) {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/layout/${id}`, { headers: { cookie: who.cookie } });
    ws.on('error', () => {});
    const closed = new Promise<[number, string]>((r) => ws.once('close', (c, why) => r([c, why.toString()])));
    await new Promise<void>((r) => ws.once('message', () => r()));
    return { ws, closed };
  }

  /** The editor makes `n` edits, one at a time as a person would, and the room has them all. */
  async function edits(peer: Peer, id: string, n: number) {
    const client = peer.doc.clientID;
    const want = Y.getState(peer.doc.store, client) + n;
    for (let i = 0; i < n; i++) {
      peer.doc.getMap('meta').set('comment', `edit ${i}`);
      await sleep(2);
    }
    const room = docHub.peek(id)!;
    for (let i = 0; i < 250 && Y.getState(room.doc.store, client) < want; i++) await sleep(20);
    expect(Y.getState(room.doc.store, client)).toBe(want);
  }

  it('never slow down the editor they land with', { timeout: 120_000 }, async () => {
    const id = await layout();
    const editor = new Peer(port, id, owner.cookie, new Y.Doc());
    await editor.synced;
    editor.doc.getMap('meta').set('comment', 'start');
    await sleep(100);
    const leaver = await raw(id, other);
    const from = Y.getState(editor.doc.store, editor.doc.clientID);
    // 200 changes, each waiting on the editor's next edit.
    leaver.ws.send(waitingOn(4242, editor.doc.clientID, from, 200));
    await sleep(200);
    expect(docHub.peek(id)!.doc.store.pendingStructs).not.toBeNull();
    const editorCopies = copyBudget(owner.id);
    const copies = guardWork.docCopies;
    await edits(editor, id, 200);
    // Each edit lands one until the room's budget (16 MiB of a ~250 KB layout) is spent; then what waits is dropped.
    expect(guardWork.docCopies - copies).toBeGreaterThan(0);
    expect(guardWork.docCopies - copies).toBeLessThan(100);
    expect(editorCopies.full()).toBe(true);
    expect(editor.ws.readyState).toBe(WebSocket.OPEN);
    expect(docHub.peek(id)!.doc.store.pendingStructs).toBeNull();
    // The one who left them paid.
    expect(copyBudget(other.id).full()).toBe(false);
    await editor.leave();
    leaver.ws.close();
  });

  it('may be left only while the room’s budget for them lasts', { timeout: 60_000 }, async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    wsPacing.roomCopyByteBurst = 1;
    wsPacing.roomCopyBytesPerSecond = 0;
    const id = await layout();
    const editor = new Peer(port, id, owner.cookie, new Y.Doc());
    await editor.synced;
    const leaver = await raw(id, other);
    const from = Y.getState(editor.doc.store, editor.doc.clientID);
    leaver.ws.send(waitingOn(4243, editor.doc.clientID, from, 3));
    await sleep(200);
    // The first edit lands one and spends the room's budget; with the next, what still waits goes.
    await edits(editor, id, 1);
    expect(docHub.peek(id)!.doc.store.pendingStructs).not.toBeNull();
    const copies = guardWork.docCopies;
    await edits(editor, id, 1);
    expect(docHub.peek(id)!.doc.store.pendingStructs).toBeNull();
    expect(guardWork.docCopies).toBe(copies);
    // Leaving more now is refused, and the editor carries on.
    leaver.ws.send(waitingOn(4244, editor.doc.clientID, from + 2, 3));
    expect(await leaver.closed).toEqual([1008, 'unreadable_update']);
    const refused = db.select().from(schema.auditEvents).where(eq(schema.auditEvents.eventType, 'layout_update_refused')).all();
    expect(JSON.parse(refused.at(-1)!.payload!)).toMatchObject({ kind: 'incomplete' });
    await edits(editor, id, 20);
    expect(editor.ws.readyState).toBe(WebSocket.OPEN);
    await editor.leave();
  });
});

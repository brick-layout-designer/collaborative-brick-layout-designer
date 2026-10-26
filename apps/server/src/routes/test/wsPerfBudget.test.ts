// What the live route does per incoming update, counted rather than timed
// so it holds on a busy CI runner (ws/decoded.ts guardWork), over a real
// socket:
//   - a desktop's first sync of a large layout, a paste of 1000 parts, an
//     offline session and a run of single edits: each update decoded once
//     (shared by the grid and merge guards), no copy of the room's document,
//     and stored a few rows at a time;
//   - a grid size change still works out what it leaves, on a copy;
//   - on that shared path every refusal still happens as before, with the
//     same close code and the same audit event: an update the apps can't
//     read, a grid size outside 1 to 2^31-1 (0, negative, NaN, infinite,
//     gone), a merge of another layout, more waiting than a room holds, a
//     connection sending too fast, and a message over the size limit.
// The times it logs are for reading, not a gate.

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import { WebSocket } from 'ws';
import * as Y from 'yjs';
import * as syncProtocol from 'y-protocols/sync';
import * as encoding from 'lib0/encoding';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDefaultLayoutDoc } from '@cld/ydoc';
import { db, loginAs, resetDb, schema } from '../../test/helpers.js';
import { attachUser } from '../../auth/cookie.js';
import { passwordRoutes } from '../auth/password.js';
import { layoutRoutes } from '../layouts.js';
import { WS_MAX_PAYLOAD, wsRoutes } from '../ws.js';
import { docHub } from '../../ws/docHub.js';
import { guardWork } from '../../ws/decoded.js';
import { MAX_PENDING_BYTES, pendingBytes } from '../../ws/pending.js';
import { wsPacing } from '../../ws/pacing.js';
import { Peer } from './wsPeer.js';

const FIXTURES = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../../packages/bbm/tests/fixtures');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const pacingDefaults = { ...wsPacing };

interface Raw {
  ws: WebSocket;
  closed: Promise<[number, string]>;
}

function rawSocket(port: number, layoutId: string, cookieStr: string): Promise<Raw> {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/layout/${layoutId}`, { headers: { cookie: cookieStr } });
  ws.on('error', () => {});
  const closed = new Promise<[number, string]>((r) => ws.once('close', (c, why) => r([c, why.toString()])));
  return new Promise((resolveOpen, reject) => {
    ws.once('open', () => resolveOpen({ ws, closed }));
    ws.once('error', reject);
  });
}

function updateMsg(update: Uint8Array): Uint8Array {
  const enc = encoding.createEncoder();
  encoding.writeVarUint(enc, 0);
  syncProtocol.writeUpdate(enc, update);
  return encoding.toUint8Array(enc);
}

const gridOf = (doc: Y.Doc) =>
  [...doc.getMap<Y.Map<unknown>>('layerData').values()].find((l) => l instanceof Y.Map && l.get('type') === 'grid')!;
const bricksOf = (doc: Y.Doc) =>
  [...doc.getMap<Y.Map<unknown>>('layerData').values()].map((l) => l.get('bricks')).find((b) => b instanceof Y.Array) as Y.Array<Y.Map<unknown>>;

describe('WS perf budget', () => {
  let app: FastifyInstance;
  let port: number;
  let cookieStr: string;
  const opened: string[] = [];

  beforeEach(async () => {
    resetDb();
    app = Fastify();
    await app.register(cookie);
    app.addHook('preHandler', attachUser);
    await app.register(passwordRoutes);
    await app.register(layoutRoutes);
    await app.register(wsRoutes);
    await app.listen({ port: 0, host: '127.0.0.1' });
    port = (app.server.address() as { port: number }).port;
    cookieStr = (await loginAs(app, 'perf-budget@example.com')).cookie;
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    Object.assign(wsPacing, pacingDefaults);
    for (const id of opened.splice(0)) await docHub.close(id);
    await app.close();
  });

  async function create(payload: Record<string, unknown> = { title: 'Yard' }): Promise<string> {
    const res = await app.inject({ method: 'POST', url: '/api/layouts', headers: { cookie: cookieStr }, payload });
    expect(res.statusCode).toBe(201);
    const id = (res.json() as { id: string }).id;
    opened.push(id);
    return id;
  }

  const rows = (id: string) => db.select().from(schema.layoutUpdates).where(eq(schema.layoutUpdates.layoutId, id)).all().length;
  const audits = (type: string) => db.select().from(schema.auditEvents).where(eq(schema.auditEvents.eventType, type)).all();
  const room = (id: string) => docHub.peek(id)!;
  const work = () => ({ ...guardWork });
  const since = (before: typeof guardWork) => ({ decodes: guardWork.decodes - before.decodes, docCopies: guardWork.docCopies - before.docCopies });
  /** Until `done`, polling (for up to 4 s: a busy runner is slow, and only the counts are checked). */
  async function until(done: () => boolean): Promise<number> {
    const t = performance.now();
    while (!done() && performance.now() - t < 4000) await sleep(4);
    expect(done()).toBe(true);
    return performance.now() - t;
  }

  it('decodes each update once and copies no document for a first sync, a paste, an offline session and single edits', async () => {
    const id = await create({ title: 'Fordyce', bbm: readFileSync(join(FIXTURES, 'fordyce-2026.bbm'), 'utf8') });
    const times: string[] = [];

    // First sync: an empty doc gets the whole layout; its step 2 is one (empty) update.
    let w = work();
    const doc = new Y.Doc();
    let t = performance.now();
    const peer = new Peer(port, id, cookieStr, doc);
    await peer.synced;
    await until(() => since(w).decodes >= 1);
    times.push(`first sync ${(performance.now() - t).toFixed(0)} ms`);
    expect(since(w)).toEqual({ decodes: 1, docCopies: 0 });

    // A paste of 1000 parts: one update, one decode, one row.
    const bricks = bricksOf(doc);
    const rowsBefore = rows(id);
    w = work();
    t = performance.now();
    doc.transact(() => {
      const pasted: Y.Map<unknown>[] = [];
      for (let i = 0; i < 1000; i++) {
        const y = new Y.Map<unknown>();
        y.set('id', `paste-${i}`);
        y.set('displayArea', { x: i, y: i, width: 8, height: 8 });
        y.set('partNumber', '3001.1');
        y.set('orientation', 0);
        pasted.push(y);
      }
      bricks.push(pasted);
    });
    await until(() => bricksOf(room(id).doc).length === bricks.length);
    times.push(`paste of 1000 parts applied ${(performance.now() - t).toFixed(0)} ms`);
    expect(since(w)).toEqual({ decodes: 1, docCopies: 0 });
    await until(() => rows(id) > rowsBefore);
    expect(rows(id)).toBe(rowsBefore + 1);

    // Offline: 500 edits, then one step 2 on reconnect.
    await peer.leave();
    for (let i = 0; i < 500; i++) bricks.get(i % bricks.length).set('orientation', i % 360);
    w = work();
    t = performance.now();
    const back = new Peer(port, id, cookieStr, doc);
    await back.synced;
    await until(() => Y.encodeStateVector(room(id).doc).toString() === Y.encodeStateVector(doc).toString());
    times.push(`offline session of 500 edits ${(performance.now() - t).toFixed(0)} ms`);
    expect(since(w)).toEqual({ decodes: 1, docCopies: 0 });

    // Steady single edits: one update each, a decode each, stored a few rows at a time.
    await until(() => rows(id) > 0);
    const steadyRows = rows(id);
    w = work();
    t = performance.now();
    const n = 200;
    for (let i = 0; i < n; i++) bricks.get(i).set('orientation', (i * 7) % 360);
    await until(() => since(w).decodes >= n);
    const steady = performance.now() - t;
    times.push(`${n} single edits ${steady.toFixed(0)} ms (${(steady / n).toFixed(2)} ms each)`);
    expect(since(w)).toEqual({ decodes: n, docCopies: 0 });
    expect(Y.encodeStateVector(room(id).doc)).toEqual(Y.encodeStateVector(doc));
    await sleep(120);
    expect(rows(id) - steadyRows).toBeGreaterThan(0);
    expect(rows(id) - steadyRows).toBeLessThan(n / 4);
    expect(pendingBytes(room(id).doc)).toBe(0);

    // A grid size change is still worked out on a copy (and taken).
    w = work();
    gridOf(doc).set('gridSizeInStud', 48);
    await until(() => gridOf(room(id).doc).get('gridSizeInStud') === 48);
    expect(since(w)).toEqual({ decodes: 1, docCopies: 1 });
    expect(back.ws.readyState).toBe(WebSocket.OPEN);
    console.log(`[perf budget] ${times.join('; ')}`);
    await back.leave();
  });

  // Each refused update, sent on its own connection to a layout with a grid.
  // `edit` changes a copy of the room's document; what it changed is sent.
  type Refusal = [string, (d: Y.Doc) => void, [number, string], string, Record<string, unknown>];
  const refusals: Refusal[] = [
    ['a string with a NUL in it', (d) => d.getMap('meta').set('nul', 'a\u0000b'), [1008, 'unreadable_update'], 'layout_update_refused', { kind: 'unreadable' }],
    ['a grid size of 0', (d) => gridOf(d).set('gridSizeInStud', 0), [1008, 'unreadable_update'], 'layout_update_refused', { kind: 'unreadable' }],
    ['a negative grid size', (d) => gridOf(d).set('gridSizeInStud', -8), [1008, 'unreadable_update'], 'layout_update_refused', { kind: 'unreadable' }],
    ['a grid size of NaN', (d) => gridOf(d).set('gridSizeInStud', Number.NaN), [1008, 'unreadable_update'], 'layout_update_refused', { kind: 'unreadable' }],
    ['an infinite grid size', (d) => gridOf(d).set('gridSizeInStud', Number.NEGATIVE_INFINITY), [1008, 'unreadable_update'], 'layout_update_refused', { kind: 'unreadable' }],
    ['the grid size deleted', (d) => gridOf(d).delete('gridSizeInStud'), [1008, 'unreadable_update'], 'layout_update_refused', { kind: 'unreadable' }],
    [
      'a valid grid size written and deleted in one update',
      (d) =>
        d.transact(() => {
          gridOf(d).set('gridSizeInStud', 48);
          gridOf(d).delete('gridSizeInStud');
        }),
      [1008, 'unreadable_update'],
      'layout_update_refused',
      { kind: 'unreadable' },
    ],
    [
      'a new grid layer of 0 studs, among 1000 pasted parts',
      (d) =>
        d.transact(() => {
          const parts = new Y.Map<unknown>();
          parts.set('type', 'brick');
          const list = new Y.Array<Y.Map<unknown>>();
          parts.set('bricks', list);
          d.getMap('layerData').set('P', parts);
          list.push(
            Array.from({ length: 1000 }, (_, i) => {
              const y = new Y.Map<unknown>();
              y.set('id', `p${i}`);
              y.set('orientation', 0);
              return y;
            }),
          );
          const g = new Y.Map<unknown>();
          d.getMap('layerData').set('G2', g);
          g.set('type', 'grid');
          g.set('gridSizeInStud', 0);
          d.getArray<string>('layers').push(['P', 'G2']);
        }),
      [1008, 'unreadable_update'],
      'layout_update_refused',
      { kind: 'unreadable' },
    ],
    [
      'another layout merged in',
      (d) => Y.applyUpdate(d, Y.encodeStateAsUpdate(createDefaultLayoutDoc())),
      [1008, 'layout_merge_refused'],
      'layout_merge_refused',
      {},
    ],
  ];

  it.each(refusals)('refuses %s on the shared-decode path: same close, same audit, layout unchanged', async (_what, edit, close, event, payload) => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const id = await create();
    const peer = await rawSocket(port, id, cookieStr);
    await sleep(50);
    const before = Y.encodeStateAsUpdate(room(id).doc);
    const mine = new Y.Doc();
    Y.applyUpdate(mine, before);
    const sv = Y.encodeStateVector(mine);
    edit(mine);
    peer.ws.send(updateMsg(Y.encodeStateAsUpdate(mine, sv)));
    expect(await peer.closed).toEqual(close);
    await vi.waitFor(() => expect(audits(event)).toHaveLength(1));
    expect(JSON.parse(audits(event)[0]!.payload!)).toMatchObject(payload);
    expect(Y.encodeStateAsUpdate(room(id).doc)).toEqual(before);
    await sleep(80);
    expect(rows(id)).toBe(0);
  });

  it('refuses more waiting than a room holds on the shared-decode path', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const id = await create();
    const peer = await rawSocket(port, id, cookieStr);
    await sleep(50);
    const before = Y.encodeStateAsUpdate(room(id).doc);
    const d = new Y.Doc();
    d.getMap('p').set('seed', 1); // never sent: what follows waits for it
    const sv = Y.encodeStateVector(d);
    d.getMap('p').set('big', 'q'.repeat(MAX_PENDING_BYTES + 1024));
    peer.ws.send(updateMsg(Y.encodeStateAsUpdate(d, sv)));
    expect(await peer.closed).toEqual([1008, 'unreadable_update']);
    await vi.waitFor(() => expect(audits('layout_update_refused')).toHaveLength(1));
    expect(JSON.parse(audits('layout_update_refused')[0]!.payload!)).toMatchObject({ kind: 'incomplete' });
    expect(Y.encodeStateAsUpdate(room(id).doc)).toEqual(before);
    expect(pendingBytes(room(id).doc)).toBe(0);
  });

  it('still closes a connection sending too fast (1013) and a message over the size limit (1009)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const id = await create();
    wsPacing.messageBurst = 5;
    wsPacing.messagesPerSecond = 1;
    const fast = await rawSocket(port, id, cookieStr);
    const d = new Y.Doc();
    Y.applyUpdate(d, Y.encodeStateAsUpdate(room(id).doc));
    for (let i = 0; i < 20; i++) {
      const sv = Y.encodeStateVector(d);
      d.getMap('meta').set('k', i);
      fast.ws.send(updateMsg(Y.encodeStateAsUpdate(d, sv)));
    }
    expect(await fast.closed).toEqual([1013, 'slow_down']);
    expect(warn.mock.calls.filter((c) => String(c[0]).includes('sent faster than allowed'))).toHaveLength(1);
    Object.assign(wsPacing, pacingDefaults);

    const big = await rawSocket(port, id, cookieStr);
    big.ws.send(Buffer.alloc(WS_MAX_PAYLOAD + 1));
    expect((await big.closed)[0]).toBe(1009);
  });
});

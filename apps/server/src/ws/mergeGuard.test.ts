// The cross-merge guard on the updates real clients send: the old desktop's
// merge (one Yjs doc kept across layouts, as in ops/unmergeLayouts.test.ts)
// is refused, every normal flow passes.

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { readBbm } from '@cld/bbm';
import { bbmToDoc, createDefaultLayoutDoc, writeSidecarCache } from '@cld/ydoc';
import { checkIncomingUpdate, SUSPICIOUS_UNSEEN_CLIENTS } from './mergeGuard.js';
import { planUnmerge } from '../ops/unmergeLayouts.js';

const FIXTURES = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../packages/bbm/tests/fixtures');
const fixture = (name: string) => readBbm(readFileSync(join(FIXTURES, name), 'utf8')).map;

/** A layout as the server holds it: made by the server (POST /api/layouts). */
function serverLayout(clientID: number, bbm?: string): Y.Doc {
  const doc = new Y.Doc();
  doc.clientID = clientID;
  if (bbm) bbmToDoc(fixture(bbm), doc);
  else Y.applyUpdate(doc, Y.encodeStateAsUpdate(createDefaultLayoutDoc()));
  return doc;
}

/** A client that synced the layout (web tab, desktop): a fresh doc plus the server's state. */
function synced(server: Y.Doc, clientID: number): Y.Doc {
  const doc = new Y.Doc();
  doc.clientID = clientID;
  Y.applyUpdate(doc, Y.encodeStateAsUpdate(server));
  return doc;
}

/** What a client sends: sync step 2 (all the server lacks). */
function step2(client: Y.Doc, server: Y.Doc): Uint8Array {
  return Y.encodeStateAsUpdate(client, Y.encodeStateVector(server));
}

/** The updates a client sends while connected, one per transaction. */
function recording(doc: Y.Doc, edit: () => void): Uint8Array[] {
  const out: Uint8Array[] = [];
  const on = (u: Uint8Array) => out.push(u);
  doc.on('update', on);
  edit();
  doc.off('update', on);
  return out;
}

/** The server's side: check, then apply only what passes. */
function deliver(server: Y.Doc, update: Uint8Array) {
  const check = checkIncomingUpdate(server, update);
  if (!check.refuse) Y.applyUpdate(server, update);
  return check;
}

function addLayer(doc: Y.Doc, id: string, index?: number): void {
  doc.transact(() => {
    const l = new Y.Map<unknown>();
    l.set('id', id);
    l.set('type', 'brick');
    l.set('name', id);
    l.set('bricks', new Y.Array());
    doc.getMap('layerData').set(id, l);
    const order = doc.getArray<string>('layers');
    order.insert(index ?? order.length, [id]);
  });
}

function brickLayer(doc: Y.Doc): Y.Array<Y.Map<unknown>> {
  const data = doc.getMap<Y.Map<unknown>>('layerData');
  for (const id of doc.getArray<string>('layers').toArray()) {
    const l = data.get(id);
    if (l?.get('type') === 'brick') return l.get('bricks') as Y.Array<Y.Map<unknown>>;
  }
  throw new Error('no brick layer');
}

function brick(n: number): Y.Map<unknown> {
  const b = new Y.Map<unknown>();
  b.set('guid', `pasted-${n}`);
  b.set('partNumber', '3001.1');
  b.set('displayArea', { x: n * 32, y: 0, width: 32, height: 32 });
  return b;
}

/** The old desktop: one doc for every layout it opens. */
class OldDesktop {
  readonly doc = new Y.Doc();
  constructor(clientID = 9001) {
    this.doc.clientID = clientID;
  }
  /** Opening a layout: the server's state in, the desktop's step 2 out. */
  open(server: Y.Doc): Uint8Array {
    const out = step2(this.doc, server);
    Y.applyUpdate(this.doc, Y.encodeStateAsUpdate(server));
    return out;
  }
}

function snapshot(doc: Y.Doc): Uint8Array {
  return Y.encodeStateAsUpdate(doc);
}

describe('checkIncomingUpdate: cross-merges', () => {
  it('refuses the Oct 17 pattern: a desktop that opened A sends A to B; B is unchanged', () => {
    const a = serverLayout(100, 'fordyce-2026.bbm');
    a.transact(() => writeSidecarCache(a, { schemaVersion: 1, bbmHashSha256: '', modules: [{ id: 'mod-a', name: 'Station', brickIds: ['1'] }] }));
    const b = serverLayout(300);
    const before = snapshot(b);
    const desktop = new OldDesktop();
    expect(deliver(a, desktop.open(a)).refuse).toBe(false); // nothing new for A
    const check = deliver(b, desktop.open(b));
    expect(check.refuse).toBe(true);
    expect(check.foreignLayers).toBe(a.getArray('layers').length);
    expect(check.docLayers).toBe(b.getArray('layers').length);
    expect(snapshot(b)).toEqual(before);
  });

  it('refuses it into an imported layout too, and when the desktop answers after reading B', () => {
    const a = serverLayout(100, 'fordyce-2026.bbm');
    const c = serverLayout(50, 'tight-corner.bbm');
    const desktop = new OldDesktop();
    desktop.open(a);
    Y.applyUpdate(desktop.doc, Y.encodeStateAsUpdate(c)); // C's state arrived first
    expect(deliver(c, step2(desktop.doc, c)).refuse).toBe(true);
  });

  it('refuses a chained merge: A and B held, sent to C', () => {
    const a = serverLayout(100, 'fordyce-2026.bbm');
    const b = serverLayout(300);
    const c = serverLayout(50, 'tight-corner.bbm');
    const desktop = new OldDesktop();
    desktop.open(a);
    desktop.open(b); // refused at B: the desktop still holds both
    const before = snapshot(c);
    const check = deliver(c, desktop.open(c));
    expect(check.refuse).toBe(true);
    expect(check.foreignLayers).toBe(a.getArray('layers').length + b.getArray('layers').length);
    expect(snapshot(c)).toEqual(before);
  });

  it('refuses a chain through a layout the merge already reached (before the guard)', () => {
    const a = serverLayout(100, 'fordyce-2026.bbm');
    const b = serverLayout(300);
    const c = serverLayout(50, 'tight-corner.bbm');
    const desktop = new OldDesktop();
    desktop.open(a);
    Y.applyUpdate(b, desktop.open(b)); // the Oct 17 merge, applied
    // A second old desktop opens the merged B, then C.
    const other = new OldDesktop(9002);
    other.open(b);
    expect(deliver(c, other.open(c)).refuse).toBe(true);
    // ...and opening A from the merged B sends A only B's layers: refused too.
    expect(deliver(a, other.open(a)).refuse).toBe(true);
  });

  it('refuses a merge even when the same message also carries a real edit to B', () => {
    const a = serverLayout(100, 'fordyce-2026.bbm');
    const b = serverLayout(300);
    const desktop = new OldDesktop();
    desktop.open(a);
    Y.applyUpdate(desktop.doc, Y.encodeStateAsUpdate(b));
    desktop.doc.getMap('meta').set('author', 'edited on B'); // placed on B's own item
    addLayer(desktop.doc, 'desk-new'); // next to B's (and A's) entries
    expect(deliver(b, step2(desktop.doc, b)).refuse).toBe(true);
  });

  it('a stale client that still holds a repaired merge sends nothing new: allowed', () => {
    const a = serverLayout(100, 'fordyce-2026.bbm');
    const b = serverLayout(300);
    const refB = synced(b, 1);
    const desktop = new OldDesktop();
    desktop.open(a);
    Y.applyUpdate(b, desktop.open(b));
    const [, plan] = planUnmerge([
      { id: 'a', title: 'A', current: snapshot(a), reference: snapshot(a) },
      { id: 'b', title: 'B', current: snapshot(b), reference: snapshot(refB) },
    ]);
    Y.applyUpdate(b, plan!.update);
    expect(deliver(b, step2(desktop.doc, b)).refuse).toBe(false);
  });
});

describe('checkIncomingUpdate: normal work passes', () => {
  it('a brand-new layout with no layer order takes a whole layout', () => {
    const empty = new Y.Doc();
    const full = serverLayout(100, 'fordyce-2026.bbm');
    expect(deliver(empty, snapshot(full)).refuse).toBe(false);
    expect(empty.getArray('layers').length).toBe(full.getArray('layers').length);
  });

  it('importing a big .bbm into a synced, empty layout (replace and add)', () => {
    const server = serverLayout(300);
    const web = synced(server, 11);
    // Replace: every layer deleted, the file's pushed after the tombstones.
    const map = fixture('fordyce-2026.bbm');
    for (const u of recording(web, () => bbmToDoc(map, web))) expect(deliver(server, u).refuse).toBe(false);
    expect(server.getArray('layers').length).toBe(map.layers.length);
    // Add: Import .bbm as module makes the host layers it lacks.
    const second = synced(server, 12);
    const updates = recording(second, () => {
      for (let i = 0; i < 5; i++) addLayer(second, `host-${i}`);
      const bricks = brickLayer(second);
      second.transact(() => bricks.push(Array.from({ length: 500 }, (_, n) => brick(n))));
    });
    for (const u of updates) expect(deliver(server, u).refuse).toBe(false);
  });

  it('adding a layer at the top, the bottom, and after deleting every layer', () => {
    const server = serverLayout(300, 'tight-corner.bbm');
    const web = synced(server, 21);
    const updates = recording(web, () => {
      addLayer(web, 'top');
      addLayer(web, 'bottom', 0);
      web.getArray('layers').delete(0, web.getArray('layers').length);
      addLayer(web, 'only', 0);
    });
    for (const u of updates) expect(deliver(server, u).refuse).toBe(false);
    expect(server.getArray('layers').toArray()).toEqual(['only']);
  });

  it('paste and Make module (first module: new sidecar and meta keys)', () => {
    const server = serverLayout(300, 'fordyce-2026.bbm');
    const web = synced(server, 31);
    const updates = recording(web, () => {
      const bricks = brickLayer(web);
      web.transact(() => bricks.push(Array.from({ length: 200 }, (_, n) => brick(n))));
      web.transact(() => writeSidecarCache(web, { schemaVersion: 1, bbmHashSha256: '', modules: [{ id: 'mod-new', name: 'Yard', brickIds: ['pasted-1'] }] }));
      web.getMap('sidecarItems').set('m:mod-new', { id: 'mod-new', name: 'Yard' });
    });
    for (const u of updates) expect(deliver(server, u).refuse).toBe(false);
  });

  it('undo of a big delete (layers and bricks)', () => {
    const server = serverLayout(300, 'fordyce-2026.bbm');
    const web = synced(server, 41);
    const order = web.getArray<string>('layers');
    const undo = new Y.UndoManager([order, web.getMap('layerData')], { trackedOrigins: new Set(['local']) });
    const updates = recording(web, () => {
      web.transact(() => {
        const ids = order.toArray();
        order.delete(0, order.length);
        for (const id of ids) web.getMap('layerData').delete(id);
      }, 'local');
      undo.undo();
    });
    for (const u of updates) expect(deliver(server, u).refuse).toBe(false);
    expect(server.getArray('layers').length).toBe(fixture('fordyce-2026.bbm').layers.length);
  });

  it('offline edits replayed on reconnect, with others editing meanwhile', () => {
    const server = serverLayout(300, 'fordyce-2026.bbm');
    const offline = synced(server, 51);
    const online = synced(server, 52);
    for (const u of recording(online, () => addLayer(online, 'meanwhile'))) deliver(server, u);
    // Offline: new layers, bricks, a module, a deleted layer.
    addLayer(offline, 'off-1');
    addLayer(offline, 'off-2', 0);
    offline.transact(() => brickLayer(offline).push([brick(1), brick(2)]));
    offline.getArray('layers').delete(1, 1);
    addLayer(offline, 'off-3', 1);
    // Reconnect: the server's step 1 is answered with everything it lacks.
    const check = deliver(server, step2(offline, server));
    expect(check.refuse).toBe(false);
    expect(server.getArray('layers').toArray()).toEqual(expect.arrayContaining(['off-1', 'off-2', 'off-3', 'meanwhile']));
  });

  it('a desktop opening a layout fresh, or from its cache of it', () => {
    const server = serverLayout(300, 'fordyce-2026.bbm');
    const fresh = new Y.Doc();
    expect(deliver(server, step2(fresh, server)).refuse).toBe(false);
    // Its cache from last time, then the layout moved on without it.
    const cache = synced(server, 61);
    addLayer(cache, 'made-on-desktop'); // an edit that never reached the server
    for (const u of recording(server, () => addLayer(server, 'made-on-web'))) void u;
    const reopened = new Y.Doc();
    reopened.clientID = 62;
    Y.applyUpdate(reopened, snapshot(cache));
    expect(deliver(server, step2(reopened, server)).refuse).toBe(false);
    expect(server.getArray('layers').toArray()).toContain('made-on-desktop');
  });

  it('an update made against an older state (part of it already here), with a layer placed after the new part', () => {
    // A whole-state update (the desktop sends one when the server's state
    // vector can't be read) or a second socket of the same doc that is
    // behind: the first struct of a client starts inside what the room
    // has and runs on past it, and another client's layer sits after
    // that new tail.
    const server = serverLayout(300, 'fordyce-2026.bbm');
    const c = synced(server, 81);
    const order = c.getArray<string>('layers');
    for (const u of recording(c, () => order.push(['c-1']))) deliver(server, u);
    order.push(['c-2']); // right after c-1: one struct with it in a whole-state update
    const d = synced(c, 82);
    d.getArray<string>('layers').push(['d-1']); // after c-2
    Y.applyUpdate(c, step2(d, c));
    const check = deliver(server, Y.encodeStateAsUpdate(c));
    expect(check.refuse).toBe(false);
    expect(server.getArray('layers').toArray().slice(-3)).toEqual(['c-1', 'c-2', 'd-1']);
  });

  it('a desktop writing a layout it opened into an empty server layout', () => {
    const server = serverLayout(300);
    const desktop = synced(server, 71);
    // The desktop writes its model into the synced doc: a diff on what it has.
    const map = fixture('tight-corner.bbm');
    for (const u of recording(desktop, () => bbmToDoc(map, desktop))) expect(deliver(server, u).refuse).toBe(false);
  });

  it('flags (does not refuse) an update with many unseen clients and no foreign layers', () => {
    // Two layouts started from the same catalog layout share its items;
    // A's later edits (by many sessions) sent to B look like normal edits.
    const base = serverLayout(100, 'fordyce-2026.bbm');
    const a = synced(base, 101);
    const b = synced(base, 102);
    for (let i = 0; i < SUSPICIOUS_UNSEEN_CLIENTS; i++) {
      const session = synced(a, 200 + i);
      session.transact(() => brickLayer(session).push([brick(i)]));
      Y.applyUpdate(a, step2(session, a));
    }
    const desktop = new OldDesktop();
    desktop.open(a);
    const check = deliver(b, desktop.open(b));
    expect(check.refuse).toBe(false);
    expect(check.suspicious).toBe(true);
    expect(check.unseenClients).toBe(SUSPICIOUS_UNSEEN_CLIENTS);
  });
});

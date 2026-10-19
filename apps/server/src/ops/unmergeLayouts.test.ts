// The unmerge repair, on layouts merged the way the old desktop merged them:
// one Yjs doc kept across layouts, so each layout opened got everything
// opened before it.

import { readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { readBbm } from '@cld/bbm';
import { bbmToDoc, createDefaultLayoutDoc, docToBbm, readSidecarCache, writeSidecarCache } from '@cld/ydoc';
import { db, schema, sqlite } from '../db/index.js';
import { resetDb } from '../test/helpers.js';
import { DocSession } from '../ws/docHub.js';
import { planUnmerge, type UnmergeInput } from './unmergeLayouts.js';
import { main } from './unmergeLayoutsCli.js';

const FIXTURES = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../packages/bbm/tests/fixtures');

/** A server's copy of a layout: its own doc, made by its own client. */
function serverDoc(clientID: number, fill: (doc: Y.Doc) => void): Y.Doc {
  const doc = new Y.Doc();
  doc.clientID = clientID;
  fill(doc);
  return doc;
}

function fromFixture(name: string) {
  return (doc: Y.Doc) => bbmToDoc(readBbm(readFileSync(join(FIXTURES, name), 'utf8')).map, doc);
}

function withModule(doc: Y.Doc): void {
  doc.transact(() =>
    writeSidecarCache(doc, { schemaVersion: 1, bbmHashSha256: '', modules: [{ id: 'mod-a', name: 'Station', brickIds: ['1'] }] }),
  );
}

function clone(doc: Y.Doc): Y.Doc {
  const c = new Y.Doc();
  Y.applyUpdate(c, Y.encodeStateAsUpdate(doc));
  return c;
}

/**
 * The old desktop: one doc for every layout it opens. Opening a layout reads
 * the server's state into it and sends back what the server lacks.
 */
class OldDesktop {
  readonly doc = new Y.Doc();
  constructor(clientID: number) {
    this.doc.clientID = clientID;
  }
  open(server: Y.Doc): void {
    Y.applyUpdate(this.doc, Y.encodeStateAsUpdate(server));
    Y.applyUpdate(server, Y.encodeStateAsUpdate(this.doc, Y.encodeStateVector(server)));
  }
}

function firstBrickLayer(doc: Y.Doc, layerId: string): Y.Array<Y.Map<unknown>> {
  return (doc.getMap('layerData').get(layerId) as Y.Map<unknown>).get('bricks') as Y.Array<Y.Map<unknown>>;
}

/** A real edit: move the first brick of a layer and delete the second. */
function realEdit(doc: Y.Doc, layerId: string): void {
  const bricks = firstBrickLayer(doc, layerId);
  doc.transact(() => {
    bricks.get(0).set('displayArea', { x: 7, y: 8, width: 32, height: 32 });
    bricks.delete(1, 1);
  });
}

function input(id: string, title: string, current: Y.Doc, reference: Y.Doc): UnmergeInput {
  return { id, title, current: Y.encodeStateAsUpdate(current), reference: Y.encodeStateAsUpdate(reference) };
}

function repaired(current: Y.Doc, update: Uint8Array): Y.Doc {
  const doc = clone(current);
  Y.applyUpdate(doc, update);
  return doc;
}

function layerIds(doc: Y.Doc): string[] {
  return doc.getArray<string>('layers').toArray();
}

describe('planUnmerge', () => {
  // A: a big layout with a module (client 100); B: a new empty layout
  // (client 300, its meta wins over A's); C: an imported layout (client 50,
  // its meta loses to both, so the merge overwrote it).
  let a: Y.Doc, b: Y.Doc, c: Y.Doc;
  let refA: Y.Doc, refB: Y.Doc, refC: Y.Doc;

  beforeEach(() => {
    a = serverDoc(100, (d) => {
      fromFixture('fordyce-2026.bbm')(d);
      withModule(d);
    });
    b = serverDoc(300, (d) => Y.applyUpdate(d, Y.encodeStateAsUpdate(createDefaultLayoutDoc())));
    c = serverDoc(50, fromFixture('tight-corner.bbm'));
    refA = clone(a);
    refB = clone(b);
    refC = clone(c);
  });

  it('takes back what a merge put into a layout, and nothing else', () => {
    const desktop = new OldDesktop(9001);
    desktop.open(a);
    desktop.open(b); // B now holds A too

    expect(layerIds(b).length).toBe(layerIds(refA).length + layerIds(refB).length);

    const plans = planUnmerge([input('a', 'A', a, refA), input('b', 'B', b, refB)]);
    const [planA, planB] = plans;
    // A was opened first: nothing went into it.
    expect(planA!.removals).toEqual([]);
    expect(planA!.update.length).toBe(0);

    const fixed = repaired(b, planB!.update);
    expect(docToBbm(fixed)).toEqual(docToBbm(refB));
    expect(readSidecarCache(fixed)).toBeNull();
    expect(planB!.removals.every((r) => r.from === 'A' || r.from === 'the removed sidecar')).toBe(true);
  });

  it('separates a chain, keeps real edits made after the merge, and restores overwritten meta', () => {
    const desktop = new OldDesktop(9001);
    desktop.open(a);
    desktop.open(b);
    desktop.open(c); // C holds A and B; B's meta (client 300) beat C's (client 50)
    expect(c.getMap('meta').get('author')).toBe(refB.getMap('meta').get('author'));

    // After the merge someone edits C for real: one of C's own layers.
    const cLayer = docToBbm(refC).layers.find((l) => l.type === 'brick' && l.bricks.length > 3)!.id;
    const editor = new Y.Doc();
    editor.clientID = 7777;
    Y.applyUpdate(editor, Y.encodeStateAsUpdate(c));
    realEdit(editor, cLayer);
    // ...and touches a layer of A's that shows in C (goes with the layer).
    const aLayer = docToBbm(refA).layers.find((l) => l.type === 'brick' && l.bricks.length > 3)!.id;
    firstBrickLayer(editor, aLayer).get(0).set('orientation', 90);
    Y.applyUpdate(c, Y.encodeStateAsUpdate(editor, Y.encodeStateVector(c)));

    const plans = planUnmerge([input('a', 'A', a, refA), input('b', 'B', b, refB), input('c', 'C', c, refC)]);
    const byId = new Map(plans.map((p) => [p.id, p]));

    // B: back to itself.
    expect(docToBbm(repaired(b, byId.get('b')!.update))).toEqual(docToBbm(refB));

    // C: itself plus the real edit; its own meta back.
    const expected = clone(refC);
    realEdit(expected, cLayer);
    const fixedC = repaired(c, byId.get('c')!.update);
    expect(docToBbm(fixedC)).toEqual(docToBbm(expected));
    expect(fixedC.getMap('meta').get('author')).toBe(refC.getMap('meta').get('author'));
    expect(byId.get('c')!.restores.map((r) => r.path)).toContain('meta.author');
    expect(readSidecarCache(fixedC)).toBeNull();

    // A is untouched, its module still there.
    expect(byId.get('a')!.update.length).toBe(0);
    expect(readSidecarCache(a)).toMatchObject({ modules: [{ id: 'mod-a' }] });
  });

  it('a stale client that still holds the merged doc cannot bring the foreign items back', () => {
    const desktop = new OldDesktop(9001);
    desktop.open(a);
    desktop.open(b);
    desktop.open(c);
    const [, , planC] = planUnmerge([input('a', 'A', a, refA), input('b', 'B', b, refB), input('c', 'C', c, refC)]);
    Y.applyUpdate(c, planC!.update);
    const want = docToBbm(c);

    // The stale desktop reconnects: full state, then the server's diff.
    Y.applyUpdate(c, Y.encodeStateAsUpdate(desktop.doc));
    Y.applyUpdate(c, Y.encodeStateAsUpdate(desktop.doc, Y.encodeStateVector(c)));
    expect(docToBbm(c)).toEqual(want);
    expect(layerIds(c)).toEqual(layerIds(refC));
  });

  it('runs the same twice: the fingerprint is stable and a repaired layout needs nothing more', () => {
    const desktop = new OldDesktop(9001);
    desktop.open(a);
    desktop.open(b);
    const inputs = [input('a', 'A', a, refA), input('b', 'B', b, refB)];
    const first = planUnmerge(inputs);
    expect(planUnmerge(inputs)[1]!.fingerprint).toBe(first[1]!.fingerprint);

    Y.applyUpdate(b, first[1]!.update);
    const again = planUnmerge([input('a', 'A', a, refA), input('b', 'B', b, refB)]);
    expect(again[1]!.removals).toEqual([]);
    expect(again[1]!.restores).toEqual([]);
  });
});

describe('unmerge-layouts CLI', () => {
  const refPath = join(tmpdir(), `cld-unmerge-ref-${process.pid}.sqlite`);
  const user = 'user-unmerge';
  let out: string[];

  beforeEach(async () => {
    resetDb();
    out = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((s: string | Uint8Array) => {
      out.push(String(s));
      return true;
    });
    vi.spyOn(process.stderr, 'write').mockImplementation((s: string | Uint8Array) => {
      out.push(String(s));
      return true;
    });
    await db.insert(schema.users).values({ id: user, email: 'u@test.com', displayName: 'U', passwordHash: null, createdAt: new Date(), isDemoAccount: false, isGlobalAdmin: false });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(refPath, { force: true });
  });

  async function addLayout(id: string, doc: Y.Doc): Promise<void> {
    const now = new Date();
    await db.insert(schema.layouts).values({ id, title: id, ownerUserId: user, ownerOrgId: null, createdBy: user, createdAt: now, updatedAt: now, expiresAt: null, docSnapshot: Buffer.from(Y.encodeStateAsUpdate(doc)), docVersion: 3 });
  }

  it('dry-runs without writing, refuses a plan nobody reviewed, applies the reviewed one', async () => {
    const a = serverDoc(100, fromFixture('fordyce-2026.bbm'));
    const b = serverDoc(300, fromFixture('tight-corner.bbm'));
    const refB = clone(b);
    await addLayout('A', a);
    await addLayout('B', b);
    sqlite.exec(`VACUUM INTO '${refPath}'`); // the backup from before the merge

    // The merge reaches B as realtime updates, not yet compacted.
    const desktop = new OldDesktop(9001);
    desktop.open(a);
    const before = Y.encodeStateVector(b);
    desktop.open(b);
    await db.insert(schema.layoutUpdates).values({ layoutId: 'B', doc: 'main', updateBytes: Buffer.from(Y.encodeStateAsUpdate(b, before)), createdAt: new Date() });

    const dbPath = process.env.DB_PATH!;
    const args = ['--db', dbPath, '--reference', refPath, '--layouts', 'A,B'];
    expect(main(args)).toBe(0);
    const fingerprint = /plan fingerprint: (\w+)/.exec(out.join(''))![1]!;
    const row = () => sqlite.prepare("select doc_version, (select count(*) from layout_updates where layout_id = 'B') n from layouts where id = 'B'").get() as { doc_version: number; n: number };
    expect(row()).toEqual({ doc_version: 3, n: 1 });

    expect(main([...args, '--apply', '--expect', 'not-the-plan'])).toBe(3);
    expect(row()).toEqual({ doc_version: 3, n: 1 });

    expect(main([...args, '--apply', '--expect', fingerprint])).toBe(0);
    expect(row()).toEqual({ doc_version: 4, n: 0 });

    // What the server loads next is B alone.
    const session = new DocSession('B');
    await session.hydrate();
    expect(docToBbm(session.doc)).toEqual(docToBbm(refB));
    const audit = sqlite.prepare("select event_type from audit_events where layout_id = 'B'").all();
    expect(audit).toEqual([{ event_type: 'layout_unmerge' }]);

    // Nothing left to do.
    out = [];
    expect(main(args)).toBe(0);
    expect(out.join('')).toContain('remove (0)');
  });
});

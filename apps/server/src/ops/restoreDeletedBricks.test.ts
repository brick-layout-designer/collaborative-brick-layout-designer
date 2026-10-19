// Restoring bricks a layout lost while it was merged: A merged into B by
// the old desktop, then some of A's own bricks deleted in A's room as if
// they were B's, the way 2x2 City lost its tracks and roads.

import { readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { readBbm } from '@cld/bbm';
import { bbmToDoc, docToBbm, readSidecarCache, writeSidecarCache } from '@cld/ydoc';
import { db, schema, sqlite } from '../db/index.js';
import { resetDb } from '../test/helpers.js';
import { DocSession } from '../ws/docHub.js';
import { planRestore, type RestoreInput } from './restoreDeletedBricks.js';
import { main } from './restoreDeletedBricksCli.js';

const FIXTURES = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../packages/bbm/tests/fixtures');

type Conn = { id: string; linkedTo: string };

function serverDoc(clientID: number, fixture: string): Y.Doc {
  const doc = new Y.Doc();
  doc.clientID = clientID;
  bbmToDoc(readBbm(readFileSync(join(FIXTURES, fixture), 'utf8')).map, doc);
  return doc;
}

function clone(doc: Y.Doc, clientID?: number): Y.Doc {
  const c = new Y.Doc();
  if (clientID) c.clientID = clientID;
  Y.applyUpdate(c, Y.encodeStateAsUpdate(doc));
  return c;
}

/** Send what `from` has and `to` lacks. */
function sync(from: Y.Doc, to: Y.Doc): void {
  Y.applyUpdate(to, Y.encodeStateAsUpdate(from, Y.encodeStateVector(to)));
}

/** The old desktop: one doc for every layout it opens. */
function oldDesktopOpens(...servers: Y.Doc[]): Y.Doc {
  const desktop = new Y.Doc();
  desktop.clientID = 9001;
  for (const s of servers) {
    Y.applyUpdate(desktop, Y.encodeStateAsUpdate(s));
    sync(desktop, s);
  }
  return desktop;
}

/** The brick layer of a doc with the most linked bricks. */
function trackLayer(doc: Y.Doc): { id: string; bricks: Y.Array<Y.Map<unknown>> } {
  let best: { id: string; bricks: Y.Array<Y.Map<unknown>>; n: number } | null = null;
  for (const [id, l] of doc.getMap<Y.Map<unknown>>('layerData')) {
    const bricks = l.get('bricks');
    if (!(bricks instanceof Y.Array)) continue;
    const n = (bricks.toArray() as Y.Map<unknown>[]).filter((b) => ((b.get('connexions') as Conn[]) ?? []).some((c) => c.linkedTo)).length;
    if (!best || n > best.n) best = { id, bricks: bricks as Y.Array<Y.Map<unknown>>, n };
  }
  return best!;
}

/** Delete bricks the way the editor does: clear the links that pointed at them. */
function deleteBricks(doc: Y.Doc, layerId: string, ids: string[]): void {
  const bricks = (doc.getMap<Y.Map<unknown>>('layerData').get(layerId)!.get('bricks')) as Y.Array<Y.Map<unknown>>;
  doc.transact(() => {
    const gone = new Set<string>();
    for (const b of bricks.toArray()) if (ids.includes(String(b.get('id')))) for (const c of (b.get('connexions') as Conn[]) ?? []) gone.add(c.id);
    for (const b of bricks.toArray()) {
      const conns = (b.get('connexions') as Conn[]) ?? [];
      if (!ids.includes(String(b.get('id'))) && conns.some((c) => gone.has(c.linkedTo))) b.set('connexions', conns.map((c) => (gone.has(c.linkedTo) ? { ...c, linkedTo: '' } : c)));
    }
    for (let i = bricks.length - 1; i >= 0; i--) if (ids.includes(String(bricks.get(i).get('id')))) bricks.delete(i, 1);
  });
}

function linkedIds(doc: Y.Doc, layerId: string, from: number, count: number): string[] {
  const bricks = trackLayer(doc).id === layerId ? trackLayer(doc).bricks : null;
  return bricks!
    .toArray()
    .filter((b) => ((b.get('connexions') as Conn[]) ?? []).some((c) => c.linkedTo))
    .slice(from, from + count)
    .map((b) => String(b.get('id')));
}

function input(current: Y.Doc, reference: Y.Doc, witness: Y.Doc | null): RestoreInput {
  return { id: 'a', title: 'A', current: Y.encodeStateAsUpdate(current), reference: Y.encodeStateAsUpdate(reference), witness: witness ? Y.encodeStateAsUpdate(witness) : null };
}

function restored(current: Y.Doc, update: Uint8Array): Y.Doc {
  const d = clone(current);
  Y.applyUpdate(d, update);
  return d;
}

function bbm(doc: Y.Doc): ReturnType<typeof docToBbm> {
  return docToBbm(doc);
}

describe('planRestore', () => {
  let a: Y.Doc, b: Y.Doc, refA: Y.Doc, layer: string;
  let beforeMerge: string[], duringMerge: string[];
  let witness: Y.Doc;

  beforeEach(() => {
    a = serverDoc(100, 'fordyce-2026.bbm');
    b = serverDoc(300, 'tight-corner.bbm');
    refA = clone(a); // the backup
    layer = trackLayer(a).id;
    beforeMerge = linkedIds(a, layer, 0, 1);
    duringMerge = linkedIds(a, layer, 20, 6);

    // A real deletion after the backup, before the merge: stays deleted.
    const editor = clone(a, 4000);
    deleteBricks(editor, layer, beforeMerge);
    sync(editor, a);
    // The merge: B takes in A.
    oldDesktopOpens(a, b);
    witness = clone(b);
    // In A's room someone deletes A's own bricks, taking them for B's.
    const merged = clone(a, 5000);
    deleteBricks(merged, layer, duringMerge);
    sync(merged, a);
  });

  it('brings back exactly the bricks deleted while merged, with their data, order and links', () => {
    const plan = planRestore(input(a, refA, witness));
    expect(plan.restored.map((r) => r.id).sort()).toEqual([...duringMerge].sort());
    expect(plan.skipped.map((s) => s.id)).toEqual(beforeMerge);
    expect(plan.relinked).toBeGreaterThan(0);

    // The layout is the backup with only the pre-merge deletion: same
    // bricks, same data, same draw order, same links.
    const expected = clone(refA, 4000);
    deleteBricks(expected, layer, beforeMerge);
    expect(bbm(restored(a, plan.update))).toEqual(bbm(expected));
  });

  it('without a witness every deletion since the backup comes back', () => {
    const plan = planRestore(input(a, refA, null));
    expect(plan.restored.map((r) => r.id).sort()).toEqual([...beforeMerge, ...duringMerge].sort());
    expect(bbm(restored(a, plan.update))).toEqual(bbm(refA));
  });

  it('changes nothing else: edits made after the merge are kept', () => {
    const editor = clone(a, 6000);
    const other = trackLayer(editor).bricks.get(0);
    editor.transact(() => other.set('altitude', 7));
    editor.getMap('meta').set('author', 'Someone');
    sync(editor, a);

    const plan = planRestore(input(a, refA, witness));
    const after = restored(a, plan.update);
    const expected = clone(refA, 4000);
    deleteBricks(expected, layer, beforeMerge);
    expected.transact(() => trackLayer(expected).bricks.get(0).set('altitude', 7));
    expected.getMap('meta').set('author', 'Someone');
    expect(bbm(after)).toEqual(bbm(expected));
  });

  it('runs once: the same plan twice, and nothing to do after it', () => {
    const first = planRestore(input(a, refA, witness));
    expect(planRestore(input(a, refA, witness)).fingerprint).toBe(first.fingerprint);
    const after = restored(a, first.update);
    const again = planRestore(input(after, refA, witness));
    expect(again.restored).toEqual([]);
    expect(again.update.length).toBe(0);
  });

  it('a stale client syncing afterwards keeps the restored bricks', () => {
    const stale = clone(a, 7000); // has the deletions, not the restore
    const plan = planRestore(input(a, refA, witness));
    Y.applyUpdate(a, plan.update);
    const want = bbm(a);

    // It reconnects (full state both ways), then edits something else.
    Y.applyUpdate(a, Y.encodeStateAsUpdate(stale));
    sync(a, stale);
    stale.getMap('meta').set('comment', 'hi');
    sync(stale, a);
    expect(bbm(a)).toEqual({ ...want, comment: 'hi' });
    expect(bbm(stale)).toEqual(bbm(a));
  });

  it('a module that listed a restored brick lists it again', () => {
    const r = clone(refA);
    r.transact(() => writeSidecarCache(r, { schemaVersion: 1, bbmHashSha256: '', modules: [{ id: 'm1', name: 'Yard', brickIds: duringMerge }] }));
    const live = clone(r);
    deleteBricks(live, layer, duringMerge);
    live.transact(() => writeSidecarCache(live, { ...readSidecarCache(live)!, modules: [{ id: 'm1', name: 'Yard', brickIds: [] }] }));
    const plan = planRestore(input(live, r, null));
    expect(plan.modules).toEqual(['m1']);
    expect(readSidecarCache(restored(live, plan.update))).toMatchObject({ modules: [{ id: 'm1', brickIds: duringMerge }] });
  });
});

describe('restore-deleted-bricks CLI', () => {
  const refPath = join(tmpdir(), `cld-restore-ref-${process.pid}.sqlite`);
  const witPath = join(tmpdir(), `cld-restore-wit-${process.pid}.sqlite`);
  const user = 'user-restore';
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
    await db.insert(schema.users).values({ id: user, email: 'r@test.com', displayName: 'R', passwordHash: null, createdAt: new Date(), isDemoAccount: false, isGlobalAdmin: false });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(refPath, { force: true });
    rmSync(witPath, { force: true });
  });

  async function addLayout(id: string, doc: Y.Doc): Promise<void> {
    const now = new Date();
    await db.insert(schema.layouts).values({ id, title: id, ownerUserId: user, ownerOrgId: null, createdBy: user, createdAt: now, updatedAt: now, expiresAt: null, docSnapshot: Buffer.from(Y.encodeStateAsUpdate(doc)), docVersion: 3 });
  }
  const setSnapshot = (id: string, doc: Y.Doc) => sqlite.prepare('update layouts set doc_snapshot = ? where id = ?').run(Buffer.from(Y.encodeStateAsUpdate(doc)), id);

  it('dry-runs without writing, refuses a plan nobody reviewed, applies the reviewed one', async () => {
    const a = serverDoc(100, 'fordyce-2026.bbm');
    const b = serverDoc(300, 'tight-corner.bbm');
    const refA = clone(a);
    await addLayout('A', a);
    await addLayout('B', b);
    sqlite.exec(`VACUUM INTO '${refPath}'`); // the backup

    oldDesktopOpens(a, b);
    setSnapshot('B', b);
    sqlite.exec(`VACUUM INTO '${witPath}'`); // before the repair: B holds A
    setSnapshot('B', serverDoc(300, 'tight-corner.bbm'));

    // The deletion reaches A as a realtime update, not yet compacted.
    const layer = trackLayer(a).id;
    const ids = linkedIds(a, layer, 3, 4);
    const sv = Y.encodeStateVector(a);
    const editor = clone(a, 5000);
    deleteBricks(editor, layer, ids);
    sync(editor, a);
    await db.insert(schema.layoutUpdates).values({ layoutId: 'A', doc: 'main', updateBytes: Buffer.from(Y.encodeStateAsUpdate(a, sv)), createdAt: new Date() });

    const args = ['--db', process.env.DB_PATH!, '--reference', refPath, '--layouts', 'A', '--witness-db', witPath, '--witness', 'A=B'];
    expect(main(args)).toBe(0);
    const text = out.join('');
    expect(text).toContain('restore (4)');
    const fingerprint = /plan fingerprint: (\w+)/.exec(text)![1]!;
    const row = () => sqlite.prepare("select doc_version, (select count(*) from layout_updates where layout_id = 'A') n from layouts where id = 'A'").get() as { doc_version: number; n: number };
    expect(row()).toEqual({ doc_version: 3, n: 1 });

    expect(main([...args, '--apply', '--expect', 'not-the-plan'])).toBe(3);
    expect(row()).toEqual({ doc_version: 3, n: 1 });

    expect(main([...args, '--apply', '--expect', fingerprint])).toBe(0);
    expect(row()).toEqual({ doc_version: 4, n: 0 });

    const session = new DocSession('A');
    await session.hydrate();
    expect(docToBbm(session.doc)).toEqual(docToBbm(refA));
    expect(sqlite.prepare("select event_type from audit_events where layout_id = 'A'").all()).toEqual([{ event_type: 'layout_restore_bricks' }]);

    out = [];
    expect(main(args)).toBe(0);
    expect(out.join('')).toContain('restore (0)');
  });
});

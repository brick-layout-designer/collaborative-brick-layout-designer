// The grid guard (gridGuard.ts) checks an update to a sheet's rulers from
// the rulers it writes, not every ruler on the sheet: a sheet with many
// rulers costs each update no more than one with a few, with the same
// answers as the check on a copy. A ruler already out of range before
// (a layout saved that way) can still be edited.

import * as Y from 'yjs';
import { describe, expect, it } from 'vitest';
import { checkGridSizes, checkGridSizesOnCopy } from './gridGuard.js';
import { guardWork } from './decoded.js';

/** A room with one ruler sheet of `n` rulers (maps), the first `bad` of them with a unit out of range. */
function room(n: number, bad = 0): Y.Doc {
  const doc = new Y.Doc();
  const sheet = new Y.Map<unknown>();
  const list = new Y.Array<unknown>();
  doc.transact(() => {
    doc.getMap('layerData').set('R', sheet);
    sheet.set('type', 'ruler');
    sheet.set('rulerItems', list);
  });
  for (let i = 0; i < n; i += 1000) {
    doc.transact(() => {
      for (let j = i; j < Math.min(n, i + 1000); j++) {
        const m = new Y.Map<unknown>();
        list.push([m]);
        m.set('id', `r${j}`);
        m.set('unit', j < bad ? 99 : 1);
        m.set('lineThickness', 2);
      }
    });
  }
  return doc;
}

/** An editor of `doc`, and what it does from here on. */
function editor(doc: Y.Doc): { ed: Y.Doc; list: () => Y.Array<unknown>; since: () => Uint8Array } {
  const ed = new Y.Doc();
  Y.applyUpdate(ed, Y.encodeStateAsUpdate(doc));
  const sv = Y.encodeStateVector(ed);
  return {
    ed,
    list: () => (ed.getMap('layerData').get('R') as Y.Map<unknown>).get('rulerItems') as Y.Array<unknown>,
    since: () => Y.encodeStateAsUpdate(ed, sv),
  };
}

/** The live check and the copy's, which must agree. */
function both(doc: Y.Doc, update: Uint8Array): string | null {
  const live = checkGridSizes(doc, update);
  expect(live).toBe(checkGridSizesOnCopy(doc, update));
  return live;
}

describe('an update to a sheet with many rulers', () => {
  it('is checked from the rulers it writes, quickly', () => {
    const doc = room(20_000);
    checkGridSizes(doc, editor(doc).since()); // (the sheet read once)
    const copies = guardWork.docCopies;
    const e = editor(doc);
    let checking = 0;
    for (let i = 0; i < 50; i++) {
      const sv = Y.encodeStateVector(e.ed);
      if (i % 2) e.list().push([{ id: `new${i}`, unit: 2 }]);
      else (e.list().get(i * 100) as Y.Map<unknown>).set('lineThickness', 3);
      const update = Y.encodeStateAsUpdate(e.ed, sv);
      const started = performance.now();
      expect(checkGridSizes(doc, update)).toBeNull();
      checking += performance.now() - started;
      Y.applyUpdate(doc, update);
    }
    expect(checking / 50).toBeLessThan(20);
    expect(guardWork.docCopies).toBe(copies);
  }, 60_000);

  it('gets the same answers as the check on a copy', () => {
    const doc = room(300);
    const cases: [string, (e: ReturnType<typeof editor>) => void, boolean][] = [
      ['a new ruler in range', (e) => e.list().push([{ id: 'a', unit: 3 }]), true],
      ['a new ruler out of range', (e) => e.list().push([{ id: 'b', unit: 77 }]), false],
      ['a new ruler map out of range', (e) => {
        const m = new Y.Map<unknown>();
        e.list().insert(5, [m]);
        m.set('id', 'c');
        m.set('measureFont', { size: 1e9 });
      }, false],
      ['a ruler’s unit set out of range', (e) => (e.list().get(7) as Y.Map<unknown>).set('unit', 40), false],
      ['a ruler’s unit set in range', (e) => (e.list().get(7) as Y.Map<unknown>).set('unit', 4), true],
      ['a ruler’s line thickness taken away', (e) => (e.list().get(9) as Y.Map<unknown>).delete('lineThickness'), true],
      ['a ruler deleted', (e) => e.list().delete(11, 1), true],
    ];
    for (const [what, edit, taken] of cases) {
      const e = editor(doc);
      edit(e);
      const update = e.since();
      expect(both(doc, update) === null, what).toBe(taken);
      if (taken) Y.applyUpdate(doc, update);
    }
  });

  it('can still edit a ruler that was out of range before', () => {
    const doc = room(300, 2); // r0 and r1 hold a unit of 99
    // Its other fields, and the ruler written again whole (as the web edits a plain ruler), are taken.
    const e = editor(doc);
    (e.list().get(0) as Y.Map<unknown>).set('lineThickness', 5);
    expect(both(doc, e.since())).toBeNull();
    // A new value out of range on it is not.
    const f = editor(doc);
    (f.list().get(1) as Y.Map<unknown>).set('lineThickness', 1e6);
    expect(both(doc, f.since())).toMatch(/r1\.lineThickness/);
  });
});

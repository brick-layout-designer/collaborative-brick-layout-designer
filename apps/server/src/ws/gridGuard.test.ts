// Grid sizes the apps draw (ws/gridGuard.ts): the shared vectors
// (fixtures/contracts/update-guard.json, gridSize), every layout fixture as
// the server seeds it, a layout already holding such a size, changes that
// wait for others before they apply, and which updates are worked out on a
// copy of the room's document (only those that could break a grid).

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as Y from 'yjs';
import { describe, expect, it } from 'vitest';
import { readBbm } from '@cld/bbm';
import { createDefaultLayoutDoc, seedFromBbm } from '@cld/ydoc';
import { checkGridSizes, invalidGridLayers, validGridSize } from './gridGuard.js';
import { decodeIncoming, guardWork } from './decoded.js';
import { checkUpdate } from './updateGuard.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../../..');
const FIXTURES = join(ROOT, 'packages/bbm/tests/fixtures');

interface GridVector {
  what: string;
  kind: 'update' | 'document';
  hex: string;
  refused: boolean;
}
const contract = JSON.parse(readFileSync(join(ROOT, 'fixtures/contracts/update-guard.json'), 'utf8')) as {
  gridSize: { base: string; vectors: GridVector[] };
};
const bytes = (hex: string) => new Uint8Array(Buffer.from(hex, 'hex'));

function room(): Y.Doc {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, bytes(contract.gridSize.base));
  return doc;
}

const gridOf = (doc: Y.Doc) =>
  [...doc.getMap<Y.Map<unknown>>('layerData').values()].find((l) => l instanceof Y.Map && l.get('type') === 'grid')!;

describe('grid guard', () => {
  it.each(contract.gridSize.vectors.map((v) => [v.what, v] as const))('%s', (_what, v) => {
    const update = bytes(v.hex);
    // Both apps read it: only the grid size decides.
    expect(checkUpdate(update)).toBeNull();
    const why = checkGridSizes(v.kind === 'update' ? room() : null, update);
    if (v.refused) expect(why).toMatch(/cell size/);
    else expect(why).toBeNull();
  });

  it('has vectors for each kind of size', () => {
    expect(contract.gridSize.vectors.filter((v) => v.refused).length).toBeGreaterThanOrEqual(10);
    expect(contract.gridSize.vectors.filter((v) => !v.refused).length).toBeGreaterThanOrEqual(5);
  });

  it('says which sizes both apps draw', () => {
    for (const ok of [1, 2, 32, 96, 1.5, 2147483647]) expect(validGridSize(ok), String(ok)).toBe(true);
    for (const bad of [0, -1, 0.99, 2147483648, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, '32', null, undefined, 32n])
      expect(validGridSize(bad), String(bad)).toBe(false);
  });

  it('passes every layout fixture as the server seeds it, and the default layout', () => {
    const names = readdirSync(FIXTURES).filter((n) => n.endsWith('.bbm'));
    expect(names.length).toBeGreaterThan(1);
    for (const name of names) {
      const doc = seedFromBbm(readBbm(readFileSync(join(FIXTURES, name), 'utf8')).map);
      expect(invalidGridLayers(doc), name).toEqual(new Set());
      expect(checkGridSizes(null, Y.encodeStateAsUpdate(doc)), name).toBeNull();
    }
    expect(checkGridSizes(null, Y.encodeStateAsUpdate(createDefaultLayoutDoc()))).toBeNull();
  });

  it('lets a layout that already holds such a size be edited and fixed', () => {
    const doc = room();
    gridOf(doc).set('gridSizeInStud', 0); // saved before the guard
    const edit = (fn: (d: Y.Doc) => void) => {
      const mine = new Y.Doc();
      Y.applyUpdate(mine, Y.encodeStateAsUpdate(doc));
      const sv = Y.encodeStateVector(mine);
      fn(mine);
      return Y.encodeStateAsUpdate(mine, sv);
    };
    expect(checkGridSizes(doc, edit((d) => d.getMap('meta').set('title', 'Still here')))).toBeNull();
    expect(checkGridSizes(doc, edit((d) => gridOf(d).set('subDivisionNumber', 2)))).toBeNull();
    expect(checkGridSizes(doc, edit((d) => gridOf(d).set('gridSizeInStud', 32)))).toBeNull();
  });

  it('checks a size whose change waits for another to arrive first', () => {
    const doc = room();
    const ahead = (fn: (d: Y.Doc) => void): [Uint8Array, Uint8Array] => {
      const mine = new Y.Doc();
      mine.clientID = 7;
      Y.applyUpdate(mine, Y.encodeStateAsUpdate(doc));
      const sv0 = Y.encodeStateVector(mine);
      mine.getMap('meta').set('note', 'first');
      const earlier = Y.encodeStateAsUpdate(mine, sv0);
      const sv1 = Y.encodeStateVector(mine);
      fn(mine);
      return [earlier, Y.encodeStateAsUpdate(mine, sv1)];
    };
    // A new size that waits still takes the old one away at once: refused.
    const [, replaced] = ahead((d) => gridOf(d).set('gridSizeInStud', 0));
    expect(checkGridSizes(doc, replaced)).toMatch(/cell size/);
    // A new grid layer that waits changes nothing yet; the change it waits
    // for is checked with it.
    const [earlier, later] = ahead((d) => {
      const g = new Y.Map<unknown>();
      d.getMap<Y.Map<unknown>>('layerData').set('G2', g);
      g.set('type', 'grid');
      g.set('gridSizeInStud', 0);
    });
    expect(checkGridSizes(doc, later)).toBeNull();
    Y.applyUpdate(doc, later);
    expect(doc.store.pendingStructs).not.toBeNull();
    expect(checkGridSizes(doc, earlier)).toMatch(/cell size/);
  });

  it('works out on a copy only the updates that could leave a grid without a valid size', () => {
    const doc = room();
    const edit = (fn: (d: Y.Doc) => void) => {
      const mine = new Y.Doc();
      Y.applyUpdate(mine, Y.encodeStateAsUpdate(doc));
      const sv = Y.encodeStateVector(mine);
      fn(mine);
      return Y.encodeStateAsUpdate(mine, sv);
    };
    const copies = (update: Uint8Array): [string | null, number] => {
      const before = guardWork.docCopies;
      const why = checkGridSizes(doc, update);
      return [why, guardWork.docCopies - before];
    };
    const parts = (d: Y.Doc, n: number) => {
      const layer = new Y.Map<unknown>();
      layer.set('type', 'brick');
      const list = new Y.Array<Y.Map<unknown>>();
      layer.set('bricks', list);
      d.getMap('layerData').set('P', layer);
      d.getArray<string>('layers').push(['P']);
      list.push(
        Array.from({ length: n }, (_, i) => {
          const y = new Y.Map<unknown>();
          y.set('id', `p${i}`);
          y.set('orientation', 0);
          return y;
        }),
      );
    };
    // No copy: parts, a layer of another kind, a title, a type taken away, a grid layer deleted.
    expect(copies(edit((d) => parts(d, 2000)))).toEqual([null, 0]);
    expect(copies(edit((d) => d.getMap('meta').set('title', 'Yard')))).toEqual([null, 0]);
    expect(copies(edit((d) => gridOf(d).delete('type')))).toEqual([null, 0]);
    expect(copies(edit((d) => gridOf(d).set('type', 'brick')))).toEqual([null, 0]);
    expect(copies(edit((d) => d.getMap('layerData').forEach((l, id) => l === gridOf(d) && d.getMap('layerData').delete(id))))).toEqual([null, 0]);
    // A copy: a new size (valid: taken), a layer turned into a grid, a grid size deleted.
    expect(copies(edit((d) => gridOf(d).set('gridSizeInStud', 48)))).toEqual([null, 1]);
    expect(copies(edit((d) => gridOf(d).set('gridSizeInStud', 0)))[1]).toBe(1);
    expect(copies(edit((d) => gridOf(d).delete('gridSizeInStud')))).toEqual([expect.stringMatching(/cell size/), 1]);
    expect(
      copies(
        edit((d) =>
          d.transact(() => {
            gridOf(d).set('gridSizeInStud', 48);
            gridOf(d).delete('gridSizeInStud');
          }),
        ),
      ),
    ).toEqual([expect.stringMatching(/cell size/), 1]);
    expect(copies(edit((d) => {
      const g = new Y.Map<unknown>();
      d.getMap('layerData').set('G2', g);
      g.set('type', 'grid');
    }))).toEqual([expect.stringMatching(/cell size/), 1]);
  });

  it('works out the hand-made update with two structs for one id on a copy', () => {
    const doc = room();
    // Two blocks for client 77 from clock 0: the first a note, the second a
    // grid size of 0. (Yjs reads the second; a lookup by id might find the first.)
    const block = (fn: (d: Y.Doc) => void): Uint8Array => {
      const mine = new Y.Doc();
      Y.applyUpdate(mine, Y.encodeStateAsUpdate(doc));
      mine.clientID = 77;
      const sv = Y.encodeStateVector(mine);
      fn(mine);
      const u = Y.encodeStateAsUpdate(mine, sv);
      expect(u[0]).toBe(1); // one client
      return u.subarray(1);
    };
    // The first's delete set is empty (a new key): drop it; the second's follows its block.
    const a = block((d) => d.getMap('meta').set('note', 'x'));
    expect(a.at(-1)).toBe(0);
    const b = block((d) => gridOf(d).set('gridSizeInStud', 0));
    const both = new Uint8Array([2, ...a.subarray(0, a.length - 1), ...b]);
    expect(checkUpdate(both)).toBeNull();
    expect(decodeIncoming(both)?.overlapping).toBe(true);
    const before = guardWork.docCopies;
    expect(checkGridSizes(doc, both)).toMatch(/cell size/);
    expect(guardWork.docCopies - before).toBe(1);
  });

  it('sees a written size its own update deletes, whatever order the deleted ranges come in', () => {
    const doc = room();
    const mine = new Y.Doc();
    Y.applyUpdate(mine, Y.encodeStateAsUpdate(doc));
    mine.clientID = 77;
    const sv = Y.encodeStateVector(mine);
    gridOf(mine).set('gridSizeInStud', 48); // client 77, clock 0: replaces the room's size
    const update = Y.encodeStateAsUpdate(mine, sv);
    // The update ends with mine's whole delete set: the same bytes as an update with no structs.
    const ds = Y.encodeStateAsUpdate(mine, Y.encodeStateVector(mine)).subarray(1);
    expect(update.subarray(update.length - ds.length)).toEqual(ds);
    // Hand-made: client 77's deleted ranges out of order, clock 5 then clock 0 (the new size).
    const crafted = new Uint8Array([...update.subarray(0, update.length - ds.length), 1, 77, 2, 5, 1, 0, 1]);
    expect(checkUpdate(crafted)).toBeNull();
    const after = new Y.Doc();
    Y.applyUpdate(after, Y.encodeStateAsUpdate(doc));
    Y.applyUpdate(after, crafted);
    expect(gridOf(after).has('gridSizeInStud')).toBe(false);
    expect(checkGridSizes(doc, crafted)).toMatch(/cell size/);
  });
});

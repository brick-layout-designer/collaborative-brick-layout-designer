// Grid sizes the apps draw (ws/gridGuard.ts): the shared vectors
// (fixtures/contracts/update-guard.json, gridSize), every layout fixture as
// the server seeds it, a layout already holding such a size, and changes
// that wait for others before they apply.

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as Y from 'yjs';
import { describe, expect, it } from 'vitest';
import { readBbm } from '@cld/bbm';
import { createDefaultLayoutDoc, seedFromBbm } from '@cld/ydoc';
import { checkGridSizes, invalidGridLayers, validGridSize } from './gridGuard.js';
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
});

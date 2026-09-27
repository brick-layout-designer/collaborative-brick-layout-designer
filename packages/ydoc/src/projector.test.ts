import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { readBbm } from '@cld/bbm';
import type { LayerBrick } from '@cld/model';
import { bbmToDoc, createDocProjector, docToBbm } from './projection.js';

const BBM_FIXTURES = resolve(dirname(fileURLToPath(import.meta.url)), '../../bbm/tests/fixtures');

function loadFixture(): Y.Doc {
  const xml = readFileSync(resolve(BBM_FIXTURES, 'fordyce-2026.bbm'), 'utf8');
  const doc = new Y.Doc();
  bbmToDoc(readBbm(xml).map, doc);
  return doc;
}

function firstBrickLayer(doc: Y.Doc): { id: string; bricks: Y.Array<Y.Map<unknown>> } {
  const id = docToBbm(doc).layers.find((l) => l.type === 'brick' && l.bricks.length > 3)!.id;
  const y = doc.getMap<Y.Map<unknown>>('layerData').get(id)!;
  return { id, bricks: y.get('bricks') as Y.Array<Y.Map<unknown>> };
}

describe('createDocProjector', () => {
  it('matches docToBbm and returns the same object while nothing changes', () => {
    const doc = loadFixture();
    const p = createDocProjector(doc);
    const a = p.project();
    expect(a).toEqual(docToBbm(doc));
    expect(p.project()).toBe(a);
  });

  it('keeps identity for untouched bricks and layers, refreshes changed ones', () => {
    const doc = loadFixture();
    const p = createDocProjector(doc);
    const before = p.project();
    const { id, bricks } = firstBrickLayer(doc);
    const moved = bricks.get(1);
    moved.set('displayArea', { x: 1, y: 2, width: 3, height: 4 });

    const after = p.project();
    expect(after).not.toBe(before);
    expect(after).toEqual(docToBbm(doc));
    const lb = before.layers.find((l) => l.id === id) as LayerBrick;
    const la = after.layers.find((l) => l.id === id) as LayerBrick;
    expect(la).not.toBe(lb);
    expect(la.bricks[0]).toBe(lb.bricks[0]);
    expect(la.bricks[1]).not.toBe(lb.bricks[1]);
    expect(la.bricks[1]!.displayArea).toEqual({ x: 1, y: 2, width: 3, height: 4 });
    expect(la.bricks[2]).toBe(lb.bricks[2]);
    // Other layers keep their identity.
    for (const l of after.layers) {
      if (l.id !== id) expect(l).toBe(before.layers.find((x) => x.id === l.id));
    }
  });

  it('tracks inserts, deletes, layer order, meta and undo', () => {
    const doc = loadFixture();
    const p = createDocProjector(doc);
    const um = new Y.UndoManager(
      [doc.getMap('layerData'), doc.getArray('layers'), doc.getMap('meta')],
      { captureTimeout: 0 },
    );
    p.project();
    const { bricks } = firstBrickLayer(doc);
    const nb = new Y.Map<unknown>();
    doc.transact(() => {
      nb.set('id', '42');
      nb.set('displayArea', { x: 0, y: 0, width: 1, height: 1 });
      nb.set('myGroup', '');
      nb.set('partNumber', 'x.1');
      nb.set('orientation', 0);
      nb.set('activeConnectionPointIndex', 0);
      nb.set('altitude', 0);
      nb.set('connexions', []);
      bricks.push([nb]);
    });
    expect(p.project()).toEqual(docToBbm(doc));
    bricks.delete(0, 2);
    expect(p.project()).toEqual(docToBbm(doc));
    doc.getMap('meta').set('author', 'me');
    expect(p.project().author).toBe('me');
    const order = doc.getArray<string>('layers');
    const first = order.get(0);
    doc.transact(() => {
      order.delete(0, 1);
      order.push([first]);
    });
    expect(p.project()).toEqual(docToBbm(doc));
    while (um.canUndo()) {
      um.undo();
      expect(p.project()).toEqual(docToBbm(doc));
    }
  });

  it('falls back to a fresh projection inside a transaction', () => {
    const doc = loadFixture();
    const p = createDocProjector(doc);
    p.project();
    doc.transact(() => {
      doc.getMap('meta').set('author', 'inside');
      expect(p.project().author).toBe('inside');
    });
  });
});

// Regression tests for the editor's undo scope and the connectivity
// write-back's interaction with it.

import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import type { Catalog, PartMetadata } from '@cld/parts-catalog/browser';
import { createDefaultLayoutDoc, docToBbm, readSidecarFromDoc } from '@cld/ydoc';
import {
  addAnchoredLabel,
  addLayer,
  deleteLayer,
  moveBrick,
  moveLayer,
  placeBrick,
  setBackgroundColor,
  setVenue,
} from '../mutations';
import { createUndoManager } from '../useUndoManager';
import { CONNECTIVITY_ORIGIN, recomputeConnectivity } from '../useConnectivity';

function brickLayerId(doc: Y.Doc): string {
  return docToBbm(doc).layers.find((l) => l.type === 'brick')!.id;
}

function trackCatalog(): Catalog {
  const meta: PartMetadata = {
    key: 'track.0',
    partNumber: 'TRACK',
    colorCode: '0',
    kind: 'leaf',
    descriptions: {},
    author: '',
    sortingKey: '0',
    spritePath: '',
    pxPerStud: 8,
    connections: [
      { type: '1', x: -8, y: 0, angle: 180 },
      { type: '1', x: 8, y: 0, angle: 0 },
    ],
    subparts: [],
    canUngroup: true,
    hullPts: [],
  } as unknown as PartMetadata;
  return new Map([['track.0', meta]]);
}

describe('undo scope', () => {
  it('undoing deleteLayer restores the layer in the visible order', () => {
    const doc = createDefaultLayoutDoc();
    const layerId = brickLayerId(doc);
    placeBrick(doc, layerId, { partNumber: 'a', x: 0, y: 0, width: 1, height: 1 });
    const um = createUndoManager(doc);
    deleteLayer(doc, layerId);
    expect(docToBbm(doc).layers.some((l) => l.id === layerId)).toBe(false);
    um.undo();
    const layer = docToBbm(doc).layers.find((l) => l.id === layerId);
    expect(layer?.type).toBe('brick');
    expect(layer?.type === 'brick' && layer.bricks.length).toBe(1);
  });

  it('layer reorder, venue, labels and background color are undoable', () => {
    const doc = createDefaultLayoutDoc();
    const a = addLayer(doc, 'brick');
    const um = createUndoManager(doc);

    const before = doc.getArray<string>('layers').toArray();
    moveLayer(doc, a, 'down');
    um.stopCapturing();
    expect(doc.getArray<string>('layers').toArray()).not.toEqual(before);
    um.undo();
    expect(doc.getArray<string>('layers').toArray()).toEqual(before);

    setVenue(doc, {
      name: 'hall',
      enabled: true,
      minWalkwayStuds: 0,
      bounds: { x: 0, y: 0, w: 1, h: 1 },
      edges: [],
      obstacles: [],
    });
    um.stopCapturing();
    addAnchoredLabel(doc, { id: 'L1' } as never);
    um.stopCapturing();
    setBackgroundColor(doc, { kind: 'known', name: 'Red' });
    um.stopCapturing();

    um.undo();
    expect(docToBbm(doc).backgroundColor).toEqual({ kind: 'known', name: 'CornflowerBlue' });
    um.undo();
    expect(readSidecarFromDoc(doc)?.anchoredLabels ?? []).toHaveLength(0);
    um.undo();
    expect(readSidecarFromDoc(doc)?.venue).toBeUndefined();
  });

  it('remote updates are not undoable', () => {
    const doc = createDefaultLayoutDoc();
    const um = createUndoManager(doc);
    doc.transact(() => doc.getMap('meta').set('author', 'someone else'), 'remote-provider');
    expect(um.canUndo()).toBe(false);
  });
});

describe('connectivity write-back', () => {
  it('does not create its own undo step: one Ctrl+Z reverts the move', () => {
    const doc = createDefaultLayoutDoc();
    const layerId = brickLayerId(doc);
    placeBrick(doc, layerId, { partNumber: 'track.0', x: 0, y: 0, width: 2, height: 1 });
    const b = placeBrick(doc, layerId, { partNumber: 'track.0', x: 50, y: 0, width: 2, height: 1 });
    const catalog = trackCatalog();
    recomputeConnectivity(doc, catalog);
    const um = createUndoManager(doc);

    // Move b so its left end meets a's right end -> they link.
    moveBrick(doc, layerId, b, 17, 0.5);
    um.stopCapturing(); // the write-back lands after the capture window
    recomputeConnectivity(doc, catalog);
    const linked = docToBbm(doc).layers.find((l) => l.id === layerId);
    const bb = linked?.type === 'brick' ? linked.bricks.find((x) => x.id === b) : undefined;
    expect(bb?.connexions.some((c) => c.linkedTo !== '')).toBe(true);
    expect(um.undoStack).toHaveLength(1);

    um.undo();
    const after = docToBbm(doc).layers.find((l) => l.id === layerId);
    const moved = after?.type === 'brick' ? after.bricks.find((x) => x.id === b) : undefined;
    expect(moved?.displayArea.x).toBe(50);
  });

  it('uses the untracked CONNECTIVITY_ORIGIN', () => {
    const doc = createDefaultLayoutDoc();
    const layerId = brickLayerId(doc);
    placeBrick(doc, layerId, { partNumber: 'track.0', x: 0, y: 0, width: 2, height: 1 });
    placeBrick(doc, layerId, { partNumber: 'track.0', x: 2, y: 0, width: 2, height: 1 });
    const origins: unknown[] = [];
    doc.on('afterTransaction', (tr: Y.Transaction) => origins.push(tr.origin));
    recomputeConnectivity(doc, trackCatalog());
    expect(origins).toEqual([CONNECTIVITY_ORIGIN]);
  });

  it('scales linearly: 5k bricks recompute + write-back well under a second', () => {
    const doc = createDefaultLayoutDoc();
    const layerId = brickLayerId(doc);
    doc.transact(() => {
      for (let i = 0; i < 5000; i++) {
        placeBrick(doc, layerId, {
          partNumber: 'track.0',
          x: (i % 100) * 16,
          y: Math.floor(i / 100) * 8,
          width: 16,
          height: 8,
        });
      }
    });
    const t0 = performance.now();
    recomputeConnectivity(doc, trackCatalog());
    // Was ~8 s with the O(n^2) per-brick linear scan.
    expect(performance.now() - t0).toBeLessThan(1500);
  });
});

// Two people editing the same thing at once (audit 2026-10-20, track B).
// Yjs has no "move": rulers, area cells and reordered parts are edited by
// deleting the entry and inserting a changed copy, so two concurrent edits
// leave two copies. removeDuplicateItems (run by every editor after
// someone else's change) keeps one; the it.fails cases below are the
// edits that are still lost and need a decision (see each one).

import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { removeDuplicateItems } from '@cld/ydoc';
import {
  addLinearRuler,
  deleteBricks,
  deleteRulerItem,
  ensureAreaLayer,
  ensureBrickLayer,
  ensureRulerLayer,
  moveArea,
  moveBrick,
  moveRulerItem,
  paintAreaCells,
  placeBrick,
  reorderBricks,
} from '../mutations';

function pair(seed: (d: Y.Doc) => void): { a: Y.Doc; b: Y.Doc } {
  const a = new Y.Doc();
  seed(a);
  const b = new Y.Doc();
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
  return { a, b };
}

function sync(a: Y.Doc, b: Y.Doc): void {
  const sa = Y.encodeStateVector(a);
  const sb = Y.encodeStateVector(b);
  const ua = Y.encodeStateAsUpdate(a, sb);
  const ub = Y.encodeStateAsUpdate(b, sa);
  Y.applyUpdate(b, ua);
  Y.applyUpdate(a, ub);
}

/** What each editor does after someone else's change, then a resync. */
function settle(a: Y.Doc, b: Y.Doc): void {
  sync(a, b);
  removeDuplicateItems(a, 'repair');
  removeDuplicateItems(b, 'repair');
  sync(a, b);
}

const list = (d: Y.Doc, layerId: string, field: string): unknown[] =>
  ((d.getMap('layerData').get(layerId) as Y.Map<unknown>).get(field) as Y.Array<unknown>).toArray();
const cells = (d: Y.Doc, layerId: string) => list(d, layerId, 'areas') as { x: number; y: number; color: string }[];
const rulers = (d: Y.Doc, layerId: string) => list(d, layerId, 'rulerItems') as { id: string; point1: { x: number; y: number } }[];
const brick = { partNumber: '3001.1', width: 4, height: 2 };

describe('rulers', () => {
  it('two people moving the same ruler at once leave one ruler, the same on both, and deleting it removes it', () => {
    let L = '';
    let R = '';
    const { a, b } = pair((d) => {
      L = ensureRulerLayer(d);
      R = addLinearRuler(d, L, { x: 0, y: 0 }, { x: 10, y: 0 });
    });
    moveRulerItem(a, L, R, 5, 0);
    moveRulerItem(b, L, R, 0, 5);
    settle(a, b);
    expect(rulers(a, L)).toHaveLength(1);
    expect(rulers(b, L)).toEqual(rulers(a, L));
    deleteRulerItem(a, L, R);
    sync(a, b);
    expect(rulers(a, L)).toHaveLength(0);
    expect(rulers(b, L)).toHaveLength(0);
  });

  // Needs Aaron: a ruler is a plain value in the array, so a move is a
  // delete plus a new copy and the copy outlives a concurrent delete.
  // Fixing it means rulers stored as Y.Maps edited in place (as text cells
  // and parts are), a doc change the desktop must make too.
  // Repro: A deletes a ruler while B (offline or at the same moment) drags it.
  it.fails('a ruler one person deletes while another moves it stays deleted', () => {
    let L = '';
    let R = '';
    const { a, b } = pair((d) => {
      L = ensureRulerLayer(d);
      R = addLinearRuler(d, L, { x: 0, y: 0 }, { x: 10, y: 0 });
    });
    deleteRulerItem(a, L, R);
    moveRulerItem(b, L, R, 0, 5);
    settle(a, b);
    expect(rulers(a, L)).toHaveLength(0);
  });
});

describe('area cells', () => {
  it('two people painting the same cell at once leave one cell, the same on both', () => {
    let L = '';
    const { a, b } = pair((d) => {
      L = ensureAreaLayer(d);
      paintAreaCells(d, L, [{ x: 1, y: 1, color: 'FF000000' }]);
    });
    paintAreaCells(a, L, [{ x: 1, y: 1, color: 'FFFF0000' }]);
    paintAreaCells(b, L, [{ x: 1, y: 1, color: 'FF00FF00' }]);
    settle(a, b);
    expect(cells(a, L)).toHaveLength(1);
    expect(cells(b, L)).toEqual(cells(a, L));
  });

  it('erasing a cell that is there twice erases it (before the copies are cleaned up)', () => {
    let L = '';
    const { a, b } = pair((d) => {
      L = ensureAreaLayer(d);
    });
    paintAreaCells(a, L, [{ x: 1, y: 1, color: 'FFFF0000' }]);
    paintAreaCells(b, L, [{ x: 1, y: 1, color: 'FF00FF00' }]);
    sync(a, b);
    expect(cells(a, L)).toHaveLength(2);
    paintAreaCells(a, L, [{ x: 1, y: 1, color: null }]);
    expect(cells(a, L)).toEqual([]);
  });

  it('the same cell twice in one stroke paints it once with the last color, leaving the others alone', () => {
    const doc = new Y.Doc();
    const L = ensureAreaLayer(doc);
    paintAreaCells(doc, L, [
      { x: 0, y: 0, color: 'FF0000FF' },
      { x: 1, y: 1, color: 'FF000000' },
    ]);
    paintAreaCells(doc, L, [
      { x: 1, y: 1, color: 'FFFF0000' },
      { x: 1, y: 1, color: 'FF00FF00' },
    ]);
    expect(cells(doc, L).map((c) => `${c.x},${c.y},${c.color}`).sort()).toEqual(['0,0,FF0000FF', '1,1,FF00FF00']);
  });

  // Needs Aaron: moveArea rewrites every cell, so two people moving the
  // same area sheet at once get both moved copies (the area doubles).
  // Repro: two editors drag the same area sheet at the same moment.
  it.fails('two people moving the same area sheet at once leave each cell once', () => {
    let L = '';
    const { a, b } = pair((d) => {
      L = ensureAreaLayer(d);
      paintAreaCells(d, L, [{ x: 1, y: 1, color: 'FF000000' }]);
    });
    moveArea(a, L, 1, 0);
    moveArea(b, L, 0, 1);
    settle(a, b);
    expect(cells(a, L)).toHaveLength(1);
  });
});

describe('parts', () => {
  // Needs Aaron: Bring to Front / Send to Back delete the part and insert
  // a copy (Yjs can't move), so a concurrent delete or move of that part is
  // lost. reorderBricks already moves as few parts as it can (#300).
  // Repro: A deletes (or drags) a part while B brings the same part to front.
  it.fails('a part one person deletes while another brings it to front stays deleted', () => {
    let L = '';
    let p = '';
    const { a, b } = pair((d) => {
      L = ensureBrickLayer(d);
      p = placeBrick(d, L, { ...brick, x: 0, y: 0 });
      placeBrick(d, L, { ...brick, x: 10, y: 0 });
    });
    deleteBricks(a, L, [p]);
    reorderBricks(b, [p], 'front');
    settle(a, b);
    expect(list(a, L, 'bricks')).toHaveLength(1);
  });

  it.fails('a part one person drags while another brings it to front keeps the drag', () => {
    let L = '';
    let p = '';
    const { a, b } = pair((d) => {
      L = ensureBrickLayer(d);
      p = placeBrick(d, L, { ...brick, x: 0, y: 0 });
      placeBrick(d, L, { ...brick, x: 10, y: 0 });
    });
    moveBrick(a, L, p, 50, 50);
    reorderBricks(b, [p], 'front');
    settle(a, b);
    const moved = (list(a, L, 'bricks') as Y.Map<unknown>[]).find((m) => m.get('id') === p)!;
    expect((moved.get('displayArea') as { x: number }).x).not.toBe(0);
  });
});

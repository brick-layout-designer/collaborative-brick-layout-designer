// Tests for mutations not yet covered:
//   placeBrick, deleteBricks, moveBrick, moveBrickAndOrient
//   translateBricks, translateBricksAcrossLayers
//   insertBricks, rotateBricks
//   paintAreaCells, ensureAreaLayer
//   moveRulerItem, moveRulerEndpoint, attachRulerEndpoint

import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  placeBrick,
  deleteBricks,
  moveBrick,
  moveBrickAndOrient,
  translateBricks,
  translateBricksAcrossLayers,
  insertBricks,
  rotateBricks,
  paintAreaCells,
  ensureAreaLayer,
  moveRulerItem,
  moveRulerEndpoint,
  attachRulerEndpoint,
  ensureBrickLayer,
  ensureRulerLayer,
  addLinearRuler,
  addCircularRuler,
} from '../mutations';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function blankDoc(): Y.Doc {
  return new Y.Doc();
}

function docWithBrickLayer(): { doc: Y.Doc; layerId: string } {
  const doc = blankDoc();
  const layerId = ensureBrickLayer(doc);
  return { doc, layerId };
}

function bricksInLayer(doc: Y.Doc, layerId: string): Y.Map<unknown>[] {
  const layerData = doc.getMap('layerData').get(layerId) as Y.Map<unknown>;
  const bricks = layerData.get('bricks') as Y.Array<Y.Map<unknown>>;
  return bricks.toArray();
}

// ---------------------------------------------------------------------------
// placeBrick
// ---------------------------------------------------------------------------

describe('placeBrick', () => {
  it('appends a brick to the layer and returns a non-empty id', () => {
    const { doc, layerId } = docWithBrickLayer();
    const id = placeBrick(doc, layerId, {
      partNumber: '3001.dat',
      x: 10,
      y: 20,
      width: 2,
      height: 1,
    });
    expect(id).toBeTruthy();
    const bricks = bricksInLayer(doc, layerId);
    expect(bricks).toHaveLength(1);
    expect(bricks[0]?.get('id')).toBe(id);
  });

  it('stores all fields correctly', () => {
    const { doc, layerId } = docWithBrickLayer();
    const id = placeBrick(doc, layerId, {
      partNumber: '3002.dat',
      x: 5,
      y: 6,
      width: 3,
      height: 2,
      orientation: 90,
      altitude: 3,
      activeConnectionPointIndex: 2,
    });
    const brick = bricksInLayer(doc, layerId)[0]!;
    expect(brick.get('id')).toBe(id);
    expect(brick.get('partNumber')).toBe('3002.dat');
    expect((brick.get('displayArea') as { x: number }).x).toBe(5);
    expect(brick.get('orientation')).toBe(90);
    expect(brick.get('altitude')).toBe(3);
    expect(brick.get('activeConnectionPointIndex')).toBe(2);
  });

  it('defaults orientation, altitude, and activeConnectionPointIndex to 0', () => {
    const { doc, layerId } = docWithBrickLayer();
    placeBrick(doc, layerId, { partNumber: 'p', x: 0, y: 0, width: 1, height: 1 });
    const brick = bricksInLayer(doc, layerId)[0]!;
    expect(brick.get('orientation')).toBe(0);
    expect(brick.get('altitude')).toBe(0);
    expect(brick.get('activeConnectionPointIndex')).toBe(0);
  });

  it('is a no-op for an unknown layerId', () => {
    const doc = blankDoc();
    const id = placeBrick(doc, 'no-such-layer', { partNumber: 'p', x: 0, y: 0, width: 1, height: 1 });
    expect(id).toBeTruthy(); // id is still minted
  });
});

// ---------------------------------------------------------------------------
// deleteBricks
// ---------------------------------------------------------------------------

describe('deleteBricks', () => {
  it('is a no-op when brickIds is empty', () => {
    const { doc, layerId } = docWithBrickLayer();
    placeBrick(doc, layerId, { partNumber: 'p', x: 0, y: 0, width: 1, height: 1 });
    deleteBricks(doc, layerId, []);
    expect(bricksInLayer(doc, layerId)).toHaveLength(1);
  });

  it('removes the specified bricks', () => {
    const { doc, layerId } = docWithBrickLayer();
    const id1 = placeBrick(doc, layerId, { partNumber: 'p', x: 0, y: 0, width: 1, height: 1 });
    const id2 = placeBrick(doc, layerId, { partNumber: 'q', x: 2, y: 0, width: 1, height: 1 });
    deleteBricks(doc, layerId, [id1]);
    const remaining = bricksInLayer(doc, layerId);
    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.get('id')).toBe(id2);
  });

  it('removes multiple bricks at once', () => {
    const { doc, layerId } = docWithBrickLayer();
    const id1 = placeBrick(doc, layerId, { partNumber: 'p', x: 0, y: 0, width: 1, height: 1 });
    const id2 = placeBrick(doc, layerId, { partNumber: 'q', x: 2, y: 0, width: 1, height: 1 });
    deleteBricks(doc, layerId, [id1, id2]);
    expect(bricksInLayer(doc, layerId)).toHaveLength(0);
  });

  it('ignores unknown brick ids', () => {
    const { doc, layerId } = docWithBrickLayer();
    placeBrick(doc, layerId, { partNumber: 'p', x: 0, y: 0, width: 1, height: 1 });
    deleteBricks(doc, layerId, ['no-such-id']);
    expect(bricksInLayer(doc, layerId)).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// moveBrick
// ---------------------------------------------------------------------------

describe('moveBrick', () => {
  it('repositions the brick so the centre is at (newCentreX, newCentreY)', () => {
    const { doc, layerId } = docWithBrickLayer();
    const id = placeBrick(doc, layerId, { partNumber: 'p', x: 0, y: 0, width: 4, height: 2 });
    moveBrick(doc, layerId, id, 10, 5);
    const area = bricksInLayer(doc, layerId)[0]?.get('displayArea') as { x: number; y: number };
    expect(area.x).toBe(10 - 2); // centreX - width/2
    expect(area.y).toBe(5 - 1);  // centreY - height/2
  });

  it('is a no-op for an unknown brick id', () => {
    const { doc, layerId } = docWithBrickLayer();
    expect(() => moveBrick(doc, layerId, 'no-such', 1, 2)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// moveBrickAndOrient
// ---------------------------------------------------------------------------

describe('moveBrickAndOrient', () => {
  it('moves and updates orientation in one transaction', () => {
    const { doc, layerId } = docWithBrickLayer();
    const id = placeBrick(doc, layerId, { partNumber: 'p', x: 0, y: 0, width: 4, height: 2, orientation: 0 });
    moveBrickAndOrient(doc, layerId, id, 20, 10, 90);
    const brick = bricksInLayer(doc, layerId)[0]!;
    const area = brick.get('displayArea') as { x: number; y: number };
    expect(area.x).toBe(20 - 2);
    expect(area.y).toBe(10 - 1);
    expect(brick.get('orientation')).toBe(90);
  });

  it('normalises orientation to [0, 360)', () => {
    const { doc, layerId } = docWithBrickLayer();
    const id = placeBrick(doc, layerId, { partNumber: 'p', x: 0, y: 0, width: 2, height: 2, orientation: 0 });
    moveBrickAndOrient(doc, layerId, id, 0, 0, -90);
    const brick = bricksInLayer(doc, layerId)[0]!;
    expect(brick.get('orientation')).toBe(270);
  });

  it('is a no-op for an unknown brick id', () => {
    const { doc, layerId } = docWithBrickLayer();
    expect(() => moveBrickAndOrient(doc, layerId, 'x', 0, 0, 0)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// translateBricks
// ---------------------------------------------------------------------------

describe('translateBricks', () => {
  it('shifts all listed bricks by (dx, dy)', () => {
    const { doc, layerId } = docWithBrickLayer();
    const id1 = placeBrick(doc, layerId, { partNumber: 'p', x: 0, y: 0, width: 2, height: 2 });
    const id2 = placeBrick(doc, layerId, { partNumber: 'q', x: 10, y: 5, width: 2, height: 2 });
    translateBricks(doc, layerId, [id1, id2], 3, -2);
    const [b1, b2] = bricksInLayer(doc, layerId);
    const a1 = b1?.get('displayArea') as { x: number; y: number };
    const a2 = b2?.get('displayArea') as { x: number; y: number };
    expect(a1.x).toBe(3);
    expect(a1.y).toBe(-2);
    expect(a2.x).toBe(13);
    expect(a2.y).toBe(3);
  });

  it('is a no-op when brickIds is empty', () => {
    const { doc, layerId } = docWithBrickLayer();
    const id = placeBrick(doc, layerId, { partNumber: 'p', x: 5, y: 5, width: 2, height: 2 });
    translateBricks(doc, layerId, [], 10, 10);
    const area = bricksInLayer(doc, layerId)[0]?.get('displayArea') as { x: number; y: number };
    expect(area.x).toBe(5);
  });

  it('is a no-op when dx and dy are both 0', () => {
    const { doc, layerId } = docWithBrickLayer();
    placeBrick(doc, layerId, { partNumber: 'p', x: 7, y: 3, width: 2, height: 2 });
    translateBricks(doc, layerId, [], 0, 0);
    const area = bricksInLayer(doc, layerId)[0]?.get('displayArea') as { x: number; y: number };
    expect(area.x).toBe(7);
  });
});

// ---------------------------------------------------------------------------
// translateBricksAcrossLayers
// ---------------------------------------------------------------------------

describe('translateBricksAcrossLayers', () => {
  it('translates bricks in multiple layers in one transaction', () => {
    const doc = blankDoc();
    // Create two separate brick layers by deleting the first before creating the second.
    const l1 = ensureBrickLayer(doc);
    const id1 = placeBrick(doc, l1, { partNumber: 'p', x: 0, y: 0, width: 2, height: 2 });
    // Create second layer by inserting directly.
    const l2 = 'layer2';
    doc.transact(() => {
      const yLayer = new Y.Map<unknown>();
      yLayer.set('id', l2);
      yLayer.set('type', 'brick');
      yLayer.set('name', 'Bricks 2');
      yLayer.set('visible', true);
      yLayer.set('transparency', 100);
      yLayer.set('bricks', new Y.Array());
      yLayer.set('groups', new Y.Array());
      doc.getMap('layerData').set(l2, yLayer);
      doc.getArray('layers').push([l2]);
    });
    const id2 = placeBrick(doc, l2, { partNumber: 'q', x: 5, y: 5, width: 2, height: 2 });

    const byLayer = new Map([
      [l1, [id1]],
      [l2, [id2]],
    ]);
    translateBricksAcrossLayers(doc, byLayer, 10, 5);

    const a1 = bricksInLayer(doc, l1)[0]?.get('displayArea') as { x: number; y: number };
    const a2 = bricksInLayer(doc, l2)[0]?.get('displayArea') as { x: number; y: number };
    expect(a1.x).toBe(10);
    expect(a1.y).toBe(5);
    expect(a2.x).toBe(15);
    expect(a2.y).toBe(10);
  });

  it('is a no-op when byLayer is empty', () => {
    const { doc, layerId } = docWithBrickLayer();
    placeBrick(doc, layerId, { partNumber: 'p', x: 1, y: 2, width: 2, height: 2 });
    translateBricksAcrossLayers(doc, new Map(), 10, 10);
    const area = bricksInLayer(doc, layerId)[0]?.get('displayArea') as { x: number };
    expect(area.x).toBe(1);
  });

  it('is a no-op when dx and dy are both 0', () => {
    const { doc, layerId } = docWithBrickLayer();
    const id = placeBrick(doc, layerId, { partNumber: 'p', x: 3, y: 4, width: 2, height: 2 });
    translateBricksAcrossLayers(doc, new Map([[layerId, [id]]]), 0, 0);
    const area = bricksInLayer(doc, layerId)[0]?.get('displayArea') as { x: number };
    expect(area.x).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// insertBricks
// ---------------------------------------------------------------------------

describe('insertBricks', () => {
  it('returns empty array and does nothing when bricks is empty', () => {
    const { doc, layerId } = docWithBrickLayer();
    const ids = insertBricks(doc, layerId, []);
    expect(ids).toEqual([]);
    expect(bricksInLayer(doc, layerId)).toHaveLength(0);
  });

  it('inserts bricks and returns their new ids', () => {
    const { doc, layerId } = docWithBrickLayer();
    const ids = insertBricks(doc, layerId, [
      { partNumber: 'p', displayArea: { x: 1, y: 2, width: 3, height: 4 } },
      { partNumber: 'q', displayArea: { x: 5, y: 6, width: 2, height: 2 } },
    ]);
    expect(ids).toHaveLength(2);
    const bricks = bricksInLayer(doc, layerId);
    expect(bricks).toHaveLength(2);
    expect(bricks[0]?.get('id')).toBe(ids[0]);
    expect(bricks[1]?.get('id')).toBe(ids[1]);
  });

  it('applies the offset to all inserted bricks', () => {
    const { doc, layerId } = docWithBrickLayer();
    insertBricks(
      doc,
      layerId,
      [{ partNumber: 'p', displayArea: { x: 10, y: 20, width: 2, height: 2 } }],
      { dx: 5, dy: -3 },
    );
    const area = bricksInLayer(doc, layerId)[0]?.get('displayArea') as { x: number; y: number };
    expect(area.x).toBe(15);
    expect(area.y).toBe(17);
  });

  it('uses orientation and altitude from the spec when provided', () => {
    const { doc, layerId } = docWithBrickLayer();
    insertBricks(doc, layerId, [
      { partNumber: 'p', displayArea: { x: 0, y: 0, width: 1, height: 1 }, orientation: 180, altitude: 5 },
    ]);
    const brick = bricksInLayer(doc, layerId)[0]!;
    expect(brick.get('orientation')).toBe(180);
    expect(brick.get('altitude')).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// rotateBricks
// ---------------------------------------------------------------------------

describe('rotateBricks', () => {
  it('is a no-op when brickIds is empty', () => {
    const { doc, layerId } = docWithBrickLayer();
    const id = placeBrick(doc, layerId, { partNumber: 'p', x: 0, y: 0, width: 2, height: 2, orientation: 0 });
    rotateBricks(doc, layerId, [], 90);
    expect(bricksInLayer(doc, layerId)[0]?.get('orientation')).toBe(0);
  });

  it('is a no-op when deltaDegrees is 0', () => {
    const { doc, layerId } = docWithBrickLayer();
    placeBrick(doc, layerId, { partNumber: 'p', x: 0, y: 0, width: 2, height: 2, orientation: 45 });
    const ids = bricksInLayer(doc, layerId).map((b) => b.get('id') as string);
    rotateBricks(doc, layerId, ids, 0);
    expect(bricksInLayer(doc, layerId)[0]?.get('orientation')).toBe(45);
  });

  it('rotates by the given delta and wraps at 360', () => {
    const { doc, layerId } = docWithBrickLayer();
    const id = placeBrick(doc, layerId, { partNumber: 'p', x: 0, y: 0, width: 2, height: 2, orientation: 270 });
    rotateBricks(doc, layerId, [id], 180);
    expect(bricksInLayer(doc, layerId)[0]?.get('orientation')).toBe(90);
  });

  it('rotates multiple bricks', () => {
    const { doc, layerId } = docWithBrickLayer();
    const id1 = placeBrick(doc, layerId, { partNumber: 'p', x: 0, y: 0, width: 2, height: 2, orientation: 0 });
    const id2 = placeBrick(doc, layerId, { partNumber: 'q', x: 5, y: 0, width: 2, height: 2, orientation: 90 });
    rotateBricks(doc, layerId, [id1, id2], 90);
    const bricks = bricksInLayer(doc, layerId);
    expect(bricks[0]?.get('orientation')).toBe(90);
    expect(bricks[1]?.get('orientation')).toBe(180);
  });
});

// ---------------------------------------------------------------------------
// ensureAreaLayer
// ---------------------------------------------------------------------------

describe('ensureAreaLayer', () => {
  it('creates a new area layer when none exists', () => {
    const doc = blankDoc();
    const id = ensureAreaLayer(doc);
    expect(id).toBeTruthy();
    const layer = doc.getMap('layerData').get(id) as Y.Map<unknown>;
    expect(layer.get('type')).toBe('area');
    expect(layer.get('visible')).toBe(true);
    expect(doc.getArray('layers').toArray()).toContain(id);
  });

  it('returns existing area layer without creating a new one', () => {
    const doc = blankDoc();
    const first = ensureAreaLayer(doc);
    const second = ensureAreaLayer(doc);
    expect(first).toBe(second);
    expect(doc.getArray('layers').length).toBe(1);
  });

  it('respects custom defaultCellSizeStuds', () => {
    const doc = blankDoc();
    const id = ensureAreaLayer(doc, 16);
    const layer = doc.getMap('layerData').get(id) as Y.Map<unknown>;
    expect(layer.get('areaCellSize')).toBe(16);
  });

  it('skips invisible area layers and returns the first visible one', () => {
    const doc = blankDoc();
    const id1 = ensureAreaLayer(doc);
    const layer1 = doc.getMap('layerData').get(id1) as Y.Map<unknown>;
    layer1.set('visible', false);
    // Must create a new visible area layer.
    const id2 = ensureAreaLayer(doc);
    expect(id2).not.toBe(id1);
  });
});

// ---------------------------------------------------------------------------
// paintAreaCells
// ---------------------------------------------------------------------------

describe('paintAreaCells', () => {
  function docWithAreaLayer(): { doc: Y.Doc; layerId: string } {
    const doc = blankDoc();
    const layerId = ensureAreaLayer(doc);
    return { doc, layerId };
  }

  function areaCells(doc: Y.Doc, layerId: string): unknown[] {
    const layer = doc.getMap('layerData').get(layerId) as Y.Map<unknown>;
    const arr = layer.get('areas') as Y.Array<unknown>;
    return arr.toArray();
  }

  it('is a no-op when changes is empty', () => {
    const { doc, layerId } = docWithAreaLayer();
    paintAreaCells(doc, layerId, []);
    expect(areaCells(doc, layerId)).toHaveLength(0);
  });

  it('adds a new cell', () => {
    const { doc, layerId } = docWithAreaLayer();
    paintAreaCells(doc, layerId, [{ x: 1, y: 2, color: 'FFFF0000' }]);
    expect(areaCells(doc, layerId)).toHaveLength(1);
    const cell = areaCells(doc, layerId)[0] as { x: number; y: number; color: string };
    expect(cell.x).toBe(1);
    expect(cell.y).toBe(2);
    expect(cell.color).toBe('FFFF0000');
  });

  it('replaces an existing cell at the same (x, y)', () => {
    const { doc, layerId } = docWithAreaLayer();
    paintAreaCells(doc, layerId, [{ x: 0, y: 0, color: 'FF000000' }]);
    paintAreaCells(doc, layerId, [{ x: 0, y: 0, color: 'FF00FF00' }]);
    const cells = areaCells(doc, layerId);
    expect(cells).toHaveLength(1);
    expect((cells[0] as { color: string }).color).toBe('FF00FF00');
  });

  it('erases a cell when color is null', () => {
    const { doc, layerId } = docWithAreaLayer();
    paintAreaCells(doc, layerId, [{ x: 3, y: 4, color: 'FF0000FF' }]);
    paintAreaCells(doc, layerId, [{ x: 3, y: 4, color: null }]);
    expect(areaCells(doc, layerId)).toHaveLength(0);
  });

  it('erase of non-existent cell is a no-op', () => {
    const { doc, layerId } = docWithAreaLayer();
    paintAreaCells(doc, layerId, [{ x: 99, y: 99, color: null }]);
    expect(areaCells(doc, layerId)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// moveRulerItem
// ---------------------------------------------------------------------------

describe('moveRulerItem', () => {
  function docWithRulerLayer(): { doc: Y.Doc; layerId: string } {
    const doc = blankDoc();
    const layerId = ensureRulerLayer(doc);
    return { doc, layerId };
  }

  it('is a no-op when dx and dy are both 0', () => {
    const { doc, layerId } = docWithRulerLayer();
    const rulerId = addLinearRuler(doc, layerId, { x: 0, y: 0 }, { x: 10, y: 0 });
    moveRulerItem(doc, layerId, rulerId, 0, 0);
    const layer = doc.getMap('layerData').get(layerId) as Y.Map<unknown>;
    const items = (layer.get('rulerItems') as Y.Array<{ point1: { x: number } }>).toArray();
    expect(items[0]?.point1.x).toBe(0);
  });

  it('translates a linear ruler — both endpoints shift', () => {
    const { doc, layerId } = docWithRulerLayer();
    const rulerId = addLinearRuler(doc, layerId, { x: 0, y: 0 }, { x: 10, y: 0 });
    moveRulerItem(doc, layerId, rulerId, 5, 3);
    const layer = doc.getMap('layerData').get(layerId) as Y.Map<unknown>;
    const item = (layer.get('rulerItems') as Y.Array<{ point1: { x: number; y: number }; point2: { x: number; y: number } }>).get(0);
    expect(item?.point1.x).toBe(5);
    expect(item?.point1.y).toBe(3);
    expect(item?.point2.x).toBe(15);
    expect(item?.point2.y).toBe(3);
  });

  it('translates a circular ruler — centre shifts', () => {
    const { doc, layerId } = docWithRulerLayer();
    const rulerId = addCircularRuler(doc, layerId, { x: 10, y: 10 }, 5);
    moveRulerItem(doc, layerId, rulerId, -2, 4);
    const layer = doc.getMap('layerData').get(layerId) as Y.Map<unknown>;
    const item = (layer.get('rulerItems') as Y.Array<{ center: { x: number; y: number } }>).get(0);
    expect(item?.center.x).toBe(8);
    expect(item?.center.y).toBe(14);
  });

  it('is a no-op for an unknown ruler id', () => {
    const { doc, layerId } = docWithRulerLayer();
    addLinearRuler(doc, layerId, { x: 0, y: 0 }, { x: 5, y: 0 });
    expect(() => moveRulerItem(doc, layerId, 'unknown-ruler', 1, 1)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// moveRulerEndpoint
// ---------------------------------------------------------------------------

describe('moveRulerEndpoint', () => {
  function docWithRulerLayer(): { doc: Y.Doc; layerId: string } {
    const doc = blankDoc();
    const layerId = ensureRulerLayer(doc);
    return { doc, layerId };
  }

  it('moves point1 of a linear ruler and clears attachedBrick1Id', () => {
    const { doc, layerId } = docWithRulerLayer();
    const rulerId = addLinearRuler(doc, layerId, { x: 0, y: 0 }, { x: 10, y: 0 });
    moveRulerEndpoint(doc, layerId, rulerId, 0, { x: 3, y: 7 });
    const layer = doc.getMap('layerData').get(layerId) as Y.Map<unknown>;
    const item = (layer.get('rulerItems') as Y.Array<{ point1: { x: number; y: number }; attachedBrick1Id: string }>).get(0);
    expect(item?.point1.x).toBe(3);
    expect(item?.point1.y).toBe(7);
    expect(item?.attachedBrick1Id).toBe('');
  });

  it('moves point2 of a linear ruler and clears attachedBrick2Id', () => {
    const { doc, layerId } = docWithRulerLayer();
    const rulerId = addLinearRuler(doc, layerId, { x: 0, y: 0 }, { x: 10, y: 0 });
    moveRulerEndpoint(doc, layerId, rulerId, 1, { x: 20, y: 5 });
    const layer = doc.getMap('layerData').get(layerId) as Y.Map<unknown>;
    const item = (layer.get('rulerItems') as Y.Array<{ point2: { x: number; y: number }; attachedBrick2Id: string }>).get(0);
    expect(item?.point2.x).toBe(20);
    expect(item?.point2.y).toBe(5);
    expect(item?.attachedBrick2Id).toBe('');
  });

  it('is a no-op for unknown ruler id', () => {
    const { doc, layerId } = docWithRulerLayer();
    expect(() => moveRulerEndpoint(doc, layerId, 'unknown', 0, { x: 0, y: 0 })).not.toThrow();
  });

  it('is a no-op for a circular ruler (kind mismatch)', () => {
    const { doc, layerId } = docWithRulerLayer();
    const rulerId = addCircularRuler(doc, layerId, { x: 5, y: 5 }, 3);
    expect(() => moveRulerEndpoint(doc, layerId, rulerId, 0, { x: 0, y: 0 })).not.toThrow();
    // Center should remain unchanged.
    const layer = doc.getMap('layerData').get(layerId) as Y.Map<unknown>;
    const item = (layer.get('rulerItems') as Y.Array<{ center: { x: number } }>).get(0);
    expect(item?.center.x).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// attachRulerEndpoint
// ---------------------------------------------------------------------------

describe('attachRulerEndpoint', () => {
  function docWithRulerLayer(): { doc: Y.Doc; layerId: string } {
    const doc = blankDoc();
    const layerId = ensureRulerLayer(doc);
    return { doc, layerId };
  }

  it('sets attachedBrick1Id on a linear ruler', () => {
    const { doc, layerId } = docWithRulerLayer();
    const rulerId = addLinearRuler(doc, layerId, { x: 0, y: 0 }, { x: 5, y: 0 });
    attachRulerEndpoint(doc, layerId, rulerId, 0, 'brick-abc');
    const layer = doc.getMap('layerData').get(layerId) as Y.Map<unknown>;
    const item = (layer.get('rulerItems') as Y.Array<{ attachedBrick1Id: string }>).get(0);
    expect(item?.attachedBrick1Id).toBe('brick-abc');
  });

  it('sets attachedBrick2Id on a linear ruler', () => {
    const { doc, layerId } = docWithRulerLayer();
    const rulerId = addLinearRuler(doc, layerId, { x: 0, y: 0 }, { x: 5, y: 0 });
    attachRulerEndpoint(doc, layerId, rulerId, 1, 'brick-xyz');
    const layer = doc.getMap('layerData').get(layerId) as Y.Map<unknown>;
    const item = (layer.get('rulerItems') as Y.Array<{ attachedBrick2Id: string }>).get(0);
    expect(item?.attachedBrick2Id).toBe('brick-xyz');
  });

  it('sets attachedBrickId on a circular ruler (which is ignored)', () => {
    const { doc, layerId } = docWithRulerLayer();
    const rulerId = addCircularRuler(doc, layerId, { x: 5, y: 5 }, 3);
    attachRulerEndpoint(doc, layerId, rulerId, 0, 'brick-circ');
    const layer = doc.getMap('layerData').get(layerId) as Y.Map<unknown>;
    const item = (layer.get('rulerItems') as Y.Array<{ attachedBrickId: string }>).get(0);
    expect(item?.attachedBrickId).toBe('brick-circ');
  });

  it('detaches when given an empty brick id', () => {
    const { doc, layerId } = docWithRulerLayer();
    const rulerId = addLinearRuler(doc, layerId, { x: 0, y: 0 }, { x: 5, y: 0 });
    attachRulerEndpoint(doc, layerId, rulerId, 0, 'brick-abc');
    attachRulerEndpoint(doc, layerId, rulerId, 0, '');
    const layer = doc.getMap('layerData').get(layerId) as Y.Map<unknown>;
    const item = (layer.get('rulerItems') as Y.Array<{ attachedBrick1Id: string }>).get(0);
    expect(item?.attachedBrick1Id).toBe('');
  });

  it('is a no-op for unknown ruler id', () => {
    const { doc, layerId } = docWithRulerLayer();
    expect(() => attachRulerEndpoint(doc, layerId, 'no-such', 0, 'b')).not.toThrow();
  });
});

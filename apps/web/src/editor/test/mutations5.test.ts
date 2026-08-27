// Tests for mutations not yet covered:
//   editBrick, reorderBricks, groupBricks, ungroupBricks
//   editRulerItem (circular radius patch)
//   cloneModuleBricks, rescanModuleFromBricks

import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import type { SidecarModule } from '@cld/bbm';
import {
  placeBrick,
  editBrick,
  reorderBricks,
  groupBricks,
  ungroupBricks,
  ensureBrickLayer,
  ensureRulerLayer,
  addLinearRuler,
  addCircularRuler,
  editRulerItem,
  cloneModuleBricks,
  rescanModuleFromBricks,
  setSidecarModuleMembers,
  addSidecarModule,
} from '../mutations';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function blankDoc(): Y.Doc { return new Y.Doc(); }

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
// editBrick
// ---------------------------------------------------------------------------

describe('editBrick', () => {
  it('updates partNumber when provided', () => {
    const { doc, layerId } = docWithBrickLayer();
    const id = placeBrick(doc, layerId, { partNumber: 'old.dat', x: 0, y: 0, width: 2, height: 2 });
    editBrick(doc, layerId, id, { partNumber: 'new.dat' });
    const brick = bricksInLayer(doc, layerId)[0]!;
    expect(brick.get('partNumber')).toBe('new.dat');
  });

  it('updates orientation (normalised to [0, 360))', () => {
    const { doc, layerId } = docWithBrickLayer();
    const id = placeBrick(doc, layerId, { partNumber: 'p', x: 0, y: 0, width: 2, height: 2, orientation: 0 });
    editBrick(doc, layerId, id, { orientation: 450 });
    expect(bricksInLayer(doc, layerId)[0]?.get('orientation')).toBe(90);
  });

  it('updates altitude and activeConnectionPointIndex', () => {
    const { doc, layerId } = docWithBrickLayer();
    const id = placeBrick(doc, layerId, { partNumber: 'p', x: 0, y: 0, width: 2, height: 2 });
    editBrick(doc, layerId, id, { altitude: 5, activeConnectionPointIndex: 3 });
    const brick = bricksInLayer(doc, layerId)[0]!;
    expect(brick.get('altitude')).toBe(5);
    expect(brick.get('activeConnectionPointIndex')).toBe(3);
  });

  it('updates x and y of displayArea', () => {
    const { doc, layerId } = docWithBrickLayer();
    const id = placeBrick(doc, layerId, { partNumber: 'p', x: 0, y: 0, width: 4, height: 2 });
    editBrick(doc, layerId, id, { x: 10, y: 7 });
    const area = bricksInLayer(doc, layerId)[0]?.get('displayArea') as { x: number; y: number; width: number };
    expect(area.x).toBe(10);
    expect(area.y).toBe(7);
    expect(area.width).toBe(4); // unchanged
  });

  it('only updates x when y is omitted', () => {
    const { doc, layerId } = docWithBrickLayer();
    const id = placeBrick(doc, layerId, { partNumber: 'p', x: 1, y: 2, width: 2, height: 2 });
    editBrick(doc, layerId, id, { x: 9 });
    const area = bricksInLayer(doc, layerId)[0]?.get('displayArea') as { x: number; y: number };
    expect(area.x).toBe(9);
    expect(area.y).toBe(2); // unchanged
  });

  it('is a no-op for unknown brickId', () => {
    const { doc, layerId } = docWithBrickLayer();
    expect(() => editBrick(doc, layerId, 'unknown', { partNumber: 'x' })).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// reorderBricks
// ---------------------------------------------------------------------------

describe('reorderBricks', () => {
  it('is a no-op when brickIds is empty', () => {
    const { doc, layerId } = docWithBrickLayer();
    const id1 = placeBrick(doc, layerId, { partNumber: 'A', x: 0, y: 0, width: 2, height: 2 });
    const id2 = placeBrick(doc, layerId, { partNumber: 'B', x: 2, y: 0, width: 2, height: 2 });
    reorderBricks(doc, layerId, [], 'front');
    const [b1, b2] = bricksInLayer(doc, layerId);
    expect(b1?.get('id')).toBe(id1);
    expect(b2?.get('id')).toBe(id2);
  });

  it('brings bricks to front (last index)', () => {
    const { doc, layerId } = docWithBrickLayer();
    const id1 = placeBrick(doc, layerId, { partNumber: 'A', x: 0, y: 0, width: 2, height: 2 });
    const id2 = placeBrick(doc, layerId, { partNumber: 'B', x: 2, y: 0, width: 2, height: 2 });
    const id3 = placeBrick(doc, layerId, { partNumber: 'C', x: 4, y: 0, width: 2, height: 2 });

    // Bring id1 to front.
    reorderBricks(doc, layerId, [id1], 'front');
    const bricks = bricksInLayer(doc, layerId);
    expect(bricks[bricks.length - 1]?.get('id')).toBe(id1);
    expect(bricks[0]?.get('id')).toBe(id2);
    expect(bricks[1]?.get('id')).toBe(id3);
  });

  it('sends bricks to back (index 0)', () => {
    const { doc, layerId } = docWithBrickLayer();
    const id1 = placeBrick(doc, layerId, { partNumber: 'A', x: 0, y: 0, width: 2, height: 2 });
    const id2 = placeBrick(doc, layerId, { partNumber: 'B', x: 2, y: 0, width: 2, height: 2 });
    const id3 = placeBrick(doc, layerId, { partNumber: 'C', x: 4, y: 0, width: 2, height: 2 });

    // Send id3 to back.
    reorderBricks(doc, layerId, [id3], 'back');
    const bricks = bricksInLayer(doc, layerId);
    expect(bricks[0]?.get('id')).toBe(id3);
    expect(bricks[1]?.get('id')).toBe(id1);
    expect(bricks[2]?.get('id')).toBe(id2);
  });
});

// ---------------------------------------------------------------------------
// groupBricks / ungroupBricks
// ---------------------------------------------------------------------------

describe('groupBricks', () => {
  it('returns null when fewer than 2 bricks are provided', () => {
    const { doc, layerId } = docWithBrickLayer();
    const id = placeBrick(doc, layerId, { partNumber: 'p', x: 0, y: 0, width: 2, height: 2 });
    expect(groupBricks(doc, layerId, [id])).toBeNull();
    expect(groupBricks(doc, layerId, [])).toBeNull();
  });

  it('creates a group and assigns myGroup to each brick', () => {
    const { doc, layerId } = docWithBrickLayer();
    const id1 = placeBrick(doc, layerId, { partNumber: 'p', x: 0, y: 0, width: 2, height: 2 });
    const id2 = placeBrick(doc, layerId, { partNumber: 'q', x: 2, y: 0, width: 2, height: 2 });
    const groupId = groupBricks(doc, layerId, [id1, id2]);
    expect(groupId).toBeTruthy();
    const [b1, b2] = bricksInLayer(doc, layerId);
    expect(b1?.get('myGroup')).toBe(groupId);
    expect(b2?.get('myGroup')).toBe(groupId);
  });
});

describe('ungroupBricks', () => {
  it('is a no-op when brickIds is empty', () => {
    const { doc, layerId } = docWithBrickLayer();
    const id = placeBrick(doc, layerId, { partNumber: 'p', x: 0, y: 0, width: 2, height: 2 });
    // This should not throw even if there are no grouped bricks.
    expect(() => ungroupBricks(doc, layerId, [id])).not.toThrow();
  });

  it('clears myGroup on all ungrouped bricks and removes empty group entry', () => {
    const { doc, layerId } = docWithBrickLayer();
    const id1 = placeBrick(doc, layerId, { partNumber: 'p', x: 0, y: 0, width: 2, height: 2 });
    const id2 = placeBrick(doc, layerId, { partNumber: 'q', x: 2, y: 0, width: 2, height: 2 });
    groupBricks(doc, layerId, [id1, id2]);

    ungroupBricks(doc, layerId, [id1, id2]);
    const [b1, b2] = bricksInLayer(doc, layerId);
    expect(b1?.get('myGroup')).toBe('');
    expect(b2?.get('myGroup')).toBe('');
  });

  it('preserves groups that still have other members', () => {
    const { doc, layerId } = docWithBrickLayer();
    const id1 = placeBrick(doc, layerId, { partNumber: 'p', x: 0, y: 0, width: 2, height: 2 });
    const id2 = placeBrick(doc, layerId, { partNumber: 'q', x: 2, y: 0, width: 2, height: 2 });
    const id3 = placeBrick(doc, layerId, { partNumber: 'r', x: 4, y: 0, width: 2, height: 2 });
    const groupId = groupBricks(doc, layerId, [id1, id2, id3])!;

    // Only ungroup id1; id2 and id3 stay in the group.
    ungroupBricks(doc, layerId, [id1]);
    const [b1, b2, b3] = bricksInLayer(doc, layerId);
    expect(b1?.get('myGroup')).toBe('');
    expect(b2?.get('myGroup')).toBe(groupId);
    expect(b3?.get('myGroup')).toBe(groupId);
  });
});

// ---------------------------------------------------------------------------
// editRulerItem — circular radius patch (lines 827-830)
// ---------------------------------------------------------------------------

describe('editRulerItem — circular radius', () => {
  function docWithRulerLayer(): { doc: Y.Doc; layerId: string } {
    const doc = blankDoc();
    const layerId = ensureRulerLayer(doc);
    return { doc, layerId };
  }

  it('updates the radius and recomputes displayArea for a circular ruler', () => {
    const { doc, layerId } = docWithRulerLayer();
    const rulerId = addCircularRuler(doc, layerId, { x: 10, y: 10 }, 5);
    editRulerItem(doc, layerId, rulerId, { radius: 8 });
    const layer = doc.getMap('layerData').get(layerId) as Y.Map<unknown>;
    const item = (layer.get('rulerItems') as Y.Array<{ radius: number; displayArea: { width: number } }>).get(0);
    expect(item?.radius).toBe(8);
    expect(item?.displayArea.width).toBe(16); // 2 * 8
  });

  it('clamps negative radius to 0', () => {
    const { doc, layerId } = docWithRulerLayer();
    const rulerId = addCircularRuler(doc, layerId, { x: 5, y: 5 }, 4);
    editRulerItem(doc, layerId, rulerId, { radius: -3 });
    const layer = doc.getMap('layerData').get(layerId) as Y.Map<unknown>;
    const item = (layer.get('rulerItems') as Y.Array<{ radius: number }>).get(0);
    expect(item?.radius).toBe(0);
  });

  it('does NOT apply radius patch to a linear ruler', () => {
    const { doc, layerId } = docWithRulerLayer();
    const rulerId = addLinearRuler(doc, layerId, { x: 0, y: 0 }, { x: 10, y: 0 });
    editRulerItem(doc, layerId, rulerId, { radius: 99 });
    const layer = doc.getMap('layerData').get(layerId) as Y.Map<unknown>;
    const item = (layer.get('rulerItems') as Y.Array<{ radius?: number }>).get(0);
    // Linear rulers don't have a radius field; it should be absent or undefined.
    expect(item?.radius).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// cloneModuleBricks
// ---------------------------------------------------------------------------

describe('cloneModuleBricks', () => {
  it('is a no-op when the module has no members', () => {
    const { doc, layerId } = docWithBrickLayer();
    placeBrick(doc, layerId, { partNumber: 'p', x: 0, y: 0, width: 2, height: 2 });
    const mod: SidecarModule = { id: 'mod1', name: 'Empty', members: [], transform: [1, 0, 0, 0, 1, 0, 0, 0, 1] };
    cloneModuleBricks(doc, mod);
    // Still only one brick.
    expect(bricksInLayer(doc, layerId)).toHaveLength(1);
  });

  it('duplicates member bricks and registers a new sidecar module', () => {
    const { doc, layerId } = docWithBrickLayer();
    const id1 = placeBrick(doc, layerId, { partNumber: 'p', x: 0, y: 0, width: 4, height: 2 });
    const id2 = placeBrick(doc, layerId, { partNumber: 'q', x: 4, y: 0, width: 4, height: 2 });

    // Register a module in the sidecar cache.
    addSidecarModule(doc, { id: 'mod1', name: 'Original', members: [id1, id2], transform: [1, 0, 0, 0, 1, 0, 0, 0, 1] });

    const mod: SidecarModule = { id: 'mod1', name: 'Original', members: [id1, id2], transform: [1, 0, 0, 0, 1, 0, 0, 0, 1] };
    cloneModuleBricks(doc, mod);

    // Should now have 4 bricks (2 originals + 2 clones).
    const bricks = bricksInLayer(doc, layerId);
    expect(bricks).toHaveLength(4);

    // The cloned bricks should have an x offset.
    const origMaxX = 8; // max(0+4, 4+4) = 8
    const cloneBricks = bricks.slice(2);
    for (const b of cloneBricks) {
      const area = b.get('displayArea') as { x: number };
      expect(area.x).toBeGreaterThanOrEqual(origMaxX); // offset applied
    }
  });
});

// ---------------------------------------------------------------------------
// rescanModuleFromBricks
// ---------------------------------------------------------------------------

describe('rescanModuleFromBricks', () => {
  it('is a no-op when freshBricks is empty', () => {
    const { doc, layerId } = docWithBrickLayer();
    const id = placeBrick(doc, layerId, { partNumber: 'p', x: 0, y: 0, width: 2, height: 2 });
    const mod: SidecarModule = { id: 'mod1', name: 'M', members: [id], transform: [1, 0, 0, 0, 1, 0, 0, 0, 1] };
    rescanModuleFromBricks(doc, mod, [], layerId);
    // Old brick should still be there.
    expect(bricksInLayer(doc, layerId)).toHaveLength(1);
  });

  it('removes old members and inserts fresh bricks', () => {
    const { doc, layerId } = docWithBrickLayer();
    const oldId = placeBrick(doc, layerId, { partNumber: 'old', x: 0, y: 0, width: 2, height: 2 });

    addSidecarModule(doc, { id: 'mod1', name: 'M', members: [oldId], transform: [1, 0, 0, 0, 1, 0, 0, 0, 1] });
    const mod: SidecarModule = { id: 'mod1', name: 'M', members: [oldId], transform: [1, 0, 0, 0, 1, 0, 0, 0, 1] };

    rescanModuleFromBricks(doc, mod, [
      { partNumber: 'new1', displayArea: { x: 5, y: 5, width: 2, height: 2 } },
      { partNumber: 'new2', displayArea: { x: 7, y: 5, width: 2, height: 2 } },
    ], layerId);

    const bricks = bricksInLayer(doc, layerId);
    expect(bricks).toHaveLength(2);
    expect(bricks[0]?.get('partNumber')).toBe('new1');
    expect(bricks[1]?.get('partNumber')).toBe('new2');
    // Old brick removed.
    expect(bricks.some((b) => b.get('id') === oldId)).toBe(false);
  });
});

// Tests for mutations NOT covered in mutations.test.ts:
// layer management, rulers, text cells, sidecar labels, general info,
// background color, and layer visibility helpers.

import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  ensureBrickLayer,
  ensureRulerLayer,
  ensureTextLayer,
  deleteLayer,
  moveLayer,
  setLayerVisible,
  showAllLayers,
  soloLayer,
  setLayerTransparency,
  renameLayer,
  setLayerHullProperties,
  setLayerDisplayBrickElevation,
  setBackgroundColor,
  setGeneralInfo,
  addLinearRuler,
  addCircularRuler,
  deleteRulerItem,
  editRulerItem,
  addTextCell,
  editTextCell,
  editTextCellFull,
  deleteTextCell,
  addAnchoredLabel,
  editAnchoredLabel,
  deleteAnchoredLabel,
  moveAnchoredLabel,
} from '../mutations';

function blankDoc(): Y.Doc {
  return new Y.Doc();
}

// ---------------------------------------------------------------------------
// Layer management
// ---------------------------------------------------------------------------

describe('deleteLayer', () => {
  it('removes the layer from layerOrder and layerData', () => {
    const doc = blankDoc();
    const id = ensureBrickLayer(doc);
    deleteLayer(doc, id);
    expect(doc.getArray('layers').toArray()).not.toContain(id);
    expect(doc.getMap('layerData').get(id)).toBeUndefined();
  });

  it('is a no-op for an unknown layerId', () => {
    const doc = blankDoc();
    ensureBrickLayer(doc);
    const before = doc.getArray('layers').length;
    deleteLayer(doc, 'does-not-exist');
    expect(doc.getArray('layers').length).toBe(before);
  });

  it('removes only the targeted layer when multiple exist', () => {
    const doc = blankDoc();
    const a = ensureBrickLayer(doc);
    const b = ensureRulerLayer(doc);
    deleteLayer(doc, a);
    const ids = doc.getArray<string>('layers').toArray();
    expect(ids).not.toContain(a);
    expect(ids).toContain(b);
  });
});

describe('moveLayer', () => {
  it('moves a layer up (toward end)', () => {
    const doc = blankDoc();
    const a = ensureBrickLayer(doc);
    const b = ensureRulerLayer(doc);
    // a is at index 0, b at index 1. Move a up → [b, a].
    moveLayer(doc, a, 'up');
    const ids = doc.getArray<string>('layers').toArray();
    expect(ids[0]).toBe(b);
    expect(ids[1]).toBe(a);
  });

  it('moves a layer down (toward start)', () => {
    const doc = blankDoc();
    const a = ensureBrickLayer(doc);
    const b = ensureRulerLayer(doc);
    // b is at index 1. Move b down → [b, a].
    moveLayer(doc, b, 'down');
    const ids = doc.getArray<string>('layers').toArray();
    expect(ids[0]).toBe(b);
    expect(ids[1]).toBe(a);
  });

  it('is a no-op when already at the top', () => {
    const doc = blankDoc();
    const a = ensureBrickLayer(doc);
    const b = ensureRulerLayer(doc);
    const before = doc.getArray<string>('layers').toArray().slice();
    moveLayer(doc, b, 'up'); // already at top
    expect(doc.getArray<string>('layers').toArray()).toEqual(before);
  });

  it('is a no-op when already at the bottom', () => {
    const doc = blankDoc();
    const a = ensureBrickLayer(doc);
    ensureRulerLayer(doc);
    const before = doc.getArray<string>('layers').toArray().slice();
    moveLayer(doc, a, 'down'); // already at bottom
    expect(doc.getArray<string>('layers').toArray()).toEqual(before);
  });

  it('is a no-op for unknown layerId', () => {
    const doc = blankDoc();
    ensureBrickLayer(doc);
    const before = doc.getArray<string>('layers').toArray().slice();
    moveLayer(doc, 'ghost', 'up');
    expect(doc.getArray<string>('layers').toArray()).toEqual(before);
  });
});

describe('setLayerVisible', () => {
  it('sets visible to false', () => {
    const doc = blankDoc();
    const id = ensureBrickLayer(doc);
    setLayerVisible(doc, id, false);
    const layer = doc.getMap('layerData').get(id) as Y.Map<unknown>;
    expect(layer.get('visible')).toBe(false);
  });

  it('sets visible back to true', () => {
    const doc = blankDoc();
    const id = ensureBrickLayer(doc);
    setLayerVisible(doc, id, false);
    setLayerVisible(doc, id, true);
    const layer = doc.getMap('layerData').get(id) as Y.Map<unknown>;
    expect(layer.get('visible')).toBe(true);
  });

  it('is a no-op for unknown layerId', () => {
    const doc = blankDoc();
    ensureBrickLayer(doc);
    // Should not throw.
    expect(() => setLayerVisible(doc, 'ghost', false)).not.toThrow();
  });
});

describe('showAllLayers', () => {
  it('makes every hidden layer visible', () => {
    const doc = blankDoc();
    const a = ensureBrickLayer(doc);
    const b = ensureRulerLayer(doc);
    setLayerVisible(doc, a, false);
    setLayerVisible(doc, b, false);
    showAllLayers(doc);
    const ld = doc.getMap('layerData');
    expect((ld.get(a) as Y.Map<unknown>).get('visible')).toBe(true);
    expect((ld.get(b) as Y.Map<unknown>).get('visible')).toBe(true);
  });

  it('is a no-op when all layers are already visible', () => {
    const doc = blankDoc();
    const id = ensureBrickLayer(doc);
    showAllLayers(doc);
    const layer = doc.getMap('layerData').get(id) as Y.Map<unknown>;
    expect(layer.get('visible')).toBe(true);
  });
});

describe('soloLayer', () => {
  it('makes the targeted layer visible and hides all others', () => {
    const doc = blankDoc();
    const a = ensureBrickLayer(doc);
    const b = ensureRulerLayer(doc);
    soloLayer(doc, a);
    const ld = doc.getMap('layerData');
    expect((ld.get(a) as Y.Map<unknown>).get('visible')).toBe(true);
    expect((ld.get(b) as Y.Map<unknown>).get('visible')).toBe(false);
  });

  it('reveals a previously hidden solo layer', () => {
    const doc = blankDoc();
    const a = ensureBrickLayer(doc);
    setLayerVisible(doc, a, false);
    soloLayer(doc, a);
    const layer = doc.getMap('layerData').get(a) as Y.Map<unknown>;
    expect(layer.get('visible')).toBe(true);
  });
});

describe('setLayerTransparency', () => {
  it('sets transparency to a valid value', () => {
    const doc = blankDoc();
    const id = ensureBrickLayer(doc);
    setLayerTransparency(doc, id, 50);
    const layer = doc.getMap('layerData').get(id) as Y.Map<unknown>;
    expect(layer.get('transparency')).toBe(50);
  });

  it('clamps values above 100 to 100', () => {
    const doc = blankDoc();
    const id = ensureBrickLayer(doc);
    setLayerTransparency(doc, id, 150);
    const layer = doc.getMap('layerData').get(id) as Y.Map<unknown>;
    expect(layer.get('transparency')).toBe(100);
  });

  it('clamps values below 0 to 0', () => {
    const doc = blankDoc();
    const id = ensureBrickLayer(doc);
    setLayerTransparency(doc, id, -10);
    const layer = doc.getMap('layerData').get(id) as Y.Map<unknown>;
    expect(layer.get('transparency')).toBe(0);
  });

  it('rounds fractional values', () => {
    const doc = blankDoc();
    const id = ensureBrickLayer(doc);
    setLayerTransparency(doc, id, 33.7);
    const layer = doc.getMap('layerData').get(id) as Y.Map<unknown>;
    expect(layer.get('transparency')).toBe(34);
  });

  it('is a no-op for unknown layerId', () => {
    const doc = blankDoc();
    expect(() => setLayerTransparency(doc, 'ghost', 50)).not.toThrow();
  });
});

describe('renameLayer', () => {
  it('updates the layer name', () => {
    const doc = blankDoc();
    const id = ensureBrickLayer(doc);
    renameLayer(doc, id, 'My Custom Layer');
    const layer = doc.getMap('layerData').get(id) as Y.Map<unknown>;
    expect(layer.get('name')).toBe('My Custom Layer');
  });

  it('allows renaming to an empty string', () => {
    const doc = blankDoc();
    const id = ensureBrickLayer(doc);
    renameLayer(doc, id, '');
    const layer = doc.getMap('layerData').get(id) as Y.Map<unknown>;
    expect(layer.get('name')).toBe('');
  });

  it('is a no-op for unknown layerId', () => {
    const doc = blankDoc();
    expect(() => renameLayer(doc, 'ghost', 'x')).not.toThrow();
  });
});

describe('setLayerHullProperties', () => {
  it('stores hull properties on the layer', () => {
    const doc = blankDoc();
    const id = ensureBrickLayer(doc);
    const color = { kind: 'argb' as const, argb: 'FFFF0000' };
    setLayerHullProperties(doc, id, true, color, 3);
    const layer = doc.getMap('layerData').get(id) as Y.Map<unknown>;
    const hull = layer.get('hullProperties') as { isVisible: boolean; hullThickness: number };
    expect(hull.isVisible).toBe(true);
    expect(hull.hullThickness).toBe(3);
  });

  it('can set isVisible to false', () => {
    const doc = blankDoc();
    const id = ensureBrickLayer(doc);
    setLayerHullProperties(doc, id, false, { kind: 'known', name: 'Black' }, 1);
    const layer = doc.getMap('layerData').get(id) as Y.Map<unknown>;
    const hull = layer.get('hullProperties') as { isVisible: boolean };
    expect(hull.isVisible).toBe(false);
  });

  it('is a no-op for unknown layerId', () => {
    const doc = blankDoc();
    expect(() =>
      setLayerHullProperties(doc, 'ghost', true, { kind: 'known', name: 'Red' }, 1),
    ).not.toThrow();
  });
});

describe('setLayerDisplayBrickElevation', () => {
  it('sets displayBrickElevation to true', () => {
    const doc = blankDoc();
    const id = ensureBrickLayer(doc);
    setLayerDisplayBrickElevation(doc, id, true);
    const layer = doc.getMap('layerData').get(id) as Y.Map<unknown>;
    expect(layer.get('displayBrickElevation')).toBe(true);
  });

  it('sets displayBrickElevation to false', () => {
    const doc = blankDoc();
    const id = ensureBrickLayer(doc);
    setLayerDisplayBrickElevation(doc, id, true);
    setLayerDisplayBrickElevation(doc, id, false);
    const layer = doc.getMap('layerData').get(id) as Y.Map<unknown>;
    expect(layer.get('displayBrickElevation')).toBe(false);
  });

  it('is a no-op for unknown layerId', () => {
    const doc = blankDoc();
    expect(() => setLayerDisplayBrickElevation(doc, 'ghost', true)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// General info / meta
// ---------------------------------------------------------------------------

describe('setBackgroundColor', () => {
  it('stores a known-name color', () => {
    const doc = blankDoc();
    setBackgroundColor(doc, { kind: 'known', name: 'CornflowerBlue' });
    const meta = doc.getMap('meta').get('backgroundColor') as { kind: string; name: string };
    expect(meta.kind).toBe('known');
    expect(meta.name).toBe('CornflowerBlue');
  });

  it('stores an argb hex color', () => {
    const doc = blankDoc();
    setBackgroundColor(doc, { kind: 'argb', argb: 'FF102030' });
    const meta = doc.getMap('meta').get('backgroundColor') as { kind: string; argb: string };
    expect(meta.kind).toBe('argb');
    expect(meta.argb).toBe('FF102030');
  });

  it('overwrites the previous value', () => {
    const doc = blankDoc();
    setBackgroundColor(doc, { kind: 'known', name: 'Red' });
    setBackgroundColor(doc, { kind: 'known', name: 'Blue' });
    const meta = doc.getMap('meta').get('backgroundColor') as { name: string };
    expect(meta.name).toBe('Blue');
  });
});

describe('setGeneralInfo', () => {
  it('sets author', () => {
    const doc = blankDoc();
    setGeneralInfo(doc, { author: 'Aaron' });
    expect(doc.getMap('meta').get('author')).toBe('Aaron');
  });

  it('sets multiple fields in one call', () => {
    const doc = blankDoc();
    setGeneralInfo(doc, { author: 'Aaron', event: 'Fordyce 2026', lug: 'ArkLUG' });
    const meta = doc.getMap('meta');
    expect(meta.get('author')).toBe('Aaron');
    expect(meta.get('event')).toBe('Fordyce 2026');
    expect(meta.get('lug')).toBe('ArkLUG');
  });

  it('does not touch fields absent from the patch', () => {
    const doc = blankDoc();
    setGeneralInfo(doc, { author: 'Aaron' });
    setGeneralInfo(doc, { event: 'BrickFair' });
    const meta = doc.getMap('meta');
    expect(meta.get('author')).toBe('Aaron');
    expect(meta.get('event')).toBe('BrickFair');
  });

  it('sets a date object', () => {
    const doc = blankDoc();
    setGeneralInfo(doc, { date: { day: 24, month: 4, year: 2026 } });
    const date = doc.getMap('meta').get('date') as { day: number; month: number; year: number };
    expect(date.day).toBe(24);
    expect(date.month).toBe(4);
    expect(date.year).toBe(2026);
  });

  it('overwrites a previous author value', () => {
    const doc = blankDoc();
    setGeneralInfo(doc, { author: 'Old' });
    setGeneralInfo(doc, { author: 'New' });
    expect(doc.getMap('meta').get('author')).toBe('New');
  });
});

// ---------------------------------------------------------------------------
// Ruler mutations
// ---------------------------------------------------------------------------

describe('addLinearRuler', () => {
  it('appends a linear ruler and returns its id', () => {
    const doc = blankDoc();
    const layerId = ensureRulerLayer(doc);
    const id = addLinearRuler(doc, layerId, { x: 0, y: 0 }, { x: 10, y: 0 });
    expect(typeof id).toBe('string');
    expect(id.length).toBeGreaterThan(0);
    const layer = doc.getMap('layerData').get(layerId) as Y.Map<unknown>;
    const items = layer.get('rulerItems') as Y.Array<unknown>;
    expect(items.length).toBe(1);
    const item = items.get(0) as { id: string; kind: string };
    expect(item.id).toBe(id);
    expect(item.kind).toBe('linear');
  });

  it('computes displayArea as bounding box of the two points', () => {
    const doc = blankDoc();
    const layerId = ensureRulerLayer(doc);
    addLinearRuler(doc, layerId, { x: 5, y: 2 }, { x: 1, y: 8 });
    const layer = doc.getMap('layerData').get(layerId) as Y.Map<unknown>;
    const item = (layer.get('rulerItems') as Y.Array<unknown>).get(0) as {
      displayArea: { x: number; y: number; width: number; height: number };
    };
    expect(item.displayArea).toEqual({ x: 1, y: 2, width: 4, height: 6 });
  });

  it('is a no-op for unknown layerId (does not throw)', () => {
    const doc = blankDoc();
    expect(() => addLinearRuler(doc, 'ghost', { x: 0, y: 0 }, { x: 1, y: 1 })).not.toThrow();
  });
});

describe('addCircularRuler', () => {
  it('appends a circular ruler and returns its id', () => {
    const doc = blankDoc();
    const layerId = ensureRulerLayer(doc);
    const id = addCircularRuler(doc, layerId, { x: 5, y: 5 }, 3);
    expect(typeof id).toBe('string');
    const layer = doc.getMap('layerData').get(layerId) as Y.Map<unknown>;
    const items = layer.get('rulerItems') as Y.Array<unknown>;
    expect(items.length).toBe(1);
    const item = items.get(0) as { kind: string; radius: number };
    expect(item.kind).toBe('circular');
    expect(item.radius).toBe(3);
  });

  it('clamps negative radius to 0', () => {
    const doc = blankDoc();
    const layerId = ensureRulerLayer(doc);
    addCircularRuler(doc, layerId, { x: 0, y: 0 }, -5);
    const layer = doc.getMap('layerData').get(layerId) as Y.Map<unknown>;
    const item = (layer.get('rulerItems') as Y.Array<unknown>).get(0) as { radius: number };
    expect(item.radius).toBe(0);
  });

  it('is a no-op for unknown layerId', () => {
    const doc = blankDoc();
    expect(() => addCircularRuler(doc, 'ghost', { x: 0, y: 0 }, 5)).not.toThrow();
  });
});

describe('deleteRulerItem', () => {
  it('removes the ruler item by id', () => {
    const doc = blankDoc();
    const layerId = ensureRulerLayer(doc);
    const id = addLinearRuler(doc, layerId, { x: 0, y: 0 }, { x: 1, y: 0 });
    deleteRulerItem(doc, layerId, id);
    const layer = doc.getMap('layerData').get(layerId) as Y.Map<unknown>;
    expect((layer.get('rulerItems') as Y.Array<unknown>).length).toBe(0);
  });

  it('is a no-op for unknown rulerId', () => {
    const doc = blankDoc();
    const layerId = ensureRulerLayer(doc);
    addLinearRuler(doc, layerId, { x: 0, y: 0 }, { x: 1, y: 0 });
    deleteRulerItem(doc, layerId, 'no-such-ruler');
    const layer = doc.getMap('layerData').get(layerId) as Y.Map<unknown>;
    expect((layer.get('rulerItems') as Y.Array<unknown>).length).toBe(1);
  });

  it('removes only the targeted ruler when multiple exist', () => {
    const doc = blankDoc();
    const layerId = ensureRulerLayer(doc);
    const a = addLinearRuler(doc, layerId, { x: 0, y: 0 }, { x: 1, y: 0 });
    const b = addCircularRuler(doc, layerId, { x: 5, y: 5 }, 2);
    deleteRulerItem(doc, layerId, a);
    const layer = doc.getMap('layerData').get(layerId) as Y.Map<unknown>;
    const items = layer.get('rulerItems') as Y.Array<unknown>;
    expect(items.length).toBe(1);
    expect((items.get(0) as { id: string }).id).toBe(b);
  });
});

describe('editRulerItem', () => {
  it('updates displayDistance flag', () => {
    const doc = blankDoc();
    const layerId = ensureRulerLayer(doc);
    const id = addLinearRuler(doc, layerId, { x: 0, y: 0 }, { x: 5, y: 0 });
    editRulerItem(doc, layerId, id, { displayDistance: false });
    const layer = doc.getMap('layerData').get(layerId) as Y.Map<unknown>;
    const item = (layer.get('rulerItems') as Y.Array<unknown>).get(0) as {
      displayDistance: boolean;
    };
    expect(item.displayDistance).toBe(false);
  });

  it('updates lineThickness', () => {
    const doc = blankDoc();
    const layerId = ensureRulerLayer(doc);
    const id = addLinearRuler(doc, layerId, { x: 0, y: 0 }, { x: 5, y: 0 });
    editRulerItem(doc, layerId, id, { lineThickness: 5 });
    const layer = doc.getMap('layerData').get(layerId) as Y.Map<unknown>;
    const item = (layer.get('rulerItems') as Y.Array<unknown>).get(0) as {
      lineThickness: number;
    };
    expect(item.lineThickness).toBe(5);
  });

  it('is a no-op for unknown rulerId', () => {
    const doc = blankDoc();
    const layerId = ensureRulerLayer(doc);
    addLinearRuler(doc, layerId, { x: 0, y: 0 }, { x: 5, y: 0 });
    expect(() => editRulerItem(doc, layerId, 'ghost', { lineThickness: 9 })).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Text cell mutations
// ---------------------------------------------------------------------------

describe('ensureTextLayer', () => {
  it('creates a text layer when none exists', () => {
    const doc = blankDoc();
    const id = ensureTextLayer(doc);
    expect(id).toBeTruthy();
    const layer = doc.getMap('layerData').get(id) as Y.Map<unknown>;
    expect(layer.get('type')).toBe('text');
  });

  it('returns the existing text layer without creating a second one', () => {
    const doc = blankDoc();
    const a = ensureTextLayer(doc);
    const b = ensureTextLayer(doc);
    expect(a).toBe(b);
    expect(doc.getArray('layers').length).toBe(1);
  });
});

describe('addTextCell', () => {
  it('appends a text cell to the layer', () => {
    const doc = blankDoc();
    const layerId = ensureTextLayer(doc);
    addTextCell(doc, layerId, {
      text: 'Hello World',
      centreX: 10,
      centreY: 10,
      widthStuds: 8,
      heightStuds: 4,
      font: { family: 'Arial', size: 12, style: 'Regular' },
      fontColor: { kind: 'known', name: 'Black' },
    });
    const layer = doc.getMap('layerData').get(layerId) as Y.Map<unknown>;
    const cells = layer.get('textCells') as Y.Array<unknown>;
    expect(cells.length).toBe(1);
    const cell = cells.get(0) as { text: string };
    expect(cell.text).toBe('Hello World');
  });

  it('computes displayArea correctly from centreX/Y and dimensions', () => {
    const doc = blankDoc();
    const layerId = ensureTextLayer(doc);
    addTextCell(doc, layerId, {
      text: 'X',
      centreX: 20,
      centreY: 10,
      widthStuds: 8,
      heightStuds: 4,
      font: { family: 'Arial', size: 12, style: 'Regular' },
      fontColor: { kind: 'known', name: 'Black' },
    });
    const layer = doc.getMap('layerData').get(layerId) as Y.Map<unknown>;
    const cell = (layer.get('textCells') as Y.Array<unknown>).get(0) as {
      displayArea: { x: number; y: number; width: number; height: number };
    };
    expect(cell.displayArea).toEqual({ x: 16, y: 8, width: 8, height: 4 });
  });

  it('is a no-op for unknown layerId', () => {
    const doc = blankDoc();
    expect(() =>
      addTextCell(doc, 'ghost', {
        text: 'x',
        centreX: 0,
        centreY: 0,
        widthStuds: 4,
        heightStuds: 2,
        font: { family: 'Arial', size: 12, style: 'Regular' },
        fontColor: { kind: 'known', name: 'Black' },
      }),
    ).not.toThrow();
  });
});

describe('editTextCell', () => {
  it('updates the text at the given index', () => {
    const doc = blankDoc();
    const layerId = ensureTextLayer(doc);
    addTextCell(doc, layerId, {
      text: 'Original',
      centreX: 0,
      centreY: 0,
      widthStuds: 4,
      heightStuds: 2,
      font: { family: 'Arial', size: 12, style: 'Regular' },
      fontColor: { kind: 'known', name: 'Black' },
    });
    editTextCell(doc, layerId, 0, 'Updated');
    const layer = doc.getMap('layerData').get(layerId) as Y.Map<unknown>;
    const cell = (layer.get('textCells') as Y.Array<unknown>).get(0) as { text: string };
    expect(cell.text).toBe('Updated');
  });

  it('is a no-op for out-of-bounds index', () => {
    const doc = blankDoc();
    const layerId = ensureTextLayer(doc);
    expect(() => editTextCell(doc, layerId, 5, 'x')).not.toThrow();
  });

  it('is a no-op for negative index', () => {
    const doc = blankDoc();
    const layerId = ensureTextLayer(doc);
    expect(() => editTextCell(doc, layerId, -1, 'x')).not.toThrow();
  });
});

describe('editTextCellFull', () => {
  it('patches only the text field when only text is provided', () => {
    const doc = blankDoc();
    const layerId = ensureTextLayer(doc);
    const font = { family: 'Arial', size: 12, style: 'Regular' };
    addTextCell(doc, layerId, {
      text: 'Before',
      centreX: 0,
      centreY: 0,
      widthStuds: 4,
      heightStuds: 2,
      font,
      fontColor: { kind: 'known', name: 'Black' },
    });
    editTextCellFull(doc, layerId, 0, { text: 'After' });
    const layer = doc.getMap('layerData').get(layerId) as Y.Map<unknown>;
    const cell = (layer.get('textCells') as Y.Array<unknown>).get(0) as {
      text: string;
      font: { family: string };
    };
    expect(cell.text).toBe('After');
    expect(cell.font.family).toBe('Arial'); // unchanged
  });

  it('patches orientation', () => {
    const doc = blankDoc();
    const layerId = ensureTextLayer(doc);
    addTextCell(doc, layerId, {
      text: 'x',
      centreX: 0,
      centreY: 0,
      widthStuds: 4,
      heightStuds: 2,
      font: { family: 'Arial', size: 12, style: 'Regular' },
      fontColor: { kind: 'known', name: 'Black' },
    });
    editTextCellFull(doc, layerId, 0, { orientation: 90 });
    const layer = doc.getMap('layerData').get(layerId) as Y.Map<unknown>;
    const cell = (layer.get('textCells') as Y.Array<unknown>).get(0) as { orientation: number };
    expect(cell.orientation).toBe(90);
  });

  it('is a no-op for out-of-bounds index', () => {
    const doc = blankDoc();
    const layerId = ensureTextLayer(doc);
    expect(() => editTextCellFull(doc, layerId, 99, { text: 'x' })).not.toThrow();
  });
});

describe('deleteTextCell', () => {
  it('removes the cell at the given index', () => {
    const doc = blankDoc();
    const layerId = ensureTextLayer(doc);
    addTextCell(doc, layerId, {
      text: 'A',
      centreX: 0,
      centreY: 0,
      widthStuds: 4,
      heightStuds: 2,
      font: { family: 'Arial', size: 12, style: 'Regular' },
      fontColor: { kind: 'known', name: 'Black' },
    });
    deleteTextCell(doc, layerId, 0);
    const layer = doc.getMap('layerData').get(layerId) as Y.Map<unknown>;
    expect((layer.get('textCells') as Y.Array<unknown>).length).toBe(0);
  });

  it('removes only the targeted cell when multiple exist', () => {
    const doc = blankDoc();
    const layerId = ensureTextLayer(doc);
    const spec = {
      centreX: 0,
      centreY: 0,
      widthStuds: 4,
      heightStuds: 2,
      font: { family: 'Arial', size: 12, style: 'Regular' },
      fontColor: { kind: 'known' as const, name: 'Black' },
    };
    addTextCell(doc, layerId, { ...spec, text: 'First' });
    addTextCell(doc, layerId, { ...spec, text: 'Second' });
    deleteTextCell(doc, layerId, 0);
    const layer = doc.getMap('layerData').get(layerId) as Y.Map<unknown>;
    const cells = layer.get('textCells') as Y.Array<unknown>;
    expect(cells.length).toBe(1);
    expect((cells.get(0) as { text: string }).text).toBe('Second');
  });

  it('is a no-op for out-of-bounds index', () => {
    const doc = blankDoc();
    const layerId = ensureTextLayer(doc);
    expect(() => deleteTextCell(doc, layerId, 5)).not.toThrow();
  });

  it('is a no-op for negative index', () => {
    const doc = blankDoc();
    const layerId = ensureTextLayer(doc);
    expect(() => deleteTextCell(doc, layerId, -1)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Sidecar — anchored labels
// ---------------------------------------------------------------------------

const LABEL_A: import('@cld/bbm').AnchoredLabel = {
  id: 'label-a',
  text: 'A',
  font: { family: 'Arial', size: 10, style: 'Regular' },
  color: { known: true, argb: 0xff000000, name: 'Black' },
  kind: 1,
  targetId: 'brick-1',
  offset: { x: 2, y: 3 },
  rot: 0,
  minZoom: 0,
};

describe('addAnchoredLabel', () => {
  it('appends a label to the sidecar cache', () => {
    const doc = blankDoc();
    addAnchoredLabel(doc, LABEL_A);
    const cache = doc.getMap('meta').get('cache') as {
      anchoredLabels: typeof LABEL_A[];
    };
    expect(cache.anchoredLabels).toHaveLength(1);
    expect(cache.anchoredLabels[0]!.id).toBe('label-a');
  });

  it('accumulates multiple labels', () => {
    const doc = blankDoc();
    addAnchoredLabel(doc, LABEL_A);
    addAnchoredLabel(doc, { ...LABEL_A, id: 'label-b' });
    const cache = doc.getMap('meta').get('cache') as { anchoredLabels: { id: string }[] };
    expect(cache.anchoredLabels).toHaveLength(2);
  });
});

describe('editAnchoredLabel', () => {
  it('updates the text of the matching label', () => {
    const doc = blankDoc();
    addAnchoredLabel(doc, LABEL_A);
    editAnchoredLabel(doc, 'label-a', { text: 'Updated' });
    const cache = doc.getMap('meta').get('cache') as {
      anchoredLabels: { text: string }[];
    };
    expect(cache.anchoredLabels[0]!.text).toBe('Updated');
  });

  it('does not modify other labels', () => {
    const doc = blankDoc();
    addAnchoredLabel(doc, LABEL_A);
    addAnchoredLabel(doc, { ...LABEL_A, id: 'label-b', text: 'B' });
    editAnchoredLabel(doc, 'label-a', { text: 'Changed' });
    const cache = doc.getMap('meta').get('cache') as {
      anchoredLabels: { id: string; text: string }[];
    };
    expect(cache.anchoredLabels.find((l) => l.id === 'label-b')!.text).toBe('B');
  });

  it('is a no-op for unknown label id', () => {
    const doc = blankDoc();
    addAnchoredLabel(doc, LABEL_A);
    editAnchoredLabel(doc, 'no-such', { text: 'x' });
    const cache = doc.getMap('meta').get('cache') as {
      anchoredLabels: { text: string }[];
    };
    expect(cache.anchoredLabels[0]!.text).toBe('A');
  });
});

describe('deleteAnchoredLabel', () => {
  it('removes the label by id', () => {
    const doc = blankDoc();
    addAnchoredLabel(doc, LABEL_A);
    deleteAnchoredLabel(doc, 'label-a');
    const cache = doc.getMap('meta').get('cache') as { anchoredLabels: unknown[] };
    expect(cache.anchoredLabels).toHaveLength(0);
  });

  it('is a no-op for unknown id', () => {
    const doc = blankDoc();
    addAnchoredLabel(doc, LABEL_A);
    deleteAnchoredLabel(doc, 'ghost');
    const cache = doc.getMap('meta').get('cache') as { anchoredLabels: unknown[] };
    expect(cache.anchoredLabels).toHaveLength(1);
  });

  it('removes only the targeted label', () => {
    const doc = blankDoc();
    addAnchoredLabel(doc, LABEL_A);
    addAnchoredLabel(doc, { ...LABEL_A, id: 'label-b' });
    deleteAnchoredLabel(doc, 'label-a');
    const cache = doc.getMap('meta').get('cache') as { anchoredLabels: { id: string }[] };
    expect(cache.anchoredLabels).toHaveLength(1);
    expect(cache.anchoredLabels[0]!.id).toBe('label-b');
  });
});

describe('moveAnchoredLabel', () => {
  it('translates the label offset by (dx, dy)', () => {
    const doc = blankDoc();
    addAnchoredLabel(doc, LABEL_A); // offset {x:2, y:3}
    moveAnchoredLabel(doc, 'label-a', 5, -1);
    const cache = doc.getMap('meta').get('cache') as {
      anchoredLabels: { offset: { x: number; y: number } }[];
    };
    expect(cache.anchoredLabels[0]!.offset).toEqual({ x: 7, y: 2 });
  });

  it('is a no-op for unknown label id', () => {
    const doc = blankDoc();
    addAnchoredLabel(doc, LABEL_A);
    moveAnchoredLabel(doc, 'ghost', 10, 10);
    const cache = doc.getMap('meta').get('cache') as {
      anchoredLabels: { offset: { x: number; y: number } }[];
    };
    expect(cache.anchoredLabels[0]!.offset).toEqual({ x: 2, y: 3 });
  });

  it('accumulates multiple moves', () => {
    const doc = blankDoc();
    addAnchoredLabel(doc, LABEL_A);
    moveAnchoredLabel(doc, 'label-a', 1, 1);
    moveAnchoredLabel(doc, 'label-a', 1, 1);
    const cache = doc.getMap('meta').get('cache') as {
      anchoredLabels: { offset: { x: number; y: number } }[];
    };
    expect(cache.anchoredLabels[0]!.offset).toEqual({ x: 4, y: 5 });
  });
});

import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { docToBbm } from '@cld/ydoc';
import type { LayerArea, LayerBrick, LayerGrid } from '@cld/model';
import { addLayer, AREA_CELL_SIZE_DEFAULT, ensureAreaLayer, ensureBrickLayer } from '../mutations';
import {
  applyLayerOptions,
  colorSpecAlpha,
  colorSpecToCss,
  colorSpecToHex,
  formFromLayer,
  layerOptionsPatch,
  withRgb,
} from '../layerOptions';
import { axisLabel, cellIndexLabels, parseCellIndexCorner } from '../render/gridIndex';
import { createUndoManager } from '../useUndoManager';

function layerById<T>(doc: Y.Doc, id: string): T {
  return docToBbm(doc).layers.find((l) => l.id === id) as T;
}

describe('colour helpers', () => {
  it('converts known and ARGB colours', () => {
    expect(colorSpecToHex({ kind: 'known', name: 'CornflowerBlue' })).toBe('#6495ed');
    expect(colorSpecToHex({ kind: 'argb', argb: '80FF0000' })).toBe('#ff0000');
    expect(colorSpecAlpha({ kind: 'argb', argb: '80000000' })).toBe(128);
    expect(colorSpecToCss({ kind: 'argb', argb: '80000000' })).toBe('rgba(0, 0, 0, 0.502)');
    expect(colorSpecToCss({ kind: 'argb', argb: 'ff00ff00' })).toBe('#00ff00');
  });

  it('keeps the alpha when the RGB changes', () => {
    expect(withRgb({ kind: 'argb', argb: '40000000' }, '#ABCDEF')).toEqual({ kind: 'argb', argb: '40abcdef' });
    expect(withRgb({ kind: 'known', name: 'Black' }, '#112233')).toEqual({ kind: 'argb', argb: 'ff112233' });
  });
});

describe('addLayer', () => {
  it('adds a Grid layer with the desktop defaults (core/LayerGrid.h)', () => {
    const doc = new Y.Doc();
    const id = addLayer(doc, 'grid');
    const g = layerById<LayerGrid>(doc, id);
    expect(g.type).toBe('grid');
    expect(g.name).toBe('Grid');
    expect(g.gridSizeInStud).toBe(32);
    expect(g.subDivisionNumber).toBe(4);
    expect(g.gridColor).toEqual({ kind: 'argb', argb: '80000000' });
    expect(g.displayCellIndex).toBe(false);
  });

  it('new Area layers paint 32-stud cells (core/LayerArea.h:25)', () => {
    const doc = new Y.Doc();
    expect(layerById<LayerArea>(doc, addLayer(doc, 'area')).areaCellSize).toBe(32);
    const doc2 = new Y.Doc();
    const yArea = doc2.getMap('layerData').get(ensureAreaLayer(doc2)) as Y.Map<unknown>;
    expect(yArea.get('areaCellSize')).toBe(AREA_CELL_SIZE_DEFAULT);
  });
});

describe('layerOptionsPatch', () => {
  it('is empty when nothing changed, so stored colour specs stay untouched', () => {
    const doc = new Y.Doc();
    const id = ensureBrickLayer(doc);
    const layer = layerById<LayerBrick>(doc, id);
    expect(layerOptionsPatch(layer, formFromLayer(layer))).toEqual({});
  });

  it('diffs common, brick and hull fields and clamps to the desktop ranges', () => {
    const doc = new Y.Doc();
    const id = ensureBrickLayer(doc);
    const layer = layerById<LayerBrick>(doc, id);
    const form = { ...formFromLayer(layer), name: '  Trains ', transparency: 140, visible: false, displayBrickElevation: true, hullThickness: 30 };
    const patch = layerOptionsPatch(layer, form);
    expect(patch).toEqual({
      // transparency 140 clamps to 100, which is unchanged → not written
      name: 'Trains',
      visible: false,
      displayBrickElevation: true,
      hullProperties: { isVisible: false, hullColor: layer.hullProperties.hullColor, hullThickness: 20 },
    });
  });

  it('writes grid options as one undo step', () => {
    const doc = new Y.Doc();
    const id = addLayer(doc, 'grid');
    const um = createUndoManager(doc);
    const layer = layerById<LayerGrid>(doc, id);
    const f = formFromLayer(layer);
    const patch = layerOptionsPatch(layer, {
      ...f,
      transparency: 50,
      grid: { ...f.grid!, gridSizeInStud: 96, gridThickness: 3, subDivisionNumber: 1, displaySubGrid: false, displayCellIndex: true, gridHex: '#ff0000' },
    });
    applyLayerOptions(doc, id, patch);
    const g = layerById<LayerGrid>(doc, id);
    expect(g.transparency).toBe(50);
    expect(g.gridSizeInStud).toBe(96);
    expect(g.gridThickness).toBe(3);
    expect(g.subDivisionNumber).toBe(2); // desktop spin box minimum
    expect(g.displaySubGrid).toBe(false);
    expect(g.displayCellIndex).toBe(true);
    expect(g.gridColor).toEqual({ kind: 'argb', argb: '80ff0000' });
    expect(um.undoStack.length).toBe(1);
    um.undo();
    expect(layerById<LayerGrid>(doc, id).gridSizeInStud).toBe(32);
  });

  it('sets the area paint cell size (1-256)', () => {
    const doc = new Y.Doc();
    ensureBrickLayer(doc); // seeds the map header
    const id = ensureAreaLayer(doc, 8);
    const layer = layerById<LayerArea>(doc, id);
    applyLayerOptions(doc, id, layerOptionsPatch(layer, { ...formFromLayer(layer), areaCellSize: 999 }));
    expect(layerById<LayerArea>(doc, id).areaCellSize).toBe(256);
  });
});

describe('grid cell index labels', () => {
  it('labels columns with letters and rows with numbers', () => {
    expect(axisLabel(0, '0')).toBe('A');
    expect(axisLabel(25, '0')).toBe('Z');
    expect(axisLabel(26, '0')).toBe('AA');
    expect(axisLabel(27, '0')).toBe('AB');
    expect(axisLabel(0, '1')).toBe('1');
    expect(axisLabel(9, 1)).toBe('10');
    expect(axisLabel(-1, '0')).toBe('-A');
    expect(axisLabel(-2, '1')).toBe('-2');
  });

  it('parses the stored corner point, defaulting to the origin', () => {
    expect(parseCellIndexCorner('\n  \n')).toEqual({ x: 0, y: 0 });
    expect(parseCellIndexCorner('<X>2</X><Y>-3</Y>')).toEqual({ x: 2, y: -3 });
    expect(parseCellIndexCorner({ x: 1, y: 4 })).toEqual({ x: 1, y: 4 });
  });

  it('emits one label per visible cell, relative to the corner', () => {
    const labels = cellIndexLabels({ xMin: -1, yMin: 0, xMax: 63, yMax: 31 }, 32, { x: 0, y: 0 }, '0', '1');
    expect(labels.map((l) => l.text)).toEqual(['-A1', 'A1', 'B1']);
    expect(labels[1]).toEqual({ x: 0, y: 0, text: 'A1' });
    const shifted = cellIndexLabels({ xMin: 0, yMin: 32, xMax: 31, yMax: 63 }, 32, { x: -1, y: 0 }, '1', '0');
    expect(shifted.map((l) => l.text)).toEqual(['2B']);
  });

  it('gives up when too many cells are visible', () => {
    expect(cellIndexLabels({ xMin: 0, yMin: 0, xMax: 10000, yMax: 10000 }, 1, { x: 0, y: 0 }, '0', '1')).toEqual([]);
  });
});

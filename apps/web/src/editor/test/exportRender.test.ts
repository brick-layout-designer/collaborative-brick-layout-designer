import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { docToBbm, readSidecarFromDoc } from '@cld/ydoc';
import {
  addAnchoredLabel,
  addLayer,
  ensureAreaLayer,
  ensureBrickLayer,
  ensureTextLayer,
  addTextCell,
  paintAreaCells,
  placeBrick,
  setLayerVisible,
  setVenue,
} from '../mutations';
import { clampPixelRatio, contentBoundsStuds, MAX_CANVAS_SIDE } from '../exportRender';

describe('contentBoundsStuds', () => {
  it('is null for an empty map', () => {
    const doc = new Y.Doc();
    ensureBrickLayer(doc);
    expect(contentBoundsStuds(docToBbm(doc))).toBeNull();
  });

  it('spans bricks, text, painted areas, world labels and the venue, not the viewport', () => {
    const doc = new Y.Doc();
    const l = ensureBrickLayer(doc);
    placeBrick(doc, l, { partNumber: 'p', x: -100, y: 10, width: 4, height: 2 });
    placeBrick(doc, l, { partNumber: 'p', x: 50, y: 0, width: 8, height: 8 });
    const t = ensureTextLayer(doc);
    addTextCell(doc, t, {
      centreX: 0, centreY: 200, widthStuds: 10, heightStuds: 4, text: 'hi',
      font: { family: 'Arial', size: 12, style: 'Regular' }, fontColor: { kind: 'argb', argb: 'FF000000' }, orientation: 0,
    });
    const a = ensureAreaLayer(doc, 8);
    paintAreaCells(doc, a, [{ x: 10, y: -3, color: 'FFFF0000' }]); // cell size 8 → (80,-24)-(88,-16)
    addAnchoredLabel(doc, {
      id: 'l', text: 'x', font: { family: 'Arial', size: 10, style: '' }, color: { known: true, argb: 0, name: 'Black' },
      kind: 0, targetId: '', offset: { x: 120, y: 5 }, rot: 0, minZoom: 0,
    });
    setVenue(doc, {
      name: '', enabled: true, minWalkwayStuds: 0, bounds: { x: 0, y: 0, w: 0, h: 0 },
      edges: [{ kind: 'wall', doorWidthStuds: 0, label: '', poly: [{ x: 0, y: -40 }, { x: 10, y: -40 }] }] as never,
      obstacles: [],
    });
    const b = contentBoundsStuds(docToBbm(doc), readSidecarFromDoc(doc))!;
    expect(b.x).toBe(-100);
    expect(b.y).toBe(-40);
    expect(b.x + b.width).toBe(120);
    expect(b.y + b.height).toBe(202);
  });

  it('ignores hidden layers', () => {
    const doc = new Y.Doc();
    const l = ensureBrickLayer(doc);
    const l2 = addLayer(doc, 'brick');
    placeBrick(doc, l, { partNumber: 'p', x: 0, y: 0, width: 1, height: 1 });
    placeBrick(doc, l2, { partNumber: 'p', x: 500, y: 0, width: 1, height: 1 });
    setLayerVisible(doc, l2, false);
    expect(contentBoundsStuds(docToBbm(doc))).toEqual({ x: 0, y: 0, width: 1, height: 1 });
  });
});

describe('clampPixelRatio', () => {
  it('keeps the requested ratio when it fits', () => {
    expect(clampPixelRatio(1000, 800, 2)).toBe(2);
  });
  it('shrinks to the per-side canvas limit', () => {
    const r = clampPixelRatio(20000, 100, 2);
    expect(20000 * r).toBeLessThanOrEqual(MAX_CANVAS_SIDE + 1e-6);
  });
});

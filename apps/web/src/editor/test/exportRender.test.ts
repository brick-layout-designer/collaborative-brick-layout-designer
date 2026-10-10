import { afterEach, describe, expect, it, vi } from 'vitest';
import type Konva from 'konva';
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
import { aspectHeight, exportBackground, clampExportSize, clampPixelRatio, contentBoundsStuds, exportSceneSize, MAX_CANVAS_SIDE, renderMapToCanvas } from '../exportRender';

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

  it('counts Group/Module labels at their world offset, not Brick labels', () => {
    const doc = new Y.Doc();
    const l = ensureBrickLayer(doc);
    placeBrick(doc, l, { partNumber: 'p', x: 0, y: 0, width: 1, height: 1 });
    const base = { font: { family: 'Arial', size: 10, style: '' }, color: { known: true, argb: 0, name: 'Black' }, rot: 0, minZoom: 0, text: 'x' };
    addAnchoredLabel(doc, { ...base, id: 'g', kind: 2, targetId: 'grp', offset: { x: 40, y: 0 } });
    addAnchoredLabel(doc, { ...base, id: 'm', kind: 3, targetId: 'mod', offset: { x: 0, y: 30 } });
    addAnchoredLabel(doc, { ...base, id: 'b', kind: 1, targetId: 'x', offset: { x: 900, y: 900 } });
    expect(contentBoundsStuds(docToBbm(doc), readSidecarFromDoc(doc))).toEqual({ x: 0, y: 0, width: 40, height: 30 });
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

describe('explicit export size', () => {
  it('keeps the map aspect for an auto height, min 64 px (desktop keepAspect)', () => {
    expect(aspectHeight(1600, { width: 800, height: 400 })).toBe(800);
    expect(aspectHeight(100, { width: 1000, height: 10 })).toBe(64);
  });
  it('clamps to the canvas limits, keeping the ratio', () => {
    expect(clampExportSize(1600.4, 1200.6)).toEqual({ width: 1600, height: 1201 });
    const big = clampExportSize(40000, 20000);
    expect(big.width).toBeLessThanOrEqual(MAX_CANVAS_SIDE);
    expect(big.width / big.height).toBeCloseTo(2, 2);
  });
  it('reports the 1x scene size including the 20 px margin', () => {
    const doc = new Y.Doc();
    const l = ensureBrickLayer(doc);
    placeBrick(doc, l, { partNumber: 'p', x: 0, y: 0, width: 10, height: 5 });
    expect(exportSceneSize(docToBbm(doc))).toEqual({ width: 120, height: 80 });
  });
});

describe('renderMapToCanvas output size and antialias', () => {
  afterEach(() => vi.restoreAllMocks());

  function setup() {
    const doc = new Y.Doc();
    const l = ensureBrickLayer(doc);
    placeBrick(doc, l, { partNumber: 'p', x: 0, y: 0, width: 10, height: 5 }); // scene 120 × 80 px
    const content = document.createElement('canvas');
    content.width = 120;
    content.height = 80;
    const toCanvas = vi.fn((cfg: { pixelRatio: number }) => {
      content.width = Math.round(120 * cfg.pixelRatio);
      content.height = Math.round(80 * cfg.pixelRatio);
      return content;
    });
    let x = 0, y = 0, sx = 1, sy = 1;
    const stage = {
      x: () => x, y: () => y, scaleX: () => sx, scaleY: () => sy,
      scale: (v: { x: number; y: number }) => { sx = v.x; sy = v.y; },
      position: (p: { x: number; y: number }) => { x = p.x; y = p.y; },
      find: () => [],
      toCanvas,
      batchDraw: () => {},
    } as unknown as Konva.Stage;
    const ctx = { imageSmoothingEnabled: true, fillRect: vi.fn(), drawImage: vi.fn(), fillText: vi.fn(), fillStyle: '', font: '', textAlign: '', textBaseline: '' };
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as unknown as CanvasRenderingContext2D);
    return { map: docToBbm(doc), stage, toCanvas, ctx };
  }

  it('renders into the exact requested size, stretching when the aspect differs', () => {
    const { map, stage, toCanvas, ctx } = setup();
    const out = renderMapToCanvas(stage, map, null, { pixelRatio: 1, transparent: false, size: { width: 600, height: 100 } })!;
    expect([out.canvas.width, out.canvas.height]).toEqual([600, 100]);
    // Rendered at the larger axis scale (600/120 = 5), then resampled.
    expect(toCanvas).toHaveBeenCalledWith(expect.objectContaining({ pixelRatio: 5, imageSmoothingEnabled: true }));
    expect(ctx.drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, 600, 100);
    expect(ctx.fillRect).toHaveBeenCalledWith(0, 0, 600, 100);
    // The stage view is restored.
    expect([stage.x(), stage.y(), stage.scaleX()]).toEqual([0, 0, 1]);
  });

  it('turns image smoothing off when antialias is off, and skips the background when transparent', () => {
    const { map, stage, toCanvas, ctx } = setup();
    renderMapToCanvas(stage, map, null, { pixelRatio: 2, transparent: true, antialias: false });
    expect(toCanvas).toHaveBeenCalledWith(expect.objectContaining({ pixelRatio: 2, imageSmoothingEnabled: false }));
    expect(ctx.imageSmoothingEnabled).toBe(false);
    expect(ctx.fillRect).not.toHaveBeenCalled();
  });

  it('renders just a print tile region, even past the content', () => {
    const { map, stage, toCanvas } = setup();
    let pos = { x: 0, y: 0 };
    const origPosition = stage.position.bind(stage);
    (stage as unknown as { position: (p: { x: number; y: number }) => void }).position = (p) => {
      if (toCanvas.mock.calls.length === 0) pos = p;
      origPosition(p);
    };
    renderMapToCanvas(stage, map, null, { pixelRatio: 3, transparent: false, regionStuds: { x: 100, y: -4, width: 20, height: 10 } });
    expect(pos).toEqual({ x: -800, y: 32 });
    expect(toCanvas).toHaveBeenCalledWith(expect.objectContaining({ x: 0, y: 0, width: 160, height: 80, pixelRatio: 3 }));
  });

  it('stamps the watermark bottom-right in QColor(0,0,0,140)', () => {
    const { map, stage, ctx } = setup();
    renderMapToCanvas(stage, map, null, { pixelRatio: 1, transparent: false, size: { width: 600, height: 600 }, watermark: 'a / b / c' });
    expect(ctx.fillText).toHaveBeenCalledWith('a / b / c', 590, 590);
    expect(ctx.fillStyle).toBe('rgba(0,0,0,0.549)');
    expect(ctx.font).toBe(`${(10 * 96) / 72}px sans-serif`);
  });
});

describe('exportBackground', () => {
  it('paints the layout color, including names outside the old 11-color table', () => {
    expect(exportBackground({ backgroundColor: { kind: 'known', name: 'CornflowerBlue' } })).toBe('#6495ed');
    expect(exportBackground({ backgroundColor: { kind: 'known', name: 'Cornsilk' } })).toBe('#fff8dc');
    expect(exportBackground({ backgroundColor: { kind: 'known', name: 'DarkOliveGreen' } })).toBe('#556b2f');
  });

  it('keeps the background alpha and resolves unknown names to black like desktop', () => {
    expect(exportBackground({ backgroundColor: { kind: 'argb', argb: '806495ed' } })).toBe('rgba(100, 149, 237, 0.502)');
    expect(exportBackground({ backgroundColor: { kind: 'known', name: 'Control' } })).toBe('#000000');
    expect(exportBackground({ backgroundColor: { kind: 'known', name: 'Transparent' } })).toBe('rgba(0, 0, 0, 0)');
  });
});

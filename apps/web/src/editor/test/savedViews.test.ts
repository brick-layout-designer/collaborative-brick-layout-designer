// Saved views: the fit maths, the sheet filter, the live doc and
// "Export all views" (savedViews.ts, references/LAYOUT-FILE.md).

import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { docToBbm, readSidecarFromDoc } from '@cld/ydoc';
import type { SavedView } from '@cld/bbm';
import { readZip } from '../../bbmFiles';
import { paintCellIndices, paintGridLines } from '../exportRender';
import {
  addAnchoredLabel,
  addLayer,
  addSavedView,
  createSidecarModule,
  deleteSavedView,
  ensureBrickLayer,
  placeBrick,
  readSavedViews,
  setLayerVisible,
  updateSavedView,
} from '../mutations';
import {
  VIEW_FIT_MARGIN_STUDS as M,
  WHOLE_LAYOUT,
  applyViewSheets,
  exportAllViews,
  fitRegionStuds,
  newView,
  pictureFileName,
  pictureSize,
  scaleForSide,
  shareScale,
  viewRegionStuds,
  type PictureRenderer,
} from '../savedViews';

/** Two brick sheets: track at (0,0)-(10,10), buildings at (100,50)-(120,60). */
function twoSheets() {
  const doc = new Y.Doc();
  const track = ensureBrickLayer(doc);
  const town = addLayer(doc, 'brick');
  placeBrick(doc, track, { partNumber: 'p', x: 0, y: 0, width: 10, height: 10 });
  placeBrick(doc, town, { partNumber: 'p', x: 100, y: 50, width: 20, height: 10 });
  return { doc, track, town };
}

const view = (over: Partial<SavedView>): SavedView => ({ ...newView('v', 'V'), ...over });

describe('fit the whole layout with module names', () => {
  // Bold text about 0.6 em per letter, the same in every run.
  const measure = (text: string) => (fontPx: number) => text.length * fontPx * 0.6;
  const names = { percent: 10, measure };
  const withModule = (name: string) => {
    const { doc, track, town } = twoSheets();
    const id = docToBbm(doc).layers.find((l) => l.id === town)!;
    const brick = (id as { bricks: { id: string }[] }).bricks[0]!.id;
    createSidecarModule(doc, name, [brick]);
    return { doc, track, town };
  };

  it('takes in the name above a wide module', () => {
    const { doc, town } = withModule('Town');
    // The town brick is 20 x 10 studs at (100, 50); its frame is half a
    // stud out, and the 16 px name sits 16 px above that.
    expect(fitRegionStuds(docToBbm(doc), readSidecarFromDoc(doc), [town], true, names)).toEqual({
      x: 99.5 - M,
      y: 45.5 - M,
      width: 21 + 2 * M,
      height: 15 + 2 * M,
    });
  });

  it('takes in a name longer than its module, centred on it', () => {
    const { doc, town } = withModule('A very long module name');
    const r = fitRegionStuds(docToBbm(doc), readSidecarFromDoc(doc), [town], true, names)!;
    expect(r.x).toBeCloseTo(96.0625 - M);
    expect(r.width).toBeCloseTo(223 / 8 + 2 * M);
  });

  it('leaves the names out when they are hidden, or their sheet is', () => {
    const { doc, town, track } = withModule('Town');
    expect(fitRegionStuds(docToBbm(doc), readSidecarFromDoc(doc), [town], true, null)).toEqual({ x: 100 - M, y: 50 - M, width: 20 + 2 * M, height: 10 + 2 * M });
    expect(fitRegionStuds(docToBbm(doc), readSidecarFromDoc(doc), [track], true, names)).toEqual({ x: -M, y: -M, width: 10 + 2 * M, height: 10 + 2 * M });
  });
});

describe('fit the whole layout', () => {
  it('is the bounds of every shown sheet plus the margin', () => {
    const { doc } = twoSheets();
    expect(fitRegionStuds(docToBbm(doc), null, null, true)).toEqual({ x: -M, y: -M, width: 120 + 2 * M, height: 60 + 2 * M });
  });

  it('counts only the view’s sheets', () => {
    const { doc, town } = twoSheets();
    expect(fitRegionStuds(docToBbm(doc), null, [town], true)).toEqual({ x: 100 - M, y: 50 - M, width: 20 + 2 * M, height: 10 + 2 * M });
  });

  it('shows a sheet the view lists even when the layout hides it, and null follows the layout', () => {
    const { doc, track, town } = twoSheets();
    setLayerVisible(doc, town, false);
    const map = docToBbm(doc);
    expect(fitRegionStuds(map, null, null, true)).toEqual({ x: -M, y: -M, width: 10 + 2 * M, height: 10 + 2 * M });
    expect(fitRegionStuds(map, null, [town], true)!.x).toBe(100 - M);
    const shown = applyViewSheets(map, [town]);
    expect(shown.layers.find((l) => l.id === town)!.visible).toBe(true);
    expect(shown.layers.find((l) => l.id === track)!.visible).toBe(false);
    // Nothing to change: the same map comes back.
    expect(applyViewSheets(map, null)).toBe(map);
  });

  it('takes in world labels only when labels show, and never the room', () => {
    const { doc } = twoSheets();
    addAnchoredLabel(doc, {
      id: 'l', text: 'x', font: { family: 'Arial', size: 10, style: '' }, color: { known: true, argb: 0, name: 'Black' },
      kind: 0, targetId: '', offset: { x: 200, y: 0 }, rot: 0, minZoom: 0,
    });
    const map = docToBbm(doc);
    const sidecar = readSidecarFromDoc(doc);
    expect(fitRegionStuds(map, sidecar, null, true)!.width).toBe(200 + 2 * M);
    expect(fitRegionStuds(map, sidecar, null, false)!.width).toBe(120 + 2 * M);
  });

  it('is null when nothing is drawn on the view’s sheets', () => {
    const { doc } = twoSheets();
    expect(fitRegionStuds(docToBbm(doc), null, ['no-such-sheet'], true)).toBeNull();
  });

  it('a view with an area uses its area; fit or no area works it out', () => {
    const { doc } = twoSheets();
    const map = docToBbm(doc);
    const rect = { x: 5, y: 6, w: 30, h: 20 };
    expect(viewRegionStuds(view({ fit: false, rect }), map, null)).toEqual({ x: 5, y: 6, width: 30, height: 20 });
    expect(viewRegionStuds(view({ fit: true, rect }), map, null)!.width).toBe(120 + 2 * M);
    expect(viewRegionStuds(view({ fit: false, rect: null }), map, null)!.width).toBe(120 + 2 * M);
  });
});

describe('picture sizes and names', () => {
  it('8 px per stud times the scale, and a smaller scale for huge layouts when sharing', () => {
    expect(pictureSize({ x: 0, y: 0, width: 100, height: 50 }, 2)).toEqual({ width: 1600, height: 800 });
    expect(shareScale({ x: 0, y: 0, width: 100, height: 50 })).toBe(2);
    expect(shareScale({ x: 0, y: 0, width: 640, height: 50 })).toBe(0.5); // 2560 px across at most
  });

  it('sizes a picture by its longest side, never past 32 px per stud', () => {
    // A big layout shrinks to fit: 1000 studs across is 8000 px at 1x.
    expect(scaleForSide({ x: 0, y: 0, width: 1000, height: 400 }, 2560)).toBeCloseTo(0.32);
    expect(scaleForSide({ x: 0, y: 0, width: 400, height: 1000 }, 2560)).toBeCloseTo(0.32);
    // A small corner stops at 4x (the parts' own detail).
    expect(scaleForSide({ x: 0, y: 0, width: 20, height: 10 }, 2560)).toBe(4);
  });

  it('names pictures <layout> - <view>.png, safe as a file name', () => {
    expect(pictureFileName('Fordyce 2026', 'Station / yard')).toBe('Fordyce 2026 - Station _ yard.png');
  });
});

describe('views in the live doc', () => {
  it('adds, changes one view without touching the others, and deletes', () => {
    const { doc } = twoSheets();
    addSavedView(doc, newView('a', 'Station'));
    addSavedView(doc, newView('b', 'Yard'));
    updateSavedView(doc, 'a', { fit: false, rect: { x: 1, y: 2, w: 3, h: 4 }, name: 'Main station' });
    let views = readSavedViews(doc);
    expect(views.map((v) => v.name)).toEqual(['Main station', 'Yard']);
    expect(views[0]).toMatchObject({ fit: false, rect: { x: 1, y: 2, w: 3, h: 4 } });
    expect(views[1]).toEqual(newView('b', 'Yard'));
    deleteSavedView(doc, 'a');
    views = readSavedViews(doc);
    expect(views.map((v) => v.id)).toEqual(['b']);
    // They sit in the sidecar, beside the rest of it.
    expect(readSidecarFromDoc(doc)!.views).toEqual(views);
  });

  it('a new view fits the whole layout, all sheets, labels on', () => {
    expect(newView('x', '  ')).toEqual({ id: 'x', name: 'View', fit: true, rect: null, sheets: null, grid: false, labels: true });
  });
});

/** A PNG holding only its IHDR: enough for anything that reads the size. */
function fakePng(width: number, height: number): Uint8Array {
  const b = new Uint8Array(24);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  new DataView(b.buffer).setUint32(16, width);
  new DataView(b.buffer).setUint32(20, height);
  return b;
}
const pngSize = (b: Uint8Array) => ({ width: new DataView(b.buffer, b.byteOffset).getUint32(16), height: new DataView(b.buffer, b.byteOffset).getUint32(20) });

describe('export all views', () => {
  const render: PictureRenderer = async (_spec, size) => ({ ...size, data: fakePng(size.width, size.height) });

  it('makes one picture per view, each at most the chosen size across, in one zip', async () => {
    const { doc, town } = twoSheets();
    const views = [
      newView('a', 'Whole'),
      view({ id: 'b', name: 'Station', fit: false, rect: { x: 0, y: 0, w: 40, h: 25 } }),
      view({ id: 'c', name: 'Town', sheets: [town] }),
    ];
    const progress: string[] = [];
    const out = await exportAllViews({ title: 'Show', views, map: docToBbm(doc), sidecar: null, maxSide: 1280, render, onProgress: (d, t) => progress.push(`${d}/${t}`) });
    expect(out.filename).toBe('Show - views.zip');
    expect(out.skipped).toEqual([]);
    const entries = await readZip(out.data);
    expect(entries.map((e) => e.name)).toEqual(['Show - Whole.png', 'Show - Station.png', 'Show - Town.png']);
    const wholeK = 1280 / ((120 + 2 * M) * 8);
    expect(entries.map((e) => pngSize(e.data))).toEqual([
      { width: 1280, height: Math.round((60 + 2 * M) * 8 * wholeK) },
      { width: 40 * 32, height: 25 * 32 }, // 1280 across is exactly 4x
      { width: (20 + 2 * M) * 32, height: (10 + 2 * M) * 32 }, // capped at 4x
    ]);
    expect(progress).toEqual(['0/3', '1/3', '2/3']);
  });

  it('with no saved views makes one "Whole layout" picture', async () => {
    const { doc } = twoSheets();
    const out = await exportAllViews({ title: 'Show', views: [], map: docToBbm(doc), sidecar: null, maxSide: 1280, render });
    expect(out.files).toEqual([`Show - ${WHOLE_LAYOUT.name}.png`]);
  });

  it('keeps two views with the same name apart, and leaves out a view with nothing to show', async () => {
    const { doc } = twoSheets();
    const views = [newView('a', 'Yard'), newView('b', 'Yard'), view({ id: 'c', name: 'Empty', sheets: [] })];
    const out = await exportAllViews({ title: 'Show', views, map: docToBbm(doc), sidecar: null, maxSide: 1280, render });
    expect(out.files).toEqual(['Show - Yard.png', 'Show - Yard (2).png']);
    expect(out.skipped).toEqual(['Empty']);
  });
});

describe('the grid in a picture', () => {
  it('paints the main lines on whole cells across the region, scaled to the picture', () => {
    const moves: [number, number][] = [];
    const ctx = { strokeStyle: '' as unknown, lineWidth: 0, beginPath() {}, stroke() {}, lineTo() {}, moveTo: (x: number, y: number) => void moves.push([x, y]) };
    const grid = { gridSizeInStud: 32, gridThickness: 1, gridColor: { kind: 'known', name: 'Black' }, displayGrid: true, displaySubGrid: false } as never;
    const n = paintGridLines(ctx, grid, { x: -4, y: 0, width: 72, height: 32 }, 2);
    // Columns at 0, 32, 64 studs; rows at 0 and 32.
    expect(n).toBe(5);
    expect(moves).toEqual([[8, 0], [72, 0], [136, 0], [0, 0], [0, 64]]);
  });

  it('paints the cell indices along the origin row and column, centred in their cells, as BlueBrick exports them', () => {
    const texts: [string, number, number][] = [];
    const ctx = {
      font: '', fillStyle: '' as unknown, textAlign: '', textBaseline: '',
      save() {}, restore() {},
      measureText: () => ({ fontBoundingBoxAscent: 10, fontBoundingBoxDescent: 2 }),
      fillText: (t: string, x: number, y: number) => void texts.push([t, x, y]),
    } as unknown as CanvasRenderingContext2D;
    const grid = {
      gridSizeInStud: 32, displayCellIndex: true, cellIndexCorner: { x: 0, y: 0 }, cellIndexColumnType: 0, cellIndexRowType: 1,
      cellIndexFont: { family: 'Arial', size: 18, style: 'Regular' }, cellIndexColor: { kind: 'known', name: 'Black' },
    } as never;
    expect(paintCellIndices(ctx, grid, { x: 0, y: 0, width: 64, height: 64 }, 2)).toBeGreaterThan(0);
    // Cell (1,0) is A, cell (0,1) is 1 (the origin stays blank), centred and lifted by (ascent - descent) / 2.
    expect(texts).toContainEqual(['A', 96, 36]);
    expect(texts).toContainEqual(['1', 32, 100]);
    expect(ctx.font).toContain('BLD Map Sans');
  });
});

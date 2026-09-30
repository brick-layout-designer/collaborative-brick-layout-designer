// Fit to View like desktop MainWindow::onFitToView (MainWindow.cpp:1372-1376).

import { describe, expect, it } from 'vitest';
import type { BbmMap } from '@cld/model';
import { contentBoundsStuds } from '../exportRender';
import { fitView, isUntouchedFit, withGridLabels } from '../viewFit';

const range = { min: 0.02, max: 40 };

describe('fitView', () => {
  it('fits the bounds plus 50 scene px, aspect kept, centred', () => {
    // 100 x 50 studs = 800 x 400 px, + 100 px margin = 900 x 500.
    const fit = fitView({ x: 0, y: 0, width: 100, height: 50 }, 904, 1004, range)!;
    expect(fit.zoom).toBeCloseTo(1, 6); // (904 - 4) / 900
    // The bounds' centre (400, 200) px lands on the view centre.
    expect(400 * fit.zoom + fit.panX).toBeCloseTo(452);
    expect(200 * fit.zoom + fit.panY).toBeCloseTo(502);
  });

  it('clamps to the zoom range and gives up on nothing to fit', () => {
    // A tiny box still carries the 100 px margin: about 6x, inside the range.
    expect(fitView({ x: 0, y: 0, width: 0.001, height: 0.001 }, 800, 600, range)!.zoom).toBeCloseTo(596 / 100.016, 3);
    // A huge one clamps to the smallest zoom.
    expect(fitView({ x: 0, y: 0, width: 1e7, height: 1e7 }, 800, 600, range)!.zoom).toBe(0.02);
    expect(fitView(null, 800, 600, range)).toBeNull();
  });

  it('covers text, rulers, areas and the venue, not only bricks', () => {
    const map = {
      layers: [
        { type: 'text', visible: true, textCells: [{ displayArea: { x: 500, y: 300, width: 20, height: 10 } }] },
        { type: 'brick', visible: true, bricks: [] },
      ],
    } as unknown as BbmMap;
    expect(contentBoundsStuds(map, null)).toEqual({ x: 500, y: 300, width: 20, height: 10 });
    const venue = { edges: [{ poly: [{ x: -10, y: -10 }, { x: 0, y: 0 }] }], obstacles: [] };
    expect(contentBoundsStuds(map, { venue } as never)).toEqual({ x: -10, y: -10, width: 530, height: 320 });
  });
});

describe('phone fit', () => {
  const grid = {
    type: 'grid',
    visible: true,
    displayCellIndex: true,
    gridSizeInStud: 96,
    cellIndexCorner: { x: -1, y: -1 },
  } as unknown as import('@cld/model').LayerGrid;

  it('keeps clear of the insets and centres in what is left', () => {
    // 100 x 50 studs + margin = 900 x 500 px; the view is 924 x 1100 with
    // 12 px sides and a 64 px bottom for the scale card: 900 px wide left.
    const insets = { top: 12, right: 12, bottom: 64, left: 12 };
    const fit = fitView({ x: 0, y: 0, width: 100, height: 50 }, 924, 1100, range, insets)!;
    expect(fit.zoom).toBeCloseTo(1, 6);
    // Centre of the bounds lands on the centre of the inset area.
    expect(400 * fit.zoom + fit.panX).toBeCloseTo(12 + 900 / 2);
    expect(200 * fit.zoom + fit.panY).toBeCloseTo(12 + (1100 - 76) / 2);
    // Bounds edges (with the 50 px margin) stay inside the insets.
    expect(-50 * fit.zoom + fit.panX).toBeGreaterThanOrEqual(12 - 1e-9);
    expect(850 * fit.zoom + fit.panX).toBeLessThanOrEqual(924 - 12 + 1e-9);
  });

  it('takes in the grid label row and column next to the content', () => {
    // Content from (10, 10) to (500, 300); labels in row -1 and column -1
    // (cells of 96 studs): the box grows to start at -96.
    const b = withGridLabels({ x: 10, y: 10, width: 490, height: 290 }, grid)!;
    expect(b).toEqual({ x: -96, y: -96, width: 596, height: 396 });
  });

  it('leaves labels out when hidden, turned off, or far from the content', () => {
    const bounds = { x: 10, y: 10, width: 490, height: 290 };
    expect(withGridLabels(bounds, { ...grid, displayCellIndex: false })).toEqual(bounds);
    expect(withGridLabels(bounds, { ...grid, visible: false })).toEqual(bounds);
    expect(withGridLabels(bounds, null)).toEqual(bounds);
    // Origin 20 cells away: not worth shrinking the layout for.
    expect(withGridLabels(bounds, { ...grid, cellIndexCorner: { x: -20, y: -20 } } as never)).toEqual(bounds);
    expect(withGridLabels(null, grid)).toBeNull();
  });

  it('refits only while the view is still the last automatic fit', () => {
    const last = { zoom: 0.04, panX: 12.5, panY: -30 };
    expect(isUntouchedFit({ ...last }, last)).toBe(true);
    expect(isUntouchedFit({ ...last, panX: 13.5 }, last)).toBe(false);
    expect(isUntouchedFit({ ...last, zoom: 0.05 }, last)).toBe(false);
    expect(isUntouchedFit(last, null)).toBe(false);
  });
});

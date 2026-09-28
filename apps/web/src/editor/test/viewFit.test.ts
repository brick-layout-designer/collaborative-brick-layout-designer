// Fit to View like desktop MainWindow::onFitToView (MainWindow.cpp:1372-1376).

import { describe, expect, it } from 'vitest';
import type { BbmMap } from '@cld/model';
import { contentBoundsStuds } from '../exportRender';
import { fitView } from '../viewFit';

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

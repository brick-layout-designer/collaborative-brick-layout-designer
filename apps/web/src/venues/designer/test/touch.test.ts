// The Venue Designer's two-finger zoom: zoomed by the fingers' spread,
// about their midpoint, which follows the fingers.

import { describe, expect, it } from 'vitest';
import { pinchDesignerView } from '../DesignerCanvas';

describe('pinchDesignerView', () => {
  const start = { scale: 2, x: 100, y: 50 };

  it('zooms by the spread and keeps the point under the fingers there', () => {
    const v = pinchDesignerView(start, { x: 180, y: 100 }, { x: 220, y: 100 }, { x: 160, y: 100 }, { x: 240, y: 100 });
    expect(v.scale).toBeCloseTo(4, 9);
    // World point under the midpoint (200, 100) before: ((200-100)/2, (100-50)/2) = (50, 25).
    expect((200 - v.x) / v.scale).toBeCloseTo(50, 9);
    expect((100 - v.y) / v.scale).toBeCloseTo(25, 9);
  });

  it('pans with the midpoint when the spread stays the same', () => {
    const v = pinchDesignerView(start, { x: 0, y: 0 }, { x: 40, y: 0 }, { x: 30, y: 10 }, { x: 70, y: 10 });
    expect(v).toEqual({ scale: 2, x: 130, y: 60 });
  });

  it('stays inside the zoom range', () => {
    expect(pinchDesignerView(start, { x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 0 }, { x: 10000, y: 0 }).scale).toBe(200);
    expect(pinchDesignerView(start, { x: 0, y: 0 }, { x: 10000, y: 0 }, { x: 0, y: 0 }, { x: 1, y: 0 }).scale).toBe(0.02);
  });
});

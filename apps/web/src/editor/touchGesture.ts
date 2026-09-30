// Touch pan and pinch zoom for the canvas (the phone viewer).
//
// Pure maths so it can be unit tested: one finger drags the view, two
// fingers zoom about their midpoint and pan with it, so the map point
// that was under the fingers when they came down stays under them.

export interface Pt {
  x: number;
  y: number;
}

export interface View {
  zoom: number;
  panX: number;
  panY: number;
}

/** One-finger drag: move the view by how far the finger moved. */
export function panView(start: View, from: Pt, to: Pt): View {
  return { zoom: start.zoom, panX: start.panX + (to.x - from.x), panY: start.panY + (to.y - from.y) };
}

const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);
const mid = (a: Pt, b: Pt): Pt => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

/**
 * Two-finger pinch: zoom by the change in finger spread, clamped to
 * `range`, keeping the map point under the starting midpoint under the
 * current midpoint.
 */
export function pinchView(
  start: View,
  startA: Pt,
  startB: Pt,
  curA: Pt,
  curB: Pt,
  range: { min: number; max: number },
): View {
  const d0 = dist(startA, startB);
  const d1 = dist(curA, curB);
  const scale = d0 > 0 && d1 > 0 ? d1 / d0 : 1;
  const zoom = Math.max(range.min, Math.min(range.max, start.zoom * scale));
  const m0 = mid(startA, startB);
  const m1 = mid(curA, curB);
  // The map point under the starting midpoint…
  const worldX = (m0.x - start.panX) / start.zoom;
  const worldY = (m0.y - start.panY) / start.zoom;
  // …lands under the current midpoint.
  return { zoom, panX: m1.x - worldX * zoom, panY: m1.y - worldY * zoom };
}

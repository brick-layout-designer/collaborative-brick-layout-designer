// Pure marquee-rectangle math, separated from the React component so
// vitest can exercise it in Node without pulling in react-konva (which
// requires the native `canvas` addon when run outside a browser).

/** Rubber-band selection rectangle, in world studs. */
export interface Marquee {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface Pt {
  x: number;
  y: number;
}

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Corners of a `w` × `h` rectangle whose local origin (`ox`, `oy` inside
 * the rectangle) sits at `at` and which is rotated by `deg` clockwise
 * (screen coordinates, y down) about that origin.
 */
export function rotatedRectCorners(at: Pt, w: number, h: number, deg: number, ox = 0, oy = 0): Pt[] {
  const r = (deg * Math.PI) / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  return [
    [-ox, -oy],
    [w - ox, -oy],
    [w - ox, h - oy],
    [-ox, h - oy],
  ].map(([lx, ly]) => ({ x: at.x + lx! * c - ly! * s, y: at.y + lx! * s + ly! * c }));
}

/**
 * Unrotated footprint (w, h) of a brick from its display area — the AABB
 * of the rotated sprite — by inverting W = w|cos| + h|sin|,
 * H = w|sin| + h|cos|. Near 45° the system is singular; there the caller's
 * `size` (sprite size in studs) wins, else the AABB itself is used.
 */
export function brickFootprint(area: Rect, orientation: number, size?: { w: number; h: number } | null): { w: number; h: number } {
  if (size && size.w > 0 && size.h > 0) return size;
  const r = (orientation * Math.PI) / 180;
  const c = Math.abs(Math.cos(r));
  const s = Math.abs(Math.sin(r));
  const det = c * c - s * s;
  if (Math.abs(det) < 0.2) return { w: area.width, h: area.height };
  const w = (area.width * c - area.height * s) / det;
  const h = (area.height * c - area.width * s) / det;
  if (!(w > 0 && h > 0)) return { w: area.width, h: area.height };
  return { w, h };
}

/**
 * Item shape of a brick: its footprint rotated about the sprite centre
 * (`centre`, the brick's pivot; default the display-area centre) — the
 * rotated pixmap bounding rect Qt's rubber band tests against
 * (IntersectsItemShape; SceneBuilder.cpp:192-216).
 */
export function brickShape(area: Rect, orientation: number, size?: { w: number; h: number } | null, centre?: Pt): Pt[] {
  const { w, h } = brickFootprint(area, orientation, size);
  centre ??= { x: area.x + area.width / 2, y: area.y + area.height / 2 };
  return rotatedRectCorners(centre, w, h, orientation, w / 2, h / 2);
}

/** Separating-axis test: does the convex polygon touch the marquee? */
export function polygonIntersectsMarquee(poly: readonly Pt[], m: Marquee): boolean {
  if (poly.length === 0) return false;
  const x0 = Math.min(m.x0, m.x1);
  const y0 = Math.min(m.y0, m.y1);
  const x1 = Math.max(m.x0, m.x1);
  const y1 = Math.max(m.y0, m.y1);
  const rect: Pt[] = [
    { x: x0, y: y0 },
    { x: x1, y: y0 },
    { x: x1, y: y1 },
    { x: x0, y: y1 },
  ];
  const axes: Pt[] = [{ x: 1, y: 0 }, { x: 0, y: 1 }];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!;
    const b = poly[(i + 1) % poly.length]!;
    if (a.x !== b.x || a.y !== b.y) axes.push({ x: -(b.y - a.y), y: b.x - a.x });
  }
  const eps = 1e-9;
  for (const ax of axes) {
    let pMin = Infinity, pMax = -Infinity, rMin = Infinity, rMax = -Infinity;
    for (const p of poly) {
      const d = p.x * ax.x + p.y * ax.y;
      pMin = Math.min(pMin, d);
      pMax = Math.max(pMax, d);
    }
    for (const p of rect) {
      const d = p.x * ax.x + p.y * ax.y;
      rMin = Math.min(rMin, d);
      rMax = Math.max(rMax, d);
    }
    if (pMax < rMin - eps || rMax < pMin - eps) return false;
  }
  return true;
}

/**
 * Bricks whose rotated shape intersects the marquee. `sizeOf` may return
 * a brick's unrotated sprite size in studs (needed near 45°).
 */
export function bricksInMarquee<B extends { id: string; orientation?: number; displayArea: Rect }>(
  marquee: Marquee,
  bricks: readonly B[],
  sizeOf?: (b: B) => { w: number; h: number } | null,
  centreOf?: (b: B) => Pt,
): string[] {
  const ids: string[] = [];
  for (const b of bricks) {
    const shape = brickShape(b.displayArea, b.orientation ?? 0, sizeOf?.(b), centreOf?.(b));
    if (polygonIntersectsMarquee(shape, marquee)) ids.push(b.id);
  }
  return ids;
}

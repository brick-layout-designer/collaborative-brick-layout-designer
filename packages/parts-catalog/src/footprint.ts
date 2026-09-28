// BlueBrick's brick footprint — port of desktop PartsLibrary::footprint
// (from BlueBrick's LayerBrick.Brick.updateImage), in the same single-
// precision arithmetic so the sizes match vanilla's saved displayAreas.
//
// A brick's displayArea is the box around its rotated hull (the sprite
// rectangle when the part has no XML <hull>). The sprite centre — the
// brick's pivot, which connection points and rotation are relative to —
// sits `imageOffset` from the box centre; that is non-zero only for parts
// with a <hull> (up to ~3 studs for 9V switches).

const f = Math.fround;

export interface FootprintPart {
  pxPerStud: number;
  /** Sprite size in pixels; no footprint without it. */
  spriteSize?: { w: number; h: number } | undefined;
  /** XML <hull> points in sprite pixels (as written in the XML). */
  hullPts?: readonly { x: number; y: number }[] | undefined;
}

export interface Footprint {
  /** Studs, from the displayArea centre to the sprite centre. */
  imageOffset: { x: number; y: number };
  /** Studs, the displayArea size. */
  size: { w: number; h: number };
  /** Studs, from the displayArea top-left to the rotated sprite's top-left. */
  imageCorner: { x: number; y: number };
}

interface MinMax {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

function bounds(points: readonly { x: number; y: number }[], c: number, s: number): MinMax {
  const mm: MinMax = { minX: f(1e30), minY: f(1e30), maxX: f(-1e30), maxY: f(-1e30) };
  for (const p of points) {
    const x = f(p.x);
    const y = f(p.y);
    const rx = f(f(x * c) - f(y * s));
    const ry = f(f(x * s) + f(y * c));
    mm.minX = Math.min(mm.minX, rx);
    mm.maxX = Math.max(mm.maxX, rx);
    mm.minY = Math.min(mm.minY, ry);
    mm.maxY = Math.max(mm.maxY, ry);
  }
  return mm;
}

export function footprint(part: FootprintPart, orientationDegrees: number): Footprint | null {
  const sprite = part.spriteSize;
  if (!sprite || sprite.w <= 0 || sprite.h <= 0) return null;
  const pps = f(part.pxPerStud > 0 ? part.pxPerStud : 8);
  const lastX = f(sprite.w - 0.5);
  const lastY = f(sprite.h - 0.5);
  const box = [
    { x: 0.5, y: 0.5 },
    { x: lastX, y: 0.5 },
    { x: lastX, y: lastY },
    { x: 0.5, y: lastY },
  ];
  const rad = (orientationDegrees * Math.PI) / 180;
  const c = f(Math.cos(rad));
  const s = f(Math.sin(rad));
  const bb = bounds(box, c, s);
  const hullPts = part.hullPts ?? [];
  if (hullPts.length === 0) {
    return {
      imageOffset: { x: 0, y: 0 },
      size: { w: f(f(f(bb.maxX - bb.minX) + 1) / pps), h: f(f(f(bb.maxY - bb.minY) + 1) / pps) },
      imageCorner: { x: f(f(0.5 - bb.minX) / pps), y: f(f(0.5 - bb.minY) / pps) },
    };
  }
  // BlueBrick shifts hull points to the pixel centre.
  const hull = bounds(hullPts.map((p) => ({ x: p.x + 0.5, y: p.y + 0.5 })), c, s);
  const ox = f(f(f(f(bb.maxX - hull.maxX) + f(bb.minX - hull.minX)) * 0.5) / pps);
  const oy = f(f(f(f(bb.maxY - hull.maxY) + f(bb.minY - hull.minY)) * 0.5) / pps);
  return {
    imageOffset: { x: ox, y: oy },
    size: { w: f(f(f(hull.maxX - hull.minX) + 1) / pps), h: f(f(f(hull.maxY - hull.minY) + 1) / pps) },
    imageCorner: { x: f(f(0.5 - hull.minX) / pps), y: f(f(0.5 - hull.minY) / pps) },
  };
}

/** `footprint().imageOffset`, zero for parts without a <hull>. */
export function imageOffset(part: FootprintPart, orientationDegrees: number): { x: number; y: number } {
  if (!part.hullPts?.length) return { x: 0, y: 0 };
  return footprint(part, orientationDegrees)?.imageOffset ?? { x: 0, y: 0 };
}

// An imported part's <PickShape>: its outline rings (holes included), in
// studs around the sprite centre. Clicks inside the shape hit the part;
// clicks in its empty corners and holes reach what is underneath. The
// footprint still comes from the sprite: this is only for picking and the
// selection outline.

export type PickShape = { x: number; y: number }[][];

/** Even-odd: inside an odd number of rings (so a hole's ring cancels the outer one). */
export function insidePickShape(rings: PickShape, x: number, y: number): boolean {
  let inside = false;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const a = ring[i]!;
      const b = ring[j]!;
      if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
    }
  }
  return inside;
}

/** Trace the rings onto a canvas path, `pxPerStud` pixels a stud. */
export function tracePickShape(ctx: CanvasRenderingContext2D, rings: PickShape, pxPerStud: number): void {
  ctx.beginPath();
  for (const ring of rings) {
    ring.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x * pxPerStud, p.y * pxPerStud) : ctx.lineTo(p.x * pxPerStud, p.y * pxPerStud)));
    ctx.closePath();
  }
}

/** Flat Konva points for one ring, `pxPerStud` pixels a stud. */
export function ringPoints(ring: { x: number; y: number }[], pxPerStud: number): number[] {
  return ring.flatMap((p) => [p.x * pxPerStud, p.y * pxPerStud]);
}

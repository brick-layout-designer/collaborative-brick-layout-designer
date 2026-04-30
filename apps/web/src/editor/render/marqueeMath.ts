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

/** Bricks intersecting the marquee, given a list of `(id, displayArea)`. */
export function bricksInMarquee(
  marquee: Marquee,
  bricks: { id: string; displayArea: { x: number; y: number; width: number; height: number } }[],
): string[] {
  const x0 = Math.min(marquee.x0, marquee.x1);
  const y0 = Math.min(marquee.y0, marquee.y1);
  const x1 = Math.max(marquee.x0, marquee.x1);
  const y1 = Math.max(marquee.y0, marquee.y1);

  const ids: string[] = [];
  for (const b of bricks) {
    // Axis-aligned rect intersection — counts a brick as selected iff
    // ANY part of its display area overlaps the marquee. Matches most
    // desktop editors. A "fully contained" alternative is one boolean
    // flip away if the desktop CLD ever standardises differently.
    if (
      b.displayArea.x + b.displayArea.width >= x0 &&
      b.displayArea.x <= x1 &&
      b.displayArea.y + b.displayArea.height >= y0 &&
      b.displayArea.y <= y1
    ) {
      ids.push(b.id);
    }
  }
  return ids;
}

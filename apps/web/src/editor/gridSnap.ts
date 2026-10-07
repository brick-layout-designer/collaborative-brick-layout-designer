// Grid snap, as BlueBrick does it (MapData/Layer.cs snapToGrid and
// updateSnapMargin, MapData/LayerBrick.cs getMovedSnapPoint). The desktop
// has the same functions in src/core/GridSnap.h, and both apps run the
// cases in test/fixtures/grid-snap-vectors.json.
//
// A part snaps by its snap corner: the top-left of its display area plus
// the offset its <SnapMargin> gives at its orientation. A 9V straight is
// 17 studs wide with half a stud of margin each side, so its 16-stud
// rails sit on the grid, not its box.
//
// Points (ruler ends, label corners, text and venue points) snap to the
// nearest grid point.

import type { Brick, LayerBrick } from '@cld/model';
import type { PartWire, SnapMarginWire } from '../api';
import { topGroupId } from './sets';

export interface Pt {
  x: number;
  y: number;
}

/** From the top-left of a part's display area to its snap corner, at `orientation` degrees (BlueBrick's updateSnapMargin, its branches included). */
export function snapOffset(m: SnapMarginWire | undefined, orientation: number): Pt {
  if (!m || (m.left === 0 && m.right === 0 && m.top === 0 && m.bottom === 0)) return { x: 0, y: 0 };
  const a = (orientation * Math.PI) / 180;
  let c = Math.cos(a);
  let s = Math.sin(a);
  let x: number;
  let y: number;
  if (c > 0) {
    x = m.left * c;
    y = m.top * c;
  } else {
    c = -c;
    x = m.right * c;
    y = m.bottom * c;
  }
  if (s > 0) {
    x += m.bottom * s;
    y += m.left * s;
  } else {
    s = -s;
    x += m.top * s;
    y += m.right * s;
  }
  return { x, y };
}

/** So a value that is a whole number of steps apart from rounding noise counts as one. */
export const GRID_EPSILON = 1e-6;

/** The grid line at or before `v`. */
export function floorToStep(v: number, step: number): number {
  return Math.floor(v / step + GRID_EPSILON) * step;
}

/** The nearest grid line; halfway goes to the even step (C#'s Math.Round, which BlueBrick's centred snap uses). */
export function roundToStep(v: number, step: number): number {
  const q = v / step;
  let r = Math.floor(q + 0.5);
  if (Math.abs(q + 0.5 - r) < GRID_EPSILON && r % 2 !== 0) r -= 1;
  return r * step;
}

/** The nearest grid point to `p`; `p` itself when the step is 0 (off). */
export function snapPoint(p: Pt, step: number): Pt {
  if (step <= 0) return { x: p.x, y: p.y };
  return { x: roundToStep(p.x, step), y: roundToStep(p.y, step) };
}

/**
 * Where a dragged part's snap corner lands: the pointer is at `mouse`, and
 * would have the corner at `rawCorner` (both studs). The corner keeps the
 * grid steps it had from the pointer when grabbed, so it lands on the grid
 * and moves a whole step as the pointer crosses a grid line (BlueBrick's
 * getMovedSnapPoint with no connection in reach).
 */
export function dragCorner(mouse: Pt, rawCorner: Pt, step: number): Pt {
  if (step <= 0) return { x: rawCorner.x, y: rawCorner.y };
  return {
    x: floorToStep(mouse.x, step) - floorToStep(mouse.x - rawCorner.x, step),
    y: floorToStep(mouse.y, step) - floorToStep(mouse.y - rawCorner.y, step),
  };
}

/** The shift that takes a dragged part from where the pointer has it onto the grid. */
export function dragShift(mouse: Pt, rawCorner: Pt, step: number): Pt {
  const c = dragCorner(mouse, rawCorner, step);
  return { x: c.x - rawCorner.x, y: c.y - rawCorner.y };
}

/**
 * How far a drag led by a ruler or label shifts from where the pointer has
 * it, onto the grid (studs). With parts in it (`corner`: the first part's
 * snap corner at the start), the parts land by that corner as when a part
 * leads, Alt or not. Without, `ref` (the grabbed ruler's first end or
 * centre, or the label's corner, at the start) goes on the nearest grid
 * point; `free` (Alt) leaves it where the pointer has it.
 */
export function annoDragShift(o: {
  /** The pointer's move since the press, studs. */
  moved: Pt;
  mouse: Pt | null;
  corner: Pt | null;
  ref: Pt | null;
  step: number;
  free: boolean;
}): Pt {
  if (o.corner) {
    if (!o.mouse) return { x: 0, y: 0 };
    return dragShift(o.mouse, { x: o.corner.x + o.moved.x, y: o.corner.y + o.moved.y }, o.step);
  }
  if (!o.ref) return { x: 0, y: 0 };
  const at = { x: o.ref.x + o.moved.x, y: o.ref.y + o.moved.y };
  const to = snapPoint(at, o.free ? 0 : o.step);
  return { x: to.x - at.x, y: to.y - at.y };
}

type Parts = ReadonlyMap<string, PartWire>;
const partOf = (parts: Parts, key: string) => parts.get(key.toLowerCase());

/** The corner a brick snaps to the grid by: its display area's top-left plus its <SnapMargin> offset (BlueBrick's Position + SnapToGridOffset). */
export function snapCorner(brick: Pick<Brick, 'displayArea' | 'orientation'>, part: PartWire | undefined): Pt {
  const off = snapOffset(part?.snapMargin, brick.orientation);
  return { x: brick.displayArea.x + off.x, y: brick.displayArea.y + off.y };
}

/**
 * The corner a grab on `brick` snaps by. As in BlueBrick, a brick whose
 * outermost group is a set from the library snaps by the set: the box
 * around all its parts plus the set's <SnapMargin> at the set's turn (a
 * part of it, less the turn it has in the set). Otherwise, the brick's own.
 */
export function grabSnapCorner(layer: Pick<LayerBrick, 'bricks' | 'groups'>, brick: Brick, parts: Parts): Pt {
  const top = topGroupId(layer.groups, brick.myGroup);
  const set = top ? layer.groups.find((g) => g.id === top) : undefined;
  if (!set?.partNumber) return snapCorner(brick, partOf(parts, brick.partNumber));
  const meta = partOf(parts, set.partNumber);
  let minX = Infinity;
  let minY = Infinity;
  let turn: number | null = null;
  for (const m of layer.bricks) {
    if (m.id !== brick.id && topGroupId(layer.groups, m.myGroup) !== top) continue;
    minX = Math.min(minX, m.displayArea.x);
    minY = Math.min(minY, m.displayArea.y);
    if (turn !== null || !meta || m.myGroup !== top) continue;
    const sp = meta.subparts.find((p) => p.subKey.toLowerCase() === m.partNumber.toLowerCase());
    if (sp) turn = m.orientation - sp.angle;
  }
  const off = snapOffset(meta?.snapMargin, turn ?? 0);
  return { x: minX + off.x, y: minY + off.y };
}

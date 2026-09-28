// BlueBrick brick geometry — port of desktop parts/BrickPlacement.h.
//
// A brick's displayArea is the box around its rotated hull; its sprite
// centre (BlueBrick's pivot) sits `imageOffset` from the box centre, which
// is non-zero only for parts with an XML <hull>. Connection points, ruler
// attachments and rotation are all relative to the pivot. The footprint
// maths lives in @cld/parts-catalog (footprint.ts).

import { footprint, imageOffset } from '@cld/parts-catalog/browser';
import type { Brick, RectangleF } from '@cld/model';
import type { PartWire } from '../api';

/** What the geometry needs from a catalog part. */
export type PartGeom = Pick<PartWire, 'pxPerStud' | 'hullPts' | 'spriteSize'> & {
  connections?: PartWire['connections'];
};

type Pt = { x: number; y: number };

export function rotated(v: Pt, degrees: number): Pt {
  const r = (degrees * Math.PI) / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  return { x: v.x * c - v.y * s, y: v.x * s + v.y * c };
}

export function areaCentre(a: RectangleF): Pt {
  return { x: a.x + a.width / 2, y: a.y + a.height / 2 };
}

/** The brick's pivot: its sprite centre, in studs. */
export function pivotOf(brick: Pick<Brick, 'displayArea' | 'orientation'>, part: PartGeom | undefined): Pt {
  const c = areaCentre(brick.displayArea);
  if (!part) return c;
  const off = imageOffset(part, brick.orientation);
  return { x: c.x + off.x, y: c.y + off.y };
}

/**
 * displayArea size for a part at `orientation`: its footprint, else the
 * brick's current size (BlueBrick draws unknown parts at their stored
 * size), else 2 x 2 studs.
 */
export function areaSize(part: PartGeom | undefined, orientation: number, current?: { width: number; height: number }): { width: number; height: number } {
  const fp = part ? footprint(part, orientation) : null;
  if (fp) return { width: fp.size.w, height: fp.size.h };
  if (current && current.width > 0 && current.height > 0) return { width: current.width, height: current.height };
  return { width: 2, height: 2 };
}

/** The displayArea that puts the brick's pivot at `pivot` for `orientation`. */
export function areaForPivot(
  part: PartGeom | undefined,
  orientation: number,
  pivot: Pt,
  current?: { width: number; height: number },
): RectangleF {
  const size = areaSize(part, orientation, current);
  const off = part ? imageOffset(part, orientation) : { x: 0, y: 0 };
  return {
    x: pivot.x - off.x - size.width / 2,
    y: pivot.y - off.y - size.height / 2,
    width: size.width,
    height: size.height,
  };
}

/** World position (studs) of connection `index`, from the pivot. */
export function connectionWorld(brick: Pick<Brick, 'displayArea' | 'orientation'>, part: PartGeom | undefined, index: number): Pt {
  const p = pivotOf(brick, part);
  const cp = part?.connections?.[index];
  if (!cp) return p;
  const r = rotated(cp, brick.orientation);
  return { x: p.x + r.x, y: p.y + r.y };
}

/**
 * Turn bricks by `degrees` around the selection's pivot — the mean of
 * their sprite centres, so a single brick turns in place — recomputing
 * each displayArea from the turned footprint (MapView::rotateSelected).
 */
export function rotateAroundPivots(
  bricks: readonly { brick: Pick<Brick, 'displayArea' | 'orientation'>; part: PartGeom | undefined }[],
  degrees: number,
): { orientation: number; displayArea: RectangleF }[] {
  if (bricks.length === 0) return [];
  const centres = bricks.map(({ brick, part }) => pivotOf(brick, part));
  const pivot = {
    x: centres.reduce((s, c) => s + c.x, 0) / centres.length,
    y: centres.reduce((s, c) => s + c.y, 0) / centres.length,
  };
  return bricks.map(({ brick, part }, i) => {
    const orientation = brick.orientation + degrees;
    const r = rotated({ x: centres[i]!.x - pivot.x, y: centres[i]!.y - pivot.y }, degrees);
    return { orientation, displayArea: areaForPivot(part, orientation, { x: pivot.x + r.x, y: pivot.y + r.y }, brick.displayArea) };
  });
}

/**
 * Earlier builds kept a brick's displayArea size when turning or placing
 * it, and drew the sprite at the box centre; BlueBrick recomputes the size
 * on load and keeps the stored corner, so it shows such bricks shifted.
 * The corrected displayArea for a brick whose box doesn't match its
 * footprint (keeping the sprite where the old build drew it, at the box
 * centre), or null when it already matches or the part is unknown
 * (desktop fixStaleAreas).
 */
export function staleAreaFix(brick: Pick<Brick, 'displayArea' | 'orientation'>, part: PartGeom | undefined): RectangleF | null {
  const fp = part ? footprint(part, brick.orientation) : null;
  if (!fp) return null;
  const a = brick.displayArea;
  if (Math.abs(fp.size.w - a.width) <= 0.01 && Math.abs(fp.size.h - a.height) <= 0.01) return null;
  return areaForPivot(part, brick.orientation, areaCentre(a));
}

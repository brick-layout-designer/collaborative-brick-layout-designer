// Snapping for the Venue Designer's pointer: to corners, onto walls, to
// 45° steps from the last point, and to a length step (1″ by default).
// The desktop's venue/DesignerSnap.cpp is the twin of this file.

import type { Venue } from '@cld/bbm';
import { dist, segDist, type Pt } from './model';
import { STUDS_PER_INCH } from './units';

export interface SnapOptions {
  /** The point the current line starts from, for angle and length snapping. */
  from?: Pt;
  /** Length / grid step in studs (0: none). */
  stepStuds: number;
  /** Angle step in degrees from `from` (0: none; Shift turns it off). */
  angleStepDeg: number;
  /** How close counts as "on" a corner or wall, in studs (the view picks it from the zoom). */
  tolStuds: number;
  /** Snap to the venue's corners and walls. */
  toVenue: boolean;
}

export type SnapKind = 'corner' | 'wall' | 'angle' | 'grid' | 'none';

export const DEFAULT_STEP_STUDS = STUDS_PER_INCH; // 1″

/** The venue's corners: edge and obstacle vertices. */
export function venueCorners(v: Venue): Pt[] {
  return [...v.edges.flatMap((e) => e.poly), ...v.obstacles.flatMap((o) => o.poly)];
}

const roundTo = (x: number, step: number): number => (step > 0 ? Math.round(x / step) * step : x);

/** Where the pointer lands, and why. */
export function snapPoint(v: Venue, p: Pt, o: SnapOptions): { pt: Pt; kind: SnapKind } {
  if (o.toVenue) {
    let best: Pt | null = null;
    let bestD = o.tolStuds;
    for (const c of venueCorners(v)) {
      const d = dist(c, p);
      if (d <= bestD) {
        best = c;
        bestD = d;
      }
    }
    if (best) return { pt: { ...best }, kind: 'corner' };
  }
  if (o.from && o.angleStepDeg > 0) {
    const dx = p.x - o.from.x, dy = p.y - o.from.y;
    const len = Math.hypot(dx, dy);
    if (len > 0.001) {
      const step = (o.angleStepDeg * Math.PI) / 180;
      const a = Math.round(Math.atan2(dy, dx) / step) * step;
      const l = roundTo(len, o.stepStuds);
      return { pt: { x: o.from.x + Math.cos(a) * l, y: o.from.y + Math.sin(a) * l }, kind: 'angle' };
    }
  }
  if (o.toVenue) {
    let best: Pt | null = null;
    let bestD = o.tolStuds;
    for (const e of v.edges)
      for (let i = 0; i < e.poly.length - 1; i++) {
        const a = e.poly[i]!, b = e.poly[i + 1]!;
        const r = segDist(p, a, b);
        if (r.d <= bestD) {
          bestD = r.d;
          // Along the wall in whole steps from its start.
          const len = dist(a, b);
          const along = len > 0 ? roundTo(r.t * len, o.stepStuds) / len : 0;
          const t = Math.max(0, Math.min(1, along));
          best = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
        }
      }
    if (best) return { pt: best, kind: 'wall' };
  }
  if (o.stepStuds > 0) return { pt: { x: roundTo(p.x, o.stepStuds), y: roundTo(p.y, o.stepStuds) }, kind: 'grid' };
  return { pt: p, kind: 'none' };
}

/**
 * The end of a line of exactly `lengthStuds` from `from` towards `toward`
 * (the length typed while drawing), keeping the snapped direction.
 */
export function pointAtLength(from: Pt, toward: Pt, lengthStuds: number, angleStepDeg: number): Pt {
  const dx = toward.x - from.x, dy = toward.y - from.y;
  let a = Math.hypot(dx, dy) > 0.001 ? Math.atan2(dy, dx) : 0;
  if (angleStepDeg > 0) {
    const step = (angleStepDeg * Math.PI) / 180;
    a = Math.round(a / step) * step;
  }
  return { x: from.x + Math.cos(a) * lengthStuds, y: from.y + Math.sin(a) * lengthStuds };
}

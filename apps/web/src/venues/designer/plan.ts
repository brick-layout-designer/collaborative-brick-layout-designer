// The floor plan behind a venue: an image (a venue map, a photo of a
// sketch) placed in the world and scaled by calibration: click two points
// on it and give the real distance between them. Kept in the venue as
// `floorPlan` (references/VENUE-MODEL.md) so it travels with it.

import type { Venue } from '@cld/bbm';
import { dist, type Pt } from './model';

export interface FloorPlan {
  /** The image as a data: URL (downscaled when loaded). */
  image: string;
  /** World position of the image's top-left corner, in studs. */
  x: number;
  y: number;
  /** Studs per image pixel. */
  studsPerPx: number;
  /** 0–1. */
  opacity: number;
}

export function planOf(v: Venue): FloorPlan | null {
  const p = v.floorPlan as Partial<FloorPlan> | undefined;
  if (!p || typeof p.image !== 'string' || !p.image.startsWith('data:image/')) return null;
  const n = (x: unknown, d: number) => (typeof x === 'number' && Number.isFinite(x) ? x : d);
  const studsPerPx = n(p.studsPerPx, 1);
  return { image: p.image, x: n(p.x, 0), y: n(p.y, 0), studsPerPx: studsPerPx > 0 ? studsPerPx : 1, opacity: Math.min(1, Math.max(0, n(p.opacity, 0.4))) };
}

export function withPlan(v: Venue, plan: FloorPlan | null): Venue {
  const out = { ...v };
  if (plan) out.floorPlan = plan;
  else delete out.floorPlan;
  return out;
}

/**
 * Rescale the plan so the distance between world points `a` and `b` (two
 * points clicked on it) becomes `realStuds`, keeping `a` where it is.
 */
export function calibrate(plan: FloorPlan, a: Pt, b: Pt, realStuds: number): FloorPlan {
  const measured = dist(a, b);
  if (measured < 0.001 || realStuds <= 0) return plan;
  const k = realStuds / measured;
  return { ...plan, studsPerPx: plan.studsPerPx * k, x: a.x - (a.x - plan.x) * k, y: a.y - (a.y - plan.y) * k };
}

/** Largest side of a stored plan image, in pixels. */
export const PLAN_MAX_PX = 2400;

/**
 * Read an image file into a plan: downscaled to PLAN_MAX_PX as a JPEG, placed
 * at `at`, first scaled so it is `widthStuds` wide (calibrate it next).
 */
export async function loadPlan(file: Blob, at: Pt, widthStuds: number): Promise<FloorPlan> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error('not an image this browser can read'));
      i.src = url;
    });
    const k = Math.min(1, PLAN_MAX_PX / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(1, Math.round(img.naturalWidth * k)), h = Math.max(1, Math.round(img.naturalHeight * k));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('could not draw the image');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    return { image: canvas.toDataURL('image/jpeg', 0.85), x: at.x, y: at.y, studsPerPx: widthStuds / w, opacity: 0.4 };
  } finally {
    URL.revokeObjectURL(url);
  }
}

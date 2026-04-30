// Synthesised thumbnails for `.set` group parts.
//
// BlueBrickParts ships some sets with their own pre-rendered `.set.gif`
// (e.g. Castle/3739-1.set.gif) — those are picked up by the catalog
// scanner and need no synthesis. Many other groups (4DBrix track sets,
// etc.) ship only the `.set.xml` definition and have NO thumbnail. The
// reference BlueBrick C# composes them at runtime in
// `BrickLibrary.createGroupImageRecursive`
// (.reference/BlueBrick/BlueBrick/MapData/BrickLibrary.cs:1554-1672) —
// load each subpart's image, rotate, translate, draw onto a single
// bitmap.
//
// Web port equivalent: lazily composite onto a canvas the first time a
// group's thumbnail is requested, return a data URL, cache forever
// (the catalog content doesn't change at runtime). The original uses
// each subpart's tight HULL polygon to find bounds; we approximate
// with the subpart's natural pixmap AABB rotated by `angle`. That's
// only off by a few pixels on the thumbnail and the user can't tell.
//
// Performance: thumbnails are 96px × 96px target on the desktop; ours
// fit roughly inside that. A 6-subpart 4DBrix set composites in <2 ms.

import { studToPx } from './coords';
import { ensureSprite } from './spriteCache';
import { spriteUrlFor, type PartWire } from '../../api';

const cache = new Map<string, Promise<string | null>>();

/**
 * Get (or build) a data URL for the group's composite thumbnail. Returns
 * `null` if the group has no subparts or all subpart images failed to
 * load. Repeated calls for the same group share the same Promise.
 */
export function ensureSetThumbnail(
  group: PartWire,
  partsByKey: Map<string, PartWire>,
): Promise<string | null> {
  if (group.kind !== 'group' || group.subparts.length === 0) {
    return Promise.resolve(null);
  }
  const key = group.key.toLowerCase();
  const cached = cache.get(key);
  if (cached) return cached;
  const promise = composeSetThumbnail(group, partsByKey).catch(() => null);
  cache.set(key, promise);
  return promise;
}

/** Synchronous lookup for an already-computed thumbnail. */
const ready = new Map<string, string>();
export function getSetThumbnailSync(groupKey: string): string | null {
  return ready.get(groupKey.toLowerCase()) ?? null;
}

async function composeSetThumbnail(
  group: PartWire,
  partsByKey: Map<string, PartWire>,
): Promise<string | null> {
  // Resolve every subpart: catalog metadata + sprite. A subpart whose
  // referenced part isn't in the catalog (rare) is skipped — desktop
  // substitutes a placeholder rectangle (`AddUnknownBrick`); we just
  // omit it. The thumbnail still renders the rest of the set.
  type Resolved = {
    img: HTMLImageElement;
    pxPerStud: number;
    /** Subpart placement in studs + degrees. */
    x: number;
    y: number;
    angle: number;
  };
  const resolved: Resolved[] = [];
  for (const sub of group.subparts) {
    const meta = partsByKey.get(sub.subKey.toLowerCase()) ?? findByPartNumber(partsByKey, sub.subKey);
    if (!meta) continue;
    const url = spriteUrlFor(meta);
    if (!url) continue;
    try {
      const img = await ensureSprite(url);
      resolved.push({
        img,
        pxPerStud: meta.pxPerStud > 0 ? meta.pxPerStud : 8,
        x: sub.x,
        y: sub.y,
        angle: sub.angle,
      });
    } catch {
      /* skip missing/failed subpart sprite */
    }
  }
  if (resolved.length === 0) return null;

  // Compute the group's AABB in scene-pixels at the editor's stud scale.
  // For each subpart: take its sprite's natural pixel rect, scale it
  // to scene pixels (= scale by `studToPx() / pxPerStud`), rotate by
  // `angle`, translate to `(x, y)` studs. Union them.
  const SCALE = studToPx(); // 8 px / stud
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  interface Drawn {
    img: HTMLImageElement;
    /** Centre in scene-pixels. */
    cx: number;
    cy: number;
    /** Sprite size in scene-pixels at SCALE. */
    drawW: number;
    drawH: number;
    angle: number;
  }
  const drawn: Drawn[] = [];
  for (const r of resolved) {
    const drawW = r.img.naturalWidth * (SCALE / r.pxPerStud);
    const drawH = r.img.naturalHeight * (SCALE / r.pxPerStud);
    const cx = r.x * SCALE;
    const cy = r.y * SCALE;
    drawn.push({ img: r.img, cx, cy, drawW, drawH, angle: r.angle });
    // Rotated AABB extents: half-width and half-height of the rotated
    // unrotated rect. Standard formula:
    const theta = (r.angle * Math.PI) / 180;
    const c = Math.abs(Math.cos(theta));
    const s = Math.abs(Math.sin(theta));
    const halfW = (drawW * c + drawH * s) / 2;
    const halfH = (drawW * s + drawH * c) / 2;
    minX = Math.min(minX, cx - halfW);
    minY = Math.min(minY, cy - halfH);
    maxX = Math.max(maxX, cx + halfW);
    maxY = Math.max(maxY, cy + halfH);
  }

  const PAD = 4;
  const width = Math.ceil(maxX - minX) + PAD * 2;
  const height = Math.ceil(maxY - minY) + PAD * 2;
  if (width <= 0 || height <= 0) return null;

  // Cap to 256×256 for the thumbnail surface — large sets (e.g. yard
  // turnouts) can run hundreds of pixels on a side at native scale.
  const MAX = 256;
  const scale = Math.min(1, MAX / Math.max(width, height));
  const canvasW = Math.max(1, Math.round(width * scale));
  const canvasH = Math.max(1, Math.round(height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = canvasW;
  canvas.height = canvasH;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  for (const d of drawn) {
    // Translate so (minX-PAD, minY-PAD) becomes the origin, then scale
    // down to the thumbnail resolution.
    const tx = (d.cx - minX + PAD) * scale;
    const ty = (d.cy - minY + PAD) * scale;
    ctx.save();
    ctx.translate(tx, ty);
    ctx.rotate((d.angle * Math.PI) / 180);
    const w = d.drawW * scale;
    const h = d.drawH * scale;
    ctx.drawImage(d.img, -w / 2, -h / 2, w, h);
    ctx.restore();
  }

  const url = canvas.toDataURL('image/png');
  ready.set(group.key.toLowerCase(), url);
  return url;
}

/**
 * Subparts reference parts by their full key (e.g. `TS_TRACK18S.8`),
 * but the case of the colour code can vary. The map is lowercase-keyed,
 * so try lowercase first; fall back to a partNumber-only walk.
 */
function findByPartNumber(
  partsByKey: Map<string, PartWire>,
  needle: string,
): PartWire | undefined {
  const lower = needle.toLowerCase();
  const direct = partsByKey.get(lower);
  if (direct) return direct;
  for (const p of partsByKey.values()) {
    if (p.partNumber.toLowerCase() === lower) return p;
  }
  return undefined;
}

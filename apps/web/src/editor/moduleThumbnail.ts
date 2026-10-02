// A module's picture: the whole module, up to 1024 px on its longest side
// (sharp on a hi-DPI phone or tablet at the biggest place it shows: the
// catalog and collection cards), drawn by the editor's own picture renderer
// and sent to the server as base64 in JSON (the site's firewall only lets
// binary bodies through on the snapshot routes). WebP where the browser
// can make it, else PNG; the server re-encodes it as WebP either way.

import type { BbmMap } from '@cld/model';
import type { Sidecar } from '@cld/bbm';
import type { ExportHandle } from './ExportImageDialog';
import { newView, pictureSize, viewPicture } from './savedViews';
import type { SpriteProgress } from './render/spriteCache';

/** Longest side of a module picture, in pixels. */
export const THUMBNAIL_SIDE = 1024;
/** WebP quality: small, and still clean on track edges. */
export const THUMBNAIL_QUALITY = 0.85;

/**
 * The output size for a region `width` × `height` px at 1×: `side` on the
 * longest side, whatever the module's size (so a picture under 512 px is
 * always one from before, which its editors can refresh).
 */
export function thumbnailScale(width: number, height: number, side = THUMBNAIL_SIDE): number {
  const longest = Math.max(width, height);
  return longest > 0 ? side / longest : 1;
}

/** The canvas as WebP, or PNG where the browser can't make WebP (it hands back a PNG instead). */
export function canvasToThumbnail(canvas: HTMLCanvasElement): Promise<{ mime: 'image/webp' | 'image/png'; blob: Blob }> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (webp) => {
        if (webp && webp.type === 'image/webp') return resolve({ mime: 'image/webp', blob: webp });
        canvas.toBlob((png) => (png ? resolve({ mime: 'image/png', blob: png }) : reject(new Error('The picture could not be made.'))), 'image/png');
      },
      'image/webp',
      THUMBNAIL_QUALITY,
    );
  });
}

async function encode(canvas: HTMLCanvasElement): Promise<{ mime: 'image/webp' | 'image/png'; data: string }> {
  const { mime, blob } = await canvasToThumbnail(canvas);
  return { mime, data: toBase64(new Uint8Array(await blob.arrayBuffer())) };
}

/** Bytes as base64, in chunks (a spread of a big array overflows the stack). */
export function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/**
 * Wait until the map can be drawn properly: the parts list has arrived
 * (until then every part draws as a "missing part" cross) and every part
 * picture asked for has loaded or failed, then let the canvas paint twice.
 * Gives up after `timeoutMs` so a save never hangs.
 */
export async function waitForPartPictures(
  catalogReady: () => boolean,
  progress: () => SpriteProgress,
  timeoutMs = 15_000,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
  frame: () => Promise<void> = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))),
): Promise<boolean> {
  const start = Date.now();
  for (;;) {
    const p = progress();
    if (catalogReady() && p.loaded + p.failed >= p.wanted) {
      await frame();
      // Drawing may have asked for more pictures; settle again if so.
      const q = progress();
      if (q.loaded + q.failed >= q.wanted) return true;
    }
    if (Date.now() - start >= timeoutMs) return false;
    await sleep(100);
  }
}

/** The module's picture as a PNG, or null when there's nothing to draw. */
export async function makeModuleThumbnail(
  handle: ExportHandle | null,
  map: BbmMap | null,
  sidecar: Sidecar | null,
): Promise<{ mime: 'image/webp' | 'image/png'; data: string } | null> {
  if (!handle?.renderPicture || !map) return null;
  if (!map.layers.some((l) => l.type === 'brick' && l.bricks.length > 0)) return null;
  const spec = viewPicture(newView('module-thumbnail', 'Module'), map, sidecar);
  if (!spec) return null;
  const scale = thumbnailScale(spec.region.width * 8, spec.region.height * 8);
  const canvas = await handle.renderPicture(spec, pictureSize(spec.region, scale));
  if (!canvas) return null;
  return encode(canvas);
}

/** A picture of one area of the map (studs), e.g. the parts picked for Save as module. */
export async function makeRegionThumbnail(
  handle: ExportHandle | null,
  region: { x: number; y: number; width: number; height: number },
): Promise<{ mime: 'image/webp' | 'image/png'; data: string } | null> {
  if (!handle?.renderPicture || !(region.width > 0 && region.height > 0)) return null;
  const scale = thumbnailScale(region.width * 8, region.height * 8);
  const canvas = await handle.renderPicture({ region, sheets: null, grid: false, labels: false }, pictureSize(region, scale));
  if (!canvas) return null;
  return encode(canvas);
}

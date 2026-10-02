// A module's picture: the whole module, about 256 px on its longest side,
// drawn by the editor's own picture renderer and sent to the server as
// base64 in JSON (the site's firewall only lets binary bodies through on
// the snapshot routes).

import type { BbmMap } from '@cld/model';
import type { Sidecar } from '@cld/bbm';
import type { ExportHandle } from './ExportImageDialog';
import { newView, pictureSize, viewPicture } from './savedViews';
import { canvasToPng } from './sharePicture';

/** Longest side of a module picture, in pixels. */
export const THUMBNAIL_SIDE = 256;

/** The output size for a region `width` × `height` px at 1×: `side` on the longest side. */
export function thumbnailScale(width: number, height: number, side = THUMBNAIL_SIDE): number {
  const longest = Math.max(width, height);
  return longest > 0 ? side / longest : 1;
}

/** Bytes as base64, in chunks (a spread of a big array overflows the stack). */
export function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/** The module's picture as a PNG, or null when there's nothing to draw. */
export async function makeModuleThumbnail(
  handle: ExportHandle | null,
  map: BbmMap | null,
  sidecar: Sidecar | null,
): Promise<{ mime: 'image/png'; data: string } | null> {
  if (!handle?.renderPicture || !map) return null;
  if (!map.layers.some((l) => l.type === 'brick' && l.bricks.length > 0)) return null;
  const spec = viewPicture(newView('module-thumbnail', 'Module'), map, sidecar);
  if (!spec) return null;
  const scale = thumbnailScale(spec.region.width * 8, spec.region.height * 8);
  const canvas = await handle.renderPicture(spec, pictureSize(spec.region, scale));
  if (!canvas) return null;
  const blob = await canvasToPng(canvas);
  return { mime: 'image/png', data: toBase64(new Uint8Array(await blob.arrayBuffer())) };
}

/** A picture of one area of the map (studs), e.g. the parts picked for Save as module. */
export async function makeRegionThumbnail(
  handle: ExportHandle | null,
  region: { x: number; y: number; width: number; height: number },
): Promise<{ mime: 'image/png'; data: string } | null> {
  if (!handle?.renderPicture || !(region.width > 0 && region.height > 0)) return null;
  const scale = thumbnailScale(region.width * 8, region.height * 8);
  const canvas = await handle.renderPicture({ region, sheets: null, grid: false, labels: false }, pictureSize(region, scale));
  if (!canvas) return null;
  const blob = await canvasToPng(canvas);
  return { mime: 'image/png', data: toBase64(new Uint8Array(await blob.arrayBuffer())) };
}

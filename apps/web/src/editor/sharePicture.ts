// Getting a picture of the layout out of the browser: the phone's share
// sheet where it takes files, the clipboard where it takes images, and a
// plain download everywhere else.

import type { BbmMap } from '@cld/model';
import type { SavedView, Sidecar } from '@cld/bbm';
import type { ExportHandle } from './ExportImageDialog';
import { exportAllViews, loadExportViewsOptions, saveExportViewsOptions } from './savedViews';

/** A canvas as PNG bytes. */
export function canvasToPng(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('The picture could not be made.'))), 'image/png');
  });
}

/** Save a file the browser's way (the Downloads folder). */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Whether this browser can hand a PNG file to the system share sheet. */
export function canShareFiles(): boolean {
  try {
    if (typeof navigator.share !== 'function' || typeof navigator.canShare !== 'function') return false;
    const probe = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], 'layout.png', { type: 'image/png' });
    return navigator.canShare({ files: [probe] });
  } catch {
    return false;
  }
}

/** Whether "Copy picture" can work here. */
export function canCopyImages(): boolean {
  if (typeof ClipboardItem === 'undefined' || typeof navigator.clipboard?.write !== 'function') return false;
  const supports = (ClipboardItem as unknown as { supports?: (type: string) => boolean }).supports;
  return typeof supports === 'function' ? supports('image/png') : true;
}

export type ShareOutcome = 'shared' | 'downloaded' | 'cancelled';

/**
 * Share the picture through the system share sheet when `preferShare`
 * and the browser can; otherwise download it. Closing the share sheet
 * counts as "cancelled", not as a failure.
 */
export async function shareOrDownload(blob: Blob, filename: string, title: string, preferShare: boolean): Promise<ShareOutcome> {
  if (preferShare) {
    const file = new File([blob], filename, { type: 'image/png' });
    let shareable = false;
    try {
      shareable = typeof navigator.share === 'function' && typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] });
    } catch {
      shareable = false;
    }
    if (shareable) {
      try {
        await navigator.share({ files: [file], title });
        return 'shared';
      } catch (e) {
        if ((e as { name?: string }).name === 'AbortError') return 'cancelled';
        // Not allowed here after all (no user gesture left, policy): download.
      }
    }
  }
  downloadBlob(blob, filename);
  return 'downloaded';
}

/** Put the picture on the clipboard. Throws when the browser refuses. */
export async function copyPicture(blob: Blob | Promise<Blob>): Promise<void> {
  // Safari wants the ClipboardItem made straight away, with the picture still coming.
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
}

/**
 * Render every saved view (or the whole layout) and download the zip.
 * Returns how many pictures it holds.
 */
export async function downloadAllViews(input: {
  title: string;
  views: readonly SavedView[];
  map: BbmMap;
  sidecar: Sidecar | null;
  handle: ExportHandle | null;
  maxSide?: number;
  onProgress?: (done: number, total: number) => void;
}): Promise<number> {
  const render = input.handle?.renderPicture;
  if (!render) return 0;
  const maxSide = input.maxSide ?? loadExportViewsOptions().maxSide;
  saveExportViewsOptions({ maxSide });
  const result = await exportAllViews({
    title: input.title,
    views: input.views,
    map: input.map,
    sidecar: input.sidecar,
    maxSide,
    ...(input.onProgress ? { onProgress: input.onProgress } : {}),
    render: async (spec, size) => {
      const canvas = await render(spec, size);
      if (!canvas) return null;
      const blob = await canvasToPng(canvas);
      return { width: canvas.width, height: canvas.height, data: new Uint8Array(await blob.arrayBuffer()) };
    },
  });
  if (result.files.length === 0) return 0;
  downloadBlob(new Blob([result.data as BlobPart], { type: 'application/zip' }), result.filename);
  return result.files.length;
}

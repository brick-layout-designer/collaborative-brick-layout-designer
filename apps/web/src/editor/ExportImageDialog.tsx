// Export as Image / Tiled Print dialog — port of MainWindowMenus.cpp:97-201
// and desktop's multi-page A3 tiling (PrintDialog.cpp).
//
// Both modes render the WHOLE map (content bounds + margin, over the map
// background colour, without grid/selection/cursors) — see exportRender.ts;
// desktop exports scene->itemsBoundingRect(), never just the viewport.
//
// Single-image export: explicit width/height in px with keep-aspect (or a
// 1×/2×/4× preset), PNG or JPEG with quality, transparent background and
// antialias toggles (MainWindowMenus.cpp:132-163); downloads client-side.
//
// Tiled print: renders the full map at the chosen DPI, slices it into
// page-sized tiles with a configurable overlap (registration marks), then
// opens a new browser window with each tile as a full-page <img> and
// calls window.print() — the user's OS print dialog handles actual output
// (PDF, physical printer, etc.).

import { useState } from 'react';
import { MAX_CANVAS_SIDE, aspectHeight } from './exportRender';

export interface ExportHandle {
  /**
   * Render the full map to a canvas. `pixelRatio` is output px per scene
   * px (8 per stud); `size`, when given, is the exact output size instead.
   * The returned ratio is what was actually used after clamping to the
   * browser's canvas limits. Null when the map is empty.
   */
  render: (opts: {
    pixelRatio: number;
    transparent: boolean;
    size?: { width: number; height: number };
    antialias?: boolean;
  }) => { canvas: HTMLCanvasElement; pixelRatio: number } | null;
  /** Scene-pixel size of the whole-map export (1×), or null when empty. */
  sceneSize: () => { width: number; height: number } | null;
}

interface Props {
  layoutTitle: string;
  exportImageRef: React.MutableRefObject<ExportHandle | null>;
  onClose: () => void;
}

// Paper sizes in mm (portrait). Landscape swaps w/h at use-time.
const PAPER_SIZES: Record<string, { w: number; h: number; label: string }> = {
  a4:      { w: 210, h: 297, label: 'A4 (210 × 297 mm)' },
  a4l:     { w: 297, h: 210, label: 'A4 Landscape (297 × 210 mm)' },
  a3:      { w: 297, h: 420, label: 'A3 (297 × 420 mm)' },
  a3l:     { w: 420, h: 297, label: 'A3 Landscape (420 × 297 mm)' },
  letter:  { w: 216, h: 279, label: 'Letter (216 × 279 mm)' },
  letterl: { w: 279, h: 216, label: 'Letter Landscape (279 × 216 mm)' },
};

export function ExportImageDialog({ layoutTitle, exportImageRef, onClose }: Props) {
  const [mode, setMode] = useState<'image' | 'print'>('image');
  // Native (1×) export size; the image defaults to 2×, like the old
  // resolution picker.
  const [scene] = useState(() => exportImageRef.current?.sceneSize() ?? null);
  const [width, setWidth] = useState(() =>
    scene ? Math.min(MAX_CANVAS_SIDE, scene.width * 2) : 1600,
  );
  const [keepAspect, setKeepAspect] = useState(true);
  const [customHeight, setCustomHeight] = useState(() =>
    scene ? Math.min(MAX_CANVAS_SIDE, scene.height * 2) : 1200,
  );
  const [format, setFormat] = useState<'png' | 'jpeg'>('png');
  const [quality, setQuality] = useState(90);
  const [antialias, setAntialias] = useState(true);
  const [transparent, setTransparent] = useState(false);
  const [dpi, setDpi] = useState(150);
  const [paperKey, setPaperKey] = useState('a3');
  const [overlapMm, setOverlapMm] = useState(10);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState('');

  const height = keepAspect && scene ? aspectHeight(width, scene) : customHeight;
  const sizeValid = width >= 1 && height >= 1 && width <= MAX_CANVAS_SIDE && height <= MAX_CANVAS_SIDE;

  function setScale(k: number) {
    if (!scene) return;
    setWidth(Math.min(MAX_CANVAS_SIDE, Math.round(scene.width * k)));
    setCustomHeight(Math.min(MAX_CANVAS_SIDE, Math.round(scene.height * k)));
  }

  function doExportImage() {
    const handle = exportImageRef.current;
    if (!handle || !sizeValid) return;
    setExporting(true);
    setError('');
    try {
      const jpeg = format === 'jpeg';
      const result = handle.render({
        pixelRatio: 1,
        size: { width, height },
        // JPEG has no alpha channel; paint the background.
        transparent: transparent && !jpeg,
        antialias,
      });
      if (!result) { setError('The map is empty.'); return; }
      const dataUrl = jpeg
        ? result.canvas.toDataURL('image/jpeg', quality / 100)
        : result.canvas.toDataURL('image/png');
      const safe = layoutTitle.replace(/[^a-z0-9_\-]/gi, '_') || 'layout';
      const a = document.createElement('a');
      a.href = dataUrl;
      a.download = `${safe}.${jpeg ? 'jpg' : 'png'}`;
      a.click();
      onClose();
    } catch (e) {
      setError(String(e));
    } finally {
      setExporting(false);
    }
  }

  function doTiledPrint() {
    const handle = exportImageRef.current;
    if (!handle) return;
    setExporting(true);
    setError('');

    try {
      const paper = PAPER_SIZES[paperKey]!;
      const MM_PER_INCH = 25.4;
      // Printable area in pixels at the chosen DPI.
      const pageWpx = Math.floor((paper.w / MM_PER_INCH) * dpi);
      const pageHpx = Math.floor((paper.h / MM_PER_INCH) * dpi);
      const overlapPx = Math.round((overlapMm / MM_PER_INCH) * dpi);

      // Render the full map to a single high-res canvas.
      // pixelRatio = dpi/96 scales the stage's CSS-pixel dimensions to
      // physical pixels at the target DPI (Konva stages are laid out at 96 dpi).
      const pr = dpi / 96;
      const rendered = handle.render({ pixelRatio: pr, transparent: false });
      if (!rendered) { setError('The map is empty.'); return; }
      const fullCanvas = rendered.canvas;
      const fullW = fullCanvas.width;
      const fullH = fullCanvas.height;

      // Slice into tiles.
      const stepX = pageWpx - overlapPx;
      const stepY = pageHpx - overlapPx;
      const cols = Math.max(1, Math.ceil((fullW - overlapPx) / stepX));
      const rows = Math.max(1, Math.ceil((fullH - overlapPx) / stepY));

      const tiles: string[] = [];

      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const sx = c * stepX;
          const sy = r * stepY;
          const sw = Math.min(pageWpx, fullW - sx);
          const sh = Math.min(pageHpx, fullH - sy);

          const tile = document.createElement('canvas');
          tile.width = pageWpx;
          tile.height = pageHpx;
          const tc = tile.getContext('2d')!;
          tc.fillStyle = '#fff';
          tc.fillRect(0, 0, pageWpx, pageHpx);
          tc.drawImage(fullCanvas, sx, sy, sw, sh, 0, 0, sw, sh);
          tiles.push(tile.toDataURL('image/png'));
        }
      }

      // Open print window.
      const safe = layoutTitle.replace(/[^a-z0-9_\-]/gi, '_') || 'layout';
      const win = window.open('', '_blank');
      if (!win) { setError('Pop-up blocked — allow pop-ups and try again.'); return; }

      // CSS: each page is exactly the paper size at screen 96dpi equivalent.
      // @page sets the paper dimensions for the print driver.
      const pageWmm = paper.w;
      const pageHmm = paper.h;
      const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>${safe}</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  @page { size: ${pageWmm}mm ${pageHmm}mm; margin: 0; }
  body { background: #888; }
  .page {
    width: ${pageWmm}mm;
    height: ${pageHmm}mm;
    overflow: hidden;
    page-break-after: always;
    break-after: page;
    display: flex;
    align-items: center;
    justify-content: center;
    background: #fff;
  }
  img { width: 100%; height: 100%; object-fit: contain; display: block; }
  @media print {
    body { background: #fff; }
    .page { page-break-after: always; break-after: page; }
  }
</style>
</head>
<body>
${tiles.map((t) => `<div class="page"><img src="${t}"></div>`).join('\n')}
<script>window.onload = () => { setTimeout(() => window.print(), 400); }<\/script>
</body>
</html>`;
      win.document.write(html);
      win.document.close();
      onClose();
    } catch (e) {
      setError(String(e));
    } finally {
      setExporting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={onClose}
    >
      <div
        className="w-96 rounded-lg border border-neutral-700 bg-neutral-900 p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-4 text-sm font-semibold text-neutral-200">Export / Print</h2>

        {/* Mode toggle */}
        <div className="mb-4 flex rounded-sm border border-neutral-700 text-xs">
          {(['image', 'print'] as const).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`flex-1 py-1.5 ${mode === m ? 'bg-neutral-700 text-white' : 'text-neutral-400 hover:bg-neutral-800'}`}
            >
              {m === 'image' ? 'Export Image' : 'Tiled Print / PDF'}
            </button>
          ))}
        </div>

        <div className="flex flex-col gap-3 text-sm">
          {mode === 'image' ? (
            <>
              <label className="flex items-center justify-between gap-2">
                <span className="text-xs text-neutral-400">Width (px)</span>
                <input
                  type="number"
                  aria-label="Width (px)"
                  min={1}
                  max={MAX_CANVAS_SIDE}
                  value={width}
                  onChange={(e) => setWidth(Math.max(0, Math.round(Number(e.target.value) || 0)))}
                  className="w-24 rounded-sm border border-neutral-700 bg-neutral-800 px-2 py-1 text-xs"
                />
              </label>
              <label className="flex items-center gap-2 text-xs text-neutral-400">
                <input
                  type="checkbox"
                  checked={keepAspect}
                  onChange={(e) => {
                    if (!e.target.checked) setCustomHeight(height);
                    setKeepAspect(e.target.checked);
                  }}
                />
                Keep aspect ratio (height auto)
              </label>
              <label className="flex items-center justify-between gap-2">
                <span className="text-xs text-neutral-400">Height (px)</span>
                <input
                  type="number"
                  aria-label="Height (px)"
                  min={1}
                  max={MAX_CANVAS_SIDE}
                  value={height}
                  disabled={keepAspect}
                  onChange={(e) => setCustomHeight(Math.max(0, Math.round(Number(e.target.value) || 0)))}
                  className="w-24 rounded-sm border border-neutral-700 bg-neutral-800 px-2 py-1 text-xs disabled:opacity-50"
                />
              </label>
              {scene && (
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs text-neutral-400">Preset</span>
                  <div className="flex gap-1">
                    {[1, 2, 4].map((k) => (
                      <button
                        key={k}
                        onClick={() => setScale(k)}
                        className="rounded-sm border border-neutral-700 px-2 py-0.5 text-xs hover:bg-neutral-800"
                        title={`${Math.round(scene.width * k)} × ${Math.round(scene.height * k)} px`}
                      >
                        {k}×
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {!sizeValid && (
                <p className="text-[10px] text-red-400">Width and height must be 1–{MAX_CANVAS_SIDE} px.</p>
              )}
              <label className="flex items-center justify-between gap-2">
                <span className="text-xs text-neutral-400">Format</span>
                <select
                  value={format}
                  onChange={(e) => setFormat(e.target.value as 'png' | 'jpeg')}
                  className="rounded-sm border border-neutral-700 bg-neutral-800 px-2 py-1 text-xs"
                >
                  <option value="png">PNG</option>
                  <option value="jpeg">JPEG</option>
                </select>
              </label>
              {format === 'jpeg' && (
                <label className="flex items-center justify-between gap-2">
                  <span className="text-xs text-neutral-400">JPEG quality</span>
                  <span className="flex items-center gap-2">
                    <input
                      type="range"
                      aria-label="JPEG quality"
                      min={10}
                      max={100}
                      value={quality}
                      onChange={(e) => setQuality(Number(e.target.value))}
                    />
                    <span className="w-8 text-right text-xs text-neutral-300">{quality}</span>
                  </span>
                </label>
              )}
              <label className="flex items-center gap-2 text-xs text-neutral-400">
                <input
                  type="checkbox"
                  checked={antialias}
                  onChange={(e) => setAntialias(e.target.checked)}
                />
                Antialias
              </label>
              <label className="flex items-center gap-2 text-xs text-neutral-400">
                <input
                  type="checkbox"
                  checked={transparent && format === 'png'}
                  disabled={format === 'jpeg'}
                  onChange={(e) => setTransparent(e.target.checked)}
                />
                Transparent background{format === 'jpeg' ? ' (PNG only)' : ''}
              </label>
            </>
          ) : (
            <>
              <label className="flex items-center justify-between gap-2">
                <span className="text-xs text-neutral-400">Paper size</span>
                <select
                  value={paperKey}
                  onChange={(e) => setPaperKey(e.target.value)}
                  className="rounded-sm border border-neutral-700 bg-neutral-800 px-2 py-1 text-xs"
                >
                  {Object.entries(PAPER_SIZES).map(([k, v]) => (
                    <option key={k} value={k}>{v.label}</option>
                  ))}
                </select>
              </label>
              <label className="flex items-center justify-between gap-2">
                <span className="text-xs text-neutral-400">DPI</span>
                <select
                  value={dpi}
                  onChange={(e) => setDpi(Number(e.target.value))}
                  className="rounded-sm border border-neutral-700 bg-neutral-800 px-2 py-1 text-xs"
                >
                  <option value={96}>96 (screen)</option>
                  <option value={150}>150 (draft print)</option>
                  <option value={300}>300 (high quality)</option>
                </select>
              </label>
              <label className="flex items-center justify-between gap-2">
                <span className="text-xs text-neutral-400">Tile overlap (mm)</span>
                <input
                  type="number"
                  value={overlapMm}
                  min={0}
                  max={50}
                  step={1}
                  onChange={(e) => setOverlapMm(Math.max(0, Number(e.target.value)))}
                  className="w-20 rounded-sm border border-neutral-700 bg-neutral-800 px-2 py-1 text-xs"
                />
              </label>
              <p className="text-[10px] text-neutral-500">
                Opens a new tab with each map tile on a separate page — use your browser's print dialog to output to PDF or a printer.
              </p>
            </>
          )}
        </div>

        {error && <p className="mt-2 text-xs text-red-400">{error}</p>}

        <div className="mt-5 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-sm px-3 py-1.5 text-xs text-neutral-400 hover:bg-neutral-800"
          >
            Cancel
          </button>
          <button
            onClick={mode === 'image' ? doExportImage : doTiledPrint}
            disabled={exporting || (mode === 'image' && !sizeValid)}
            className="rounded-sm bg-blue-600 px-3 py-1.5 text-xs text-white hover:bg-blue-500 disabled:opacity-50"
          >
            {exporting ? 'Working…' : mode === 'image' ? `Export ${format === 'jpeg' ? 'JPEG' : 'PNG'}` : 'Open Print Preview'}
          </button>
        </div>
      </div>
    </div>
  );
}

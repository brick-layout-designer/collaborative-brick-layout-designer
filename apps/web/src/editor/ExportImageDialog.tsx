// Export as Image / Print / PDF dialog — port of MainWindowMenus.cpp:97-312.
//
// All modes render the WHOLE map (content bounds + margin, over the map
// background colour, without grid/selection/cursors) — see exportRender.ts;
// desktop exports scene->itemsBoundingRect(), never just the viewport.
//
// Image: explicit width/height in px with keep-aspect (or a 1×/2×/4×
// preset), PNG or JPEG with quality, transparent background, antialias
// and the per-export "Embed general-info watermark" (always
// "author / LUG / event"); downloads client-side.
//
// Print: actual size, 1 stud = 8 mm (desktop File ▸ Print). The map is
// tiled over as many pages of the chosen paper as it needs; each page is
// rendered separately at the chosen DPI and laid out at its physical size
// in a print window, so printing at 100 % scale gives true size.
//
// PDF: one A3 page, orientation from the layout's aspect, 12 mm margins,
// map fitted (desktop File ▸ Export as PDF), written without a library.

import { useState } from 'react';
import { MAX_CANVAS_SIDE, aspectHeight, type StudRect } from './exportRender';
import { useEditorStore } from './editorStore';
import { buildImagePdf, dataUrlBytes, pdfPageLayout, printPixelRatio, printTiles } from './printLayout';

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
    /** Stamp "author / LUG / event" bottom-right. */
    watermark?: boolean;
    /** Render only this map region (studs) — a print tile. */
    regionStuds?: StudRect;
  }) => { canvas: HTMLCanvasElement; pixelRatio: number } | null;
  /** Scene-pixel size of the whole-map export (1×), or null when empty. */
  sceneSize: () => { width: number; height: number } | null;
  /** Stud region of the whole-map export, or null when empty. */
  region?: () => StudRect | null;
}

/** Print-page resolution for the PDF image (the page is A3). */
const PDF_DPI = 200;

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
  const [mode, setMode] = useState<'image' | 'print' | 'pdf'>('image');
  // Desktop remembers the watermark checkbox (QSettings export/watermark).
  const [watermark, setWatermark] = useState(() => useEditorStore.getState().showExportWatermark);
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
  const [marginMm, setMarginMm] = useState(10);
  const [overlapMm, setOverlapMm] = useState(0);
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
        watermark,
      });
      if (!result) { setError('The map is empty.'); return; }
      useEditorStore.getState().setShowExportWatermark(watermark);
      const dataUrl = jpeg
        ? result.canvas.toDataURL('image/jpeg', quality / 100)
        : result.canvas.toDataURL('image/png');
      const safe = safeTitle(layoutTitle);
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

  const paper = PAPER_SIZES[paperKey]!;
  const region = exportImageRef.current?.region?.() ?? null;
  const tiling = region ? printTiles(region, paper, marginMm, overlapMm) : null;

  function doTiledPrint() {
    const handle = exportImageRef.current;
    if (!handle || !tiling) { setError('The map is empty.'); return; }
    setExporting(true);
    setError('');

    try {
      // Each page shows a paper-sized piece of the map at 1 stud = 8 mm,
      // rendered at the chosen DPI (desktop renders page by page too).
      const pr = printPixelRatio(dpi);
      const tiles: string[] = [];
      for (const t of tiling.tiles) {
        const rendered = handle.render({ pixelRatio: pr, transparent: false, regionStuds: t });
        if (!rendered) { setError('The map is empty.'); return; }
        tiles.push(rendered.canvas.toDataURL('image/png'));
      }

      const win = window.open('', '_blank');
      if (!win) { setError('Pop-up blocked — allow pop-ups and try again.'); return; }
      win.document.write(printHtml(safeTitle(layoutTitle), paper, marginMm, tiling.tileMm, tiles));
      win.document.close();
      onClose();
    } catch (e) {
      setError(String(e));
    } finally {
      setExporting(false);
    }
  }

  function doExportPdf() {
    const handle = exportImageRef.current;
    if (!handle || !region) { setError('The map is empty.'); return; }
    setExporting(true);
    setError('');
    try {
      const layout = pdfPageLayout(region);
      const size = {
        width: Math.max(1, Math.round((layout.imageMm.w / 25.4) * PDF_DPI)),
        height: Math.max(1, Math.round((layout.imageMm.h / 25.4) * PDF_DPI)),
      };
      const rendered = handle.render({ pixelRatio: 1, size, transparent: false, antialias: true });
      if (!rendered) { setError('The map is empty.'); return; }
      const jpeg = dataUrlBytes(rendered.canvas.toDataURL('image/jpeg', 0.92));
      const pdf = buildImagePdf(layout, { bytes: jpeg, width: rendered.canvas.width, height: rendered.canvas.height }, layoutTitle);
      const url = URL.createObjectURL(new Blob([pdf as BlobPart], { type: 'application/pdf' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `${safeTitle(layoutTitle)}.pdf`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
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
          {(['image', 'print', 'pdf'] as const).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`flex-1 py-1.5 ${mode === m ? 'bg-neutral-700 text-white' : 'text-neutral-400 hover:bg-neutral-800'}`}
            >
              {m === 'image' ? 'Export Image' : m === 'print' ? 'Print (1:1)' : 'PDF (A3)'}
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
              <label className="flex items-center gap-2 text-xs text-neutral-400">
                <input
                  type="checkbox"
                  checked={watermark}
                  onChange={(e) => setWatermark(e.target.checked)}
                />
                Embed general-info watermark
              </label>
            </>
          ) : mode === 'pdf' ? (
            <p className="text-xs text-neutral-400">
              One A3 page ({region && region.width >= region.height ? 'landscape' : 'portrait'}, from the layout&apos;s
              shape) with the whole map fitted inside 12 mm margins.
            </p>
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
                <span className="text-xs text-neutral-400">Page margin (mm)</span>
                <input
                  type="number"
                  aria-label="Page margin (mm)"
                  value={marginMm}
                  min={0}
                  max={50}
                  step={1}
                  onChange={(e) => setMarginMm(Math.max(0, Number(e.target.value)))}
                  className="w-20 rounded-sm border border-neutral-700 bg-neutral-800 px-2 py-1 text-xs"
                />
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
              <p className="text-xs text-neutral-300" data-testid="print-pages">
                {tiling ? `${tiling.cols} × ${tiling.rows} = ${tiling.tiles.length} page(s) at actual size (1 stud = 8 mm)` : 'The map is empty.'}
              </p>
              <p className="text-[10px] text-neutral-500">
                Opens a new tab with one page per tile — print it at 100 % scale (no &quot;fit to page&quot;) to keep the actual size.
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
            onClick={mode === 'image' ? doExportImage : mode === 'print' ? doTiledPrint : doExportPdf}
            disabled={exporting || (mode === 'image' && !sizeValid)}
            className="rounded-sm bg-blue-600 px-3 py-1.5 text-xs text-white hover:bg-blue-500 disabled:opacity-50"
          >
            {exporting ? 'Working…' : mode === 'image' ? `Export ${format === 'jpeg' ? 'JPEG' : 'PNG'}` : mode === 'print' ? 'Open Print Preview' : 'Export PDF'}
          </button>
        </div>
      </div>
    </div>
  );
}

function safeTitle(title: string): string {
  return title.replace(/[^a-z0-9_\-]/gi, '_') || 'layout';
}

/** Print window: one physical-size page per tile. */
function printHtml(
  title: string,
  paper: { w: number; h: number },
  marginMm: number,
  tileMm: { w: number; h: number },
  tiles: readonly string[],
): string {
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>${title}</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  @page { size: ${paper.w}mm ${paper.h}mm; margin: ${marginMm}mm; }
  body { background: #888; }
  .page { width: ${tileMm.w}mm; height: ${tileMm.h}mm; overflow: hidden; break-after: page; background: #fff; }
  .page:last-child { break-after: auto; }
  img { width: ${tileMm.w}mm; height: ${tileMm.h}mm; display: block; }
  @media print { body { background: #fff; } }
</style>
</head>
<body>
${tiles.map((t) => `<div class="page"><img src="${t}"></div>`).join('\n')}
<script>window.onload = () => { setTimeout(() => window.print(), 400); }<\/script>
</body>
</html>`;
}

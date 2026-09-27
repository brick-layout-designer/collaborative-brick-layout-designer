// Export as Image / Tiled Print dialog — port of MainWindowMenus.cpp:97-201
// and desktop's multi-page A3 tiling (PrintDialog.cpp).
//
// Both modes render the WHOLE map (content bounds + margin, over the map
// background colour, without grid/selection/cursors) — see exportRender.ts;
// desktop exports scene->itemsBoundingRect(), never just the viewport.
//
// Single-image export: renders at the chosen pixel ratio, downloads as PNG.
//
// Tiled print: renders the full map at the chosen DPI, slices it into
// page-sized tiles with a configurable overlap (registration marks), then
// opens a new browser window with each tile as a full-page <img> and
// calls window.print() — the user's OS print dialog handles actual output
// (PDF, physical printer, etc.).

import { useState } from 'react';

export interface ExportHandle {
  /**
   * Render the full map to a canvas. `pixelRatio` is output px per scene
   * px (8 per stud); the returned ratio is what was actually used after
   * clamping to the browser's canvas limits. Null when the map is empty.
   */
  render: (opts: { pixelRatio: number; transparent: boolean }) =>
    { canvas: HTMLCanvasElement; pixelRatio: number } | null;
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
  const [mode, setMode] = useState<'png' | 'print'>('png');
  const [pixelRatio, setPixelRatio] = useState(2);
  const [transparent, setTransparent] = useState(false);
  const [dpi, setDpi] = useState(150);
  const [paperKey, setPaperKey] = useState('a3');
  const [overlapMm, setOverlapMm] = useState(10);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState('');

  function doExportPng() {
    const handle = exportImageRef.current;
    if (!handle) return;
    setExporting(true);
    setError('');
    try {
      const result = handle.render({ pixelRatio, transparent });
      if (!result) { setError('The map is empty.'); return; }
      const dataUrl = result.canvas.toDataURL('image/png');
      const safe = layoutTitle.replace(/[^a-z0-9_\-]/gi, '_') || 'layout';
      const a = document.createElement('a');
      a.href = dataUrl;
      a.download = `${safe}.png`;
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
        <div className="mb-4 flex rounded border border-neutral-700 text-xs">
          {(['png', 'print'] as const).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`flex-1 py-1.5 ${mode === m ? 'bg-neutral-700 text-white' : 'text-neutral-400 hover:bg-neutral-800'}`}
            >
              {m === 'png' ? 'Export PNG' : 'Tiled Print / PDF'}
            </button>
          ))}
        </div>

        <div className="flex flex-col gap-3 text-sm">
          {mode === 'png' ? (
            <>
              <label className="flex items-center justify-between gap-2">
                <span className="text-xs text-neutral-400">Resolution</span>
                <select
                  value={pixelRatio}
                  onChange={(e) => setPixelRatio(Number(e.target.value))}
                  className="rounded border border-neutral-700 bg-neutral-800 px-2 py-1 text-xs"
                >
                  <option value={1}>1× (native)</option>
                  <option value={2}>2× (retina)</option>
                  <option value={4}>4× (print)</option>
                </select>
              </label>
              <label className="flex items-center gap-2 text-xs text-neutral-400">
                <input
                  type="checkbox"
                  checked={transparent}
                  onChange={(e) => setTransparent(e.target.checked)}
                />
                Transparent background
              </label>
            </>
          ) : (
            <>
              <label className="flex items-center justify-between gap-2">
                <span className="text-xs text-neutral-400">Paper size</span>
                <select
                  value={paperKey}
                  onChange={(e) => setPaperKey(e.target.value)}
                  className="rounded border border-neutral-700 bg-neutral-800 px-2 py-1 text-xs"
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
                  className="rounded border border-neutral-700 bg-neutral-800 px-2 py-1 text-xs"
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
                  className="w-20 rounded border border-neutral-700 bg-neutral-800 px-2 py-1 text-xs"
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
            className="rounded px-3 py-1.5 text-xs text-neutral-400 hover:bg-neutral-800"
          >
            Cancel
          </button>
          <button
            onClick={mode === 'png' ? doExportPng : doTiledPrint}
            disabled={exporting}
            className="rounded bg-blue-600 px-3 py-1.5 text-xs text-white hover:bg-blue-500 disabled:opacity-50"
          >
            {exporting ? 'Working…' : mode === 'png' ? 'Export PNG' : 'Open Print Preview'}
          </button>
        </div>
      </div>
    </div>
  );
}

// Export the WHOLE map, not just the visible viewport — desktop renders
// `scene->itemsBoundingRect()` plus a 20 px margin (MainWindowMenus.cpp:102,
// 178), onto the map background colour, without the view-only chrome
// (grid, selection, snap ring, cursors), which desktop paints in
// drawBackground / drawForeground rather than as scene items.

import type Konva from 'konva';
import type { BbmMap, ColorSpec } from '@cld/model';
import type { Sidecar } from '@cld/bbm';

/** Konva node name for view-only chrome hidden while exporting. */
export const EXPORT_HIDE = 'export-hide';

/** Desktop's 20 scene-px margin at 8 px/stud. */
export const EXPORT_MARGIN_STUDS = 2.5;

/** Browser canvas limits (Chrome/Firefox: 32767 per side, ~268M px area; Safari lower). */
export const MAX_CANVAS_SIDE = 16384;
export const MAX_CANVAS_AREA = 16384 * 16384;

export interface StudRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Bounding box, in studs, of everything drawn as map content: bricks,
 * text cells and ruler items of visible layers, painted area cells,
 * World-anchored labels and the venue outline/obstacles. Null for an
 * empty map. Mirrors what desktop's scene contains.
 */
export function contentBoundsStuds(map: BbmMap, sidecar?: Sidecar | null): StudRect | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const add = (x: number, y: number, w = 0, h = 0) => {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x + w);
    maxY = Math.max(maxY, y + h);
  };
  for (const layer of map.layers) {
    if (!layer.visible) continue;
    switch (layer.type) {
      case 'brick':
        for (const b of layer.bricks) add(b.displayArea.x, b.displayArea.y, b.displayArea.width, b.displayArea.height);
        break;
      case 'text':
        for (const c of layer.textCells) add(c.displayArea.x, c.displayArea.y, c.displayArea.width, c.displayArea.height);
        break;
      case 'ruler':
        for (const r of layer.rulerItems) add(r.displayArea.x, r.displayArea.y, r.displayArea.width, r.displayArea.height);
        break;
      case 'area': {
        const s = layer.areaCellSize;
        for (const c of layer.areas) add(c.x * s, c.y * s, s, s);
        break;
      }
      default:
        break;
    }
  }
  for (const l of sidecar?.anchoredLabels ?? []) {
    // Only World labels have a position independent of other content;
    // anchored ones sit next to bricks already inside the box.
    if (l.kind === 0) add(l.offset.x, l.offset.y);
  }
  const venue = sidecar?.venue;
  if (venue) {
    for (const e of venue.edges) for (const p of e.poly) add(p.x, p.y);
    for (const o of venue.obstacles) for (const p of o.poly) add(p.x, p.y);
  }
  if (!Number.isFinite(minX)) return null;
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/**
 * Largest pixel ratio ≤ `requested` that keeps a `widthPx × heightPx`
 * render inside the browser's canvas limits.
 */
export function clampPixelRatio(widthPx: number, heightPx: number, requested: number): number {
  if (widthPx <= 0 || heightPx <= 0) return requested;
  const bySide = MAX_CANVAS_SIDE / Math.max(widthPx, heightPx);
  const byArea = Math.sqrt(MAX_CANVAS_AREA / (widthPx * heightPx));
  return Math.max(0.01, Math.min(requested, bySide, byArea));
}

export function colorSpecToCss(c: ColorSpec): string {
  if (c.kind === 'known') {
    const known: Record<string, string> = {
      black: '#000000', white: '#ffffff', red: '#ff0000', green: '#008000', blue: '#0000ff',
      yellow: '#ffff00', orange: '#ffa500', gray: '#808080', darkgray: '#a9a9a9', lightgray: '#d3d3d3',
      cornsilk: '#fff8dc',
    };
    return known[c.name.toLowerCase()] ?? '#ffffff';
  }
  return `#${c.argb.length === 8 ? c.argb.slice(2) : c.argb}`;
}

export interface ExportOptions {
  /** Output pixels per scene pixel (1 stud = 8 scene px). Clamped to canvas limits. */
  pixelRatio: number;
  transparent: boolean;
  /** Bottom-right "author / LUG / event" stamp, like desktop's watermark option. */
  watermark?: string;
}

/**
 * Render the full map to a canvas: the stage is temporarily reset to
 * 1:1 at the content origin, view-only chrome (nodes named
 * `EXPORT_HIDE` plus the HUD layer) is hidden, and the result is
 * composited over the map background colour. Everything is restored
 * before returning. Null for an empty map.
 */
export function renderMapToCanvas(
  stage: Konva.Stage,
  map: BbmMap,
  sidecar: Sidecar | null,
  opts: ExportOptions & { hudLayer?: Konva.Layer | null },
): { canvas: HTMLCanvasElement; pixelRatio: number } | null {
  const bounds = contentBoundsStuds(map, sidecar);
  if (!bounds) return null;
  const PX = 8;
  const x0 = (bounds.x - EXPORT_MARGIN_STUDS) * PX;
  const y0 = (bounds.y - EXPORT_MARGIN_STUDS) * PX;
  const w = Math.ceil((bounds.width + 2 * EXPORT_MARGIN_STUDS) * PX);
  const h = Math.ceil((bounds.height + 2 * EXPORT_MARGIN_STUDS) * PX);
  const pixelRatio = clampPixelRatio(w, h, opts.pixelRatio);

  const saved = { x: stage.x(), y: stage.y(), sx: stage.scaleX(), sy: stage.scaleY() };
  const hidden: Konva.Node[] = [];
  for (const n of stage.find(`.${EXPORT_HIDE}`)) {
    if (n.visible()) {
      n.visible(false);
      hidden.push(n);
    }
  }
  if (opts.hudLayer && opts.hudLayer.visible()) {
    opts.hudLayer.visible(false);
    hidden.push(opts.hudLayer);
  }
  let content: HTMLCanvasElement;
  try {
    stage.scale({ x: 1, y: 1 });
    stage.position({ x: -x0, y: -y0 });
    content = stage.toCanvas({ x: 0, y: 0, width: w, height: h, pixelRatio });
  } finally {
    stage.scale({ x: saved.sx, y: saved.sy });
    stage.position({ x: saved.x, y: saved.y });
    for (const n of hidden) n.visible(true);
    stage.batchDraw();
  }

  const out = document.createElement('canvas');
  out.width = content.width;
  out.height = content.height;
  const ctx = out.getContext('2d');
  if (!ctx) return { canvas: content, pixelRatio };
  if (!opts.transparent) {
    ctx.fillStyle = colorSpecToCss(map.backgroundColor);
    ctx.fillRect(0, 0, out.width, out.height);
  }
  ctx.drawImage(content, 0, 0);
  if (opts.watermark) {
    const size = Math.max(8, out.height / 60);
    ctx.font = `${size}px sans-serif`;
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'bottom';
    ctx.fillText(opts.watermark, out.width - 10, out.height - 10);
  }
  return { canvas: out, pixelRatio };
}

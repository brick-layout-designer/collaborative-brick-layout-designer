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
    // World, Group and Module labels sit at their offset as a world
    // position (SceneBuilderSidecar.cpp:222-223); Brick labels ride on
    // bricks already inside the box.
    if (l.kind !== 1) add(l.offset.x, l.offset.y);
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

/** Scene-pixel size (1 stud = 8 px) of the full-map export, margin included. Null for an empty map. */
export function exportSceneSize(map: BbmMap, sidecar?: Sidecar | null): { width: number; height: number } | null {
  const b = contentBoundsStuds(map, sidecar);
  if (!b) return null;
  return {
    width: Math.ceil((b.width + 2 * EXPORT_MARGIN_STUDS) * 8),
    height: Math.ceil((b.height + 2 * EXPORT_MARGIN_STUDS) * 8),
  };
}

/**
 * Output height for `width` that keeps the scene's aspect ratio — desktop
 * "Keep aspect ratio (height auto)": max(64, width * h / w).
 */
export function aspectHeight(width: number, scene: { width: number; height: number }): number {
  if (scene.width <= 0) return width;
  return Math.max(64, Math.round(width * (scene.height / scene.width)));
}

/** Round an explicit export size to whole pixels inside the browser's canvas limits. */
export function clampExportSize(width: number, height: number): { width: number; height: number } {
  let w = Math.max(1, Math.round(width));
  let h = Math.max(1, Math.round(height));
  const k = Math.min(1, MAX_CANVAS_SIDE / Math.max(w, h), Math.sqrt(MAX_CANVAS_AREA / (w * h)));
  if (k < 1) {
    w = Math.max(1, Math.floor(w * k));
    h = Math.max(1, Math.floor(h * k));
  }
  return { width: w, height: h };
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
  /**
   * Explicit output size in px (desktop Width / Height, MainWindowMenus.cpp:
   * 132-163). Overrides `pixelRatio`; the map is scaled to fill it, so a
   * size off the map's aspect ratio stretches it (Qt::IgnoreAspectRatio).
   */
  size?: { width: number; height: number };
  /**
   * Smooth sprite scaling (desktop "Antialias" = SmoothPixmapTransform).
   * Canvas 2D always antialiases vector shapes. Default true.
   */
  antialias?: boolean;
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
  const size = opts.size ? clampExportSize(opts.size.width, opts.size.height) : null;
  // With an explicit size, render at the larger of the two axis scales
  // and resample into the requested box.
  const pixelRatio = clampPixelRatio(w, h, size ? Math.max(size.width / w, size.height / h) : opts.pixelRatio);
  const smooth = opts.antialias !== false;

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
    content = stage.toCanvas({ x: 0, y: 0, width: w, height: h, pixelRatio, imageSmoothingEnabled: smooth });
  } finally {
    stage.scale({ x: saved.sx, y: saved.sy });
    stage.position({ x: saved.x, y: saved.y });
    for (const n of hidden) n.visible(true);
    stage.batchDraw();
  }

  const out = document.createElement('canvas');
  out.width = size?.width ?? content.width;
  out.height = size?.height ?? content.height;
  const ctx = out.getContext('2d');
  if (!ctx) return { canvas: content, pixelRatio };
  if (!opts.transparent) {
    ctx.fillStyle = colorSpecToCss(map.backgroundColor);
    ctx.fillRect(0, 0, out.width, out.height);
  }
  ctx.imageSmoothingEnabled = smooth;
  ctx.drawImage(content, 0, 0, out.width, out.height);
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

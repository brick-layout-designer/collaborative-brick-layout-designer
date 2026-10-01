// Saved views and pictures of the layout (references/LAYOUT-FILE.md
// "Saved views"). A saved view is a named picture of the layout: which
// part of it (the whole layout, or a fixed area), which sheets, and
// whether the grid and the labels show. It lives in the sidecar under
// `views`, so it travels with the layout file and syncs live.
//
// "Fit the whole layout" (a view's `fit`) works the area out each time a
// picture is made, from what's drawn on the view's sheets, so after the
// layout changes one click makes every picture again.

import type { BbmMap, LayerGrid } from '@cld/model';
import type { SavedView, Sidecar } from '@cld/bbm';
import { contentBoundsStuds, clampExportSize, type StudRect } from './exportRender';
import { buildZip, sanitizeFilename, type ZipEntry } from '../bbmFiles';
import { drawnGridLayer } from './render/gridIndex';

/** Space left around the layout when a view fits the whole layout, in studs. */
export const VIEW_FIT_MARGIN_STUDS = 4;

/** Output pixels per stud at scale 1 (the map's own 8 px per stud). */
export const PX_PER_STUD = 8;

/** What a picture shows. */
export interface PictureSpec {
  /** The area, in studs. */
  region: StudRect;
  /** The sheets shown (layer ids), or null for the layout's own on/off. */
  sheets: string[] | null;
  grid: boolean;
  labels: boolean;
}

/** A new view: fits the whole layout, every sheet, labels on. */
export function newView(id: string, name: string, opts: { grid?: boolean } = {}): SavedView {
  return { id, name: name.trim() || 'View', fit: true, rect: null, sheets: null, grid: opts.grid ?? false, labels: true };
}

/** The picture "Share picture" and "Export all views" make when there are no saved views. */
export const WHOLE_LAYOUT: SavedView = {
  id: 'whole-layout',
  name: 'Whole layout',
  fit: true,
  rect: null,
  sheets: null,
  grid: false,
  labels: true,
};

/**
 * The map as a view shows it: with `sheets` given, exactly those sheets
 * are on, whatever the layout's own on/off says; null leaves the
 * layout's own on/off. The grid is not a sheet here (the view's `grid`
 * says whether it shows). The same objects come back when nothing
 * changes, so the canvas doesn't redraw for nothing.
 */
export function applyViewSheets(map: BbmMap, sheets: readonly string[] | null): BbmMap {
  if (!sheets) return map;
  const on = new Set(sheets);
  let changed = false;
  const layers = map.layers.map((l) => {
    if (l.type === 'grid' || on.has(l.id) === l.visible) return l;
    changed = true;
    return { ...l, visible: on.has(l.id) };
  });
  return changed ? { ...map, layers } : map;
}

/**
 * "Fit the whole layout": the bounds of what's drawn on the shown sheets
 * (bricks, text, rulers, painted areas, plus the labels when they show),
 * grown by VIEW_FIT_MARGIN_STUDS on every side. Null when nothing is drawn.
 * The room and the background picture don't count: the picture is of the
 * layout.
 */
export function fitRegionStuds(
  map: BbmMap,
  sidecar: Sidecar | null | undefined,
  sheets: readonly string[] | null,
  labels: boolean,
): StudRect | null {
  const shown = applyViewSheets(map, sheets);
  const labelsOnly: Sidecar | null =
    labels && sidecar?.anchoredLabels?.length
      ? { schemaVersion: sidecar.schemaVersion, bbmHashSha256: '', anchoredLabels: sidecar.anchoredLabels }
      : null;
  const b = contentBoundsStuds(shown, labelsOnly);
  if (!b) return null;
  const m = VIEW_FIT_MARGIN_STUDS;
  return { x: b.x - m, y: b.y - m, width: b.width + 2 * m, height: b.height + 2 * m };
}

/** The area a view's picture covers, in studs, or null when there's nothing to show. */
export function viewRegionStuds(view: SavedView, map: BbmMap, sidecar: Sidecar | null | undefined): StudRect | null {
  const r = view.rect;
  if (!view.fit && r && r.w > 0 && r.h > 0) return { x: r.x, y: r.y, width: r.w, height: r.h };
  return fitRegionStuds(map, sidecar, view.sheets, view.labels);
}

/** The picture a view makes, or null when there's nothing to show. */
export function viewPicture(view: SavedView, map: BbmMap, sidecar: Sidecar | null | undefined): PictureSpec | null {
  const region = viewRegionStuds(view, map, sidecar);
  if (!region) return null;
  return { region, sheets: view.sheets, grid: view.grid, labels: view.labels };
}

/** The grid layer a picture with the grid on draws, if the layout has one. */
export function pictureGrid(map: BbmMap, spec: Pick<PictureSpec, 'grid'>): LayerGrid | null {
  if (!spec.grid) return null;
  return (drawnGridLayer(map.layers) as LayerGrid | undefined) ?? null;
}

/** Output size in pixels of a region at `scale` (1 = 8 px per stud), inside the browser's canvas limits. */
export function pictureSize(region: StudRect, scale: number): { width: number; height: number } {
  return clampExportSize(region.width * PX_PER_STUD * scale, region.height * PX_PER_STUD * scale);
}

/**
 * A picture's scale for sharing: `preferred`, made smaller when the
 * longest side would pass `maxSide` (phones and chat apps choke on
 * huge images).
 */
export function shareScale(region: StudRect, preferred = 2, maxSide = 4096): number {
  const longest = Math.max(region.width, region.height) * PX_PER_STUD;
  if (!(longest > 0)) return preferred;
  return Math.min(preferred, maxSide / longest);
}

/** `<layout> - <view>.png`, safe as a file name. */
export function pictureFileName(layoutTitle: string, viewName: string): string {
  return `${sanitizeFilename(layoutTitle)} - ${sanitizeFilename(viewName || 'View')}.png`;
}

// ---------------------------------------------------------------------------
// Export all views: one PNG per view, in one zip
// ---------------------------------------------------------------------------

export interface RenderedPng {
  width: number;
  height: number;
  data: Uint8Array;
}

/** Makes one picture at exactly `size` pixels. Null when it can't. */
export type PictureRenderer = (spec: PictureSpec, size: { width: number; height: number }) => Promise<RenderedPng | null>;

/** "Export all views" options, remembered between uses. */
export interface ExportViewsOptions {
  /** 1 = 8 px per stud. */
  scale: number;
}

export const EXPORT_VIEWS_SCALES = [
  { scale: 1, label: 'Small' },
  { scale: 2, label: 'Medium' },
  { scale: 4, label: 'Large' },
] as const;

const PREFS_KEY = 'cld:exportViews';

export function loadExportViewsOptions(): ExportViewsOptions {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    const v = raw ? (JSON.parse(raw) as Partial<ExportViewsOptions>) : {};
    const scale = typeof v.scale === 'number' && v.scale > 0 && v.scale <= 8 ? v.scale : 2;
    return { scale };
  } catch {
    return { scale: 2 };
  }
}

export function saveExportViewsOptions(o: ExportViewsOptions): void {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(o));
  } catch {
    /* a per-browser convenience only */
  }
}

export interface ExportAllResult {
  filename: string;
  data: Uint8Array;
  /** The pictures in the zip, by file name. */
  files: string[];
  /** Views left out, because there was nothing to show. */
  skipped: string[];
}

/**
 * One PNG per saved view (or one "Whole layout" picture when there are
 * none), named `<layout> - <view>.png`, zipped into `<layout> - views.zip`.
 */
export async function exportAllViews(input: {
  title: string;
  views: readonly SavedView[];
  map: BbmMap;
  sidecar: Sidecar | null | undefined;
  scale: number;
  render: PictureRenderer;
}): Promise<ExportAllResult> {
  const views = input.views.length > 0 ? input.views : [WHOLE_LAYOUT];
  const entries: ZipEntry[] = [];
  const skipped: string[] = [];
  const used = new Set<string>();
  for (const view of views) {
    const spec = viewPicture(view, input.map, input.sidecar);
    const png = spec ? await input.render(spec, pictureSize(spec.region, input.scale)) : null;
    if (!png) {
      skipped.push(view.name);
      continue;
    }
    let name = pictureFileName(input.title, view.name);
    for (let n = 2; used.has(name.toLowerCase()); n++) name = pictureFileName(input.title, `${view.name} (${n})`);
    used.add(name.toLowerCase());
    entries.push({ name, data: png.data }); // PNGs are compressed already
  }
  return {
    filename: `${sanitizeFilename(input.title)} - views.zip`,
    data: buildZip(entries),
    files: entries.map((e) => e.name),
    skipped,
  };
}

// Layer Options — the form model behind LayerOptionsDialog, port of the
// desktop dialog built in MainWindow.cpp:146-265 (LayerPanel
// layerOptionsRequested): name, transparency, visibility, hull, plus a
// Grid section (cell size, line thickness, sub-divisions, display grid /
// sub-grid / cell-index labels), a Brick section (elevation labels) and
// an Area section (paint cell size).
//
// The web dialog also offers the grid / sub-grid / cell-index colours
// (vanilla BlueBrick's LayerGridOptionForm has them; the desktop dialog
// does not) and the hull colour.
//
// Pure: `formFromLayer` → edit → `layerOptionsPatch` gives only the fields
// that changed, which `applyLayerOptions` writes in one transaction (one
// undo step, like the desktop "Layer options" macro).

import * as Y from 'yjs';
import type { ColorSpec, Layer } from '@cld/model';
import { LOCAL_ORIGIN } from './useLayoutDoc';
import { NAMED_COLORS } from './namedColors';

// ---------------------------------------------------------------------------
// Colour helpers
// ---------------------------------------------------------------------------

/** `#rrggbb` for a colour input; unknown names give `fallback`. */
export function colorSpecToHex(c: ColorSpec, fallback = '#000000'): string {
  if (c.kind === 'known') return NAMED_COLORS[c.name.toLowerCase()] ?? (c.name.toLowerCase() === 'transparent' ? '#000000' : fallback);
  const hex = c.argb.length === 8 ? c.argb.slice(2) : c.argb.padStart(6, '0').slice(-6);
  return `#${hex.toLowerCase()}`;
}

/** Alpha byte (0-255) of a colour; known colours are opaque except Transparent. */
export function colorSpecAlpha(c: ColorSpec): number {
  if (c.kind === 'known') return c.name.toLowerCase() === 'transparent' ? 0 : 255;
  if (c.argb.length !== 8) return 255;
  const a = parseInt(c.argb.slice(0, 2), 16);
  return Number.isFinite(a) ? a : 255;
}

/** CSS colour including alpha (desktop grid defaults are half-transparent black). */
export function colorSpecToCss(c: ColorSpec, fallback = '#404040'): string {
  const hex = colorSpecToHex(c, fallback);
  const a = colorSpecAlpha(c);
  if (a >= 255) return hex;
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${+(a / 255).toFixed(3)})`;
}

/** `aarrggbb` (lowercase) for a colour, alpha included — what ColorAlphaInput edits. */
export function colorSpecToArgb(c: ColorSpec, fallback = '#000000'): string {
  return colorSpecAlpha(c).toString(16).padStart(2, '0') + colorSpecToHex(c, fallback).slice(1);
}

/** New ARGB spec with `hex`'s RGB, keeping the original colour's alpha. */
export function withRgb(original: ColorSpec, hex: string): ColorSpec {
  const a = colorSpecAlpha(original).toString(16).padStart(2, '0');
  return { kind: 'argb', argb: `${a}${hex.replace('#', '').toLowerCase()}` };
}

// ---------------------------------------------------------------------------
// Form model
// ---------------------------------------------------------------------------

export interface GridOptions {
  gridSizeInStud: number;
  gridThickness: number;
  subDivisionNumber: number;
  displayGrid: boolean;
  displaySubGrid: boolean;
  displayCellIndex: boolean;
  gridArgb: string;
  subGridArgb: string;
  cellIndexArgb: string;
}

export interface LayerOptionsForm {
  name: string;
  /** Percent, 0-100 (100 = opaque, as stored in the .bbm). */
  transparency: number;
  visible: boolean;
  hullVisible: boolean;
  hullArgb: string;
  hullThickness: number;
  /** Brick layers only. */
  displayBrickElevation?: boolean;
  /** Grid layers only. */
  grid?: GridOptions;
  /** Area layers only — paint cell size in studs. */
  areaCellSize?: number;
}

export function formFromLayer(layer: Layer): LayerOptionsForm {
  const form: LayerOptionsForm = {
    name: layer.name,
    transparency: layer.transparency,
    visible: layer.visible,
    hullVisible: layer.hullProperties.isVisible,
    hullArgb: colorSpecToArgb(layer.hullProperties.hullColor),
    hullThickness: layer.hullProperties.hullThickness,
  };
  if (layer.type === 'brick') form.displayBrickElevation = layer.displayBrickElevation;
  if (layer.type === 'area') form.areaCellSize = layer.areaCellSize;
  if (layer.type === 'grid') {
    form.grid = {
      gridSizeInStud: layer.gridSizeInStud,
      gridThickness: layer.gridThickness,
      subDivisionNumber: layer.subDivisionNumber,
      displayGrid: layer.displayGrid,
      displaySubGrid: layer.displaySubGrid,
      displayCellIndex: layer.displayCellIndex,
      gridArgb: colorSpecToArgb(layer.gridColor),
      subGridArgb: colorSpecToArgb(layer.subGridColor),
      cellIndexArgb: colorSpecToArgb(layer.cellIndexColor),
    };
  }
  return form;
}

const clampInt = (v: number, lo: number, hi: number, fallback: number): number =>
  Number.isFinite(v) ? Math.max(lo, Math.min(hi, Math.round(v))) : fallback;

/**
 * Fields to write, compared with the layer's current form so untouched
 * values (e.g. a KnownColor hull colour) are left exactly as stored.
 * Ranges match the desktop spin boxes: transparency 0-100, hull
 * thickness 1-20, cell size 1-512, grid thickness 1-20, sub-divisions
 * 2-32, area cell size 1-256.
 */
export function layerOptionsPatch(layer: Layer, form: LayerOptionsForm): Record<string, unknown> {
  const cur = formFromLayer(layer);
  const patch: Record<string, unknown> = {};
  const name = form.name.trim();
  if (name && name !== cur.name) patch.name = name;
  const transparency = clampInt(form.transparency, 0, 100, cur.transparency);
  if (transparency !== cur.transparency) patch.transparency = transparency;
  if (form.visible !== cur.visible) patch.visible = form.visible;
  const hullThickness = clampInt(form.hullThickness, 1, 20, cur.hullThickness);
  if (form.hullVisible !== cur.hullVisible || form.hullArgb !== cur.hullArgb || hullThickness !== cur.hullThickness) {
    patch.hullProperties = {
      isVisible: form.hullVisible,
      hullColor: form.hullArgb !== cur.hullArgb
        ? { kind: 'argb', argb: form.hullArgb }
        : layer.hullProperties.hullColor,
      hullThickness,
    };
  }
  if (layer.type === 'brick' && form.displayBrickElevation !== undefined
    && form.displayBrickElevation !== cur.displayBrickElevation) {
    patch.displayBrickElevation = form.displayBrickElevation;
  }
  if (layer.type === 'area' && form.areaCellSize !== undefined) {
    const size = clampInt(form.areaCellSize, 1, 256, layer.areaCellSize);
    if (size !== layer.areaCellSize) patch.areaCellSize = size;
  }
  if (layer.type === 'grid' && form.grid && cur.grid) {
    const g = form.grid;
    const c = cur.grid;
    const size = clampInt(g.gridSizeInStud, 1, 512, c.gridSizeInStud);
    if (size !== c.gridSizeInStud) patch.gridSizeInStud = size;
    const thick = clampInt(g.gridThickness, 1, 20, c.gridThickness);
    if (thick !== c.gridThickness) patch.gridThickness = thick;
    const sub = clampInt(g.subDivisionNumber, 2, 32, c.subDivisionNumber);
    if (sub !== c.subDivisionNumber) patch.subDivisionNumber = sub;
    if (g.displayGrid !== c.displayGrid) patch.displayGrid = g.displayGrid;
    if (g.displaySubGrid !== c.displaySubGrid) patch.displaySubGrid = g.displaySubGrid;
    if (g.displayCellIndex !== c.displayCellIndex) patch.displayCellIndex = g.displayCellIndex;
    // Colours are edited with alpha (desktop's colour buttons use
    // QColorDialog::ShowAlphaChannel, EditDialogs.cpp:68).
    if (g.gridArgb !== c.gridArgb) patch.gridColor = { kind: 'argb', argb: g.gridArgb };
    if (g.subGridArgb !== c.subGridArgb) patch.subGridColor = { kind: 'argb', argb: g.subGridArgb };
    if (g.cellIndexArgb !== c.cellIndexArgb) patch.cellIndexColor = { kind: 'argb', argb: g.cellIndexArgb };
  }
  return patch;
}

/** Write a `layerOptionsPatch` result as one undo step. */
export function applyLayerOptions(doc: Y.Doc, layerId: string, patch: Record<string, unknown>): void {
  const keys = Object.keys(patch);
  if (keys.length === 0) return;
  doc.transact(() => {
    const layer = doc.getMap('layerData').get(layerId);
    if (!(layer instanceof Y.Map)) return;
    for (const k of keys) layer.set(k, patch[k]);
  }, LOCAL_ORIGIN);
}

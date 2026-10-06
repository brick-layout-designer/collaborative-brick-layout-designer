// Where module frames and names go (ModuleOverlay draws them; the fits
// that must keep the names on screen use the same numbers). No React or
// store here, so plain-Node code (saved views) can use it.
//
// The desktop draws the same (rendering/ModuleLabels.cpp), and both apps
// are tested against packages/bbm/tests/fixtures/render-parity/modules.json.

import type { BbmMap } from '@cld/model';
import type { SidecarModule } from '@cld/bbm';
import { studToPx } from './coords';

/** The module look both apps draw (packages/bbm/tests/fixtures/render-parity/modules.json). */
export const MODULE_FRAME_STROKE = 'rgba(100,180,255,0.8)';
export const MODULE_FRAME_DASH: [number, number] = [6, 4];
/** A module with some parts on hidden sheets: short, far-apart dashes ("there's more you can't see"). */
export const MODULE_FRAME_PARTLY_HIDDEN_DASH: [number, number] = [2, 6];
export const MODULE_NAME_FILL = 'rgba(100,180,255,0.9)';
export const MODULE_NAME_STROKE = 'rgba(0,0,0,0.6)';
/** A chosen colour is drawn at the default look's opacity: 0.8 for the outline, 0.9 for the name. */
export const MODULE_FRAME_ALPHA = 0.8;
export const MODULE_NAME_ALPHA = 0.9;
/** The full name, shown over a shortened one on hover or select: a dark pill behind it. */
export const MODULE_FULL_NAME_BG = 'rgba(0,0,0,0.75)';
/** The smallest a name gets before it is shortened with an ellipsis, in scene px (2 studs). */
export const MODULE_NAME_MIN_PX = 16;
/** Lines of a two-line name are one font size apart. */
export const MODULE_NAME_LINE_HEIGHT = 1;

/** The name's outline width. */
export function moduleNameStrokePx(fontPx: number): number {
  return Math.max(2, fontPx / 12);
}

/** Width of `text` in bold at a font size, in px. */
export type TextMeasure = (text: string) => (fontPx: number) => number;

/**
 * Module name font size in scene px: `percent`% of the frame's long axis,
 * clamped to 16..400 px like desktop.
 */
export function moduleLabelFontPx(frameWpx: number, frameHpx: number, percent: number): number {
  const longAxis = Math.max(frameWpx, frameHpx);
  const pct = Math.max(5, Math.min(100, percent));
  return Math.round(Math.max(16, Math.min(400, longAxis * (pct / 100))));
}

/** A name fitted to its side: one or two lines, never wider than the side. */
export interface ModuleNameFit {
  fontPx: number;
  lines: string[];
  /** Part of the name was cut off with an ellipsis (the full name shows on hover or select). */
  truncated: boolean;
}

const ELLIPSIS = '…';

/**
 * Fits a module's name to the side it sits on, so it is never longer than
 * the module's edge:
 *   1. the whole name on one line at `fontPx`;
 *   2. else on two lines (broken between words, as evenly as it goes);
 *   3. else the font shrinks, one line or two, whichever stays bigger,
 *      down to MODULE_NAME_MIN_PX;
 *   4. else, at that size, as many words as fit on the first line and the
 *      rest on the second, cut short with an ellipsis.
 * The desktop's fitModuleName (rendering/ModuleLabels.cpp) is the same,
 * step for step.
 */
export function fitModuleName(
  text: string,
  measure: TextMeasure,
  fontPx: number,
  side: number,
): ModuleNameFit {
  const w = (s: string, f: number) => measure(s)(f);
  const fits = (lines: string[], f: number) => lines.every((l) => w(l, f) <= side);
  if (w(text, fontPx) <= side) return { fontPx, lines: [text], truncated: false };

  const words = text.split(' ').filter((s) => s !== '');
  const split = balancedSplit(words, (s) => w(s, fontPx));
  if (split && split.widest <= side) return { fontPx, lines: split.lines, truncated: false };

  // Shrink: the bigger of the one-line and two-line sizes.
  const one = Math.floor((fontPx * side) / w(text, fontPx));
  const two = split ? Math.floor((fontPx * side) / split.widest) : 0;
  const lines = two > one ? split!.lines : [text];
  let f = Math.min(fontPx, Math.max(one, two));
  if (f >= MODULE_NAME_MIN_PX) {
    while (f > MODULE_NAME_MIN_PX && !fits(lines, f)) f--;
    if (fits(lines, f)) return { fontPx: f, lines, truncated: false };
  }

  // Last resort: the smallest size, cut short.
  f = MODULE_NAME_MIN_PX;
  const cut = (s: string) => ellipsize(s, (t) => w(t, f) <= side);
  let k = 0;
  while (k < words.length && w(words.slice(0, k + 1).join(' '), f) <= side) k++;
  let truncated = false;
  let first: string;
  if (k === 0) {
    first = cut(words[0] ?? text);
    truncated = true;
    k = 1;
  } else {
    first = words.slice(0, k).join(' ');
  }
  const rest = words.slice(k).join(' ');
  if (rest === '') return { fontPx: f, lines: [first], truncated };
  if (w(rest, f) <= side) return { fontPx: f, lines: [first, rest], truncated };
  return { fontPx: f, lines: [first, cut(rest)], truncated: true };
}

/** The two-line break that keeps the wider line narrowest (the first such break on a tie); null for one word. */
function balancedSplit(words: string[], width: (s: string) => number): { lines: string[]; widest: number } | null {
  let best: { lines: string[]; widest: number } | null = null;
  for (let i = 1; i < words.length; i++) {
    const a = words.slice(0, i).join(' ');
    const b = words.slice(i).join(' ');
    const widest = Math.max(width(a), width(b));
    if (!best || widest < best.widest) best = { lines: [a, b], widest };
  }
  return best;
}

/** `s` shortened from the end until it fits with an ellipsis after it. */
function ellipsize(s: string, fits: (t: string) => boolean): string {
  let t = s;
  while (t.length > 0 && !fits(t.trimEnd() + ELLIPSIS)) t = t.slice(0, -1);
  return t.trimEnd() + ELLIPSIS;
}

/** `#rrggbb` (or `#rgb`) as rgba() at an opacity; null for anything else. */
export function hexToRgba(hex: string | undefined, alpha: number): string | null {
  if (!hex) return null;
  let m = /^#([0-9a-f]{6})$/i.exec(hex)?.[1];
  if (!m) {
    const s = /^#([0-9a-f]{3})$/i.exec(hex)?.[1];
    if (!s) return null;
    m = s.split('').map((c) => c + c).join('');
  }
  const n = parseInt(m, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

/** How one placed module is drawn: its colours (the default look unless chosen) and whether its name shows. */
export function moduleLook(mod: Pick<SidecarModule, 'outlineColor' | 'nameColor' | 'showName'>): {
  frameStroke: string;
  nameFill: string;
  showName: boolean;
} {
  return {
    frameStroke: hexToRgba(mod.outlineColor, MODULE_FRAME_ALPHA) ?? MODULE_FRAME_STROKE,
    nameFill: hexToRgba(mod.nameColor, MODULE_NAME_ALPHA) ?? MODULE_NAME_FILL,
    showName: mod.showName !== false,
  };
}

/** Where one module's frame and name go, in scene px. */
export interface ModuleLabelLayout {
  id: string;
  /** The module's whole name. */
  name: string;
  frame: { x: number; y: number; width: number; height: number };
  /**
   * The name's anchor and box (`width` along the side it sits on, `height`
   * its lines); portrait names turn -90° about the anchor and read bottom
   * to top. Absent when the module's name is hidden.
   */
  text?: {
    x: number;
    y: number;
    rotation: number;
    width: number;
    height: number;
    fontPx: number;
    lines: string[];
    truncated: boolean;
  };
  /** Frame and name together. */
  bounds: { x: number; y: number; width: number; height: number };
  /** Some of its parts are on hidden sheets: the frame fits the rest, drawn with sparser dashes. */
  partlyHidden: boolean;
  frameStroke: string;
  nameFill: string;
}

const PAD = 4;
const GAP = 16; // desktop padOut

/**
 * Lay out every module's frame and name (the drawing below and the fits
 * that must show the names use the same numbers).
 */
export function moduleLabelLayouts(
  map: BbmMap,
  modules: readonly SidecarModule[],
  labelPercent: number,
  measure: TextMeasure,
): ModuleLabelLayout[] {
  if (modules.length === 0) return [];
  // Index brick positions by id.
  const brickById = new Map<string, { x: number; y: number; w: number; h: number }>();
  // Bricks on hidden sheets don't frame or name their module.
  const hidden = new Set<string>();
  for (const layer of map.layers) {
    if (layer.type !== 'brick') continue;
    if (!layer.visible) {
      for (const b of layer.bricks) hidden.add(b.id);
      continue;
    }
    for (const b of layer.bricks) {
      brickById.set(b.id, { x: b.displayArea.x, y: b.displayArea.y, w: b.displayArea.width, h: b.displayArea.height });
    }
  }
  const pxPerStud = studToPx();
  const out: ModuleLabelLayout[] = [];
  for (const mod of modules) {
    const box = moduleStudBox(mod, brickById);
    if (!box) continue;
    const partlyHidden = hidden.size > 0 && mod.members.some((id) => hidden.has(id));
    out.push({ ...moduleLabelLayout(mod, box, pxPerStud, labelPercent, measure), partlyHidden });
  }
  return out;
}

/** The bounds of a module's parts on visible sheets, in studs; null when none show. */
function moduleStudBox(
  mod: SidecarModule,
  brickById: Map<string, { x: number; y: number; w: number; h: number }>,
): { x: number; y: number; w: number; h: number } | null {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const id of mod.members) {
    const b = brickById.get(id);
    if (!b) continue;
    minX = Math.min(minX, b.x);
    minY = Math.min(minY, b.y);
    maxX = Math.max(maxX, b.x + b.w);
    maxY = Math.max(maxY, b.y + b.h);
  }
  return isFinite(minX) ? { x: minX, y: minY, w: maxX - minX, h: maxY - minY } : null;
}

function moduleLabelLayout(
  mod: SidecarModule,
  box: { x: number; y: number; w: number; h: number },
  pxPerStud: number,
  labelPercent: number,
  measure: TextMeasure,
): Omit<ModuleLabelLayout, 'partlyHidden'> {
  const px = box.x * pxPerStud;
  const py = box.y * pxPerStud;
  const pw = box.w * pxPerStud;
  const ph = box.h * pxPerStud;
  const portrait = ph > pw;
  const name = mod.name || '(module)';
  const look = moduleLook(mod);
  const frame = { x: px - PAD, y: py - PAD, width: pw + PAD * 2, height: ph + PAD * 2 };
  const base = { id: mod.id, name, frame, frameStroke: look.frameStroke, nameFill: look.nameFill };
  if (!look.showName) return { ...base, bounds: { ...frame } };
  // Landscape: centred above the frame. Portrait: turned along the left
  // edge, reading bottom-to-top. Either way no wider than that side.
  const side = portrait ? frame.height : frame.width;
  const fit = fitModuleName(name, measure, moduleLabelFontPx(pw, ph, labelPercent), side);
  const height = fit.lines.length * fit.fontPx * MODULE_NAME_LINE_HEIGHT;
  const text = portrait
    ? { x: frame.x - GAP - height, y: frame.y + frame.height, rotation: -90, width: side, height, ...fit }
    : { x: frame.x, y: frame.y - GAP - height, rotation: 0, width: side, height, ...fit };
  // The name's own box: a turned name runs up from its anchor.
  const nameBox = portrait
    ? { x: text.x, y: text.y - side, width: height, height: side }
    : { x: text.x, y: text.y, width: side, height };
  const x0 = Math.min(frame.x, nameBox.x);
  const y0 = Math.min(frame.y, nameBox.y);
  const x1 = Math.max(frame.x + frame.width, nameBox.x + nameBox.width);
  const y1 = Math.max(frame.y + frame.height, nameBox.y + nameBox.height);
  return { ...base, text, bounds: { x: x0, y: y0, width: x1 - x0, height: y1 - y0 } };
}

/**
 * The pill with the whole name, over a shortened name: one line at the
 * name's size, centred on the name's box (in the name's own turned frame:
 * x along the side, y across it), with a quarter-font margin.
 */
export function moduleFullNamePill(
  text: NonNullable<ModuleLabelLayout['text']>,
  name: string,
  measure: TextMeasure,
): { x: number; y: number; width: number; height: number; textX: number; textY: number } {
  const pad = Math.round(text.fontPx / 4);
  const width = Math.ceil(measure(name)(text.fontPx)) + pad * 2;
  const height = text.fontPx + pad * 2;
  const x = (text.width - width) / 2;
  const y = (text.height - height) / 2;
  return { x, y, width, height, textX: x + pad, textY: y + pad };
}

/** Every module's frame and name together, in studs (for fitting the view). */
export function moduleLabelBoundsStuds(
  map: BbmMap,
  modules: readonly SidecarModule[],
  labelPercent: number,
  measure: TextMeasure,
): { x: number; y: number; width: number; height: number }[] {
  const k = studToPx();
  return moduleLabelLayouts(map, modules, labelPercent, measure).map(({ bounds: b }) => ({
    x: b.x / k,
    y: b.y / k,
    width: b.width / k,
    height: b.height / k,
  }));
}

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
/** A chosen color is drawn at the default look's opacity: 0.8 for the outline, 0.9 for the name. */
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

/** A name is never taller than this share of its module's short side (a long, thin module got a name far bigger than itself). */
export const MODULE_NAME_SHORT_SHARE = 0.5;

/**
 * Module name font size in scene px: `percent`% of the frame's long axis,
 * at most MODULE_NAME_SHORT_SHARE of its short axis, clamped to 16..400 px
 * like desktop.
 */
export function moduleLabelFontPx(frameWpx: number, frameHpx: number, percent: number): number {
  const longAxis = Math.max(frameWpx, frameHpx);
  const shortAxis = Math.min(frameWpx, frameHpx);
  const pct = Math.max(5, Math.min(100, percent));
  return Math.round(Math.max(16, Math.min(400, longAxis * (pct / 100), shortAxis * MODULE_NAME_SHORT_SHARE)));
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

/**
 * How one placed module is drawn: its colors (chosen, else `defaultHex`,
 * its own default color from moduleColors, else the light blue) and
 * whether its name shows.
 */
export function moduleLook(mod: Pick<SidecarModule, 'outlineColor' | 'nameColor' | 'showName'>, defaultHex?: string): {
  frameStroke: string;
  nameFill: string;
  showName: boolean;
} {
  return {
    frameStroke: hexToRgba(mod.outlineColor, MODULE_FRAME_ALPHA) ?? hexToRgba(defaultHex, MODULE_FRAME_ALPHA) ?? MODULE_FRAME_STROKE,
    nameFill: hexToRgba(mod.nameColor, MODULE_NAME_ALPHA) ?? hexToRgba(defaultHex, MODULE_NAME_ALPHA) ?? MODULE_NAME_FILL,
    showName: mod.showName !== false,
  };
}

// ---- Default colors --------------------------------------------------------

/**
 * Each module's own default color comes from this palette: distinct hues,
 * light enough to read inside the name's dark outline (at least 10:1
 * against black), apart from the map's default blue (at least 1.4:1 and
 * 30° of hue), on light and dark themes alike.
 */
export const MODULE_PALETTE = ['#FFE066', '#FFA94D', '#FCC2D7', '#E599F7', '#8CE99A', '#C0EB75', '#66D9E8', '#63E6BE'] as const;
/** Modules this close (studs) count as neighbours, which get different colors. */
export const MODULE_NEIGHBOUR_STUDS = 4;

/** FNV-1a over the id's UTF-16 code units: the same number in both apps. */
export function moduleIdHash(id: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

type StudBox = { x: number; y: number; w: number; h: number };

function near(a: StudBox, b: StudBox, d: number): boolean {
  return a.x - d < b.x + b.w && b.x - d < a.x + a.w && a.y - d < b.y + b.h && b.y - d < a.y + a.h;
}

/**
 * Every module's default color (a palette hex), from its id so it is the
 * same everywhere, stepping on through the palette when a neighbour
 * (placed earlier in the list) already has it. Chosen colors (Colors…)
 * don't change this; they draw over it.
 */
export function moduleColors(modules: readonly { id: string; box: StudBox | null }[]): Map<string, string> {
  const n = MODULE_PALETTE.length;
  const index = new Map<string, number>();
  const out = new Map<string, string>();
  for (const m of modules) {
    const taken = new Set<number>();
    if (m.box) {
      for (const o of modules) {
        const k = index.get(o.id);
        if (o === m || k === undefined || !o.box) continue;
        if (near(m.box, o.box, MODULE_NEIGHBOUR_STUDS)) taken.add(k);
      }
    }
    let k = moduleIdHash(m.id) % n;
    for (let t = 0; t < n && taken.has(k); t++) k = (k + 1) % n;
    index.set(m.id, k);
    out.set(m.id, MODULE_PALETTE[k]!);
  }
  return out;
}

/** Which side of its module a name sits on. */
export type ModuleNameSide = 'top' | 'bottom' | 'left' | 'right' | 'inside';

/** Where one module's frame and name go, in scene px. */
export interface ModuleLabelLayout {
  id: string;
  /** The module's whole name. */
  name: string;
  frame: { x: number; y: number; width: number; height: number };
  /**
   * The name's anchor and box (`width` along the side it sits on, `height`
   * its lines). A name turned -90° (on the left, or inside a tall module)
   * reads bottom to top from its anchor at the box's bottom-left; one
   * turned 90° (on the right) reads top to bottom from its anchor at the
   * box's top-right, so neither is ever upside down. Absent when the
   * module's name is hidden.
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
  /** Where the name went (absent when hidden). */
  side?: ModuleNameSide;
  /** Which candidate place it took ("top:0", "inside:1"): a live drag keeps it (placeModuleNames `keep`). */
  slot?: string;
  /** Frame and name together. */
  bounds: { x: number; y: number; width: number; height: number };
  /** Some of its parts are on hidden sheets: the frame fits the rest, drawn with sparser dashes. */
  partlyHidden: boolean;
  frameStroke: string;
  nameFill: string;
}

const PAD = 4;
const GAP = 16; // desktop padOut

type Box = { x: number; y: number; width: number; height: number };

/**
 * Lay out every module's frame and name (the drawing below and the fits
 * that must show the names use the same numbers). Names are placed
 * together (placeModuleNames), so they keep clear of parts and of each
 * other; each module gets its own default color (moduleColors).
 */
export function moduleLabelLayouts(
  map: BbmMap,
  modules: readonly SidecarModule[],
  labelPercent: number,
  measure: TextMeasure,
  keep?: ReadonlyMap<string, string>,
): ModuleLabelLayout[] {
  if (modules.length === 0) return [];
  // Index brick positions by id.
  const brickById = new Map<string, { x: number; y: number; w: number; h: number }>();
  // Bricks on hidden sheets don't frame or name their module, nor keep names off.
  const hidden = new Set<string>();
  const k = studToPx();
  const parts: Box[] = [];
  for (const layer of map.layers) {
    if (layer.type !== 'brick') continue;
    if (!layer.visible) {
      for (const b of layer.bricks) hidden.add(b.id);
      continue;
    }
    for (const b of layer.bricks) {
      brickById.set(b.id, { x: b.displayArea.x, y: b.displayArea.y, w: b.displayArea.width, h: b.displayArea.height });
      parts.push({ x: b.displayArea.x * k, y: b.displayArea.y * k, width: b.displayArea.width * k, height: b.displayArea.height * k });
    }
  }
  const boxes = modules.map((m) => ({ mod: m, box: moduleStudBox(m, brickById) }));
  const colors = moduleColors(boxes.map((b) => ({ id: b.mod.id, box: b.box })));
  const shown = boxes.filter((b): b is { mod: SidecarModule; box: StudBox } => b.box !== null);
  const placed = placeModuleNames(
    shown.map((b) => ({ id: b.mod.id, name: b.mod.name || '(module)', studs: b.box, showName: b.mod.showName !== false })),
    parts,
    labelPercent,
    measure,
    keep,
  );
  return placed.map((p, i) => {
    const mod = shown[i]!.mod;
    const look = moduleLook(mod, colors.get(mod.id));
    const partlyHidden = hidden.size > 0 && mod.members.some((id) => hidden.has(id));
    return { ...p, partlyHidden, frameStroke: look.frameStroke, nameFill: look.nameFill };
  });
}

/** Every module's own default color in a layout (moduleColors over where its parts are). */
export function layoutModuleColors(map: BbmMap, modules: readonly SidecarModule[]): Map<string, string> {
  const brickById = new Map<string, { x: number; y: number; w: number; h: number }>();
  for (const layer of map.layers) {
    if (layer.type !== 'brick' || !layer.visible) continue;
    for (const b of layer.bricks) brickById.set(b.id, { x: b.displayArea.x, y: b.displayArea.y, w: b.displayArea.width, h: b.displayArea.height });
  }
  return moduleColors(modules.map((m) => ({ id: m.id, box: moduleStudBox(m, brickById) })));
}

/** The bounds of a module's parts on visible sheets, in studs; null when none show. */
function moduleStudBox(
  mod: SidecarModule,
  brickById: Map<string, { x: number; y: number; w: number; h: number }>,
): StudBox | null {
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

// ---- Where names go ---------------------------------------------------------
//
// Each name is placed in turn (in the modules' order), choosing among
// candidate places around its module (and, as a last resort, inside it)
// the one with the lowest score:
//   - parts under the name (×100, as a share of the name's area, and 20
//     for touching any);
//   - names already placed under it (×100, and 50 for touching any);
//   - other modules' frames under it (×20);
//   - facing in: 4 × (1 − how much the side faces away from the layout's
//     middle), so on a ring of tables (nothing at the layout's middle)
//     names go on the outside edge; 1 × that when the middle is filled;
//   - the module's own long side first, then top before bottom and left
//     before right (0, 0.5, 1, 1.5);
//   - shrinking (6 × how much smaller) and being cut short (10);
//   - each step further out (3), and inside the module (30).
// Ties go to the first candidate. Top and bottom names are level; names on
// the left read bottom to top and on the right top to bottom. The desktop's
// placeModuleNames (rendering/ModuleLabels.cpp) is the same, step by step.

export const MODULE_NAME_SCORE = {
  parts: 100,
  anyPart: 20,
  names: 100,
  anyName: 50,
  frames: 20,
  inward: 4,
  /** Facing in when the layout's middle is filled (not a ring). */
  inwardSolid: 1,
  shrink: 6,
  cut: 10,
  level: 3,
  inside: 30,
  levels: 3,
} as const;

export interface ModuleNameInput {
  id: string;
  name: string;
  /** The module's visible parts' bounds, in studs. */
  studs: StudBox;
  showName: boolean;
}

export type PlacedModuleName = Omit<ModuleLabelLayout, 'partlyHidden' | 'frameStroke' | 'nameFill'>;

function overlap(a: Box, b: Box): number {
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

/** Part boxes bucketed on a grid, so each candidate only looks at parts near it. */
class PartGrid {
  private readonly cells = new Map<string, number[]>();
  constructor(
    private readonly boxes: readonly Box[],
    private readonly cell = 512,
  ) {
    boxes.forEach((b, i) => {
      for (let cx = Math.floor(b.x / cell); cx <= Math.floor((b.x + b.width) / cell); cx++)
        for (let cy = Math.floor(b.y / cell); cy <= Math.floor((b.y + b.height) / cell); cy++) {
          const key = `${cx},${cy}`;
          const list = this.cells.get(key);
          if (list) list.push(i);
          else this.cells.set(key, [i]);
        }
    });
  }
  /** The summed overlap of `q` with every part, in part order. */
  covered(q: Box): number {
    const seen = new Set<number>();
    for (let cx = Math.floor(q.x / this.cell); cx <= Math.floor((q.x + q.width) / this.cell); cx++)
      for (let cy = Math.floor(q.y / this.cell); cy <= Math.floor((q.y + q.height) / this.cell); cy++)
        for (const i of this.cells.get(`${cx},${cy}`) ?? []) seen.add(i);
    let sum = 0;
    for (const i of [...seen].sort((a, b) => a - b)) sum += overlap(q, this.boxes[i]!);
    return sum;
  }
}

type Side = Exclude<ModuleNameSide, 'inside'>;
const NORMAL: Record<Side, { x: number; y: number }> = {
  top: { x: 0, y: -1 },
  bottom: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};

/**
 * Places every module's frame and name together: names keep clear of the
 * parts (`parts`, scene px) and of each other, and on a ring of modules go
 * on its outside edge.
 */
export function placeModuleNames(
  modules: readonly ModuleNameInput[],
  parts: readonly Box[],
  labelPercent: number,
  measure: TextMeasure,
  /** Module id → the slot to keep (while parts are dragged, names stay on their side). */
  keep?: ReadonlyMap<string, string>,
): PlacedModuleName[] {
  const k = studToPx();
  const S = MODULE_NAME_SCORE;
  const frames = modules.map((m) => ({
    x: m.studs.x * k - PAD,
    y: m.studs.y * k - PAD,
    width: m.studs.w * k + PAD * 2,
    height: m.studs.h * k + PAD * 2,
  }));
  // The layout's middle: the middle of all the modules together.
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const f of frames) {
    x0 = Math.min(x0, f.x);
    y0 = Math.min(y0, f.y);
    x1 = Math.max(x1, f.x + f.width);
    y1 = Math.max(y1, f.y + f.height);
  }
  const mid = { x: (x0 + x1) / 2, y: (y0 + y1) / 2 };
  const half = { x: Math.max((x1 - x0) / 2, 1), y: Math.max((y1 - y0) / 2, 1) };
  const grid = new PartGrid(parts);
  // A ring (a hole in the middle): nothing within a tenth of the layout's size of its middle.
  const r = Math.min(half.x, half.y) / 10;
  const ring = grid.covered({ x: mid.x - r, y: mid.y - r, width: 2 * r, height: 2 * r }) === 0;
  const inward = ring ? S.inward : S.inwardSolid;
  const names: Box[] = [];
  return modules.map((m, mi) => {
    const frame = frames[mi]!;
    const base = { id: m.id, name: m.name, frame };
    if (!m.showName) return { ...base, bounds: { ...frame } };
    const pw = m.studs.w * k;
    const ph = m.studs.h * k;
    const portrait = ph > pw;
    const f0 = moduleLabelFontPx(pw, ph, labelPercent);
    // Which way is out: from the layout's middle to the module's.
    const dx = (frame.x + frame.width / 2 - mid.x) / half.x;
    const dy = (frame.y + frame.height / 2 - mid.y) / half.y;
    const len = Math.hypot(dx, dy);
    const away = len < 0.2 ? null : { x: dx / len, y: dy / len };
    const pref: Record<ModuleNameSide, number> = portrait
      ? { left: 0, right: 0.5, top: 1, bottom: 1.5, inside: 0 }
      : { top: 0, bottom: 0.5, left: 1, right: 1.5, inside: 0 };
    // Never longer than the module's edge (its parts, not the frame round them).
    const fitTo = (side: number) => {
      const fit = fitModuleName(m.name, measure, f0, side - 2 * PAD);
      const w = Math.max(...fit.lines.map((l) => measure(l)(fit.fontPx)));
      const h = fit.lines.length * fit.fontPx * MODULE_NAME_LINE_HEIGHT;
      return { side, fit, w, h };
    };
    const across = fitTo(frame.width);
    const along = fitTo(frame.height);
    type Cand = { slot: string; side: ModuleNameSide; x: number; y: number; rotation: number; box: Box; f: typeof across; extra: number };
    const cands: Cand[] = [];
    const xMid = frame.x + (frame.width - across.w) / 2;
    const yMid = frame.y + (frame.height - along.w) / 2;
    for (let level = 0; level < S.levels; level++) {
      const top = frame.y - GAP - across.h - level * (across.h + GAP);
      const bottom = frame.y + frame.height + GAP + level * (across.h + GAP);
      const left = frame.x - GAP - along.h - level * (along.h + GAP);
      const right = frame.x + frame.width + GAP + along.h + level * (along.h + GAP);
      const extra = level * S.level;
      cands.push(
        { slot: `top:${level}`, side: 'top', x: frame.x, y: top, rotation: 0, box: { x: xMid, y: top, width: across.w, height: across.h }, f: across, extra },
        { slot: `bottom:${level}`, side: 'bottom', x: frame.x, y: bottom, rotation: 0, box: { x: xMid, y: bottom, width: across.w, height: across.h }, f: across, extra },
        { slot: `left:${level}`, side: 'left', x: left, y: frame.y + frame.height, rotation: -90, box: { x: left, y: yMid, width: along.h, height: along.w }, f: along, extra },
        { slot: `right:${level}`, side: 'right', x: right, y: frame.y, rotation: 90, box: { x: right - along.h, y: yMid, width: along.h, height: along.w }, f: along, extra },
      );
    }
    // Inside, as a last resort: the emptiest of three places across the module.
    const inner = portrait ? along : across;
    for (let i = 0; i < 3; i++) {
      if (portrait) {
        const space = frame.width - 2 * PAD - inner.h;
        const x = frame.x + PAD + (space > 0 ? (i * space) / 2 : space / 2);
        const box = { x, y: frame.y + (frame.height - inner.w) / 2, width: inner.h, height: inner.w };
        cands.push({ slot: `inside:${i}`, side: 'inside', x, y: frame.y + frame.height, rotation: -90, box, f: inner, extra: S.inside });
      } else {
        const space = frame.height - 2 * PAD - inner.h;
        const y = frame.y + PAD + (space > 0 ? (i * space) / 2 : space / 2);
        const box = { x: frame.x + (frame.width - inner.w) / 2, y, width: inner.w, height: inner.h };
        cands.push({ slot: `inside:${i}`, side: 'inside', x: frame.x, y, rotation: 0, box, f: inner, extra: S.inside });
      }
    }
    let best = cands[0]!;
    let bestScore = Infinity;
    const kept = keep?.get(m.id);
    for (const c of kept && cands.some((x) => x.slot === kept) ? cands.filter((x) => x.slot === kept) : cands) {
      const area = Math.max(c.box.width * c.box.height, 1);
      let score = c.extra + pref[c.side];
      const onParts = grid.covered(c.box);
      score += (S.parts * onParts) / area + (onParts > 0 ? S.anyPart : 0);
      let onNames = 0;
      for (const n of names) onNames += overlap(c.box, n);
      score += (S.names * onNames) / area + (onNames > 0 ? S.anyName : 0);
      frames.forEach((f, fi) => {
        if (fi !== mi) score += (S.frames * overlap(c.box, f)) / area;
      });
      if (c.side !== 'inside' && away) {
        const n = NORMAL[c.side];
        score += inward * (1 - (n.x * away.x + n.y * away.y));
      }
      score += S.shrink * (1 - c.f.fit.fontPx / f0) + (c.f.fit.truncated ? S.cut : 0);
      if (score < bestScore - 1e-9) {
        bestScore = score;
        best = c;
      }
    }
    names.push(best.box);
    const f = best.f;
    const text = { x: best.x, y: best.y, rotation: best.rotation, width: f.side, height: f.h, fontPx: f.fit.fontPx, lines: f.fit.lines, truncated: f.fit.truncated };
    // The name's whole box along its side (where it may be drawn).
    const nameBox =
      best.rotation === -90
        ? { x: best.x, y: best.y - f.side, width: f.h, height: f.side }
        : best.rotation === 90
          ? { x: best.x - f.h, y: best.y, width: f.h, height: f.side }
          : { x: best.x, y: best.y, width: f.side, height: f.h };
    const bx0 = Math.min(frame.x, nameBox.x);
    const by0 = Math.min(frame.y, nameBox.y);
    const bx1 = Math.max(frame.x + frame.width, nameBox.x + nameBox.width);
    const by1 = Math.max(frame.y + frame.height, nameBox.y + nameBox.height);
    return { ...base, text, side: best.side, slot: best.slot, bounds: { x: bx0, y: by0, width: bx1 - bx0, height: by1 - by0 } };
  });
}

/**
 * What a module's name says on hover: the whole name, and "(partly hidden)"
 * when some of its parts are on a hidden sheet. Null when hover adds nothing.
 */
export function moduleHoverName(layout: Pick<ModuleLabelLayout, 'name' | 'partlyHidden' | 'text'>): string | null {
  if (!layout.text) return null;
  if (layout.partlyHidden) return `${layout.name} (partly hidden)`;
  return layout.text.truncated ? layout.name : null;
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

// The numbers both apps draw a sheet from: a grid's cell size, line
// thicknesses and sub-divisions, an area sheet's cell size, every sheet's
// transparency and hull thickness, and each ruler's geometry, thicknesses,
// dash pattern, unit and font size. Each must be a finite number (a whole
// number where the desktop holds an int) inside the range below; a huge
// sub-division count, say, has a map draw lines without end. The grid
// guard (gridGuard.ts) refuses an update or a whole document that would
// leave one outside its range, unless it was already so before (a layout
// saved that way can still be edited and fixed). A field that isn't there
// is fine (the apps use their default), except a grid's cell size.
//
// The ranges are wide enough for every layout file we've seen (the apps'
// own dialogs allow less): fixtures/contracts/update-guard.json
// (drawingSettings) holds them for the desktop.

import * as Y from 'yjs';

export type Rule = (v: unknown) => boolean;

const num =
  (min: number, max: number): Rule =>
  (v) =>
    typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
const int =
  (min: number, max: number): Rule =>
  (v) =>
    num(min, max)(v) && Number.isInteger(v);
/** A plain object whose listed fields, when there, follow their rules. */
const obj =
  (fields: Record<string, Rule>): Rule =>
  (v) => {
    if (v === null || typeof v !== 'object' || Array.isArray(v) || v instanceof Y.AbstractType) return false;
    const o = v as Record<string, unknown>;
    return Object.entries(fields).every(([k, rule]) => o[k] === undefined || rule(o[k]));
  };

/** The largest coordinate a ruler may have, in studs (a layout is far smaller). */
export const MAX_COORD = 10_000_000;
const coord = num(-MAX_COORD, MAX_COORD);
const point = obj({ x: coord, y: coord });
const font = obj({ size: num(1, 1000) });
const thickness = num(0, 100);

/** A dash pattern: at most 64 lengths from 0 to 1000, not all (nearly) zero. */
const dashes: Rule = (v) => {
  if (!Array.isArray(v) || v.length > 64) return false;
  if (!v.every(num(0, 1000))) return false;
  return v.length === 0 || (v as number[]).reduce((a, b) => a + b, 0) >= 0.01;
};

/** A sheet's own fields (any kind of sheet; the grid's cell size is checked on its own, gridGuard.ts). */
export const SHEET_RULES: Readonly<Record<string, Rule>> = {
  transparency: num(0, 100),
  hullProperties: obj({ hullThickness: thickness }),
  gridThickness: thickness,
  subGridThickness: thickness,
  subDivisionNumber: int(1, 100),
  cellIndexFont: font,
  cellIndexCorner: obj({ x: int(-1_000_000, 1_000_000), y: int(-1_000_000, 1_000_000) }),
  areaCellSize: int(1, 4096),
};

/** A ruler's fields. */
export const RULER_RULES: Readonly<Record<string, Rule>> = {
  lineThickness: thickness,
  guidelineThickness: thickness,
  guidelineDashPattern: dashes,
  unit: int(0, 16),
  measureFont: font,
  point1: point,
  point2: point,
  center: point,
  radius: num(0, MAX_COORD),
  offsetDistance: coord,
};

/** The limits in words, for the contract file and the PR. */
export const LIMITS_TEXT: Readonly<Record<string, string>> = {
  'sheet.transparency': 'number 0 to 100',
  'sheet.hullProperties.hullThickness': 'number 0 to 100',
  'grid.gridSizeInStud': 'number 1 to 2147483647 (required on a grid)',
  'grid.gridThickness': 'number 0 to 100',
  'grid.subGridThickness': 'number 0 to 100',
  'grid.subDivisionNumber': 'whole number 1 to 100',
  'grid.cellIndexFont.size': 'number 1 to 1000',
  'grid.cellIndexCorner.x/y': 'whole number -1000000 to 1000000',
  'area.areaCellSize': 'whole number 1 to 4096',
  'ruler.lineThickness': 'number 0 to 100',
  'ruler.guidelineThickness': 'number 0 to 100',
  'ruler.guidelineDashPattern': 'at most 64 numbers 0 to 1000, adding up to 0.01 or more (or none)',
  'ruler.unit': 'whole number 0 to 16',
  'ruler.measureFont.size': 'number 1 to 1000',
  'ruler.point1/point2/center.x/y': 'number -10000000 to 10000000',
  'ruler.radius': 'number 0 to 10000000',
  'ruler.offsetDistance': 'number -10000000 to 10000000',
};

/** Keys of a sheet the guard reads (besides `type` and the grid size). */
export const SHEET_KEYS: ReadonlySet<string> = new Set(Object.keys(SHEET_RULES));
export const RULER_KEYS: ReadonlySet<string> = new Set(Object.keys(RULER_RULES));

/** A ruler as the guard sees it: its id (or place) and how to read a field. */
export interface RulerView {
  key: string;
  read: (field: string) => unknown;
}

/**
 * What is outside its range on one sheet, as `<sheet>.<field>` and
 * `<sheet>.rulers.<ruler>.<field>` (the grid's cell size is gridGuard's).
 */
export function sheetProblems(sheet: string, read: (field: string) => unknown, rulers: Iterable<RulerView>): string[] {
  const out: string[] = [];
  for (const [field, rule] of Object.entries(SHEET_RULES)) {
    const v = read(field);
    if (v !== undefined && !rule(v)) out.push(`${sheet}.${field}`);
  }
  for (const r of rulers) {
    for (const [field, rule] of Object.entries(RULER_RULES)) {
      const v = r.read(field);
      if (v !== undefined && !rule(v)) out.push(`${sheet}.rulers.${r.key}.${field}`);
    }
  }
  return out;
}

/** A ruler entry (a Y.Map, or plain JSON in older docs) as a RulerView; `place` names one without an id. */
export function rulerView(v: unknown, place: string): RulerView | null {
  if (v instanceof Y.Map) {
    const id = v.get('id');
    return { key: typeof id === 'string' && id ? id : place, read: (f) => v.get(f) };
  }
  if (v !== null && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Y.AbstractType)) {
    const o = v as Record<string, unknown>;
    return { key: typeof o.id === 'string' && o.id ? o.id : place, read: (f) => o[f] };
  }
  return null;
}

/** Where an entry of a list is, by the id of its struct (the same in every copy of the document). */
export const placeOf = (client: number, clock: number) => `@${client}:${clock}`;

/** The entries of a Y.Array in a document as it is, each with its place. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function arrayEntries(arr: Y.AbstractType<any>): { value: unknown; place: string }[] {
  const out: { value: unknown; place: string }[] = [];
  for (let item = arr._start; item; item = item.right) {
    if (item.deleted) continue;
    const values = item.content.getContent();
    values.forEach((value, j) => out.push({ value, place: placeOf(item.id.client, item.id.clock + j) }));
  }
  return out;
}

/** The problems of a sheet of a document as it is (its rulers too). */
export function docSheetProblems(sheet: string, layer: Y.Map<unknown>): string[] {
  const arr = layer.get('rulerItems');
  const rulers: RulerView[] = [];
  if (arr instanceof Y.Array) {
    for (const e of arrayEntries(arr)) {
      const r = rulerView(e.value, e.place);
      if (r) rulers.push(r);
    }
  }
  return sheetProblems(sheet, (f) => layer.get(f), rulers);
}

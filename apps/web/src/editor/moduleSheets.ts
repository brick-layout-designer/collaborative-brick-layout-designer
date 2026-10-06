// How a module's sheets meet a layout's sheets, in both directions.
//
// Saving: the picked parts keep the sheets they sit on (one module sheet
// per layout sheet, same name, same fade), or all go on one sheet named
// after the sheet with the most of them.
//
// Inserting: each module sheet goes on the layout's parts sheet with the
// same name (case and spaces at either end don't count). A module sheet
// with no match is never given a surprise new sheet: the person is asked
// "Where should these go?" (the picked sheet, or a new sheet by that name).

import * as Y from 'yjs';
import type { BbmMap, Brick, Layer, LayerBrick } from '@cld/model';
import type { ModuleBatch } from './mutations';

/** Two sheet names are the same sheet when they match ignoring case and spaces at either end. */
export function sheetKey(name: string): string {
  return name.trim().toLowerCase();
}

/** The parts sheet named `name` (see `sheetKey`), first in sheet order; null when none. */
export function findPartsSheet(layers: readonly Pick<Layer, 'id' | 'name' | 'type'>[], name: string): string | null {
  const key = sheetKey(name);
  return layers.find((l) => l.type === 'brick' && sheetKey(l.name) === key)?.id ?? null;
}

/** Where one module sheet's parts go: an existing sheet, or a new sheet with this name. */
export type SheetChoice = { layerId: string } | { newName: string };

/** The answer to "Where should these go?": module sheet name → where. */
export type SheetChoices = Record<string, SheetChoice>;

export interface UnmatchedSheet {
  /** The module sheet's name, as the batches carry it. */
  name: string;
  parts: number;
}

/** The module's sheets (with parts) that no parts sheet in the layout matches, in module order. */
export function unmatchedSheets(map: Pick<BbmMap, 'layers'>, batches: readonly ModuleBatch[]): UnmatchedSheet[] {
  const out: UnmatchedSheet[] = [];
  for (const b of batches) {
    if (b.bricks.length === 0) continue;
    const name = b.layerName || 'Module';
    if (findPartsSheet(map.layers, name)) continue;
    const same = out.find((u) => sheetKey(u.name) === sheetKey(name));
    if (same) same.parts += b.bricks.length;
    else out.push({ name, parts: b.bricks.length });
  }
  return out;
}

/** The module's sheets with parts, merged by name, in module order. */
export function moduleSheetNames(batches: readonly ModuleBatch[]): string[] {
  const out: string[] = [];
  for (const b of batches) {
    if (b.bricks.length === 0) continue;
    const name = b.layerName || 'Module';
    if (!out.some((n) => sheetKey(n) === sheetKey(name))) out.push(name);
  }
  return out;
}

/** The sheet new parts go on: the picked sheet when it's a parts sheet, else the top parts sheet; null when there's none. */
export function pickedPartsSheet(map: Pick<BbmMap, 'layers'>, activeLayerId: string | null): string | null {
  const active = map.layers.find((l) => l.id === activeLayerId);
  if (active?.type === 'brick') return active.id;
  for (let i = map.layers.length - 1; i >= 0; i--) if (map.layers[i]!.type === 'brick') return map.layers[i]!.id;
  return null;
}

/** The starting answer: every unmatched sheet on the picked sheet, or a new sheet by its name when the layout has no parts sheet. */
export function defaultChoices(unmatched: readonly UnmatchedSheet[], picked: string | null): SheetChoices {
  const out: SheetChoices = {};
  for (const u of unmatched) out[u.name] = picked ? { layerId: picked } : { newName: u.name };
  return out;
}

// ---- Saving ---------------------------------------------------------------

/** The picked parts grouped by the parts sheet they sit on, in sheet order. */
export function pickedBySheet(map: BbmMap, selection: readonly string[]): { layer: LayerBrick; bricks: Brick[] }[] {
  const sel = new Set(selection);
  const out: { layer: LayerBrick; bricks: Brick[] }[] = [];
  for (const layer of map.layers) {
    if (layer.type !== 'brick') continue;
    const bricks = layer.bricks.filter((b) => sel.has(b.id));
    if (bricks.length > 0) out.push({ layer, bricks });
  }
  return out;
}

/** The name for "Put everything on one sheet": the sheet with the most of the picked parts (the first, on a tie). */
export function oneSheetName(groups: readonly { layer: Pick<Layer, 'name'>; bricks: readonly unknown[] }[]): string {
  let best = groups[0];
  for (const g of groups) if (best && g.bricks.length > best.bricks.length) best = g;
  return best?.layer.name || 'Module';
}

const DEFAULT_HULL = { isVisible: false, hullColor: { kind: 'known' as const, name: 'black' }, hullThickness: 1 };

/**
 * The module's map from the picked parts: centred on (0, 0), one parts
 * sheet per layout sheet they came from (same name and fade, always
 * shown), or one sheet when `oneSheet`. Null when no parts are picked.
 * `region` is where they were on the layout, for the module's picture.
 */
export function moduleMapFromSelection(
  map: BbmMap,
  selection: readonly string[],
  opts: { oneSheet?: boolean } = {},
): { moduleMap: BbmMap; region: { x: number; y: number; width: number; height: number }; count: number } | null {
  const groups = pickedBySheet(map, selection);
  const all = groups.flatMap((g) => g.bricks);
  if (all.length === 0) return null;
  let cx = 0, cy = 0;
  for (const b of all) {
    cx += (b.displayArea.x + b.displayArea.width / 2) / all.length;
    cy += (b.displayArea.y + b.displayArea.height / 2) / all.length;
  }
  const x0 = Math.min(...all.map((b) => b.displayArea.x));
  const y0 = Math.min(...all.map((b) => b.displayArea.y));
  const x1 = Math.max(...all.map((b) => b.displayArea.x + b.displayArea.width));
  const y1 = Math.max(...all.map((b) => b.displayArea.y + b.displayArea.height));
  const sheets =
    opts.oneSheet && groups.length > 1
      ? [{ name: oneSheetName(groups), transparency: 100, bricks: all }]
      : groups.map((g) => ({ name: g.layer.name, transparency: g.layer.transparency, bricks: g.bricks }));
  const moduleMap: BbmMap = {
    version: map.version,
    nbItems: all.length,
    backgroundColor: map.backgroundColor,
    author: map.author,
    lug: map.lug,
    event: map.event,
    date: map.date,
    comment: '',
    exportInfo: map.exportInfo,
    selectedLayerIndex: 0,
    layers: sheets.map((s, i) => ({
      type: 'brick' as const,
      id: `module-layer-${i}`,
      name: s.name,
      visible: true,
      // The layout sheet's fade (100 = solid). Before 2026-10 this was
      // written as 0, which hid the parts in the module editor and in
      // BlueBrick; `repairModuleSheets` mends those modules on open.
      transparency: s.transparency,
      displayBrickElevation: false,
      hullProperties: DEFAULT_HULL,
      groups: [],
      bricks: s.bricks.map((b) => ({
        ...b,
        connexions: [],
        displayArea: { ...b.displayArea, x: b.displayArea.x - cx, y: b.displayArea.y - cy },
      })),
    })),
  };
  return { moduleMap, region: { x: x0 - 1, y: y0 - 1, width: x1 - x0 + 2, height: y1 - y0 + 2 }, count: all.length };
}

/**
 * Mends a module saved by the web before 2026-10, whose sheets were
 * written fully see-through (transparency 0): its parts sheets made by
 * Save module (ids `module-layer-N`) at 0 are set solid again. Returns
 * how many were mended. Runs before edits are tracked, so it doesn't
 * count as an unsaved change; the mended value is saved with the next Save.
 */
export function repairModuleSheets(doc: Y.Doc): number {
  let mended = 0;
  const layerData = doc.getMap<unknown>('layerData');
  doc.transact(() => {
    for (const [id, l] of layerData) {
      if (!(l instanceof Y.Map) || l.get('type') !== 'brick' || !/^module-layer-\d+$/.test(id)) continue;
      if (l.get('transparency') !== 0) continue;
      l.set('transparency', 100);
      mended++;
    }
  });
  return mended;
}

// ---- A placed module's sheets ---------------------------------------------

export interface ModuleSheetUse {
  id: string;
  name: string;
  visible: boolean;
  /** How many of the module's parts are on it. */
  parts: number;
}

/** The parts sheets a placed module's parts are on, in sheet order. */
export function moduleSheetsUsed(map: Pick<BbmMap, 'layers'>, members: readonly string[]): ModuleSheetUse[] {
  if (members.length === 0) return [];
  const set = new Set(members);
  const out: ModuleSheetUse[] = [];
  for (const l of map.layers) {
    if (l.type !== 'brick') continue;
    let n = 0;
    for (const b of l.bricks) if (set.has(b.id)) n++;
    if (n > 0) out.push({ id: l.id, name: l.name, visible: l.visible, parts: n });
  }
  return out;
}

/** What the Modules panel says when some or all of a module's sheets are hidden; null when all show. */
export function hiddenSheetsNote(uses: readonly ModuleSheetUse[]): string | null {
  const hidden = uses.filter((u) => !u.visible);
  if (hidden.length === 0) return null;
  if (hidden.length === uses.length) return uses.length === 1 ? 'hidden: its sheet is hidden' : 'hidden: its sheets are hidden';
  const parts = hidden.reduce((n, u) => n + u.parts, 0);
  return `${parts} ${parts === 1 ? 'part is' : 'parts are'} on a hidden sheet`;
}

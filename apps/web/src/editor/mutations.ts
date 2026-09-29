// All Yjs doc mutations the editor performs. Pulled out of the React tree
// so the rules (origin-tagging, transaction granularity, brick lookup) can
// be unit-tested directly against a Y.Doc.
//
// Every mutation wraps in `doc.transact(fn, LOCAL_ORIGIN)` so that
// Y.UndoManager configured with `trackedOrigins: new Set([LOCAL_ORIGIN])`
// only walks back transactions originating in this client. Phase 4 will
// distinguish "this user's edits" from "other users' edits" using the
// y-websocket clientID; for Phase 3 single-user, LOCAL_ORIGIN is enough.

import * as Y from 'yjs';
import type { ColorSpec, FontSpec, RectangleF } from '@cld/model';
import type { AnchoredLabel, BackgroundImage, SidecarModule } from '@cld/bbm';
import { LOCAL_ORIGIN } from './useLayoutDoc';
import { imageOffset } from '@cld/parts-catalog/browser';
import { areaForPivot, rotateAroundPivots, type PartGeom } from './brickGeometry';

export interface BrickInsertSpec {
  partNumber: string;
  /** World position in studs (top-left of displayArea). */
  x: number;
  y: number;
  width: number;
  height: number;
  orientation?: number;
  altitude?: number;
  activeConnectionPointIndex?: number;
}

/**
 * Generate a fresh decimal-numeric id (bricks, layers, groups, ...).
 *
 * Vanilla BlueBrick ids must be parseable as `ulong`, so we emit a random
 * 63-bit unsigned integer in decimal. The previous `Date.now() + rand(0..999)`
 * scheme collided constantly when many ids were minted in the same
 * millisecond (a 50-brick paste produced duplicates in ~65% of runs).
 */
export function makeId(): string {
  const a = new BigUint64Array(1);
  crypto.getRandomValues(a);
  // Drop the top bit so the value also fits a signed 64-bit long, and
  // avoid the (astronomically unlikely) zero id.
  const v = a[0]! >> 1n;
  return (v === 0n ? 1n : v).toString();
}

export function placeBrick(
  doc: Y.Doc,
  layerId: string,
  spec: BrickInsertSpec,
): string {
  const id = makeId();
  doc.transact(() => {
    const layerData = doc.getMap('layerData').get(layerId);
    if (!(layerData instanceof Y.Map)) return;
    const bricks = layerData.get('bricks');
    if (!(bricks instanceof Y.Array)) return;

    const yBrick = new Y.Map<unknown>();
    yBrick.set('id', id);
    yBrick.set('displayArea', {
      x: spec.x,
      y: spec.y,
      width: spec.width,
      height: spec.height,
    } satisfies RectangleF);
    yBrick.set('myGroup', '');
    yBrick.set('partNumber', spec.partNumber);
    yBrick.set('orientation', spec.orientation ?? 0);
    yBrick.set('activeConnectionPointIndex', spec.activeConnectionPointIndex ?? 0);
    yBrick.set('altitude', spec.altitude ?? 0);
    yBrick.set('connexions', []);
    bricks.push([yBrick]);
  }, LOCAL_ORIGIN);
  return id;
}

export function deleteBricks(doc: Y.Doc, layerId: string, brickIds: string[]): void {
  if (brickIds.length === 0) return;
  doc.transact(() => {
    const layerData = doc.getMap('layerData').get(layerId);
    if (!(layerData instanceof Y.Map)) return;
    const bricks = layerData.get('bricks');
    if (!(bricks instanceof Y.Array)) return;

    const idSet = new Set(brickIds);
    // Walk in reverse so deletions don't shift indices we still need.
    for (let i = bricks.length - 1; i >= 0; i--) {
      const b = bricks.get(i);
      if (b instanceof Y.Map && idSet.has(b.get('id') as string)) {
        bricks.delete(i, 1);
      }
    }
    pruneModuleMembers(doc, idSet);
  }, LOCAL_ORIGIN);
}

/**
 * Drop deleted brick ids from every sidecar module, and remove modules
 * left with no members — desktop `DeleteBricksCommand::redo`
 * (EditCommands.cpp:82-120). Writes the cache only when something changed.
 * Call inside a transaction.
 */
function pruneModuleMembers(doc: Y.Doc, deleted: Set<string>): void {
  const cache = readSidecarCache(doc);
  const modules = getSidecarModules(cache);
  if (modules.length === 0) return;
  let changed = false;
  const next: SidecarModule[] = [];
  for (const m of modules) {
    const members = m.members.filter((id) => !deleted.has(id));
    if (members.length === m.members.length) {
      next.push(m);
      continue;
    }
    changed = true;
    if (members.length > 0) next.push({ ...m, members });
  }
  if (changed) writeSidecarCache(doc, { ...cache, modules: next });
}

/**
 * Move a brick so its pivot (sprite centre, `pivotOf`) is at
 * (`pivotX`, `pivotY`). Without `part` the pivot is the displayArea centre.
 */
export function moveBrick(
  doc: Y.Doc,
  layerId: string,
  brickId: string,
  pivotX: number,
  pivotY: number,
  part?: PartGeom,
): void {
  doc.transact(() => {
    const yBrick = findBrick(doc, layerId, brickId);
    if (!yBrick) return;
    const area = yBrick.get('displayArea') as RectangleF;
    const off = part ? imageOffset(part, (yBrick.get('orientation') as number) ?? 0) : { x: 0, y: 0 };
    yBrick.set('displayArea', {
      ...area,
      x: pivotX - off.x - area.width / 2,
      y: pivotY - off.y - area.height / 2,
    });
  }, LOCAL_ORIGIN);
}

/**
 * Move a brick and set its orientation in one transaction — used when a
 * connection-snap fires on drag-end so position + rotation are one undo step.
 */
export function moveBrickAndOrient(
  doc: Y.Doc,
  layerId: string,
  brickId: string,
  pivotX: number,
  pivotY: number,
  newOrientation: number,
  part?: PartGeom,
): void {
  doc.transact(() => {
    const yBrick = findBrick(doc, layerId, brickId);
    if (!yBrick) return;
    const area = yBrick.get('displayArea') as RectangleF;
    const orientation = mod360(newOrientation);
    // The box follows the turned footprint (BrickPlacement placeByImageCentre).
    yBrick.set('displayArea', areaForPivot(part, orientation, { x: pivotX, y: pivotY }, area));
    yBrick.set('orientation', orientation);
  }, LOCAL_ORIGIN);
}

/**
 * Translate selected bricks that may span multiple layers in one Yjs
 * transaction so undo treats the whole drag as one step.
 *
 * `byLayer` is a map of layerId → brickIds to move in that layer.
 */
export function translateBricksAcrossLayers(
  doc: Y.Doc,
  byLayer: Map<string, string[]>,
  dxStuds: number,
  dyStuds: number,
): void {
  if (byLayer.size === 0 || (dxStuds === 0 && dyStuds === 0)) return;
  doc.transact(() => {
    for (const [layerId, brickIds] of byLayer) {
      if (brickIds.length === 0) continue;
      const layerData = doc.getMap('layerData').get(layerId);
      if (!(layerData instanceof Y.Map)) continue;
      const bricks = layerData.get('bricks');
      if (!(bricks instanceof Y.Array)) continue;
      const idSet = new Set(brickIds);
      for (let i = 0; i < bricks.length; i++) {
        const b = bricks.get(i);
        if (!(b instanceof Y.Map) || !idSet.has(b.get('id') as string)) continue;
        const area = b.get('displayArea') as import('@cld/model').RectangleF;
        b.set('displayArea', { ...area, x: area.x + dxStuds, y: area.y + dyStuds });
      }
    }
  }, LOCAL_ORIGIN);
}

/**
 * Translate every brick in `brickIds` by the same delta. Used for
 * multi-select drag — the dragged brick's `dx, dy` is computed by the
 * caller from the Konva event, then applied to every selected brick in
 * a single Yjs transaction so undo treats the whole drag as one step.
 */
export function translateBricks(
  doc: Y.Doc,
  layerId: string,
  brickIds: string[],
  dxStuds: number,
  dyStuds: number,
): void {
  if (brickIds.length === 0 || (dxStuds === 0 && dyStuds === 0)) return;
  doc.transact(() => {
    for (const brickId of brickIds) {
      const yBrick = findBrick(doc, layerId, brickId);
      if (!yBrick) continue;
      const area = yBrick.get('displayArea') as RectangleF;
      yBrick.set('displayArea', {
        ...area,
        x: area.x + dxStuds,
        y: area.y + dyStuds,
      });
    }
  }, LOCAL_ORIGIN);
}

/**
 * Insert a list of bricks (typically extracted from a module's snapshot)
 * into the given layer at an offset. New brick ids are minted so the
 * insertion can't collide with existing ids in the target layout.
 *
 * Returns the list of newly-minted ids in insertion order — useful for
 * the editor to immediately select what was inserted.
 */
export function insertBricks(
  doc: Y.Doc,
  layerId: string,
  bricks: Array<{
    partNumber: string;
    displayArea: { x: number; y: number; width: number; height: number };
    orientation?: number;
    altitude?: number;
  }>,
  offset: { dx: number; dy: number } = { dx: 0, dy: 0 },
): string[] {
  if (bricks.length === 0) return [];
  const ids: string[] = [];
  doc.transact(() => {
    const layerData = doc.getMap('layerData').get(layerId);
    if (!(layerData instanceof Y.Map)) return;
    const yBricks = layerData.get('bricks');
    if (!(yBricks instanceof Y.Array)) return;
    for (const b of bricks) {
      const id = makeId();
      ids.push(id);
      const yBrick = new Y.Map<unknown>();
      yBrick.set('id', id);
      yBrick.set('displayArea', {
        x: b.displayArea.x + offset.dx,
        y: b.displayArea.y + offset.dy,
        width: b.displayArea.width,
        height: b.displayArea.height,
      });
      yBrick.set('myGroup', '');
      yBrick.set('partNumber', b.partNumber);
      yBrick.set('orientation', b.orientation ?? 0);
      yBrick.set('activeConnectionPointIndex', 0);
      yBrick.set('altitude', b.altitude ?? 0);
      yBrick.set('connexions', []);
      yBricks.push([yBrick]);
    }
  }, LOCAL_ORIGIN);
  return ids;
}

export function rotateBricks(
  doc: Y.Doc,
  layerId: string,
  brickIds: string[],
  deltaDegrees: number,
): void {
  if (brickIds.length === 0 || deltaDegrees === 0) return;
  doc.transact(() => {
    for (const brickId of brickIds) {
      const yBrick = findBrick(doc, layerId, brickId);
      if (!yBrick) continue;
      const current = (yBrick.get('orientation') as number) ?? 0;
      // Preserve float orientation. Desktop stores `Brick.orientation` as
      // a float and rotateSelected adds a float delta (MapView.cpp:964-967
      // pushes ±90.0f through RotateBricksCommand). Rounding to an int
      // would silently quantise the values that came in from a desktop
      // save — and the .bbm writer at G7 already handles drift fine.
      yBrick.set('orientation', mod360(current + deltaDegrees));
    }
  }, LOCAL_ORIGIN);
}

/**
 * Group `ids` by the brick layer that holds them, in layer order. The
 * selection is a flat id list that can span layers; desktop commands act
 * on every selected brick whatever its layer (items carry their layer
 * index), so the web commands resolve layers from the map, never from the
 * active layer. Unknown ids are dropped.
 */
export function bricksByLayer(
  map: { layers: ReadonlyArray<{ id: string; type: string; bricks?: ReadonlyArray<{ id: string }> }> },
  ids: Iterable<string>,
  opts: { visibleOnly?: boolean } = {},
): Map<string, string[]> {
  const want = ids instanceof Set ? (ids as Set<string>) : new Set(ids);
  const out = new Map<string, string[]>();
  if (want.size === 0) return out;
  for (const layer of map.layers) {
    if (layer.type !== 'brick' || !layer.bricks) continue;
    if (opts.visibleOnly && (layer as { visible?: boolean }).visible === false) continue;
    const hit: string[] = [];
    for (const b of layer.bricks) if (want.has(b.id)) hit.push(b.id);
    if (hit.length > 0) out.set(layer.id, hit);
  }
  return out;
}

/** Every brick id on every visible brick layer — desktop `selectAll` (MapView.cpp:1417). */
export function allVisibleBrickIds(
  map: { layers: ReadonlyArray<{ type: string; visible?: boolean; bricks?: ReadonlyArray<{ id: string }> }> },
): string[] {
  const out: string[] = [];
  for (const layer of map.layers) {
    if (layer.type !== 'brick' || layer.visible === false || !layer.bricks) continue;
    for (const b of layer.bricks) out.push(b.id);
  }
  return out;
}

/**
 * `insertBricks` into several layers in one transaction; returns every
 * new id (layer order). Used by Duplicate so copies stay on their
 * source layers.
 */
export function insertBricksAcrossLayers(
  doc: Y.Doc,
  perLayer: Map<string, Parameters<typeof insertBricks>[2]>,
  offset: { dx: number; dy: number } = { dx: 0, dy: 0 },
): string[] {
  const ids: string[] = [];
  doc.transact(() => {
    for (const [layerId, bricks] of perLayer) ids.push(...insertBricks(doc, layerId, bricks, offset));
  }, LOCAL_ORIGIN);
  return ids;
}

/** Delete bricks spanning several layers in ONE transaction (one undo step). */
export function deleteBricksAcrossLayers(doc: Y.Doc, byLayer: Map<string, string[]>): void {
  if (byLayer.size === 0) return;
  doc.transact(() => {
    for (const [layerId, ids] of byLayer) deleteBricks(doc, layerId, ids);
  }, LOCAL_ORIGIN);
}

/**
 * Rotate a (possibly multi-layer) selection by `degrees` around its pivot
 * — the mean of the bricks' sprite centres, so one brick turns in place —
 * with each displayArea following the turned footprint
 * (MapView::rotateSelected). `partOf` resolves a brick's catalog part;
 * without it the pivot is the displayArea centre and sizes are kept.
 * One transaction.
 */
export function rotateBricksAboutCentroid(
  doc: Y.Doc,
  byLayer: Map<string, string[]>,
  degrees: number,
  partOf: (partNumber: string) => PartGeom | undefined = () => undefined,
): void {
  if (byLayer.size === 0 || degrees === 0) return;
  const found: Array<{ yBrick: Y.Map<unknown>; area: RectangleF; orientation: number; part: PartGeom | undefined }> = [];
  for (const [layerId, ids] of byLayer) {
    const layerData = doc.getMap('layerData').get(layerId);
    if (!(layerData instanceof Y.Map)) continue;
    const bricks = layerData.get('bricks');
    if (!(bricks instanceof Y.Array)) continue;
    const idSet = new Set(ids);
    for (let i = 0; i < bricks.length; i++) {
      const b = bricks.get(i);
      if (b instanceof Y.Map && idSet.has(b.get('id') as string)) {
        found.push({
          yBrick: b,
          area: b.get('displayArea') as RectangleF,
          orientation: (b.get('orientation') as number) ?? 0,
          part: partOf(b.get('partNumber') as string),
        });
      }
    }
  }
  if (found.length === 0) return;
  const next = rotateAroundPivots(
    found.map(({ area, orientation, part }) => ({ brick: { displayArea: area, orientation }, part })),
    degrees,
  );
  doc.transact(() => {
    found.forEach(({ yBrick, area }, i) => {
      const n = next[i]!;
      const a = n.displayArea;
      if (
        Math.abs(a.x - area.x) > 1e-9 || Math.abs(a.y - area.y) > 1e-9 ||
        Math.abs(a.width - area.width) > 1e-9 || Math.abs(a.height - area.height) > 1e-9
      ) {
        yBrick.set('displayArea', a);
      }
      yBrick.set('orientation', mod360(n.orientation));
    });
  }, LOCAL_ORIGIN);
}

/**
 * Group a multi-layer selection — desktop `GroupBricksCommand` creates
 * ONE group per layer (EditCommands.cpp:298-340) and needs at least two
 * bricks in total. Returns the new group ids.
 */
export function groupBricksAcrossLayers(doc: Y.Doc, byLayer: Map<string, string[]>): string[] {
  let total = 0;
  for (const ids of byLayer.values()) total += ids.length;
  if (total < 2) return [];
  const groupIds: string[] = [];
  doc.transact(() => {
    for (const [layerId, ids] of byLayer) {
      const layerData = doc.getMap('layerData').get(layerId);
      if (!(layerData instanceof Y.Map)) continue;
      const yBricks = layerData.get('bricks');
      const yGroups = layerData.get('groups');
      if (!(yBricks instanceof Y.Array) || !(yGroups instanceof Y.Array)) continue;
      const groupId = makeId();
      const g = new Y.Map<unknown>();
      g.set('id', groupId);
      yGroups.push([g]);
      groupIds.push(groupId);
      const idSet = new Set(ids);
      for (let i = 0; i < yBricks.length; i++) {
        const b = yBricks.get(i);
        if (b instanceof Y.Map && idSet.has(b.get('id') as string)) b.set('myGroup', groupId);
      }
    }
  }, LOCAL_ORIGIN);
  return groupIds;
}

/** Ungroup a multi-layer selection in one transaction. */
export function ungroupBricksAcrossLayers(doc: Y.Doc, byLayer: Map<string, string[]>): void {
  if (byLayer.size === 0) return;
  doc.transact(() => {
    for (const [layerId, ids] of byLayer) ungroupBricks(doc, layerId, ids);
  }, LOCAL_ORIGIN);
}

/**
 * Paint or erase area cells — port of `PaintAreaCellsCommand`
 * (AreaCommands.cpp:41-68).
 *
 * `color === null` ⇒ erase the cell at (x, y); otherwise upsert the
 * cell with the new colour. All changes apply in one Yjs transaction
 * → one undo step.
 *
 * `color` is the AARRGGBB hex string (uppercase per AreaCell.color).
 */
export function paintAreaCells(
  doc: Y.Doc,
  layerId: string,
  changes: Array<{ x: number; y: number; color: string | null }>,
): void {
  if (changes.length === 0) return;
  doc.transact(() => {
    const layerData = doc.getMap('layerData').get(layerId);
    if (!(layerData instanceof Y.Map)) return;
    const yAreas = layerData.get('areas');
    if (!(yAreas instanceof Y.Array)) return;

    // Index existing cells by `${x},${y}` for O(1) upsert.
    const indexByKey = new Map<string, number>();
    for (let i = 0; i < yAreas.length; i++) {
      const cell = yAreas.get(i) as { x: number; y: number; color: string };
      indexByKey.set(`${cell.x},${cell.y}`, i);
    }

    // Sort changes so deletions happen highest-index first (so other
    // indices stay valid). Splits into upserts + deletes.
    const upserts: { x: number; y: number; color: string }[] = [];
    const deletes: number[] = [];
    for (const c of changes) {
      const key = `${c.x},${c.y}`;
      const existing = indexByKey.get(key);
      if (c.color === null) {
        if (existing !== undefined) deletes.push(existing);
      } else {
        if (existing !== undefined) {
          // Replace in place: delete + push the upsert.
          deletes.push(existing);
        }
        upserts.push({ x: c.x, y: c.y, color: c.color });
      }
    }
    deletes.sort((a, b) => b - a);
    for (const idx of deletes) yAreas.delete(idx, 1);
    for (const u of upserts) yAreas.push([u]);
  }, LOCAL_ORIGIN);
}

/**
 * Paint cell size of a NEW Area layer, in studs — desktop
 * `LayerArea::areaCellSizeInStud = 32` (core/LayerArea.h:25). Existing
 * layers keep whatever size they were saved with.
 */
export const AREA_CELL_SIZE_DEFAULT = 32;

/**
 * Find the topmost (last in the layer order, matching desktop's
 * "for i = layers.size()-1 ... break" search at MapView.cpp:500-507)
 * visible Area layer. Creates a new Area layer with sane defaults
 * when no Area layer exists. Returns the layer id.
 */
export function ensureAreaLayer(doc: Y.Doc, defaultCellSizeStuds = AREA_CELL_SIZE_DEFAULT): string {
  const layerOrder = doc.getArray<string>('layers');
  const layerData = doc.getMap<Y.Map<unknown>>('layerData');
  // Walk in reverse order: topmost first (desktop convention).
  const ids = layerOrder.toArray();
  for (let i = ids.length - 1; i >= 0; i--) {
    const id = ids[i]!;
    const l = layerData.get(id);
    if (l instanceof Y.Map && l.get('type') === 'area' && l.get('visible') !== false) {
      return id;
    }
  }
  // None — create one.
  const id = makeId();
  doc.transact(() => {
    const yLayer = new Y.Map<unknown>();
    yLayer.set('id', id);
    yLayer.set('type', 'area');
    yLayer.set('name', 'Area');
    yLayer.set('visible', true);
    yLayer.set('transparency', 100);
    yLayer.set('hullProperties', {
      isVisible: false,
      hullColor: { kind: 'known', name: 'Black' },
      hullThickness: 1,
    });
    yLayer.set('areaCellSize', defaultCellSizeStuds);
    yLayer.set('areas', new Y.Array<{ x: number; y: number; color: string }>());
    yLayer.set('groups', new Y.Array<Y.Map<unknown>>());
    layerData.set(id, yLayer);
    layerOrder.push([id]);
  }, LOCAL_ORIGIN);
  return id;
}

export interface GeneralInfoPatch {
  author?: string;
  lug?: string;
  event?: string;
  date?: { day: number; month: number; year: number };
  comment?: string;
}

/**
 * Edit Map > General Info — port of `ChangeGeneralInfoCommand`
 * (LayerCommands.cpp). Single Yjs transaction → one undo step.
 * Only fields present in `patch` change.
 */
export function setGeneralInfo(doc: Y.Doc, patch: GeneralInfoPatch): void {
  doc.transact(() => {
    const meta = doc.getMap('meta');
    if (patch.author !== undefined) meta.set('author', patch.author);
    if (patch.lug !== undefined) meta.set('lug', patch.lug);
    if (patch.event !== undefined) meta.set('event', patch.event);
    if (patch.comment !== undefined) meta.set('comment', patch.comment);
    if (patch.date !== undefined) meta.set('date', { ...patch.date });
  }, LOCAL_ORIGIN);
}

/**
 * Map > Background Colour — port of `ChangeBackgroundColorCommand`
 * (LayerCommands.cpp). `color` is a ColorSpec (known-name or argb hex).
 */
export function setBackgroundColor(
  doc: Y.Doc,
  color: { kind: 'known'; name: string } | { kind: 'argb'; argb: string },
): void {
  doc.transact(() => {
    doc.getMap('meta').set('backgroundColor', { ...color });
  }, LOCAL_ORIGIN);
}

/** Meta key of the budget limits: a Y.Map of part number → limit (≥ 0). */
const BUDGET_KEY = 'budgetLimits';

/**
 * Budget limits stored in the doc (part number → max count). Desktop keeps
 * them in a `.bbb` file beside the map (Budget.cpp); here they live in the
 * doc's `meta` so they survive reload and are shared with collaborators.
 * `.bbb` files are still read/written by the Budget dialog.
 */
export function readBudgetLimits(doc: Y.Doc): Map<string, number> {
  const out = new Map<string, number>();
  const y = doc.getMap('meta').get(BUDGET_KEY);
  if (!(y instanceof Y.Map)) return out;
  for (const [part, limit] of y.entries()) {
    if (typeof limit === 'number' && Number.isFinite(limit) && limit >= 0) out.set(part, limit);
  }
  return out;
}

/**
 * Replace the budget limits with `limits`, as one undo step. Only the
 * changed parts are written, so two users editing different rows merge.
 */
export function setBudgetLimits(doc: Y.Doc, limits: Map<string, number>): void {
  doc.transact(() => {
    const meta = doc.getMap('meta');
    let y = meta.get(BUDGET_KEY);
    if (!(y instanceof Y.Map)) {
      if (limits.size === 0) return;
      y = new Y.Map<number>();
      meta.set(BUDGET_KEY, y);
    }
    const ym = y as Y.Map<number>;
    for (const part of [...ym.keys()]) {
      if (!limits.has(part)) ym.delete(part);
    }
    for (const [part, limit] of limits) {
      if (!(limit >= 0)) {
        if (ym.has(part)) ym.delete(part);
      } else if (ym.get(part) !== limit) {
        ym.set(part, limit);
      }
    }
  }, LOCAL_ORIGIN);
}

/**
 * Set a layer's `visible` flag. Port of `SetLayerVisibilityCommand`
 * (LayerCommands.cpp).
 */
export function setLayerVisible(doc: Y.Doc, layerId: string, visible: boolean): void {
  doc.transact(() => {
    const layer = doc.getMap('layerData').get(layerId);
    if (layer instanceof Y.Map) layer.set('visible', visible);
  }, LOCAL_ORIGIN);
}

/** Show all layers (port of LayerPanel.cpp "Show All" button). */
export function showAllLayers(doc: Y.Doc): void {
  const layerData = doc.getMap('layerData');
  doc.transact(() => {
    for (const [, layer] of layerData) {
      if (layer instanceof Y.Map) layer.set('visible', true);
    }
  }, LOCAL_ORIGIN);
}

/**
 * Solo the given layer — make it visible, hide all others.
 * Port of LayerPanel.cpp "Solo" button.
 */
export function soloLayer(doc: Y.Doc, layerId: string): void {
  const layerData = doc.getMap('layerData');
  doc.transact(() => {
    for (const [id, layer] of layerData) {
      if (layer instanceof Y.Map) layer.set('visible', id === layerId);
    }
  }, LOCAL_ORIGIN);
}

/** Set a layer's `transparency` (0-100). */
export function setLayerTransparency(doc: Y.Doc, layerId: string, transparency: number): void {
  doc.transact(() => {
    const layer = doc.getMap('layerData').get(layerId);
    if (layer instanceof Y.Map) {
      layer.set('transparency', Math.max(0, Math.min(100, Math.round(transparency))));
    }
  }, LOCAL_ORIGIN);
}

/** Rename a layer. */
export function renameLayer(doc: Y.Doc, layerId: string, name: string): void {
  doc.transact(() => {
    const layer = doc.getMap('layerData').get(layerId);
    if (layer instanceof Y.Map) layer.set('name', name);
  }, LOCAL_ORIGIN);
}

/** Set hull visibility, colour, and thickness on a brick layer — port of `LayerOptionsDialog` changes. */
export function setLayerHullProperties(
  doc: Y.Doc,
  layerId: string,
  isVisible: boolean,
  hullColor: import('@cld/model').ColorSpec,
  hullThickness: number,
): void {
  doc.transact(() => {
    const layer = doc.getMap('layerData').get(layerId);
    if (layer instanceof Y.Map) {
      layer.set('hullProperties', { isVisible, hullColor, hullThickness });
    }
  }, LOCAL_ORIGIN);
}

/** Toggle per-layer brick-elevation display (`LayerBrick.displayBrickElevation`). */
export function setLayerDisplayBrickElevation(doc: Y.Doc, layerId: string, v: boolean): void {
  doc.transact(() => {
    const layer = doc.getMap('layerData').get(layerId);
    if (layer instanceof Y.Map) layer.set('displayBrickElevation', v);
  }, LOCAL_ORIGIN);
}

/**
 * Move a layer up (toward end of the array = topmost) or down. Mirrors
 * `MoveLayerCommand` (LayerCommands.cpp).
 */
export function moveLayer(doc: Y.Doc, layerId: string, direction: 'up' | 'down'): void {
  doc.transact(() => {
    const layerOrder = doc.getArray<string>('layers');
    const ids = layerOrder.toArray();
    const idx = ids.indexOf(layerId);
    if (idx < 0) return;
    const swap = direction === 'up' ? idx + 1 : idx - 1;
    if (swap < 0 || swap >= ids.length) return;
    const a = ids[idx]!;
    const b = ids[swap]!;
    layerOrder.delete(Math.min(idx, swap), 2);
    if (direction === 'up') {
      layerOrder.insert(Math.min(idx, swap), [b, a]);
    } else {
      layerOrder.insert(Math.min(idx, swap), [a, b]);
    }
  }, LOCAL_ORIGIN);
}

/** Delete a layer entirely (data + ordering). */
export function deleteLayer(doc: Y.Doc, layerId: string): void {
  doc.transact(() => {
    const layerOrder = doc.getArray<string>('layers');
    const ids = layerOrder.toArray();
    const idx = ids.indexOf(layerId);
    if (idx >= 0) layerOrder.delete(idx, 1);
    doc.getMap<Y.Map<unknown>>('layerData').delete(layerId);
  }, LOCAL_ORIGIN);
}

/**
 * Move a grid layer's cell-index origin by whole cells, as one undo step
 * (desktop MoveGridOriginCommand, LayerCommands.cpp:195-210).
 */
export function moveGridOrigin(doc: Y.Doc, layerId: string, dx: number, dy: number): void {
  if (dx === 0 && dy === 0) return;
  doc.transact(() => {
    const layer = doc.getMap('layerData').get(layerId);
    if (!(layer instanceof Y.Map) || layer.get('type') !== 'grid') return;
    const cur = layer.get('cellIndexCorner') as { x?: number; y?: number } | undefined;
    layer.set('cellIndexCorner', { x: (cur?.x ?? 0) + dx, y: (cur?.y ?? 0) + dy });
  }, LOCAL_ORIGIN);
}

/**
 * The first ruler layer, or a new one named "Rulers" at the top — where
 * desktop's ruler tools put a new ruler (MapView.cpp:818-829).
 */
export function ensureRulerLayer(doc: Y.Doc): string {
  const layerOrder = doc.getArray<string>('layers');
  const layerData = doc.getMap<Y.Map<unknown>>('layerData');
  const ids = layerOrder.toArray();
  for (let i = 0; i < ids.length; i++) {
    const id = ids[i]!;
    const l = layerData.get(id);
    if (l instanceof Y.Map && l.get('type') === 'ruler') return id;
  }
  const id = makeId();
  doc.transact(() => {
    const yLayer = new Y.Map<unknown>();
    yLayer.set('id', id);
    yLayer.set('type', 'ruler');
    yLayer.set('name', 'Rulers');
    yLayer.set('visible', true);
    yLayer.set('transparency', 100);
    yLayer.set('hullProperties', {
      isVisible: false,
      hullColor: { kind: 'known', name: 'Black' },
      hullThickness: 1,
    });
    yLayer.set('rulerItems', new Y.Array());
    yLayer.set('groups', new Y.Array<Y.Map<unknown>>());
    layerData.set(id, yLayer);
    layerOrder.push([id]);
  }, LOCAL_ORIGIN);
  return id;
}

/**
 * The label shown while drawing a ruler (MapView.cpp:941-946): length in
 * studs to one decimal and in mm (m with two decimals from 1 m), with
 * "r=" for a circle's radius.
 */
export function rulerPreviewLabel(lengthStuds: number, circular: boolean): string {
  const mm = lengthStuds * 8;
  const unit = mm >= 1000 ? `${(mm / 1000).toFixed(2)} m` : `${mm.toFixed(0)} mm`;
  return `${circular ? 'r=' : ''}${lengthStuds.toFixed(1)} studs (${unit})`;
}

/**
 * The status-bar readout while drawing a ruler (MapView.cpp:661-680),
 * kept alongside the floating label.
 */
export function rulerStatusMessage(lengthStuds: number, circular: boolean): string {
  const mm = lengthStuds * 8;
  const unit = mm >= 1000 ? `${(mm / 1000).toFixed(2)} m` : `${mm.toFixed(0)} mm`;
  return `Ruler ${circular ? 'radius' : 'length'}: ${lengthStuds.toFixed(1)} studs  (${unit})`;
}

/**
 * A new ruler, as desktop's RulerItemBase defaults (core/RulerItem.h:22-31,
 * FontSpec.h:11-12): black (the known colour) line, guideline and
 * measure text, 1-thick solid lines, Microsoft Sans Serif 8.25.
 */
const RULER_DEFAULTS = {
  color: { kind: 'known' as const, name: 'Black' },
  lineThickness: 1,
  displayDistance: true,
  displayUnit: true,
  guidelineColor: { kind: 'known' as const, name: 'Black' },
  guidelineThickness: 1,
  guidelineDashPattern: [] as number[],
  unit: 0, // STUD
  measureFont: { family: 'Microsoft Sans Serif', size: 8.25, style: 'Regular' },
  measureFontColor: { kind: 'known' as const, name: 'Black' },
};

/**
 * Append a linear ruler — port of `AddRulerItemCommand`
 * (RulerCommands.cpp). Endpoints in studs.
 */
export function addLinearRuler(
  doc: Y.Doc,
  layerId: string,
  point1: { x: number; y: number },
  point2: { x: number; y: number },
): string {
  const id = makeId();
  doc.transact(() => {
    const layerData = doc.getMap('layerData').get(layerId);
    if (!(layerData instanceof Y.Map)) return;
    const yItems = layerData.get('rulerItems');
    if (!(yItems instanceof Y.Array)) return;
    const minX = Math.min(point1.x, point2.x);
    const minY = Math.min(point1.y, point2.y);
    const maxX = Math.max(point1.x, point2.x);
    const maxY = Math.max(point1.y, point2.y);
    yItems.push([
      {
        id,
        kind: 'linear',
        displayArea: { x: minX, y: minY, width: maxX - minX, height: maxY - minY },
        myGroup: '',
        ...RULER_DEFAULTS,
        point1,
        point2,
        attachedBrick1Id: '',
        attachedBrick2Id: '',
        offsetDistance: 0,
        allowOffset: false,
      },
    ]);
  }, LOCAL_ORIGIN);
  return id;
}

/** Append a circular ruler. */
export function addCircularRuler(
  doc: Y.Doc,
  layerId: string,
  centre: { x: number; y: number },
  radiusStuds: number,
): string {
  const id = makeId();
  doc.transact(() => {
    const layerData = doc.getMap('layerData').get(layerId);
    if (!(layerData instanceof Y.Map)) return;
    const yItems = layerData.get('rulerItems');
    if (!(yItems instanceof Y.Array)) return;
    const r = Math.max(0, radiusStuds);
    yItems.push([
      {
        id,
        kind: 'circular',
        displayArea: { x: centre.x - r, y: centre.y - r, width: 2 * r, height: 2 * r },
        myGroup: '',
        ...RULER_DEFAULTS,
        center: centre,
        radius: r,
        attachedBrickId: '',
      },
    ]);
  }, LOCAL_ORIGIN);
  return id;
}

// ---------------------------------------------------------------------------
// Ruler verbs — port of `RulerCommands.cpp`. Each is one Yjs transaction
// so undo unwinds the whole edit. Items are addressed by stable `id`
// (minted in `addLinearRuler`/`addCircularRuler` and on `.bbm` read in
// `Reader.ts`).
// ---------------------------------------------------------------------------

/**
 * Find a ruler item's index inside the layer's `rulerItems` Y.Array.
 * Returns -1 if not found. Used by every ruler verb below.
 */
function findRulerIndex(yItems: Y.Array<unknown>, rulerId: string): number {
  for (let i = 0; i < yItems.length; i++) {
    const item = yItems.get(i) as { id?: string } | undefined;
    if (item && item.id === rulerId) return i;
  }
  return -1;
}

/** Delete a ruler item. */
export function deleteRulerItem(doc: Y.Doc, layerId: string, rulerId: string): void {
  doc.transact(() => {
    const layerData = doc.getMap('layerData').get(layerId);
    if (!(layerData instanceof Y.Map)) return;
    const yItems = layerData.get('rulerItems');
    if (!(yItems instanceof Y.Array)) return;
    const idx = findRulerIndex(yItems, rulerId);
    if (idx >= 0) yItems.delete(idx, 1);
  }, LOCAL_ORIGIN);
}

/**
 * Translate a ruler item by `(dx, dy)` studs. For linear rulers both
 * endpoints move; for circular the centre moves. displayArea is
 * recomputed. Mirrors `MoveRulerItemCommand` (RulerCommands.cpp:162-199).
 */
export function moveRulerItem(
  doc: Y.Doc,
  layerId: string,
  rulerId: string,
  dxStuds: number,
  dyStuds: number,
): void {
  if (dxStuds === 0 && dyStuds === 0) return;
  doc.transact(() => {
    const layerData = doc.getMap('layerData').get(layerId);
    if (!(layerData instanceof Y.Map)) return;
    const yItems = layerData.get('rulerItems');
    if (!(yItems instanceof Y.Array)) return;
    const idx = findRulerIndex(yItems, rulerId);
    if (idx < 0) return;
    const cur = yItems.get(idx) as RulerLike;
    if (!cur) return;
    yItems.delete(idx, 1);
    if (cur.kind === 'linear') {
      const p1 = { x: cur.point1.x + dxStuds, y: cur.point1.y + dyStuds };
      const p2 = { x: cur.point2.x + dxStuds, y: cur.point2.y + dyStuds };
      yItems.insert(idx, [
        {
          ...cur,
          point1: p1,
          point2: p2,
          displayArea: rectFromTwoPoints(p1, p2),
        } as unknown as Record<string, unknown>,
      ]);
    } else {
      const c = { x: cur.center.x + dxStuds, y: cur.center.y + dyStuds };
      yItems.insert(idx, [
        {
          ...cur,
          center: c,
          displayArea: rectAroundCircle(c, cur.radius),
        } as unknown as Record<string, unknown>,
      ]);
    }
  }, LOCAL_ORIGIN);
}

/**
 * Move one endpoint of a linear ruler. `which` selects 0 = point1 or
 * 1 = point2. Mirrors `MoveRulerEndpointCommand` (RulerCommands.cpp:203-282).
 * Detaches the corresponding `attachedBrickN` automatically (the
 * desktop's command does the same — once the user has hand-moved an
 * endpoint, the attach link is stale).
 */
export function moveRulerEndpoint(
  doc: Y.Doc,
  layerId: string,
  rulerId: string,
  which: 0 | 1,
  newPoint: { x: number; y: number },
): void {
  doc.transact(() => {
    const layerData = doc.getMap('layerData').get(layerId);
    if (!(layerData instanceof Y.Map)) return;
    const yItems = layerData.get('rulerItems');
    if (!(yItems instanceof Y.Array)) return;
    const idx = findRulerIndex(yItems, rulerId);
    if (idx < 0) return;
    const cur = yItems.get(idx) as RulerLike;
    if (!cur || cur.kind !== 'linear') return;
    yItems.delete(idx, 1);
    const next = { ...cur };
    if (which === 0) {
      next.point1 = { ...newPoint };
      next.attachedBrick1Id = '';
    } else {
      next.point2 = { ...newPoint };
      next.attachedBrick2Id = '';
    }
    next.displayArea = rectFromTwoPoints(next.point1, next.point2);
    yItems.insert(idx, [next as unknown as Record<string, unknown>]);
  }, LOCAL_ORIGIN);
}

/**
 * Attach (or detach) a ruler endpoint to a brick by guid. For circular
 * rulers, `which` is ignored and the centre is attached. Mirrors
 * `AttachRulerCommand` (RulerCommands.cpp:298-346). Pass an empty
 * brick id to detach.
 */
export function attachRulerEndpoint(
  doc: Y.Doc,
  layerId: string,
  rulerId: string,
  which: 0 | 1,
  brickId: string,
): void {
  doc.transact(() => {
    const layerData = doc.getMap('layerData').get(layerId);
    if (!(layerData instanceof Y.Map)) return;
    const yItems = layerData.get('rulerItems');
    if (!(yItems instanceof Y.Array)) return;
    const idx = findRulerIndex(yItems, rulerId);
    if (idx < 0) return;
    const cur = yItems.get(idx) as RulerLike;
    if (!cur) return;
    yItems.delete(idx, 1);
    if (cur.kind === 'linear') {
      const next = { ...cur };
      if (which === 0) next.attachedBrick1Id = brickId;
      else next.attachedBrick2Id = brickId;
      yItems.insert(idx, [next as unknown as Record<string, unknown>]);
    } else {
      const next = { ...cur, attachedBrickId: brickId };
      yItems.insert(idx, [next as unknown as Record<string, unknown>]);
    }
  }, LOCAL_ORIGIN);
}

export interface EditRulerPatch {
  color?: ColorSpec;
  lineThickness?: number;
  displayDistance?: boolean;
  displayUnit?: boolean;
  guidelineColor?: ColorSpec;
  guidelineThickness?: number;
  guidelineDashPattern?: number[];
  unit?: number;
  measureFont?: FontSpec;
  measureFontColor?: ColorSpec;
  // Linear-only:
  offsetDistance?: number;
  allowOffset?: boolean;
  // Circular-only:
  radius?: number;
}

/**
 * Apply an `EditRulerPatch` — port of `EditRulerItemCommand`
 * (RulerCommands.cpp:99-149). Only fields present in the patch
 * change; everything else is preserved.
 */
export function editRulerItem(
  doc: Y.Doc,
  layerId: string,
  rulerId: string,
  patch: EditRulerPatch,
): void {
  doc.transact(() => {
    const layerData = doc.getMap('layerData').get(layerId);
    if (!(layerData instanceof Y.Map)) return;
    const yItems = layerData.get('rulerItems');
    if (!(yItems instanceof Y.Array)) return;
    const idx = findRulerIndex(yItems, rulerId);
    if (idx < 0) return;
    const cur = yItems.get(idx) as RulerLike;
    if (!cur) return;
    yItems.delete(idx, 1);
    const next: Record<string, unknown> = { ...cur };
    for (const k of [
      'color',
      'lineThickness',
      'displayDistance',
      'displayUnit',
      'guidelineColor',
      'guidelineThickness',
      'guidelineDashPattern',
      'unit',
      'measureFont',
      'measureFontColor',
    ] as const) {
      if (patch[k] !== undefined) next[k] = patch[k] as unknown;
    }
    if (cur.kind === 'linear') {
      if (patch.offsetDistance !== undefined) next.offsetDistance = patch.offsetDistance;
      if (patch.allowOffset !== undefined) next.allowOffset = patch.allowOffset;
    } else {
      if (patch.radius !== undefined) {
        const r = Math.max(0, patch.radius);
        next.radius = r;
        next.displayArea = rectAroundCircle(cur.center, r);
      }
    }
    yItems.insert(idx, [next]);
  }, LOCAL_ORIGIN);
}

type RulerLike = {
  id: string;
  kind: 'linear' | 'circular';
  point1: { x: number; y: number };
  point2: { x: number; y: number };
  center: { x: number; y: number };
  radius: number;
  attachedBrick1Id: string;
  attachedBrick2Id: string;
  attachedBrickId: string;
} & Record<string, unknown>;

function rectFromTwoPoints(
  p1: { x: number; y: number },
  p2: { x: number; y: number },
): RectangleF {
  const minX = Math.min(p1.x, p2.x);
  const minY = Math.min(p1.y, p2.y);
  const maxX = Math.max(p1.x, p2.x);
  const maxY = Math.max(p1.y, p2.y);
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

function rectAroundCircle(c: { x: number; y: number }, r: number): RectangleF {
  return { x: c.x - r, y: c.y - r, width: 2 * r, height: 2 * r };
}

export interface AddTextSpec {
  /** World centre of the displayArea, studs. */
  centreX: number;
  centreY: number;
  /** Approx box size in studs (used as displayArea dimensions). */
  widthStuds: number;
  heightStuds: number;
  text: string;
  /** Font shape — defaults applied if missing. */
  font: { family: string; size: number; style: string };
  /** Font colour as `{ kind: 'argb', argb: '...' }` or `{ kind: 'known', name: '...' }`. */
  fontColor: { kind: 'argb'; argb: string } | { kind: 'known'; name: string };
  orientation?: number;
  textAlignment?: string;
}

/**
 * The first text layer, or a new one named "Labels" at the top — where
 * desktop's Insert Text puts a cell (MapView::addTextAtScenePos).
 */
export function ensureTextLayer(doc: Y.Doc): string {
  const layerOrder = doc.getArray<string>('layers');
  const layerData = doc.getMap<Y.Map<unknown>>('layerData');
  const ids = layerOrder.toArray();
  for (let i = 0; i < ids.length; i++) {
    const id = ids[i]!;
    const l = layerData.get(id);
    if (l instanceof Y.Map && l.get('type') === 'text') return id;
  }
  const id = makeId();
  doc.transact(() => {
    const yLayer = new Y.Map<unknown>();
    yLayer.set('id', id);
    yLayer.set('type', 'text');
    yLayer.set('name', 'Labels');
    yLayer.set('visible', true);
    yLayer.set('transparency', 100);
    yLayer.set('hullProperties', {
      isVisible: false,
      hullColor: { kind: 'known', name: 'Black' },
      hullThickness: 1,
    });
    yLayer.set('textCells', new Y.Array());
    yLayer.set('groups', new Y.Array<Y.Map<unknown>>());
    layerData.set(id, yLayer);
    layerOrder.push([id]);
  }, LOCAL_ORIGIN);
  return id;
}

/**
 * Box for new text, in studs: 10 studs high, 0.6 of that per character
 * wide and at least twice the height (MapView::addTextAtScenePos).
 */
export function newTextBox(text: string): { width: number; height: number } {
  const height = 10;
  return { width: Math.max(height * 0.6 * text.length, height * 2), height };
}

/**
 * Append a new text cell to the given layer — port of
 * `AddTextCellCommand` (TextCommands.cpp:30-50).
 *
 * Single Yjs transaction → one undo step.
 */
export function addTextCell(doc: Y.Doc, layerId: string, spec: AddTextSpec): void {
  doc.transact(() => {
    const layerData = doc.getMap('layerData').get(layerId);
    if (!(layerData instanceof Y.Map)) return;
    const yCells = layerData.get('textCells');
    if (!(yCells instanceof Y.Array)) return;
    // Text cells are Y.Maps, like every cell the .bbm import writes
    // (packages/ydoc textCellToYMap); the projection reads them with
    // Y.Map#get, so a plain object here made the whole doc unprojectable.
    yCells.push([
      textCellYMap({
        displayArea: {
          x: spec.centreX - spec.widthStuds / 2,
          y: spec.centreY - spec.heightStuds / 2,
          width: spec.widthStuds,
          height: spec.heightStuds,
        },
        myGroup: '',
        text: spec.text,
        orientation: spec.orientation ?? 0,
        fontColor: spec.fontColor,
        font: spec.font,
        textAlignment: spec.textAlignment ?? 'Center',
      }),
    ]);
  }, LOCAL_ORIGIN);
}

function textCellYMap(fields: Record<string, unknown>): Y.Map<unknown> {
  const y = new Y.Map<unknown>();
  for (const [k, v] of Object.entries(fields)) y.set(k, v);
  return y;
}

/**
 * Apply `patch` to the text cell at `cellIndex`. Y.Map cells are edited
 * in place; a legacy plain-object cell (written by older web builds) is
 * replaced by an equivalent Y.Map.
 */
function patchTextCell(yCells: Y.Array<unknown>, cellIndex: number, patch: Record<string, unknown>): void {
  if (cellIndex < 0 || cellIndex >= yCells.length) return;
  const cell = yCells.get(cellIndex);
  if (cell instanceof Y.Map) {
    for (const [k, v] of Object.entries(patch)) cell.set(k, v);
    return;
  }
  if (!cell || typeof cell !== 'object') return;
  yCells.delete(cellIndex, 1);
  yCells.insert(cellIndex, [textCellYMap({ ...(cell as Record<string, unknown>), ...patch })]);
}

/**
 * Edit an existing text cell's `text` field by index — port of
 * `EditTextCellTextCommand`. We address by index because text cells
 * have no GUID in the .bbm format.
 */
export function editTextCell(doc: Y.Doc, layerId: string, cellIndex: number, newText: string): void {
  doc.transact(() => {
    const layerData = doc.getMap('layerData').get(layerId);
    if (!(layerData instanceof Y.Map)) return;
    const yCells = layerData.get('textCells');
    if (!(yCells instanceof Y.Array)) return;
    patchTextCell(yCells, cellIndex, { text: newText });
  }, LOCAL_ORIGIN);
}

export interface EditTextCellPatch {
  text?: string;
  font?: { family: string; size: number; style: string };
  fontColor?: { kind: 'argb'; argb: string } | { kind: 'known'; name: string };
  orientation?: number;
}

/**
 * Edit all properties of a text cell — port of `EditTextCellCommand`.
 * Addressed by index (text cells have no GUID in the .bbm format).
 */
export function editTextCellFull(
  doc: Y.Doc,
  layerId: string,
  cellIndex: number,
  patch: EditTextCellPatch,
): void {
  doc.transact(() => {
    const layerData = doc.getMap('layerData').get(layerId);
    if (!(layerData instanceof Y.Map)) return;
    const yCells = layerData.get('textCells');
    if (!(yCells instanceof Y.Array)) return;
    const next: Record<string, unknown> = {};
    if (patch.text !== undefined) next.text = patch.text;
    if (patch.font !== undefined) next.font = { ...patch.font };
    if (patch.fontColor !== undefined) next.fontColor = { ...patch.fontColor };
    if (patch.orientation !== undefined) next.orientation = patch.orientation;
    patchTextCell(yCells, cellIndex, next);
  }, LOCAL_ORIGIN);
}

/**
 * Delete a text cell by index — port of `DeleteTextCellCommand`
 * (TextCommands.cpp). Text cells have no GUID so we address by index.
 */
export function deleteTextCell(doc: Y.Doc, layerId: string, cellIndex: number): void {
  doc.transact(() => {
    const layerData = doc.getMap('layerData').get(layerId);
    if (!(layerData instanceof Y.Map)) return;
    const yCells = layerData.get('textCells');
    if (!(yCells instanceof Y.Array)) return;
    if (cellIndex < 0 || cellIndex >= yCells.length) return;
    yCells.delete(cellIndex, 1);
  }, LOCAL_ORIGIN);
}

export interface EditBrickPatch {
  partNumber?: string;
  /** Top-left of displayArea (studs). */
  x?: number;
  y?: number;
  orientation?: number;
  altitude?: number;
  activeConnectionPointIndex?: number;
}

/**
 * Edit per-brick properties — port of `EditBrickCommand`
 * (EditCommands.cpp:264-289). Only fields present in `patch` change;
 * everything else stays put. Single Yjs transaction → one undo step.
 */
export function editBrick(
  doc: Y.Doc,
  layerId: string,
  brickId: string,
  patch: EditBrickPatch,
): void {
  doc.transact(() => {
    const yBrick = findBrick(doc, layerId, brickId);
    if (!yBrick) return;
    if (patch.partNumber !== undefined) yBrick.set('partNumber', patch.partNumber);
    if (patch.orientation !== undefined) yBrick.set('orientation', mod360(patch.orientation));
    if (patch.altitude !== undefined) yBrick.set('altitude', patch.altitude);
    if (patch.activeConnectionPointIndex !== undefined) {
      yBrick.set('activeConnectionPointIndex', patch.activeConnectionPointIndex);
    }
    if (patch.x !== undefined || patch.y !== undefined) {
      const area = yBrick.get('displayArea') as RectangleF;
      yBrick.set('displayArea', {
        ...area,
        x: patch.x ?? area.x,
        y: patch.y ?? area.y,
      });
    }
  }, LOCAL_ORIGIN);
}

/**
 * Origin for UI-state writes that must sync and persist but are not
 * user edits, so the undo manager (tracking LOCAL_ORIGIN only) skips them.
 */
export const UI_STATE_ORIGIN = Symbol('cld-ui-state-origin');

/**
 * Persist the grab anchor: the connection the user clicked becomes the
 * brick's active connection point. Desktop `captureGrabAnchor` mutates
 * `activeConnectionPointIndex` in place without an undo command
 * (MapViewDrag.cpp:186-216) and BlueBrick saves it, so this writes under
 * UI_STATE_ORIGIN (synced, saved, not on the undo stack). No-op when
 * the value is unchanged.
 */
export function setActiveConnectionPoint(
  doc: Y.Doc,
  layerId: string,
  brickId: string,
  index: number,
): void {
  const yBrick = findBrick(doc, layerId, brickId);
  if (!yBrick || yBrick.get('activeConnectionPointIndex') === index) return;
  doc.transact(() => yBrick.set('activeConnectionPointIndex', index), UI_STATE_ORIGIN);
}

/**
 * Bring-to-front / send-to-back — port of desktop's
 * `ReorderBricksCommand` (EditCommands.cpp). Repositions every brick in
 * `brickIds` within its own layer's `bricks` Y.Array (any layer) so it sits at the
 * front (last index = top z) or back (index 0 = bottom z). Within-group
 * order is preserved.
 *
 * Wraps in a single Yjs transaction so undo treats the whole reorder
 * as one step.
 */
export function reorderBricks(
  doc: Y.Doc,
  brickIds: string[],
  to: 'front' | 'back',
): void {
  if (brickIds.length === 0) return;
  const idSet = new Set(brickIds);
  doc.transact(() => {
    // Reorder within each layer that contains any of the selected bricks.
    // Iterating all layers handles cross-layer selections correctly.
    const layerOrder = doc.getArray<string>('layers');
    for (const lid of layerOrder.toArray()) {
      const layerData = doc.getMap('layerData').get(lid);
      if (!(layerData instanceof Y.Map)) continue;
      const yBricks = layerData.get('bricks');
      if (!(yBricks instanceof Y.Array)) continue;

      const moving: number[] = [];
      for (let i = 0; i < yBricks.length; i++) {
        const b = yBricks.get(i);
        if (b instanceof Y.Map && idSet.has(b.get('id') as string)) moving.push(i);
      }
      if (moving.length === 0) continue;

      const all: Record<string, unknown>[] = [];
      for (let i = 0; i < yBricks.length; i++) {
        const b = yBricks.get(i);
        if (b instanceof Y.Map) all.push(b.toJSON() as Record<string, unknown>);
      }
      const movingSet = new Set(moving);
      const movingJson = moving.map((i) => all[i]!);
      const stationary = all.filter((_, i) => !movingSet.has(i));
      const next = to === 'front' ? [...stationary, ...movingJson]
                                  : [...movingJson, ...stationary];

      yBricks.delete(0, yBricks.length);
      for (const json of next) {
        const yBrick = new Y.Map<unknown>();
        for (const [k, v] of Object.entries(json)) yBrick.set(k, v);
        yBricks.push([yBrick]);
      }
    }
  }, LOCAL_ORIGIN);
}

/**
 * Group every brick in `brickIds` under a freshly-minted group id.
 * Mirrors desktop's `GroupBricksCommand` (EditCommands.cpp:290-355):
 * one new Group entry per layer, every brick's `myGroup` points at it.
 *
 * Single transaction → one undo step.
 */
export function groupBricks(doc: Y.Doc, layerId: string, brickIds: string[]): string | null {
  if (brickIds.length < 2) return null;
  const groupId = makeId();
  doc.transact(() => {
    const layerData = doc.getMap('layerData').get(layerId);
    if (!(layerData instanceof Y.Map)) return;
    const yBricks = layerData.get('bricks');
    if (!(yBricks instanceof Y.Array)) return;
    const yGroups = layerData.get('groups');
    if (!(yGroups instanceof Y.Array)) return;

    const newGroup = new Y.Map<unknown>();
    newGroup.set('id', groupId);
    yGroups.push([newGroup]);

    const idSet = new Set(brickIds);
    for (let i = 0; i < yBricks.length; i++) {
      const b = yBricks.get(i);
      if (b instanceof Y.Map && idSet.has(b.get('id') as string)) {
        b.set('myGroup', groupId);
      }
    }
  }, LOCAL_ORIGIN);
  return groupId;
}

/**
 * Clear every selected brick's `myGroup`, then drop any group entries
 * that no longer have any members. Port of `UngroupBricksCommand`
 * (EditCommands.cpp:357-...).
 */
export function ungroupBricks(doc: Y.Doc, layerId: string, brickIds: string[]): void {
  if (brickIds.length === 0) return;
  doc.transact(() => {
    const layerData = doc.getMap('layerData').get(layerId);
    if (!(layerData instanceof Y.Map)) return;
    const yBricks = layerData.get('bricks');
    if (!(yBricks instanceof Y.Array)) return;
    const yGroups = layerData.get('groups');
    if (!(yGroups instanceof Y.Array)) return;

    const affectedGroups = new Set<string>();
    const idSet = new Set(brickIds);
    for (let i = 0; i < yBricks.length; i++) {
      const b = yBricks.get(i);
      if (!(b instanceof Y.Map)) continue;
      if (!idSet.has(b.get('id') as string)) continue;
      const prior = (b.get('myGroup') as string) ?? '';
      if (prior) affectedGroups.add(prior);
      b.set('myGroup', '');
    }

    if (affectedGroups.size === 0) return;
    // Recompute which groups still have at least one member; drop the
    // empty ones from `groups` array (desktop ReorderBricksCommand path).
    const stillUsed = new Set<string>();
    for (let i = 0; i < yBricks.length; i++) {
      const b = yBricks.get(i);
      if (b instanceof Y.Map) {
        const g = (b.get('myGroup') as string) ?? '';
        if (g) stillUsed.add(g);
      }
    }
    for (let i = yGroups.length - 1; i >= 0; i--) {
      const g = yGroups.get(i);
      if (g instanceof Y.Map) {
        const id = g.get('id') as string;
        if (affectedGroups.has(id) && !stillUsed.has(id)) {
          yGroups.delete(i, 1);
        }
      }
    }
  }, LOCAL_ORIGIN);
}

/** Normalise to [0, 360) without losing fractional precision. */
function mod360(v: number): number {
  const r = v % 360;
  return r < 0 ? r + 360 : r;
}

function findBrick(doc: Y.Doc, layerId: string, brickId: string): Y.Map<unknown> | null {
  const layerData = doc.getMap('layerData').get(layerId);
  if (!(layerData instanceof Y.Map)) return null;
  const bricks = layerData.get('bricks');
  if (!(bricks instanceof Y.Array)) return null;
  for (let i = 0; i < bricks.length; i++) {
    const b = bricks.get(i);
    if (b instanceof Y.Map && b.get('id') === brickId) return b;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Initialisers — used when starting from a blank layout and the user does
// their first interaction. We seed minimal defaults for layers / fonts.
// ---------------------------------------------------------------------------

export type LayerKind = 'grid' | 'brick' | 'area' | 'text' | 'ruler';

const NEW_LAYER_DEFAULTS: Record<LayerKind, { name: string; extraFields: () => Record<string, unknown> }> = {
  // Desktop LayerGrid defaults (core/LayerGrid.h:20-38): half-transparent
  // black lines, 32-stud cells, 4 sub-divisions, no cell index.
  grid: {
    name: 'Grid',
    extraFields: () => ({
      gridColor: { kind: 'argb', argb: '80000000' } satisfies ColorSpec,
      gridThickness: 2,
      subGridColor: { kind: 'argb', argb: '40000000' } satisfies ColorSpec,
      subGridThickness: 1,
      gridSizeInStud: 32,
      subDivisionNumber: 4,
      displayGrid: true,
      displaySubGrid: true,
      displayCellIndex: false,
      cellIndexFont: { family: 'Microsoft Sans Serif', size: 8.25, style: 'Regular' } satisfies FontSpec,
      cellIndexColor: { kind: 'known', name: 'Black' } satisfies ColorSpec,
      cellIndexColumnType: '0',
      cellIndexRowType: '1',
      cellIndexCorner: '',
    }),
  },
  brick: {
    name: 'Parts',
    extraFields: () => ({
      displayBrickElevation: false,
      bricks: new Y.Array<Y.Map<unknown>>(),
    }),
  },
  area: {
    name: 'Area',
    extraFields: () => ({
      areaCellSize: AREA_CELL_SIZE_DEFAULT,
      areas: new Y.Array<{ x: number; y: number; color: string }>(),
    }),
  },
  text: {
    name: 'Text',
    extraFields: () => ({ textCells: new Y.Array() }),
  },
  ruler: {
    name: 'Ruler',
    extraFields: () => ({ rulerItems: new Y.Array() }),
  },
};

/**
 * Unconditionally create a new layer of the given kind and return its id.
 * Unlike the `ensure*Layer` initialisers below (which are idempotent —
 * used to lazily seed a blank doc on first interaction), this always adds
 * a fresh layer, disambiguating the default name against existing layers
 * of the same kind (e.g. "Parts", "Parts 2", "Parts 3", ...).
 */
export function addLayer(doc: Y.Doc, kind: LayerKind): string {
  const layerOrder = doc.getArray<string>('layers');
  const layerData = doc.getMap<Y.Map<unknown>>('layerData');
  const defaults = NEW_LAYER_DEFAULTS[kind];
  const existingNames = new Set(
    layerOrder
      .toArray()
      .map((id) => layerData.get(id))
      .filter((l): l is Y.Map<unknown> => l instanceof Y.Map && l.get('type') === kind)
      .map((l) => l.get('name')),
  );
  let name = defaults.name;
  for (let n = 2; existingNames.has(name); n++) name = `${defaults.name} ${n}`;

  const id = makeId();
  doc.transact(() => {
    const meta = doc.getMap('meta');
    if (meta.get('version') === undefined) seedDefaultMeta(meta);
    const yLayer = new Y.Map<unknown>();
    yLayer.set('id', id);
    yLayer.set('type', kind);
    yLayer.set('name', name);
    yLayer.set('visible', true);
    yLayer.set('transparency', 100);
    yLayer.set('hullProperties', {
      isVisible: false,
      hullColor: { kind: 'known', name: 'Black' } satisfies ColorSpec,
      hullThickness: 1,
    });
    for (const [k, v] of Object.entries(defaults.extraFields())) yLayer.set(k, v);
    yLayer.set('groups', new Y.Array<Y.Map<unknown>>());
    layerData.set(id, yLayer);
    layerOrder.push([id]);
  }, LOCAL_ORIGIN);
  return id;
}

export function ensureBrickLayer(doc: Y.Doc): string {
  const layerOrder = doc.getArray<string>('layers');
  const layerData = doc.getMap<Y.Map<unknown>>('layerData');
  for (const id of layerOrder.toArray()) {
    const l = layerData.get(id);
    if (l instanceof Y.Map && l.get('type') === 'brick') return id;
  }
  // No brick layer exists — create one. Include a meta header if the doc
  // is fully empty so docToBbm doesn't trip on a missing version.
  const meta = doc.getMap('meta');
  doc.transact(() => {
    if (meta.get('version') === undefined) seedDefaultMeta(meta);
    const layerId = makeId();
    const yLayer = new Y.Map<unknown>();
    yLayer.set('id', layerId);
    yLayer.set('type', 'brick');
    yLayer.set('name', 'Parts');
    yLayer.set('visible', true);
    yLayer.set('transparency', 100);
    yLayer.set('hullProperties', {
      isVisible: false,
      hullColor: { kind: 'known', name: 'Black' } satisfies ColorSpec,
      hullThickness: 1,
    });
    yLayer.set('displayBrickElevation', false);
    yLayer.set('bricks', new Y.Array<Y.Map<unknown>>());
    yLayer.set('groups', new Y.Array<Y.Map<unknown>>());
    layerData.set(layerId, yLayer);
    layerOrder.push([layerId]);
  }, LOCAL_ORIGIN);
  return ensureBrickLayer(doc); // re-resolve the id after the transaction
}

function seedDefaultMeta(meta: Y.Map<unknown>): void {
  const today = new Date();
  meta.set('version', 9);
  meta.set('nbItems', 0);
  meta.set('backgroundColor', { kind: 'known', name: 'White' } satisfies ColorSpec);
  meta.set('author', '');
  meta.set('lug', '');
  meta.set('event', '');
  meta.set('date', {
    day: today.getDate(),
    month: today.getMonth() + 1,
    year: today.getFullYear(),
  });
  meta.set('comment', '');
  meta.set('exportInfo', {
    exportPath: '',
    exportFileType: 4,
    exportArea: { x: 0, y: 0, width: 0, height: 0 },
    exportScale: 0,
    exportWatermark: true,
    exportElectricCircuit: false,
    exportConnectionPoints: false,
  });
  meta.set('selectedLayerIndex', 0);
}

// ---------------------------------------------------------------------------
// Sidecar — anchored label mutations
//
// The sidecar blob is stored as `meta.cache` (a plain JS object). Label
// mutations read it, patch the `anchoredLabels` array, and write it back in
// a Yjs transaction. This is last-write-wins at the sidecar level — the same
// trade-off accepted by venue + module sidecar entries — but correct for
// typical single-user editing sessions.
// ---------------------------------------------------------------------------

function readSidecarCache(doc: Y.Doc): Record<string, unknown> {
  const meta = doc.getMap('meta');
  const cache = meta.get('cache');
  return (cache && typeof cache === 'object' ? cache : {}) as Record<string, unknown>;
}

function writeSidecarCache(doc: Y.Doc, cache: Record<string, unknown>): void {
  doc.getMap('meta').set('cache', cache);
}

export function addAnchoredLabel(doc: Y.Doc, label: AnchoredLabel): void {
  doc.transact(() => {
    const cache = readSidecarCache(doc);
    const existing = Array.isArray(cache.anchoredLabels) ? (cache.anchoredLabels as AnchoredLabel[]) : [];
    writeSidecarCache(doc, { ...cache, anchoredLabels: [...existing, label] });
  }, LOCAL_ORIGIN);
}

export function editAnchoredLabel(doc: Y.Doc, id: string, patch: Partial<AnchoredLabel>): void {
  doc.transact(() => {
    const cache = readSidecarCache(doc);
    const existing = Array.isArray(cache.anchoredLabels) ? (cache.anchoredLabels as AnchoredLabel[]) : [];
    writeSidecarCache(doc, {
      ...cache,
      anchoredLabels: existing.map((l) => (l.id === id ? { ...l, ...patch } : l)),
    });
  }, LOCAL_ORIGIN);
}

export function deleteAnchoredLabel(doc: Y.Doc, id: string): void {
  doc.transact(() => {
    const cache = readSidecarCache(doc);
    const existing = Array.isArray(cache.anchoredLabels) ? (cache.anchoredLabels as AnchoredLabel[]) : [];
    writeSidecarCache(doc, {
      ...cache,
      anchoredLabels: existing.filter((l) => l.id !== id),
    });
  }, LOCAL_ORIGIN);
}

export function moveAnchoredLabel(doc: Y.Doc, id: string, dx: number, dy: number): void {
  doc.transact(() => {
    const cache = readSidecarCache(doc);
    const existing = Array.isArray(cache.anchoredLabels) ? (cache.anchoredLabels as AnchoredLabel[]) : [];
    writeSidecarCache(doc, {
      ...cache,
      anchoredLabels: existing.map((l) =>
        l.id === id ? { ...l, offset: { x: l.offset.x + dx, y: l.offset.y + dy } } : l,
      ),
    });
  }, LOCAL_ORIGIN);
}

// ---------------------------------------------------------------------------
// Sidecar — module mutations (same last-write-wins pattern as labels)
// ---------------------------------------------------------------------------

function getSidecarModules(cache: Record<string, unknown>): SidecarModule[] {
  return Array.isArray(cache.modules) ? (cache.modules as SidecarModule[]) : [];
}

export function addSidecarModule(doc: Y.Doc, module: SidecarModule): void {
  doc.transact(() => {
    const cache = readSidecarCache(doc);
    writeSidecarCache(doc, { ...cache, modules: [...getSidecarModules(cache), module] });
  }, LOCAL_ORIGIN);
}

/**
 * Register the given bricks as a new sidecar module — desktop
 * `CreateModuleCommand` (ModuleCommands.cpp:38-58), reached from
 * Modules ▸ Create from Selection (MainWindow.cpp:1056). The bricks stay
 * where they are; only the module entry is added. Returns its id, or
 * null when there is nothing to group.
 */
export function createSidecarModule(doc: Y.Doc, name: string, memberIds: string[]): string | null {
  const members = [...new Set(memberIds)];
  if (members.length === 0) return null;
  const id = makeId();
  addSidecarModule(doc, {
    id,
    name: name.trim() || 'New Module',
    members,
    transform: [1, 0, 0, 0, 1, 0, 0, 0, 1],
  });
  return id;
}

/**
 * Place a set's bricks and wrap them in a sidecar module named after the
 * set, as one undo step — desktop places a set this way so it moves as a
 * unit (MapView.cpp:1344-1390). Returns the new brick ids.
 */
export function insertSet(
  doc: Y.Doc,
  layerId: string,
  bricks: Parameters<typeof insertBricks>[2],
  setName: string,
): string[] {
  let ids: string[] = [];
  doc.transact(() => {
    ids = insertBricks(doc, layerId, bricks, { dx: 0, dy: 0 });
    createSidecarModule(doc, setName, ids);
  }, LOCAL_ORIGIN);
  return ids;
}

/** One source brick layer of a module file — desktop `LayerBatch`. */
export interface ModuleBatch {
  layerName: string;
  bricks: Array<{
    partNumber: string;
    displayArea: RectangleF;
    orientation?: number;
    altitude?: number;
  }>;
}

/**
 * Insert a module's bricks and register them as a sidecar module in ONE
 * transaction — desktop `ImportBbmAsModuleCommand` (ModuleCommands.cpp:451-506).
 * Each batch lands on the host brick layer with the same name, or on a
 * new brick layer with that name when none exists, so the module keeps
 * its layering (tracks stay above scenery). Returns the module id and
 * the new brick ids.
 */
export function importBricksAsModule(
  doc: Y.Doc,
  batches: ModuleBatch[],
  opts: { name: string; offset?: { dx: number; dy: number }; sourceFile?: string },
): { moduleId: string; ids: string[] } | null {
  const nonEmpty = batches.filter((b) => b.bricks.length > 0);
  if (nonEmpty.length === 0) return null;
  const moduleId = makeId();
  const ids: string[] = [];
  doc.transact(() => {
    const layerData = doc.getMap('layerData');
    const findByName = (name: string): string | null => {
      for (const lid of doc.getArray<string>('layers').toArray()) {
        const l = layerData.get(lid);
        if (l instanceof Y.Map && l.get('type') === 'brick' && l.get('name') === name) return lid;
      }
      return null;
    };
    for (const batch of nonEmpty) {
      const name = batch.layerName || 'Module';
      let layerId = findByName(name);
      if (!layerId) {
        layerId = addLayer(doc, 'brick');
        renameLayer(doc, layerId, name);
      }
      ids.push(...insertBricks(doc, layerId, batch.bricks, opts.offset));
    }
    const cache = readSidecarCache(doc);
    const mod: SidecarModule = {
      id: moduleId,
      name: opts.name || 'Module',
      members: ids,
      transform: [1, 0, 0, 0, 1, 0, 0, 0, 1],
      importedAt: new Date().toISOString(),
      ...(opts.sourceFile ? { sourceFile: opts.sourceFile } : {}),
    };
    writeSidecarCache(doc, { ...cache, modules: [...getSidecarModules(cache), mod] });
  }, LOCAL_ORIGIN);
  return { moduleId, ids };
}

export function renameSidecarModule(doc: Y.Doc, id: string, name: string): void {
  doc.transact(() => {
    const cache = readSidecarCache(doc);
    writeSidecarCache(doc, {
      ...cache,
      modules: getSidecarModules(cache).map((m) => (m.id === id ? { ...m, name } : m)),
    });
  }, LOCAL_ORIGIN);
}

export function deleteSidecarModule(doc: Y.Doc, id: string): void {
  doc.transact(() => {
    const cache = readSidecarCache(doc);
    writeSidecarCache(doc, {
      ...cache,
      modules: getSidecarModules(cache).filter((m) => m.id !== id),
    });
  }, LOCAL_ORIGIN);
}

/**
 * Replace the member list for a sidecar module — used after Flatten
 * removes bricks or Rescan re-discovers them.
 */
export function setSidecarModuleMembers(doc: Y.Doc, id: string, members: string[]): void {
  doc.transact(() => {
    const cache = readSidecarCache(doc);
    writeSidecarCache(doc, {
      ...cache,
      modules: getSidecarModules(cache).map((m) => (m.id === id ? { ...m, members } : m)),
    });
  }, LOCAL_ORIGIN);
}

/**
 * Flatten a module — unregisters it from the sidecar while leaving its
 * member bricks in place. Mirrors `FlattenModuleCommand` (ModuleCommands.cpp).
 */
export function flattenSidecarModule(doc: Y.Doc, id: string): void {
  deleteSidecarModule(doc, id);
}

/**
 * Translate all member bricks of a sidecar module by (dx, dy) studs.
 * Scans all layers — mirrors MoveModuleCommand (ModuleCommands.cpp:89-101).
 */
export function moveModuleBricks(
  doc: Y.Doc,
  memberIds: string[],
  dxStuds: number,
  dyStuds: number,
): void {
  if (memberIds.length === 0 || (dxStuds === 0 && dyStuds === 0)) return;
  const idSet = new Set(memberIds);
  const layerOrder = doc.getArray<string>('layers');
  doc.transact(() => {
    for (const layerId of layerOrder.toArray()) {
      const layerData = doc.getMap('layerData').get(layerId);
      if (!(layerData instanceof Y.Map)) continue;
      const bricks = layerData.get('bricks');
      if (!(bricks instanceof Y.Array)) continue;
      for (let i = 0; i < bricks.length; i++) {
        const b = bricks.get(i);
        if (!(b instanceof Y.Map) || !idSet.has(b.get('id') as string)) continue;
        const area = b.get('displayArea') as RectangleF;
        b.set('displayArea', { ...area, x: area.x + dxStuds, y: area.y + dyStuds });
      }
    }
  }, LOCAL_ORIGIN);
}

/**
 * Rotate all member bricks of a sidecar module by `degrees` around their
 * collective centroid. Mirrors RotateModuleCommand (ModuleCommands.cpp:125-183).
 */
export function rotateModuleBricks(
  doc: Y.Doc,
  memberIds: string[],
  degrees: number,
): void {
  if (memberIds.length === 0 || degrees === 0) return;
  const idSet = new Set(memberIds);
  const layerOrder = doc.getArray<string>('layers');

  // Collect all member Y.Maps and compute centroid first.
  const found: Array<{ yBrick: Y.Map<unknown>; area: RectangleF }> = [];
  for (const layerId of layerOrder.toArray()) {
    const layerData = doc.getMap('layerData').get(layerId);
    if (!(layerData instanceof Y.Map)) continue;
    const bricks = layerData.get('bricks');
    if (!(bricks instanceof Y.Array)) continue;
    for (let i = 0; i < bricks.length; i++) {
      const b = bricks.get(i);
      if (!(b instanceof Y.Map) || !idSet.has(b.get('id') as string)) continue;
      found.push({ yBrick: b, area: b.get('displayArea') as RectangleF });
    }
  }
  if (found.length === 0) return;

  const cx = found.reduce((s, { area }) => s + area.x + area.width / 2, 0) / found.length;
  const cy = found.reduce((s, { area }) => s + area.y + area.height / 2, 0) / found.length;
  const rad = (degrees * Math.PI) / 180;
  const cosA = Math.cos(rad), sinA = Math.sin(rad);

  doc.transact(() => {
    for (const { yBrick, area } of found) {
      const bx = area.x + area.width / 2 - cx;
      const by = area.y + area.height / 2 - cy;
      const nx = cx + (bx * cosA - by * sinA) - area.width / 2;
      const ny = cy + (bx * sinA + by * cosA) - area.height / 2;
      yBrick.set('displayArea', { ...area, x: nx, y: ny });
      const orient = (yBrick.get('orientation') as number) ?? 0;
      yBrick.set('orientation', mod360(orient + degrees));
    }
  }, LOCAL_ORIGIN);
}

/**
 * Update arbitrary fields on a sidecar module entry (e.g. sourceFile after
 * Save to Library). Mirrors the pattern of renameSidecarModule.
 */
export function patchSidecarModule(
  doc: Y.Doc,
  id: string,
  patch: Partial<SidecarModule>,
): void {
  doc.transact(() => {
    const cache = readSidecarCache(doc);
    writeSidecarCache(doc, {
      ...cache,
      modules: getSidecarModules(cache).map((m) => (m.id === id ? { ...m, ...patch } : m)),
    });
  }, LOCAL_ORIGIN);
}

/**
 * Clone a module — duplicate every member brick across all layers with fresh
 * IDs, offset by the module's bounding-box width + 2 studs, and register a
 * new sidecar module entry. Mirrors CloneModuleCommand (ModuleCommands.cpp:232-300).
 */
export function cloneModuleBricks(doc: Y.Doc, module: SidecarModule): void {
  if (module.members.length === 0) return;
  const idSet = new Set(module.members);
  const layerOrder = doc.getArray<string>('layers');

  // Compute bounding box to determine offset.
  let minX = Infinity, maxX = -Infinity;
  for (const layerId of layerOrder.toArray()) {
    const layerData = doc.getMap('layerData').get(layerId);
    if (!(layerData instanceof Y.Map)) continue;
    const bricks = layerData.get('bricks');
    if (!(bricks instanceof Y.Array)) continue;
    for (let i = 0; i < bricks.length; i++) {
      const b = bricks.get(i);
      if (!(b instanceof Y.Map) || !idSet.has(b.get('id') as string)) continue;
      const area = b.get('displayArea') as RectangleF;
      minX = Math.min(minX, area.x);
      maxX = Math.max(maxX, area.x + area.width);
    }
  }
  const offsetX = Number.isFinite(maxX) ? maxX - minX + 2 : 4;

  const newMemberIds: string[] = [];
  doc.transact(() => {
    for (const layerId of layerOrder.toArray()) {
      const layerData = doc.getMap('layerData').get(layerId);
      if (!(layerData instanceof Y.Map)) continue;
      const bricks = layerData.get('bricks');
      if (!(bricks instanceof Y.Array)) continue;
      // Snapshot so we don't iterate bricks we're appending.
      const snap: Y.Map<unknown>[] = [];
      for (let i = 0; i < bricks.length; i++) {
        const b = bricks.get(i);
        if (b instanceof Y.Map && idSet.has(b.get('id') as string)) snap.push(b);
      }
      for (const src of snap) {
        const area = src.get('displayArea') as RectangleF;
        const newId = makeId();
        newMemberIds.push(newId);
        const yNew = new Y.Map<unknown>();
        yNew.set('id', newId);
        yNew.set('displayArea', { ...area, x: area.x + offsetX });
        yNew.set('partNumber', src.get('partNumber'));
        yNew.set('orientation', src.get('orientation') ?? 0);
        yNew.set('altitude', src.get('altitude') ?? 0);
        yNew.set('activeConnectionPointIndex', 0);
        yNew.set('myGroup', '');
        yNew.set('connexions', []);
        bricks.push([yNew]);
      }
    }

    const cache = readSidecarCache(doc);
    const cloned: SidecarModule = {
      id: makeId(),
      name: module.name ? `${module.name} (copy)` : '(copy)',
      members: newMemberIds,
      transform: [1, 0, 0, 0, 1, 0, 0, 0, 1],
    };
    writeSidecarCache(doc, { ...cache, modules: [...getSidecarModules(cache), cloned] });
  }, LOCAL_ORIGIN);
}

/**
 * Replace the member bricks of a module with a fresh set (Re-scan).
 * Removes old member bricks across all layers, inserts fresh bricks into
 * `targetLayerId`, and updates the module's member list. Mirrors
 * RescanModuleCommand (ModuleCommands.cpp:346-410).
 */
export function rescanModuleFromBricks(
  doc: Y.Doc,
  module: SidecarModule,
  freshBricks: Array<{
    partNumber: string;
    displayArea: RectangleF;
    orientation?: number;
    altitude?: number;
  }>,
  targetLayerId: string,
): void {
  if (freshBricks.length === 0) return;
  const oldIdSet = new Set(module.members);
  const layerOrder = doc.getArray<string>('layers');
  const newIds: string[] = [];

  doc.transact(() => {
    // Remove old members from all layers.
    for (const layerId of layerOrder.toArray()) {
      const layerData = doc.getMap('layerData').get(layerId);
      if (!(layerData instanceof Y.Map)) continue;
      const bricks = layerData.get('bricks');
      if (!(bricks instanceof Y.Array)) continue;
      for (let i = bricks.length - 1; i >= 0; i--) {
        const b = bricks.get(i);
        if (b instanceof Y.Map && oldIdSet.has(b.get('id') as string)) {
          bricks.delete(i, 1);
        }
      }
    }

    // Insert fresh bricks into target layer.
    const layerData = doc.getMap('layerData').get(targetLayerId);
    if (!(layerData instanceof Y.Map)) return;
    const bricks = layerData.get('bricks');
    if (!(bricks instanceof Y.Array)) return;
    for (const b of freshBricks) {
      const newId = makeId();
      newIds.push(newId);
      const yBrick = new Y.Map<unknown>();
      yBrick.set('id', newId);
      yBrick.set('displayArea', b.displayArea);
      yBrick.set('partNumber', b.partNumber);
      yBrick.set('orientation', b.orientation ?? 0);
      yBrick.set('altitude', b.altitude ?? 0);
      yBrick.set('activeConnectionPointIndex', 0);
      yBrick.set('myGroup', '');
      yBrick.set('connexions', []);
      bricks.push([yBrick]);
    }

    // Update module member list.
    const cache = readSidecarCache(doc);
    writeSidecarCache(doc, {
      ...cache,
      modules: getSidecarModules(cache).map((m) =>
        m.id === module.id ? { ...m, members: newIds } : m,
      ),
    });
  }, LOCAL_ORIGIN);
}

// Sidecar — venue

/**
 * Replace the entire venue (or clear it). Mirrors SetVenueCommand
 * (VenueCommands.cpp). Pass `null` to clear.
 */
export function setVenue(doc: Y.Doc, venue: import('@cld/bbm').Venue | null): void {
  doc.transact(() => {
    const cache = readSidecarCache(doc);
    if (venue === null) {
      const { venue: _removed, ...rest } = cache as Record<string, unknown>;
      writeSidecarCache(doc, rest);
    } else {
      writeSidecarCache(doc, { ...cache, venue });
    }
  }, LOCAL_ORIGIN);
}

// Sidecar — background image

export function setBackgroundImage(doc: Y.Doc, bg: BackgroundImage): void {
  doc.transact(() => {
    const cache = readSidecarCache(doc);
    writeSidecarCache(doc, { ...cache, backgroundImage: bg });
  }, LOCAL_ORIGIN);
}

export function clearBackgroundImage(doc: Y.Doc): void {
  doc.transact(() => {
    const { backgroundImage: _removed, ...rest } = readSidecarCache(doc);
    writeSidecarCache(doc, rest);
  }, LOCAL_ORIGIN);
}

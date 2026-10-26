// Grid sizes both apps can draw. A grid layer's `gridSizeInStud` (its cell
// size) must be a finite number from 1 to the largest 32-bit int: the
// desktop holds it as an int and draws its grid lines that far apart. An
// update or a whole document that
// would leave a grid layer outside that range (0, negative, a fraction
// below 1, too big for an int, not finite, not a number, or the field
// gone) is refused like one the apps can't read (ws/updateGuard.ts).
//
// The check is cheap for almost every update: it reads the update's
// structs (decoded once and shared with the merge guard, ws/decoded.ts),
// and only when the update could leave a grid layer without a valid size is
// the result worked out, on a copy of the room's document. That is when it:
//   - writes a layer's type as 'grid' (or as something not a plain value);
//   - writes a grid size that isn't one plain valid number, or deletes the
//     value it writes;
//   - deletes the grid size of a layer that is a grid and stays;
//   - lands while the room has changes waiting for others (they may land
//     with it), or holds two structs for one id (hand-made: Yjs reads one).
// So a new grid layer and a change of a grid's size are worked out on the
// copy; adding a layer of another kind, deleting a layer, and every edit
// that writes neither key (parts, labels, a paste, an offline session)
// can't leave a grid without a valid size, and never need it.

import * as Y from 'yjs';
import { decodeIncoming, findStruct, guardWork, type DecodedUpdate, type DeleteSet } from './decoded.js';

const SIZE_KEY = 'gridSizeInStud';
const TYPE_KEY = 'type';
const LAYER_DATA = 'layerData';
export const MAX_GRID_SIZE = 2147483647;

/** Whether `v` is a grid size both apps draw. */
export function validGridSize(v: unknown): boolean {
  return typeof v === 'number' && Number.isFinite(v) && v >= 1 && v <= MAX_GRID_SIZE;
}

/** The grid layers (by id) of `doc` whose size isn't valid. */
export function invalidGridLayers(doc: Y.Doc): Set<string> {
  const out = new Set<string>();
  const layerData = doc.share.get(LAYER_DATA);
  if (!layerData) return out;
  // A root type not read as a map yet: look at its entries as one.
  const map = layerData instanceof Y.Map ? layerData : doc.getMap(LAYER_DATA);
  map.forEach((layer, id) => {
    if (layer instanceof Y.Map && layer.get(TYPE_KEY) === 'grid' && !validGridSize(layer.get(SIZE_KEY))) out.add(id);
  });
  return out;
}

/** Could this write of a layer's type make it a grid? */
function mayWriteGrid(content: unknown): boolean {
  if (content instanceof Y.ContentDeleted) return false; // a type taken away: not a grid
  if (content instanceof Y.ContentAny || content instanceof Y.ContentJSON) return content.arr.includes('grid');
  return true; // some other kind of value: work it out
}

/** Is this write of a grid size one valid number that stays? */
function writesValidSize(item: Y.Item, ds: DeleteSet): boolean {
  const c = item.content;
  if (!(c instanceof Y.ContentAny || c instanceof Y.ContentJSON)) return false;
  return item.length === 1 && c.arr.length === 1 && validGridSize(c.arr[0]) && !Y.isDeleted(ds, item.id);
}

/** Could `update` leave a grid layer of `doc` without a valid size? (False: certainly not.) */
function mayBreakGrid(doc: Y.Doc | null, update: DecodedUpdate): boolean {
  // Changes the room holds back until others arrive may land with this one.
  if (doc?.store.pendingStructs || doc?.store.pendingDs) return true;
  if (update.overlapping) return true;
  const { structs, ds, byClient } = update;
  const known = (id: Y.ID): boolean => !!doc && id.clock < Y.getState(doc.store, id.client);
  // The map key an item is the value of: written with it the first time a
  // key is set, else the key of the value it replaces (its origin; or the
  // one it is placed before, with no origin). Each
  // item's key is worked out once: a paste of 1000 parts is one chain of
  // origins 1000 long, so walking it from every item was quadratic.
  const keys = new Map<Y.Item, string | null>();
  const keyOf = (start: Y.Item): string | null => {
    const chain: Y.Item[] = [];
    const seen = new Set<Y.Item>();
    let item: Y.Item | null = start;
    let key: string | null = null;
    while (item) {
      const memo = keys.get(item);
      if (memo !== undefined) {
        key = memo;
        break;
      }
      chain.push(item);
      seen.add(item);
      if (item.parentSub !== null) {
        key = item.parentSub;
        break;
      }
      // Its parent written without a key: a list item, not a map value.
      if (item.parent !== null) break;
      const ref: Y.ID | null = item.origin ?? item.rightOrigin;
      if (!ref) break;
      if (known(ref)) {
        try {
          const there = Y.getItem(doc!.store, ref);
          key = there instanceof Y.Item ? there.parentSub : null;
        } catch {
          key = null;
        }
        break;
      }
      const next = findStruct(byClient.get(ref.client), ref.clock);
      item = next instanceof Y.Item && !seen.has(next) ? next : null;
    }
    for (const c of chain) keys.set(c, key);
    return key;
  };
  for (const s of structs) {
    if (!(s instanceof Y.Item)) continue;
    const key = keyOf(s);
    if (key === SIZE_KEY && !writesValidSize(s, ds)) return true;
    if (key === TYPE_KEY && mayWriteGrid(s.content)) return true;
  }
  // Deleting the grid size of a layer that is a grid, unless the layer goes too.
  if (doc) {
    for (const [client, ranges] of ds.clients) {
      const list = doc.store.clients.get(client);
      if (!list) continue;
      for (const r of ranges) {
        const end = Math.min(r.clock + r.len, Y.getState(doc.store, client));
        if (r.clock >= end) continue;
        for (let i = Y.findIndexSS(list, r.clock); i < list.length && list[i]!.id.clock < end; i++) {
          const s = list[i];
          if (!(s instanceof Y.Item) || s.parentSub !== SIZE_KEY || s.deleted) continue;
          const layer = s.parent;
          if (!(layer instanceof Y.Map) || layer.get(TYPE_KEY) !== 'grid') continue;
          const layerItem = layer._item;
          if (layerItem && (layerItem.deleted || Y.isDeleted(ds, layerItem.id))) continue;
          return true;
        }
      }
    }
  }
  return false;
}

/**
 * Null when `update` (Yjs update v1) leaves every grid layer of `doc` with
 * a size both apps draw, or doesn't change one; else why not, for the log.
 * `doc` is the room's document, or null for a whole document on its own (a
 * snapshot). A grid size that was already out of range before the update
 * doesn't refuse it (so a layout saved that way can still be fixed).
 */
export function checkGridSizes(doc: Y.Doc | null, update: Uint8Array): string | null {
  const decoded = decodeIncoming(update);
  // Unreadable: the update guard and Yjs refuse it on their own.
  return decoded ? checkGridSizesDecoded(doc, update, decoded) : null;
}

/** checkGridSizes with the update already decoded (the live handler shares one decode). */
export function checkGridSizesDecoded(doc: Y.Doc | null, update: Uint8Array, decoded: DecodedUpdate): string | null {
  if (!mayBreakGrid(doc, decoded)) return null;
  guardWork.docCopies += 1;
  const before = doc ? invalidGridLayers(doc) : new Set<string>();
  const after = new Y.Doc();
  try {
    if (doc) Y.applyUpdate(after, Y.encodeStateAsUpdate(doc));
    Y.applyUpdate(after, update);
    for (const id of invalidGridLayers(after)) {
      if (!before.has(id)) return `it leaves grid layer ${id} with a cell size outside 1 to ${MAX_GRID_SIZE} studs`;
    }
    return null;
  } catch {
    return null; // Yjs can't apply it either: it changes nothing
  } finally {
    after.destroy();
  }
}

// Grid sizes both apps can draw. A grid layer's `gridSizeInStud` (its cell
// size) must be a finite number from 1 to the largest 32-bit int: the
// desktop holds it as an int and draws its grid lines that far apart. An
// update or a whole document that
// would leave a grid layer outside that range (0, negative, a fraction
// below 1, too big for an int, not finite, not a number, or the field
// gone) is refused like one the apps can't read (ws/updateGuard.ts).
//
// The check is cheap for almost every update: one decode, and only when
// the update could change a grid layer (it writes a layer's type or grid
// size, deletes one, or the room has changes waiting for others) is the
// result worked out, on a copy of the room's document.

import * as Y from 'yjs';

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

type Struct = Y.Item | Y.GC | Y.Skip;
type DeleteSet = ReturnType<typeof Y.decodeUpdate>['ds'];

/** Could `update` change a grid layer's type or size in `doc`? */
function touchesGrid(doc: Y.Doc | null, structs: Struct[], ds: DeleteSet): boolean {
  // Changes the room holds back until others arrive may land with this one.
  if (doc?.store.pendingStructs || doc?.store.pendingDs) return true;
  const inUpdate = new Map<number, Struct[]>();
  for (const s of structs) {
    let list = inUpdate.get(s.id.client);
    if (!list) inUpdate.set(s.id.client, (list = []));
    list.push(s);
  }
  const findInUpdate = (id: Y.ID): Struct | null =>
    inUpdate.get(id.client)?.find((s) => id.clock >= s.id.clock && id.clock < s.id.clock + s.length) ?? null;
  const known = (id: Y.ID): boolean => !!doc && id.clock < Y.getState(doc.store, id.client);
  // The map key an item is the value of: written with it the first time a
  // key is set, else the key of the value it replaces (its origin).
  const keyOf = (start: Y.Item): string | null => {
    let item: Y.Item | null = start;
    for (let steps = 0; item && steps < 10000; steps++) {
      if (item.parentSub !== null) return item.parentSub;
      // Its parent written without a key: a list item, not a map value.
      if (item.parent !== null) return null;
      const ref: Y.ID | null = item.origin;
      if (!ref) return null;
      if (known(ref)) {
        try {
          const there = Y.getItem(doc!.store, ref);
          return there instanceof Y.Item ? there.parentSub : null;
        } catch {
          return null;
        }
      }
      const next = findInUpdate(ref);
      item = next instanceof Y.Item && next !== item ? next : null;
    }
    return null;
  };
  for (const s of structs) {
    if (!(s instanceof Y.Item)) continue;
    const key = keyOf(s);
    if (key === SIZE_KEY || key === TYPE_KEY) return true;
  }
  // Deleting a grid size, or a layer's type.
  if (doc) {
    for (const [client, ranges] of ds.clients) {
      const list = doc.store.clients.get(client);
      if (!list) continue;
      for (const r of ranges) {
        const end = Math.min(r.clock + r.len, Y.getState(doc.store, client));
        if (r.clock >= end) continue;
        for (let i = Y.findIndexSS(list, r.clock); i < list.length && list[i]!.id.clock < end; i++) {
          const s = list[i];
          if (s instanceof Y.Item && (s.parentSub === SIZE_KEY || s.parentSub === TYPE_KEY)) return true;
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
  let decoded: { structs: Struct[]; ds: DeleteSet };
  try {
    decoded = Y.decodeUpdate(update) as { structs: Struct[]; ds: DeleteSet };
  } catch {
    return null; // unreadable: the update guard and Yjs refuse it on their own
  }
  if (!touchesGrid(doc, decoded.structs, decoded.ds)) return null;
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

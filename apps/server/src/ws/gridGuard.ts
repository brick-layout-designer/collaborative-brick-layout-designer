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
// the result worked out. That is when it:
//   - writes a layer's type as 'grid' (or as something not a plain value);
//     an item's key is the one Yjs gives it: its own, else its origin's,
//     else (no origin) its right origin's;
//   - writes a grid size that isn't one plain valid number, or deletes the
//     value it writes;
//   - deletes the grid size of a layer that is a grid and stays;
//   - lands while the room has changes waiting for others (they may land
//     with it), or holds two structs for one id (hand-made: Yjs reads one).
// Adding a layer of another kind, deleting a layer, and every edit that
// writes neither key (parts, labels, a paste, an offline session) can't
// leave a grid without a valid size, and need nothing more.
//
// A new grid layer and a change of a grid's size are worked out exactly
// from the keys they touch (exactVerdict): which structs Yjs would
// integrate, following its own order, then, for each layer the update
// touches, the value its type and grid size end up with. Only the layer's
// entry in layerData and those two keys are read, so it costs the same on a
// layout of 10 parts or 10,000. The few updates outside what that reading
// covers (some of it would wait for changes the room doesn't have, two
// writes race for one key, a struct Yjs would only partly apply, a hand-made
// shape Yjs reads its own way) are worked out on a copy of the room's
// document, as before.

import * as Y from 'yjs';
import { decodeIncoming, findStruct, guardWork, type DecodedUpdate, type DeleteSet, type Struct } from './decoded.js';
import { updateClientBlocks } from './updateGuard.js';

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
  if (content instanceof Y.ContentAny) return content.arr.includes('grid');
  return true; // some other kind of value (JSON content, which the apps read differently, too): work it out
}

/**
 * Does the update's delete set take any of `item` away? Every range is
 * looked at: Y.isDeleted searches them as if sorted, and a hand-made update
 * may list them in any order (Yjs applies them all).
 */
function deletes(ds: DeleteSet, item: Y.Item): boolean {
  const { client, clock } = item.id;
  const end = clock + item.length;
  return (ds.clients.get(client) ?? []).some((r) => r.clock < end && clock < r.clock + r.len);
}

/** Is this write of a grid size one valid number that stays? */
function writesValidSize(item: Y.Item, ds: DeleteSet): boolean {
  const c = item.content;
  if (!(c instanceof Y.ContentAny)) return false;
  return item.length === 1 && c.arr.length === 1 && validGridSize(c.arr[0]) && !deletes(ds, item);
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
          if (layerItem && (layerItem.deleted || deletes(ds, layerItem))) continue;
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
  const exact = exactVerdict(doc, update, decoded);
  if (exact !== UNSURE) {
    guardWork.gridExact += 1;
    return exact;
  }
  return checkGridSizesOnCopy(doc, update);
}

/** The same worked out on a copy of the room's document (exact for any update; costs the layout's size). */
export function checkGridSizesOnCopy(doc: Y.Doc | null, update: Uint8Array): string | null {
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

// ---- exact, from the touched keys --------------------------------------------

/** exactVerdict's answer for an update outside what it reads: work it out on a copy. */
export const UNSURE = Symbol('unsure');
type Unsure = typeof UNSURE;

class NotSure extends Error {}
const unsure = (): never => {
  throw new NotSure();
};

const idKey = (client: number, clock: number) => `${client}:${clock}`;
const lastKey = (s: { id: Y.ID; length: number }) => idKey(s.id.client, s.id.clock + s.length - 1);
const ROOT_LAYERS = `r:${LAYER_DATA}`;

/** Does `ds` take away the last clock of `s`, the one a map key reads? */
function deletesLast(ds: DeleteSet, s: { id: Y.ID; length: number }): boolean {
  const clock = s.id.clock + s.length - 1;
  return (ds.clients.get(s.id.client) ?? []).some((r) => r.clock <= clock && clock < r.clock + r.len);
}

/** A key of a map: the map (`r:<root name>` or `i:<client>:<clock>` of its item) and the key. */
interface Slot {
  tok: string;
  key: string | null;
}

/**
 * The structs of the update Yjs integrates, in the order it does
 * (utils/encoding.js integrateStructs, Yjs 13.6), worked out on clocks
 * alone. Unsure when anything would wait for changes the room doesn't
 * have, a struct would be applied only in part, or a struct points at a
 * later one of its own client (Yjs can't read that).
 */
function integration(doc: Y.Doc | null, byClient: Map<number, Struct[]>): Struct[] {
  const state = new Map<number, number>();
  const st = (client: number): number => {
    let v = state.get(client);
    if (v === undefined) state.set(client, (v = doc ? Y.getState(doc.store, client) : 0));
    return v;
  };
  for (const list of byClient.values()) {
    for (const s of list) {
      if (s instanceof Y.Skip) unsure();
      if (!(s instanceof Y.Item)) continue;
      const c = s.id.client;
      for (const ref of [s.origin, s.rightOrigin, s.parent instanceof Y.ID ? s.parent : null]) {
        if (ref && ref.client === c && ref.clock >= s.id.clock) unsure();
      }
    }
  }
  const refs = new Map<number, { refs: Struct[]; i: number }>();
  for (const [c, list] of byClient) refs.set(c, { refs: list, i: 0 });
  const ids = [...refs.keys()].sort((a, b) => a - b);
  const nextTarget = () => {
    while (ids.length) {
      const t = refs.get(ids[ids.length - 1]!)!;
      if (t.i < t.refs.length) return t;
      ids.pop();
    }
    return null;
  };
  const missingOf = (s: Struct): number | null => {
    if (!(s instanceof Y.Item)) return null;
    const c = s.id.client;
    if (s.origin && s.origin.client !== c && s.origin.clock >= st(s.origin.client)) return s.origin.client;
    if (s.rightOrigin && s.rightOrigin.client !== c && s.rightOrigin.clock >= st(s.rightOrigin.client)) return s.rightOrigin.client;
    const p = s.parent;
    if (p instanceof Y.ID && p.client !== c && p.clock >= st(p.client)) return p.client;
    return null;
  };
  const placed: Struct[] = [];
  let cur = nextTarget();
  if (!cur) return placed;
  let head = cur.refs[cur.i++]!;
  const stack: Struct[] = [];
  for (;;) {
    const offset = st(head.id.client) - head.id.clock;
    if (offset < 0) unsure(); // waits for an earlier change of its own client
    const missing = missingOf(head);
    if (missing !== null) {
      stack.push(head);
      const t = refs.get(missing);
      if (!t || t.i === t.refs.length) unsure(); // waits for a change the room doesn't have
      head = t!.refs[t!.i++]!;
      continue;
    }
    if (offset === 0) {
      placed.push(head);
      state.set(head.id.client, head.id.clock + head.length);
    } else if (offset < head.length) unsure(); // applied in part
    if (stack.length) head = stack.pop()!;
    else if (cur && cur.i < cur.refs.length) head = cur.refs[cur.i++]!;
    else {
      cur = nextTarget();
      if (!cur) break;
      head = cur.refs[cur.i++]!;
    }
  }
  return placed;
}

/**
 * What the grid check on a copy would answer, worked out from the keys the
 * update touches; UNSURE for an update outside what this reads.
 */
export function exactVerdict(doc: Y.Doc | null, update: Uint8Array, decoded: DecodedUpdate): string | null | Unsure {
  if (doc?.store.pendingStructs || doc?.store.pendingDs || decoded.overlapping) return UNSURE;
  // Yjs reads only the last block of a client that has two.
  const blocks = updateClientBlocks(update);
  if (!blocks || new Set(blocks).size !== blocks.length) return UNSURE;
  try {
    return exactOrThrow(doc, decoded);
  } catch (err) {
    if (err instanceof NotSure) return UNSURE;
    throw err;
  }
}

function exactOrThrow(doc: Y.Doc | null, decoded: DecodedUpdate): string | null {
  const { byClient, ds } = decoded;
  const placed = integration(doc, byClient);
  const known = (id: Y.ID): boolean => !!doc && id.clock < Y.getState(doc.store, id.client);
  const docStruct = (id: Y.ID): Y.Item | Y.GC => {
    try {
      return Y.getItem(doc!.store, id) as Y.Item | Y.GC;
    } catch {
      return unsure();
    }
  };
  const roots = new Map<unknown, string>();
  if (doc) for (const [name, t] of doc.share) roots.set(t, name);
  const typeTok = (t: unknown): string => {
    const type = t as Y.AbstractType<unknown>;
    if (type?._item) return `i:${idKey(type._item.id.client, type._item.id.clock)}`;
    const name = roots.get(type);
    return name === undefined ? unsure() : `r:${name}`;
  };
  const docSlot = (s: Y.Item): Slot => ({ tok: typeTok(s.parent), key: s.parentSub });

  // Where each integrated item lands (null: Yjs keeps it as garbage), in
  // the order Yjs integrates them, so whatever one points at is known.
  const slots = new Map<Y.Item, Slot | null>();
  const placedSet = new Set<Struct>(placed);
  const resolve = (id: Y.ID): { gc: boolean; slot: Slot | null; item: Y.Item | null } => {
    if (known(id)) {
      const s = docStruct(id);
      return s instanceof Y.Item ? { gc: false, slot: docSlot(s), item: s } : { gc: true, slot: null, item: null };
    }
    const s = findStruct(byClient.get(id.client), id.clock);
    if (!s || !placedSet.has(s)) return unsure();
    if (!(s instanceof Y.Item)) return { gc: true, slot: null, item: null };
    const slot = slots.get(s);
    if (slot === undefined) return unsure();
    return { gc: slot === null, slot, item: s };
  };
  const slotOf = (item: Y.Item): Slot | null => {
    const parent = item.parent as unknown;
    if (parent !== null) {
      if (typeof parent === 'string') return { tok: `r:${parent}`, key: item.parentSub };
      if (!(parent instanceof Y.ID)) return unsure();
      const p = resolve(parent);
      if (p.gc) return null;
      if (!(p.item!.content instanceof Y.ContentType)) return unsure();
      return { tok: `i:${idKey(parent.client, parent.clock)}`, key: item.parentSub };
    }
    const left = item.origin ? resolve(item.origin) : null;
    const right = item.rightOrigin ? resolve(item.rightOrigin) : null;
    if (left?.gc || right?.gc) return null;
    return (left ?? right ?? unsure()).slot;
  };
  for (const s of placed) if (s instanceof Y.Item) slots.set(s, slotOf(s));

  // The layer a map is (its key in layerData), or null.
  const layerOf = (tok: string): string | null => {
    if (!tok.startsWith('i:')) return null;
    const [client, clock] = tok.slice(2).split(':').map(Number) as [number, number];
    const r = resolve(Y.createID(client, clock));
    return r.slot?.tok === ROOT_LAYERS ? r.slot.key : null;
  };

  // The new items of each key, and the layers touched.
  const chains = new Map<string, Y.Item[]>();
  const touched = new Set<string>();
  const touch = (slot: Slot) => {
    if (slot.key === null) return;
    if (slot.tok === ROOT_LAYERS) touched.add(slot.key);
    else if (slot.key === TYPE_KEY || slot.key === SIZE_KEY) {
      const layer = layerOf(slot.tok);
      if (layer !== null) touched.add(layer);
    }
  };
  for (const [item, slot] of slots) {
    if (!slot || slot.key === null) continue;
    const k = `${slot.tok}\u0000${slot.key}`;
    const list = chains.get(k);
    if (list) list.push(item);
    else chains.set(k, [item]);
    touch(slot);
  }
  // Values the update deletes in the room's document.
  if (doc) {
    for (const [client, ranges] of ds.clients) {
      const list = doc.store.clients.get(client);
      if (!list) continue;
      const state = Y.getState(doc.store, client);
      for (const r of ranges) {
        const end = Math.min(r.clock + r.len, state);
        if (r.clock >= end) continue;
        for (let i = Y.findIndexSS(list, r.clock); i < list.length && list[i]!.id.clock < end; i++) {
          const s = list[i];
          if (s instanceof Y.Item && !s.deleted && s.parentSub !== null) touch(docSlot(s));
        }
      }
    }
  }

  // What a key of a map reads after the update.
  const docTail = (tok: string, key: string): Y.Item | null => {
    if (!doc) return null;
    if (tok.startsWith('r:')) return (doc.share.get(tok.slice(2))?._map.get(key) as Y.Item | undefined) ?? null;
    const [client, clock] = tok.slice(2).split(':').map(Number) as [number, number];
    const id = Y.createID(client, clock);
    if (!known(id)) return null;
    const s = docStruct(id);
    if (!(s instanceof Y.Item) || !(s.content instanceof Y.ContentType)) return null;
    return (s.content.type._map.get(key) as Y.Item | undefined) ?? null;
  };
  const read = (tok: string, key: string): { item: Y.Item | null; value: unknown } => {
    const tail = docTail(tok, key);
    let last: Y.Item | null = tail;
    const items = chains.get(`${tok}\u0000${key}`) ?? [];
    if (items.length) {
      // One chain of writes, each after the one before, the first after the
      // value there now: Yjs puts each at the end, so the last one is the value.
      const byOrigin = new Map<string, Y.Item>();
      for (const it of items) {
        if (it.rightOrigin) unsure();
        const k = it.origin ? idKey(it.origin.client, it.origin.clock) : '-';
        if (byOrigin.has(k)) unsure(); // two writes racing for the key
        byOrigin.set(k, it);
      }
      let n = 0;
      for (let it = byOrigin.get(tail ? lastKey(tail) : '-'); it; it = byOrigin.get(lastKey(it))) {
        last = it;
        if (++n > items.length) unsure();
      }
      if (n !== items.length) unsure();
    }
    if (!last) return { item: null, value: undefined };
    const gone = (known(last.id) ? last.deleted : last.content instanceof Y.ContentDeleted) || deletesLast(ds, last);
    return { item: last, value: gone ? undefined : last.content.getContent()[last.length - 1] };
  };
  const invalidBefore = (layer: string): boolean => {
    const t = doc ? ((doc.share.get(LAYER_DATA)?._map.get(layer) as Y.Item | undefined) ?? null) : null;
    if (!t || t.deleted) return false;
    const v = t.content.getContent()[t.length - 1];
    return v instanceof Y.Map && v.get(TYPE_KEY) === 'grid' && !validGridSize(v.get(SIZE_KEY));
  };

  for (const layer of touched) {
    guardWork.gridLayersRead += 1;
    const entry = read(ROOT_LAYERS, layer);
    if (!(entry.value instanceof Y.Map) || !entry.item) continue;
    const tok = `i:${idKey(entry.item.id.client, entry.item.id.clock)}`;
    if (read(tok, TYPE_KEY).value !== 'grid') continue;
    if (validGridSize(read(tok, SIZE_KEY).value)) continue;
    if (!invalidBefore(layer)) return `it leaves grid layer ${layer} with a cell size outside 1 to ${MAX_GRID_SIZE} studs`;
  }
  return null;
}

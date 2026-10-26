// Doc shape 2 (meta.schemaVersion 2): edits that merge.
//
// Yjs has no "move", so an edit made by deleting an entry and inserting a
// changed copy loses a concurrent edit or delete of the same entry. Shape 2
// edits in place instead:
//
//  - Ruler items are Y.Maps (as parts and text cells are), so a move or an
//    edit sets fields of the same entry; a concurrent delete wins.
//  - An area sheet keeps a `cellOffset` {x, y} (whole cells): a cell at
//    `areas[i]` is drawn at (x + offset.x, y + offset.y). Moving the sheet
//    sets the offset, so two people moving it at once leave each cell once.
//  - Parts and rulers may carry a number `z`: the front-to-back order is
//    by z, not by place in the array, so Bring to Front / Send to Back set
//    z on the same entry instead of deleting and inserting it.
//
// Docs in shape 1 (plain-object rulers, no offset, no z) still read the
// same. A doc moves to shape 2 lazily: the first time someone edits a
// ruler, moves an area sheet or reorders parts with a new build, that part
// of the doc is converted (in its own, untracked transaction) and
// `meta.schemaVersion` set to 2, so older builds, which would read the new
// entries wrong, refuse the doc instead of corrupting it. A doc nobody
// edits that way stays shape 1 and keeps working with older builds.
//
// One limit: two people making the very first ruler edit of a shape-1 sheet
// at the same instant both convert it, leaving each ruler there twice
// (removeDuplicateItems, and the desktop's next write, keep one); an edit
// one of them made to the copy that goes is lost. After the conversion,
// ruler edits merge.
//
// The desktop (src/sync/DocShape.cpp) does the same; the order and z rules
// have shared vectors in fixtures/contracts/doc-shape.json.

import * as Y from 'yjs';

/** The shape a doc is stamped with when it's made (and older builds read). */
export const DOC_BASE_SCHEMA = 1;
/** The shape that uses in-place rulers, the area offset and z order. */
export const DOC_SHAPE_IN_PLACE = 2;

/** Transactions that only convert a doc's shape: never undone. */
export const SHAPE_ORIGIN = 'cld-shape';

/**
 * Mark the doc as shape 2 (older builds then refuse it). Inside a
 * transaction or on its own.
 */
export function markShapeInPlace(doc: Y.Doc): void {
  const meta = doc.getMap('meta');
  const v = meta.get('schemaVersion');
  if (typeof v === 'number' && v >= DOC_SHAPE_IN_PLACE) return;
  doc.transact(() => meta.set('schemaVersion', DOC_SHAPE_IN_PLACE), SHAPE_ORIGIN);
}

// ---------------------------------------------------------------------------
// Order by z
// ---------------------------------------------------------------------------

/** The z of an entry, or undefined when it has none. */
export function zOf(item: unknown): number | undefined {
  const z = item instanceof Y.Map ? item.get('z') : undefined;
  return typeof z === 'number' && Number.isFinite(z) ? z : undefined;
}

/**
 * The front-to-back order of entries given their z (undefined: none), as
 * indexes into the list. An entry without z sorts with the last entry
 * before it that has one (first of all when none does), after it; ties keep
 * the array order. So an array with no z keeps its order, and an entry
 * someone inserted without z (before they saw the z) stays next to the
 * entry it was put after.
 */
export function orderByZ(zs: readonly (number | undefined)[]): number[] {
  let last = -Infinity;
  const keys = zs.map((z, i) => {
    if (z !== undefined) last = z;
    return { k: z ?? last, i };
  });
  keys.sort((a, b) => (a.k < b.k ? -1 : a.k > b.k ? 1 : a.i - b.i));
  return keys.map((e) => e.i);
}

/** Whether any entry of the array has a z (the array is ordered by z). */
export function hasZOrder(arr: Y.Array<unknown>): boolean {
  for (const v of arr) if (zOf(v) !== undefined) return true;
  return false;
}

/** The array's entries front-to-back order (bottom first). */
export function itemsInOrder<T>(arr: Y.Array<T>): T[] {
  const all = arr.toArray();
  if (!all.some((v) => zOf(v) !== undefined)) return all;
  return orderByZ(all.map(zOf)).map((i) => all[i]!);
}

/** The z for an entry put on top: above every z there, or none when unordered. */
export function zOnTop(arr: Y.Array<unknown>): number | undefined {
  let max: number | undefined;
  for (const v of arr) {
    const z = zOf(v);
    if (z !== undefined && (max === undefined || z > max)) max = z;
  }
  return max === undefined ? undefined : Math.floor(max) + 1;
}

/** Append entries on top: with a z each when the array is ordered by z. */
export function pushOnTop(arr: Y.Array<unknown>, items: Y.Map<unknown>[]): void {
  let z = zOnTop(arr);
  if (z !== undefined) for (const m of items) m.set('z', z++);
  arr.push(items);
}

/**
 * The new z of the entries that must change so the order becomes `want`
 * (ids, bottom first). `cur` is the entries in their order now, with their
 * z. The longest run of entries that have a z and are already in order
 * keeps its z; every other entry gets one between its neighbours in
 * `want`. Entries of `want` not in `cur` are new ones and get a z too.
 * Shared with the desktop (contract vectors in doc-shape.json).
 */
export function assignZ(
  cur: readonly { id: string; z: number | undefined }[],
  want: readonly string[],
): Map<string, number> {
  const pos = new Map(want.map((id, i) => [id, i] as const));
  const zById = new Map(cur.map((e) => [e.id, e.z] as const));
  // Entries with a z, in the current order, by their place in `want`.
  const seqIds = cur.filter((e) => e.z !== undefined && pos.has(e.id)).map((e) => e.id);
  const seq = seqIds.map((id) => pos.get(id)!);
  const keep = new Set<string>();
  {
    const tails: number[] = [];
    const prev = new Array<number>(seq.length).fill(-1);
    seq.forEach((v, i) => {
      let lo = 0;
      let hi = tails.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (seq[tails[mid]!]! < v) lo = mid + 1;
        else hi = mid;
      }
      if (lo > 0) prev[i] = tails[lo - 1]!;
      tails[lo] = i;
    });
    for (let k = tails.length ? tails[tails.length - 1]! : -1; k >= 0; k = prev[k]!) keep.add(seqIds[k]!);
  }
  const out = new Map<string, number>();
  let i = 0;
  let below: number | undefined;
  while (i < want.length) {
    const id = want[i]!;
    if (keep.has(id)) {
      below = zById.get(id);
      i++;
      continue;
    }
    // A run of entries to place, up to the next kept one.
    let j = i;
    while (j < want.length && !keep.has(want[j]!)) j++;
    const above = j < want.length ? zById.get(want[j]!) : undefined;
    const n = j - i;
    for (let k = 0; k < n; k++) {
      let z: number;
      if (below !== undefined && above !== undefined) z = below + ((above - below) * (k + 1)) / (n + 1);
      else if (below !== undefined) z = Math.floor(below) + k + 1;
      else if (above !== undefined) z = Math.ceil(above) - (n - k);
      else z = k;
      if (zById.get(want[i + k]!) !== z) out.set(want[i + k]!, z);
    }
    i = j;
  }
  return out;
}

/**
 * Put an array of id'd Y.Maps into `want` order (ids, bottom first) by
 * setting z, never by moving entries. Call inside a transaction.
 */
export function reorderByZ(arr: Y.Array<unknown>, want: readonly string[]): void {
  const cur = itemsInOrder(arr)
    .filter((v): v is Y.Map<unknown> => v instanceof Y.Map)
    .map((m) => ({ id: m.get('id') as string, z: zOf(m), m }));
  const byId = new Map(cur.map((e) => [e.id, e.m] as const));
  for (const [id, z] of assignZ(cur, want)) byId.get(id)?.set('z', z);
}

// ---------------------------------------------------------------------------
// Rulers as Y.Maps
// ---------------------------------------------------------------------------

/** A ruler entry as a plain object (without its z). */
export function rulerJson(v: unknown): Record<string, unknown> | null {
  if (v instanceof Y.Map) {
    const { z: _z, ...rest } = v.toJSON() as Record<string, unknown>;
    return rest;
  }
  if (v && typeof v === 'object' && !(v instanceof Y.AbstractType)) return structuredClone(v as Record<string, unknown>);
  return null;
}

/** A plain object as an entry Y.Map (top-level fields; values as they are). */
export function toItemMap(o: Record<string, unknown>): Y.Map<unknown> {
  const y = new Y.Map<unknown>();
  for (const [k, v] of Object.entries(o)) if (v !== undefined) y.set(k, v);
  return y;
}

/**
 * Turn a ruler sheet's plain-object entries into Y.Maps (shape 2), in their
 * own untracked transaction, and mark the doc. No change when they already
 * are. Returns the sheet's ruler array.
 */
export function rulersInPlace(doc: Y.Doc, layer: Y.Map<unknown>): Y.Array<unknown> | null {
  const arr = layer.get('rulerItems');
  if (!(arr instanceof Y.Array)) return null;
  markShapeInPlace(doc);
  const items = arr.toArray();
  if (items.every((v) => v instanceof Y.Map)) return arr;
  doc.transact(() => {
    // Only the plain ones are replaced, each where it is.
    for (let i = items.length - 1; i >= 0; i--) {
      const v = items[i];
      if (v instanceof Y.Map) continue;
      const json = rulerJson(v);
      arr.delete(i, 1);
      if (json) arr.insert(i, [toItemMap(json)]);
    }
  }, SHAPE_ORIGIN);
  return arr;
}

/** Set the fields of an entry Y.Map that differ from `next` (and drop missing ones but id/z). */
export function setItemFields(m: Y.Map<unknown>, next: Record<string, unknown>): void {
  for (const [k, v] of Object.entries(next)) {
    if (v === undefined) continue;
    if (JSON.stringify(m.get(k)) !== JSON.stringify(v)) m.set(k, v);
  }
  for (const k of [...m.keys()]) if (k !== 'id' && k !== 'z' && !(k in next)) m.delete(k);
}

// ---------------------------------------------------------------------------
// Area sheet offset
// ---------------------------------------------------------------------------

/** An area sheet's cell offset (whole cells); {0, 0} when it has none. */
export function cellOffsetOf(layer: Y.Map<unknown>): { x: number; y: number } {
  const o = layer.get('cellOffset') as { x?: unknown; y?: unknown } | undefined;
  const x = o && typeof o.x === 'number' && Number.isFinite(o.x) ? o.x : 0;
  const y = o && typeof o.y === 'number' && Number.isFinite(o.y) ? o.y : 0;
  return { x, y };
}

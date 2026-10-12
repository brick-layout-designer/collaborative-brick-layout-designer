// Yjs document shape + helpers for layouts. Used by the server (snapshot
// hydration, persistence) and the client (binding to the editor).
//
// The full Yjs<->BbmMap projection lands in Phase 4. For Phase 2 we only
// need:
//   - empty doc seed (createLayoutDoc / createSidecarDoc)
//   - bytes ↔ doc helpers (encodeDoc / decodeDoc) so the layouts table can
//     persist a binary snapshot from day one
// Phase 4 fills in the read/write of bricks, layers, etc.

import * as Y from 'yjs';
import { BBM_FORMAT_VERSION, type BbmMap } from '@cld/model';
import type { Sidecar } from '@cld/bbm';
import { bbmToDoc, docToBbm } from './projection.js';

import { DOC_SCHEMA_VERSION } from './ids.js';

export { bbmToDoc, docToBbm, createDocProjector, type DocProjector } from './projection.js';
export { DOC_MIN_READABLE, DOC_SCHEMA_VERSION, canReadDoc, makeId, upgradeDoc } from './ids.js';

export function createLayoutDoc(): Y.Doc {
  const doc = new Y.Doc();
  doc.getMap('meta').set('schemaVersion', DOC_SCHEMA_VERSION);
  doc.getArray('layers');
  doc.getMap('layerData');
  doc.getMap('venue');
  doc.getMap('modules');
  doc.getMap('labels');
  return doc;
}

/**
 * Seed a new layout doc with the same defaults as the desktop app:
 *   - CornflowerBlue background
 *   - Grid layer (Layer 1, 96-stud cells, 3 sub-divisions)
 *   - Brick layer (Layer 2, empty)
 *
 * Mirrors MainWindowFileIO.cpp:200-249 "new map" sequence.
 */
export function createDefaultLayoutDoc(): Y.Doc {
  const now = new Date();
  const defaultMap: BbmMap = {
    version: BBM_FORMAT_VERSION,
    nbItems: 0,
    backgroundColor: { kind: 'known', name: 'CornflowerBlue' },
    author: '',
    lug: '',
    event: '',
    date: { day: now.getDate(), month: now.getMonth() + 1, year: now.getFullYear() },
    comment: '',
    exportInfo: {
      exportPath: '',
      exportFileType: 4,
      exportArea: { x: 0, y: 0, width: 0, height: 0 },
      exportScale: 0,
      exportWatermark: true,
      exportElectricCircuit: false,
      exportConnectionPoints: false,
    },
    selectedLayerIndex: 1,
    layers: [
      {
        id: 'grid-1',
        type: 'grid',
        name: 'Grid',
        visible: true,
        transparency: 100,
        hullProperties: { isVisible: false, hullColor: { kind: 'known', name: 'Black' }, hullThickness: 1 },
        gridColor: { kind: 'argb', argb: 'ffffffff' },
        gridThickness: 2,
        subGridColor: { kind: 'argb', argb: 'ffd3d3d3' },
        subGridThickness: 1,
        gridSizeInStud: 96,
        subDivisionNumber: 3,
        displayGrid: true,
        displaySubGrid: true,
        displayCellIndex: true,
        cellIndexFont: { family: 'Arial', size: 18, style: 'Regular' },
        cellIndexColor: { kind: 'argb', argb: 'ff000000' },
        cellIndexColumnType: '0',
        cellIndexRowType: '1',
        cellIndexCorner: { x: 0, y: 0 },
      },
      {
        id: 'brick-1',
        type: 'brick',
        name: 'Layout',
        visible: true,
        transparency: 100,
        hullProperties: { isVisible: false, hullColor: { kind: 'known', name: 'Black' }, hullThickness: 1 },
        displayBrickElevation: false,
        bricks: [],
        groups: [],
      },
    ],
  };
  const doc = new Y.Doc();
  bbmToDoc(defaultMap, doc);
  return doc;
}

export function createSidecarDoc(): Y.Doc {
  const doc = new Y.Doc();
  doc.getMap('meta');
  doc.getMap('connections');
  doc.getArray('rulers');
  doc.getArray('areas');
  return doc;
}

/**
 * Seed a fresh Y.Doc from a parsed `.bbm` map using the full projection.
 * Replaces the Phase-2 `bbmCache` shortcut: every layer/brick/textCell now
 * lives in the Yjs tree and survives editing.
 */
export function seedFromBbm(map: BbmMap): Y.Doc {
  const doc = new Y.Doc();
  bbmToDoc(map, doc);
  return doc;
}

export function seedFromSidecar(sidecar: Sidecar): Y.Doc {
  const doc = createSidecarDoc();
  const meta = doc.getMap('meta');
  meta.set('schemaVersion', sidecar.schemaVersion);
  meta.set('bbmHashSha256', sidecar.bbmHashSha256);
  meta.set('cache', sidecar as unknown as Record<string, unknown>);
  return doc;
}

// ---------------------------------------------------------------------------
// The sidecar (modules, anchored labels, views, venue, ...) lives in
// `meta.cache` as one plain object, so two people changing it at once used
// to lose one of the changes: the last write won. Modules and anchored
// labels are now also kept one per key in the `sidecarItems` map, so
// concurrent edits to different ones merge. `meta.cache` stays complete for
// readers that don't know the map (older apps, the desktop), and
// `sidecarItems.__blob` records which `meta.cache` the items go with: when a
// writer that doesn't know the map replaces `meta.cache`, the hash no longer
// matches and the blob is read as it is.
// ---------------------------------------------------------------------------

const SIDECAR_ITEMS = 'sidecarItems';
const ITEM_KINDS = [
  { field: 'modules', prefix: 'm:' },
  { field: 'anchoredLabels', prefix: 'l:' },
] as const;

/**
 * JSON with every object's keys in sorted order (by UTF-16 code unit), so the
 * text, and the hash, don't depend on the order a writer gave the keys: the
 * desktop's yrs keeps an object's keys in no fixed order.
 */
function stableStringify(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map((x) => (x === undefined ? 'null' : stableStringify(x))).join(',')}]`;
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    const keys = Object.keys(o).filter((k) => o[k] !== undefined).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(o[k])}`).join(',')}}`;
  }
  return JSON.stringify(v) ?? 'null';
}

/**
 * Which sidecar blob the items go with: FNV-1a over the UTF-16 code units of
 * its key-sorted JSON, and the text's length. The desktop computes the same
 * (sync/SidecarItems.cpp; shared vectors in sidecarItems.test.ts).
 */
export function sidecarBlobHash(blob: unknown): string {
  return blobHash(blob);
}

function blobHash(blob: unknown): string {
  const text = stableStringify(blob);
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return `${text.length}:${(h >>> 0).toString(16)}`;
}

/**
 * The sidecar as everyone's edits left it: `meta.cache` with its modules and
 * anchored labels taken from `sidecarItems` when those go with this blob.
 */
export function readSidecarCache(doc: Y.Doc): Record<string, unknown> | null {
  const blob = doc.getMap('meta').get('cache');
  if (!blob || typeof blob !== 'object') return null;
  const cache = blob as Record<string, unknown>;
  const items = doc.getMap(SIDECAR_ITEMS);
  if (items.size === 0 || items.get('__blob') !== blobHash(cache)) return cache;
  return mergedSidecar(cache, items);
}

function mergedSidecar(cache: Record<string, unknown>, items: Y.Map<unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...cache };
  for (const { field, prefix } of ITEM_KINDS) {
    const entries: { order: number; id: string; value: Record<string, unknown> }[] = [];
    items.forEach((v, k) => {
      if (!k.startsWith(prefix) || !v || typeof v !== 'object') return;
      const { _order, ...value } = v as Record<string, unknown>;
      entries.push({ order: typeof _order === 'number' ? _order : 0, id: k, value });
    });
    if (entries.length === 0 && !Array.isArray(cache[field])) continue;
    entries.sort((a, b) => a.order - b.order || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    out[field] = entries.map((e) => e.value);
  }
  return out;
}

/**
 * Write the sidecar: `meta.cache` whole, and each module and anchored label
 * under its own key, changing only the ones that differ. Call inside a
 * transaction.
 */
export function writeSidecarCache(doc: Y.Doc, cache: Record<string, unknown>): void {
  const items = doc.getMap(SIDECAR_ITEMS);
  for (const { field, prefix } of ITEM_KINDS) {
    const list = Array.isArray(cache[field]) ? (cache[field] as Record<string, unknown>[]) : [];
    const want = new Map<string, Record<string, unknown>>();
    list.forEach((v, i) => {
      if (v && typeof v === 'object' && typeof v.id === 'string') want.set(prefix + v.id, { ...v, _order: i });
    });
    for (const k of [...items.keys()]) if (k.startsWith(prefix) && !want.has(k)) items.delete(k);
    for (const [k, v] of want) if (JSON.stringify(items.get(k)) !== JSON.stringify(v)) items.set(k, v);
  }
  doc.getMap('meta').set('cache', cache);
  items.set('__blob', blobHash(cache));
}

/**
 * After someone else's edits: when `meta.cache` lags the merged items (two
 * people changed modules at once), write it again so readers that only
 * know `meta.cache` see everyone's. Every client computes the same blob,
 * so two doing it at once agree. Returns whether it wrote.
 */
export function repairSidecarCache(doc: Y.Doc, origin: unknown): boolean {
  const blob = doc.getMap('meta').get('cache');
  if (!blob || typeof blob !== 'object') return false;
  const items = doc.getMap(SIDECAR_ITEMS);
  if (items.size === 0) return false;
  const merged = mergedSidecar(blob as Record<string, unknown>, items);
  const hash = blobHash(merged);
  if (items.get('__blob') === hash && JSON.stringify(merged) === JSON.stringify(blob)) return false;
  // Only when the items still go with a blob some writer of the map made
  // (a writer that doesn't know the map leaves the blob alone).
  if (!itemsKnownForBlob(items, blob as Record<string, unknown>)) return false;
  doc.transact(() => {
    doc.getMap('meta').set('cache', merged);
    items.set('__blob', hash);
  }, origin);
  return true;
}

// Concurrent writers of the map each set the blob and its hash; Yjs keeps
// one writer's pair, so a matching hash means the items are current.
function itemsKnownForBlob(items: Y.Map<unknown>, blob: Record<string, unknown>): boolean {
  return items.get('__blob') === blobHash(blob);
}

/**
 * Yjs can't move an item: a reorder or a move to another sheet deletes it and
 * inserts a copy. When two people move the same part at once, both copies
 * survive and the part is there twice. This removes the extra copies,
 * keeping the one Yjs made first (lowest client, then clock), so every
 * client keeps the same one whatever order it sees them in. Returns how many
 * it removed. Bricks only, across all part sheets.
 */
export function removeDuplicateBricks(doc: Y.Doc, origin: unknown): number {
  const layerData = doc.getMap('layerData');
  type Hit = { arr: Y.Array<unknown>; index: number; key: [number, number] };
  const byId = new Map<string, Hit[]>();
  for (const id of doc.getArray<string>('layers').toArray()) {
    const layer = layerData.get(id);
    if (!(layer instanceof Y.Map)) continue;
    const bricks = layer.get('bricks');
    if (!(bricks instanceof Y.Array)) continue;
    bricks.toArray().forEach((b, index) => {
      if (!(b instanceof Y.Map)) return;
      const bid = b.get('id');
      if (typeof bid !== 'string') return;
      const item = (b as unknown as { _item: { id: { client: number; clock: number } } | null })._item;
      const key: [number, number] = item ? [item.id.client, item.id.clock] : [0, 0];
      const list = byId.get(bid) ?? [];
      list.push({ arr: bricks as Y.Array<unknown>, index, key });
      byId.set(bid, list);
    });
  }
  const extra: Hit[] = [];
  for (const hits of byId.values()) {
    if (hits.length < 2) continue;
    hits.sort((x, y) => x.key[0] - y.key[0] || x.key[1] - y.key[1]);
    extra.push(...hits.slice(1));
  }
  if (extra.length === 0) return 0;
  // Highest index first within each array, so earlier indexes stay valid.
  extra.sort((x, y) => y.index - x.index);
  doc.transact(() => {
    for (const h of extra) h.arr.delete(h.index, 1);
  }, origin);
  return extra.length;
}

/**
 * Best-effort read of the sidecar blob from a doc's meta. Returns null
 * if absent. Used by the editor's overlays (anchored labels, venue,
 * module annotations) to render fork-only data alongside the main map.
 *
 * The sidecar is a passive cache — until the editor learns to mutate
 * each entry collaboratively, it round-trips verbatim.
 */
export function readSidecarFromDoc(doc: Y.Doc): Sidecar | null {
  return readSidecarCache(doc) as Sidecar | null;
}

/** Encode a doc to its binary y-update form — what we persist in the DB. */
export function encodeDoc(doc: Y.Doc): Uint8Array {
  return Y.encodeStateAsUpdate(doc);
}

/** Reconstruct a doc from a stored snapshot. */
export function decodeDoc(bytes: Uint8Array): Y.Doc {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, bytes);
  return doc;
}

/**
 * Reconstruct a BbmMap from a populated Yjs doc. Returns `null` if the doc
 * is empty (no `meta.version` set) — i.e. the caller never seeded it from
 * a .bbm or `bbmToDoc`. The projection round-trips losslessly with
 * `bbmToDoc`, so this is the export path used by the server's
 * `/api/layouts/:id/export.bbm` route.
 */
export function exportBbmFromDoc(doc: Y.Doc): BbmMap | null {
  if (doc.getMap('meta').get('version') === undefined) return null;
  return docToBbm(doc);
}

export function exportSidecarFromDoc(doc: Y.Doc): Sidecar | null {
  return (readSidecarCache(doc) as Sidecar | null) ?? null;
}

// The Yjs shape of what the apps do to a layout, for the merge-guard tests
// (wsOfflineSessions.test.ts). What the guard looks at is where each new
// entry of the `layers` order is placed, so each helper makes the same
// inserts and deletes, in the same transactions, as the code it names:
//
//   web    apps/web/src/editor/mutations.ts (addLayer, deleteLayer,
//          moveLayer, insertBricks, importBricksAsModule,
//          createSidecarModule), useUndoManager.ts (createUndoManager);
//          a whole-layout replace is @cld/ydoc bbmToDoc on the live doc.
//   desktop  src/sync/SyncDoc.cpp SyncDoc::writeMap: a changed layer order
//          is removed whole and inserted again at 0 in one transaction,
//          layer data no longer wanted is removed, new layers are set as
//          whole Y.Maps (bricks/groups/textCells as Y.Arrays of Y.Maps).

import * as Y from 'yjs';
import type { BbmMap, Layer } from '@cld/model';
import { bbmToDoc, makeId, readSidecarCache, writeSidecarCache } from '@cld/ydoc';

/** The web's LOCAL_ORIGIN: the undo manager tracks these only. */
export const LOCAL = Symbol('cld-local-origin');

/** The web editor's undo manager (captureTimeout 0: every edit its own step, the most steps). */
export function webUndoManager(doc: Y.Doc): Y.UndoManager {
  return new Y.UndoManager([doc.getMap('layerData'), doc.getArray('layers'), doc.getMap('meta')], {
    trackedOrigins: new Set([LOCAL]),
    captureTimeout: 0,
  });
}

function newLayerMap(id: string, type: string, name: string): Y.Map<unknown> {
  const l = new Y.Map<unknown>();
  l.set('id', id);
  l.set('type', type);
  l.set('name', name);
  l.set('visible', true);
  l.set('transparency', 100);
  l.set('hullProperties', { isVisible: false, hullColor: { kind: 'known', name: 'Black' }, hullThickness: 1 });
  if (type === 'brick') {
    l.set('bricks', new Y.Array<Y.Map<unknown>>());
    l.set('displayBrickElevation', false);
  }
  l.set('groups', new Y.Array<Y.Map<unknown>>());
  return l;
}

/** web addLayer: a new layer map and its id pushed at the end of the order. */
export function addLayer(doc: Y.Doc, name: string, type = 'brick'): string {
  const id = makeId();
  doc.transact(() => {
    doc.getMap('layerData').set(id, newLayerMap(id, type, name));
    doc.getArray<string>('layers').push([id]);
  }, LOCAL);
  return id;
}

/** web deleteLayer. */
export function deleteLayer(doc: Y.Doc, id: string): void {
  doc.transact(() => {
    const order = doc.getArray<string>('layers');
    const i = order.toArray().indexOf(id);
    if (i >= 0) order.delete(i, 1);
    doc.getMap('layerData').delete(id);
  }, LOCAL);
}

/** web moveLayer: the pair deleted and inserted again swapped. */
export function moveLayer(doc: Y.Doc, id: string, direction: 'up' | 'down'): void {
  doc.transact(() => {
    const order = doc.getArray<string>('layers');
    const ids = order.toArray();
    const i = ids.indexOf(id);
    const j = direction === 'up' ? i + 1 : i - 1;
    if (i < 0 || j < 0 || j >= ids.length) return;
    const lo = Math.min(i, j);
    order.delete(lo, 2);
    order.insert(lo, [ids[lo + 1]!, ids[lo]!]);
  }, LOCAL);
}

export interface BrickSpec {
  partNumber: string;
  displayArea: { x: number; y: number; width: number; height: number };
  orientation?: number;
  altitude?: number;
}

/** web insertBricks (paste, duplicate, place): one Y.Map per part pushed onto the layer's bricks. */
export function insertBricks(doc: Y.Doc, layerId: string, bricks: BrickSpec[], dx = 0, dy = 0): string[] {
  const ids: string[] = [];
  doc.transact(() => {
    const layer = doc.getMap('layerData').get(layerId);
    if (!(layer instanceof Y.Map)) return;
    const yBricks = layer.get('bricks');
    if (!(yBricks instanceof Y.Array)) return;
    for (const b of bricks) {
      const id = makeId();
      ids.push(id);
      const y = new Y.Map<unknown>();
      y.set('id', id);
      y.set('displayArea', { ...b.displayArea, x: b.displayArea.x + dx, y: b.displayArea.y + dy });
      y.set('myGroup', '');
      y.set('partNumber', b.partNumber);
      y.set('orientation', b.orientation ?? 0);
      y.set('activeConnectionPointIndex', 0);
      y.set('altitude', b.altitude ?? 0);
      y.set('connexions', []);
      yBricks.push([y]);
    }
  }, LOCAL);
  return ids;
}

function modules(doc: Y.Doc): Record<string, unknown>[] {
  const m = readSidecarCache(doc)?.modules;
  return Array.isArray(m) ? (m as Record<string, unknown>[]) : [];
}

function addModule(doc: Y.Doc, module: Record<string, unknown>): void {
  writeSidecarCache(doc, { ...(readSidecarCache(doc) ?? {}), modules: [...modules(doc), module] });
}

/** web createSidecarModule (Make module): sidecar entries only, no layers. */
export function makeModule(doc: Y.Doc, name: string, members: string[]): string {
  const id = makeId();
  doc.transact(() => addModule(doc, { id, name, members, transform: [1, 0, 0, 0, 1, 0, 0, 0, 1] }), LOCAL);
  return id;
}

/** The brick layers of a .bbm, as moduleBatchesFromMap reads them. */
export function brickBatches(map: BbmMap): { layerName: string; bricks: BrickSpec[] }[] {
  return map.layers
    .filter((l): l is Extract<Layer, { type: 'brick' }> => l.type === 'brick')
    .map((l) => ({
      layerName: l.name,
      bricks: l.bricks.map((b) => ({
        partNumber: b.partNumber,
        displayArea: { ...b.displayArea },
        orientation: b.orientation,
        altitude: b.altitude,
      })),
    }));
}

/**
 * web importBricksAsModule (Import .bbm as module, Insert module): each
 * batch onto the brick layer of the same name, or a new one pushed at the
 * end; then the module entry. One transaction.
 */
export function importAsModule(doc: Y.Doc, map: BbmMap, name: string, dx = 0, dy = 0): string[] {
  const ids: string[] = [];
  doc.transact(() => {
    const data = doc.getMap('layerData');
    const sheetNamed = (n: string): string | undefined =>
      doc
        .getArray<string>('layers')
        .toArray()
        .find((id) => {
          const l = data.get(id);
          return l instanceof Y.Map && l.get('type') === 'brick' && String(l.get('name') ?? '').trim().toLowerCase() === n.trim().toLowerCase();
        });
    for (const batch of brickBatches(map)) {
      if (batch.bricks.length === 0) continue;
      const layerId = sheetNamed(batch.layerName) ?? addLayer(doc, batch.layerName || 'Module');
      ids.push(...insertBricks(doc, layerId, batch.bricks, dx, dy));
    }
    addModule(doc, { id: makeId(), name, members: ids, transform: [1, 0, 0, 0, 1, 0, 0, 0, 1], importedAt: new Date().toISOString() });
  }, LOCAL);
  return ids;
}

/** A whole layout replaced by a .bbm on the live doc (bbmToDoc: clear, then push every layer). */
export function replaceWithBbm(doc: Y.Doc, map: BbmMap): void {
  doc.transact(() => bbmToDoc(map, doc), LOCAL);
}

/** The layer order, data and brick ids of a doc, as JSON (what a desktop snapshot holds). */
export function layoutJson(doc: Y.Doc): { layers: string[]; layerData: Record<string, Record<string, unknown>> } {
  return {
    layers: doc.getArray<string>('layers').toArray(),
    layerData: doc.getMap('layerData').toJSON() as Record<string, Record<string, unknown>>,
  };
}

/**
 * Desktop SyncDoc::writeMap of a snapshot whose layer order differs from
 * the doc's ("Keep mine" after an offline session): the whole order
 * removed and inserted again at 0, layers not wanted removed, the others
 * set as whole new maps when new (or of another type). One transaction.
 */
export function desktopWriteLayers(doc: Y.Doc, want: ReturnType<typeof layoutJson>): void {
  doc.transact(() => {
    const order = doc.getArray<string>('layers');
    const data = doc.getMap('layerData');
    order.delete(0, order.length);
    order.insert(0, want.layers);
    for (const k of [...data.keys()]) if (!(k in want.layerData)) data.delete(k);
    for (const [id, layer] of Object.entries(want.layerData)) {
      const cur = data.get(id);
      if (cur instanceof Y.Map && cur.get('type') === layer.type) continue;
      const y = new Y.Map<unknown>();
      for (const [k, v] of Object.entries(layer)) {
        if ((k === 'bricks' || k === 'groups' || k === 'textCells') && Array.isArray(v)) {
          const arr = new Y.Array<Y.Map<unknown>>();
          arr.push(
            (v as Record<string, unknown>[]).map((item) => {
              const m = new Y.Map<unknown>();
              for (const [ik, iv] of Object.entries(item)) m.set(ik, iv);
              return m;
            }),
          );
          y.set(k, arr);
        } else if ((k === 'areas' || k === 'rulerItems') && Array.isArray(v)) {
          const arr = new Y.Array<unknown>();
          arr.push(v);
          y.set(k, arr);
        } else {
          y.set(k, v);
        }
      }
      data.set(id, y);
    }
  }, 'bld-local');
}

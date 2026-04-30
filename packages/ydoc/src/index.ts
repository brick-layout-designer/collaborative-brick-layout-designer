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

export { bbmToDoc, docToBbm } from './projection.js';

export function createLayoutDoc(): Y.Doc {
  const doc = new Y.Doc();
  doc.getMap('meta');
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
        cellIndexCorner: '',
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

/**
 * Best-effort read of the sidecar blob from a doc's meta. Returns null
 * if absent. Used by the editor's overlays (anchored labels, venue,
 * module annotations) to render fork-only data alongside the main map.
 *
 * The sidecar is a passive cache — until the editor learns to mutate
 * each entry collaboratively, it round-trips verbatim.
 */
export function readSidecarFromDoc(doc: Y.Doc): Sidecar | null {
  const meta = doc.getMap('meta');
  const cache = meta.get('cache');
  if (!cache || typeof cache !== 'object') return null;
  return cache as Sidecar;
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
  const cached = doc.getMap('meta').get('cache');
  return (cached as Sidecar | undefined) ?? null;
}

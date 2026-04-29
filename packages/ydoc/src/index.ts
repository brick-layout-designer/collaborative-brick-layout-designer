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
import type { BbmMap } from '@cld/model';
import type { Sidecar } from '@cld/bbm';

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

export function createSidecarDoc(): Y.Doc {
  const doc = new Y.Doc();
  doc.getMap('meta');
  doc.getMap('connections');
  doc.getArray('rulers');
  doc.getArray('areas');
  return doc;
}

/**
 * Seed a fresh Y.Doc from a parsed `.bbm` map. Phase 2 stub: only stuffs the
 * map header into `meta` so we can prove the import pipeline runs end-to-end.
 * Phase 3/4 expands this to project the full layer/brick tree.
 */
export function seedFromBbm(map: BbmMap): Y.Doc {
  const doc = createLayoutDoc();
  const meta = doc.getMap('meta');
  meta.set('version', map.version);
  meta.set('author', map.author);
  meta.set('lug', map.lug);
  meta.set('event', map.event);
  meta.set('comment', map.comment);
  meta.set('selectedLayerIndex', map.selectedLayerIndex);
  // Stash the original parsed map until the projection ports — that way an
  // export round-trip during Phase 2 (read .bbm → store → re-emit .bbm) is
  // lossless. Phase 3 replaces this with a real per-layer Yjs structure.
  meta.set('bbmCache', map as unknown as Record<string, unknown>);
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
 * Phase-2 export shim: pull the cached BbmMap back out of the doc's `meta`
 * map. Returns `null` if nothing was seeded (e.g. a doc created in-app
 * without an import). Phase 3 replaces this by reconstructing the map from
 * the per-layer Yjs structure.
 */
export function exportBbmFromDoc(doc: Y.Doc): BbmMap | null {
  const cached = doc.getMap('meta').get('bbmCache');
  return (cached as BbmMap | undefined) ?? null;
}

export function exportSidecarFromDoc(doc: Y.Doc): Sidecar | null {
  const cached = doc.getMap('meta').get('cache');
  return (cached as Sidecar | undefined) ?? null;
}

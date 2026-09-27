// Debounced connectivity recompute. Listens to doc updates, waits for the
// drag/edit to settle, then runs the O(N) bucketing algorithm.
//
// Triggers: our own edits (LOCAL_ORIGIN) and our own undo/redo (origin is
// the Y.UndoManager). Remote updates are ignored — the collaborator who
// made the edit recomputes on their side and the result syncs over.
//
// Connectivity is a *derived* projection of the bricks (PLAN.md §3.2). The
// recompute mutates `Brick.connexions[i].linkedTo` on a throwaway
// projection and writes only the changed values back into Yjs under
// CONNECTIVITY_ORIGIN. That origin is deliberately NOT tracked by the
// UndoManager: the write-back lands ~250ms after the edit (after the
// undo capture window closes), so tracking it produced a separate undo
// step and the first Ctrl+Z after a move appeared to do nothing. Links
// are instead re-derived after undo/redo, which is why undo/redo origins
// also schedule a recompute.

import { useEffect, useMemo } from 'react';
import * as Y from 'yjs';
import { rebuildConnectivity, type Catalog, type PartMetadata } from '@cld/parts-catalog/browser';
import { docToBbm } from '@cld/ydoc';
import { LOCAL_ORIGIN } from './useLayoutDoc';
import type { PartWire } from '../api';

const DEBOUNCE_MS = 250;

/**
 * Origin of the connectivity write-back transaction. Not in the
 * UndoManager's trackedOrigins, so links never form their own undo step.
 */
export const CONNECTIVITY_ORIGIN = Symbol('cld-connectivity-origin');

export function useConnectivity(doc: Y.Doc | null, parts: PartWire[] | undefined): void {
  // Build a Catalog from the wire shape. The recompute only reads
  // `connections` and `partNumber`/`key` — we leave the other fields
  // empty since the algorithm doesn't touch them.
  const catalog: Catalog = useMemo(() => {
    const m: Catalog = new Map();
    for (const p of parts ?? []) {
      const meta: PartMetadata = {
        key: p.key,
        partNumber: p.partNumber,
        colorCode: p.colorCode,
        kind: p.kind,
        descriptions: {},
        author: '',
        sortingKey: p.sortingKey,
        spritePath: p.spritePath,
        pxPerStud: p.pxPerStud,
        connections: p.connections.map((c) => ({
          type: c.type,
          x: c.x,
          y: c.y,
          angle: c.angle,
          electricPlug: c.electricPlug,
        })),
        subparts: [],
        canUngroup: true,
        hullPts: p.hullPts ?? [],
      };
      m.set(p.key, meta);
    }
    return m;
  }, [parts]);

  useEffect(() => {
    if (!doc) return;
    let timer: ReturnType<typeof setTimeout> | null = null;

    function schedule() {
      if (timer) clearTimeout(timer);
      timer = setTimeout(runRecompute, DEBOUNCE_MS);
    }

    function runRecompute() {
      if (!doc) return;
      recomputeConnectivity(doc, catalog);
    }

    function onUpdate(_u: Uint8Array, origin: unknown) {
      if (origin !== LOCAL_ORIGIN && !(origin instanceof Y.UndoManager)) return;
      schedule();
    }

    doc.on('update', onUpdate);
    // Run once on mount (or when catalog becomes available) so that bricks
    // already in the doc get their connexions populated without needing to
    // trigger a mutation first.
    schedule();
    return () => {
      doc.off('update', onUpdate);
      if (timer) clearTimeout(timer);
    };
  }, [doc, catalog]);
}

/**
 * Recompute connectivity for the whole doc and write changed links back
 * under CONNECTIVITY_ORIGIN. Exported for tests.
 */
export function recomputeConnectivity(doc: Y.Doc, catalog: Catalog): void {
  if (catalog.size === 0) return;
  try {
    const map = docToBbm(doc);
    rebuildConnectivity(map, catalog);
    // The mutate-in-place result needs to be projected back. The
    // simplest faithful path is to re-seed the doc; the smaller path
    // is to write only the changed `linkedTo` values directly. We
    // take the small path because re-seeding loses Yjs identity (and
    // therefore breaks UndoManager's stack).
    doc.transact(() => writeBackConnexions(doc, map), CONNECTIVITY_ORIGIN);
  } catch {
    // Transient parse failures (e.g. mid-import) are fine — we'll
    // try again on the next mutation.
  }
}

/**
 * Mirror updated `connexions[].linkedTo` back into the Yjs structure.
 * Only writes when the value actually changed. Bricks are resolved via a
 * per-layer id index built once (a linear scan per brick was O(n^2):
 * ~8 s at 5k bricks).
 */
function writeBackConnexions(doc: Y.Doc, map: import('@cld/model').BbmMap): void {
  const layerData = doc.getMap('layerData');
  for (const layer of map.layers) {
    if (layer.type !== 'brick') continue;
    const yLayer = layerData.get(layer.id);
    if (!(yLayer instanceof Y.Map)) continue;
    const yBricks = yLayer.get('bricks');
    if (!(yBricks instanceof Y.Array)) continue;
    const byId = new Map<unknown, Y.Map<unknown>>();
    yBricks.forEach((b) => {
      // First occurrence wins, matching the old linear scan.
      if (b instanceof Y.Map && !byId.has(b.get('id'))) byId.set(b.get('id'), b);
    });
    for (const brick of layer.bricks) {
      const yBrick = byId.get(brick.id);
      if (!yBrick) continue;
      const current = (yBrick.get('connexions') ?? []) as { id: string; linkedTo: string }[];
      const next = brick.connexions;
      // Cheap deep-equal: same length AND same linkedTo strings.
      if (
        current.length === next.length &&
        current.every((c, i) => c.linkedTo === next[i]?.linkedTo)
      ) {
        continue;
      }
      yBrick.set('connexions', next.map((c) => ({ id: c.id, linkedTo: c.linkedTo })));
    }
  }
}

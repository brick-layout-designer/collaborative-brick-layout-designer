// Debounced connectivity recompute. Listens to doc updates, waits for the
// drag/edit to settle, then runs the O(N) bucketing algorithm.
//
// The recompute is bound to the doc's brick layers; non-brick mutations
// (e.g. metadata edits) skip the work. Only LOCAL_ORIGIN updates trigger
// us — Phase 4 will recompute on remote updates too, but for now we only
// care about our own edits.
//
// Connectivity is a *derived* projection of the bricks, not stored in
// Yjs (PLAN.md §3.2). The recompute mutates `Brick.connexions[i].linkedTo`
// in-place. Since those fields ARE stored in Yjs, the writes go through
// `doc.transact(..., LOCAL_ORIGIN)` so they're undoable as part of the
// triggering edit's history.

import { useEffect, useMemo } from 'react';
import * as Y from 'yjs';
import { rebuildConnectivity, type Catalog } from '@cld/parts-catalog/browser';
import { docToBbm } from '@cld/ydoc';
import { LOCAL_ORIGIN } from './useLayoutDoc';
import type { PartWire } from '../api';

const DEBOUNCE_MS = 250;

export function useConnectivity(doc: Y.Doc | null, parts: PartWire[] | undefined): void {
  // Build a catalog the recompute can read. The desktop's per-part
  // connection-point coordinates aren't carried in PartWire (we strip
  // them on the wire to keep the payload small) — Phase 3 needs the
  // server to ship them through. For now we feed an EMPTY catalog so
  // recompute is a no-op until that lands. The hook still wires the
  // debounce so plugging in the data later is one line.
  const catalog: Catalog = useMemo(() => new Map(), [parts]);

  useEffect(() => {
    if (!doc) return;
    let timer: ReturnType<typeof setTimeout> | null = null;

    function schedule() {
      if (timer) clearTimeout(timer);
      timer = setTimeout(runRecompute, DEBOUNCE_MS);
    }

    function runRecompute() {
      if (!doc || catalog.size === 0) return;
      try {
        const map = docToBbm(doc);
        rebuildConnectivity(map, catalog);
        // The mutate-in-place result needs to be projected back. The
        // simplest faithful path is to re-seed the doc; the smaller path
        // is to write only the changed `linkedTo` values directly. We
        // take the small path because re-seeding loses Yjs identity (and
        // therefore breaks UndoManager's stack).
        doc.transact(() => writeBackConnexions(doc, map), LOCAL_ORIGIN);
      } catch {
        // Transient parse failures (e.g. mid-import) are fine — we'll
        // try again on the next mutation.
      }
    }

    function onUpdate(_u: Uint8Array, origin: unknown) {
      if (origin !== LOCAL_ORIGIN) return;
      schedule();
    }

    doc.on('update', onUpdate);
    return () => {
      doc.off('update', onUpdate);
      if (timer) clearTimeout(timer);
    };
  }, [doc, catalog]);
}

/**
 * Mirror updated `connexions[].linkedTo` back into the Yjs structure.
 * Only writes when the value actually changed to keep undo history clean.
 */
function writeBackConnexions(doc: Y.Doc, map: import('@cld/model').BbmMap): void {
  const layerData = doc.getMap('layerData');
  for (const layer of map.layers) {
    if (layer.type !== 'brick') continue;
    const yLayer = layerData.get(layer.id);
    if (!(yLayer instanceof Y.Map)) continue;
    const yBricks = yLayer.get('bricks');
    if (!(yBricks instanceof Y.Array)) continue;
    for (const brick of layer.bricks) {
      const yBrick = findBrickById(yBricks, brick.id);
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

function findBrickById(bricks: Y.Array<unknown>, brickId: string): Y.Map<unknown> | null {
  for (let i = 0; i < bricks.length; i++) {
    const b = bricks.get(i);
    if (b instanceof Y.Map && b.get('id') === brickId) return b;
  }
  return null;
}

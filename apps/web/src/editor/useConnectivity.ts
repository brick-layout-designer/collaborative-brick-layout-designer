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
//
// Before connectivity, the first pass (and every remote update, including
// the initial sync) repairs stale brick boxes: earlier builds kept a
// brick's displayArea size when turning or placing it, which BlueBrick
// shows shifted. Like desktop fixStaleAreas on every load, such boxes are
// resized to the part's footprint, keeping the sprite where it was drawn.

import { useEffect, useMemo } from 'react';
import * as Y from 'yjs';
import { rebuildConnectivity, type Catalog, type PartMetadata } from '@cld/parts-catalog/browser';
import { docToBbm } from '@cld/ydoc';
import { LOCAL_ORIGIN } from './useLayoutDoc';
import type { PartWire } from '../api';
import type { RectangleF } from '@cld/model';
import { staleAreaFix } from './brickGeometry';
import { indexParts } from './partIndex';

const DEBOUNCE_MS = 250;

/**
 * Origin of the connectivity write-back transaction. Not in the
 * UndoManager's trackedOrigins, so links never form their own undo step.
 */
export const CONNECTIVITY_ORIGIN = Symbol('cld-connectivity-origin');

export function useConnectivity(doc: Y.Doc | null, parts: PartWire[] | undefined): void {
  const partIndex = useMemo(() => indexParts(parts), [parts]);
  const catalog: Catalog = useMemo(() => catalogFromParts(parts), [parts]);

  useEffect(() => {
    if (!doc) return;
    let timer: ReturnType<typeof setTimeout> | null = null;

    function schedule() {
      if (timer) clearTimeout(timer);
      timer = setTimeout(runRecompute, DEBOUNCE_MS);
    }

    function runRecompute() {
      if (!doc) return;
      if (partIndex.size > 0) fixStaleAreasInDoc(doc, partIndex);
      recomputeConnectivity(doc, catalog);
    }

    let staleTimer: ReturnType<typeof setTimeout> | null = null;
    function scheduleStaleFix() {
      if (staleTimer) clearTimeout(staleTimer);
      staleTimer = setTimeout(() => {
        if (doc && partIndex.size > 0) fixStaleAreasInDoc(doc, partIndex);
      }, DEBOUNCE_MS);
    }

    function onUpdate(_u: Uint8Array, origin: unknown) {
      if (origin === CONNECTIVITY_ORIGIN) return;
      if (origin !== LOCAL_ORIGIN && !(origin instanceof Y.UndoManager)) {
        scheduleStaleFix();
        return;
      }
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
      if (staleTimer) clearTimeout(staleTimer);
    };
  }, [doc, catalog, partIndex]);
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
 * Mirror updated `connexions[].linkedTo` and `activeConnectionPointIndex`
 * back into the Yjs structure.
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
      // The active connection moves when a link is made or broken
      // (BlueBrick's hand-over, rebuildConnectivity).
      if ((yBrick.get('activeConnectionPointIndex') ?? 0) !== brick.activeConnectionPointIndex) {
        yBrick.set('activeConnectionPointIndex', brick.activeConnectionPointIndex);
      }
      const current = (yBrick.get('connexions') ?? []) as { id: string; linkedTo: string }[];
      const next = brick.connexions;
      // Cheap deep-equal: same length, ids AND linkedTo strings.
      if (
        current.length === next.length &&
        current.every((c, i) => c.id === next[i]?.id && c.linkedTo === next[i]?.linkedTo)
      ) {
        continue;
      }
      yBrick.set('connexions', next.map((c) => ({ id: c.id, linkedTo: c.linkedTo })));
    }
  }
}

/**
 * Resize every brick whose displayArea doesn't match its part's footprint
 * (desktop fixStaleAreas), writing under CONNECTIVITY_ORIGIN so it is not
 * an undo step. Returns how many bricks changed. Exported for tests.
 */
export function fixStaleAreasInDoc(doc: Y.Doc, partIndex: ReadonlyMap<string, PartWire>): number {
  const fixes: Array<[Y.Map<unknown>, RectangleF]> = [];
  doc.getMap('layerData').forEach((layer) => {
    if (!(layer instanceof Y.Map)) return;
    const bricks = layer.get('bricks');
    if (!(bricks instanceof Y.Array)) return;
    bricks.forEach((b) => {
      if (!(b instanceof Y.Map)) return;
      const partNumber = b.get('partNumber');
      const displayArea = b.get('displayArea') as RectangleF | undefined;
      if (typeof partNumber !== 'string' || !displayArea) return;
      const orientation = (b.get('orientation') as number) ?? 0;
      const fixed = staleAreaFix({ displayArea, orientation }, partIndex.get(partNumber.toLowerCase()));
      if (fixed) fixes.push([b, fixed]);
    });
  });
  if (fixes.length > 0) {
    doc.transact(() => {
      for (const [b, area] of fixes) b.set('displayArea', area);
    }, CONNECTIVITY_ORIGIN);
  }
  return fixes.length;
}

/**
 * The catalog shape `rebuildConnectivity` reads, from the wire parts:
 * connections, pivot geometry (sprite size, hull) and old names. Other
 * fields are left empty since the algorithm doesn't touch them.
 */
export function catalogFromParts(parts: readonly PartWire[] | undefined): Catalog {
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
        // Where the active connection moves after a link (onLinked).
        ...(c.nextConnexionPreference !== undefined ? { nextConnexionPreference: c.nextConnexionPreference } : {}),
      })),
      subparts: [],
      canUngroup: true,
      hullPts: p.hullPts ?? [],
      ...(p.spriteSize ? { spriteSize: p.spriteSize } : {}),
      ...(p.oldNames?.length ? { oldNames: p.oldNames } : {}),
    };
    m.set(p.key, meta);
  }
  return m;
}

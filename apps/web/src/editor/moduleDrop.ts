// Pure placement math for dropping / importing a module — port of the
// module branch of desktop `MapView::dropEvent` (MapView.cpp:1900-2060)
// and `batchesFromModuleMap` (MainWindow.cpp:1291-1308).

import type { BbmMap } from '@cld/model';
import type { PartWire } from '../api';
import type { ModuleBatch } from './mutations';
import { connKey, freeConnectionsCached, lookupPart } from './snap';
import { holdReach, pickSnap, type SnapCandidate, type SnapSession } from './snapFeel';

/**
 * One batch per non-empty brick layer of a module file, named after the
 * source layer ("Module" when unnamed), in file order.
 */
export function moduleBatchesFromMap(map: BbmMap): ModuleBatch[] {
  const out: ModuleBatch[] = [];
  for (const l of map.layers) {
    if (l.type !== 'brick' || l.bricks.length === 0) continue;
    out.push({
      layerName: l.name || 'Module',
      bricks: l.bricks.map((b) => ({
        partNumber: b.partNumber,
        displayArea: { ...b.displayArea },
        orientation: b.orientation,
        altitude: b.altitude,
      })),
    });
  }
  return out;
}

/** Connection snap for a module drop: reach, the drag's session, Alt, the drop. */
export interface ModuleSnapOptions {
  /** Reach in studs (`snapReachStuds`); 0 = no connection snap. */
  reach: number;
  session?: SnapSession;
  bypass?: boolean;
  final?: boolean;
}

/**
 * Translation that drops a module onto `target` (studs) like desktop:
 *   1. the module's centroid (mean brick centre) goes under the cursor;
 *   2. with a grid step, the module's bounding-box TOP-LEFT is rounded to
 *      the grid (so its edges sit on studs, matching the ghost);
 *   3. connection-snap pass: if any free connection of the placed module
 *      lands within reach of a free compatible connection in the host,
 *      shift the whole module by the smallest such gap. No rotation —
 *      modules drop at a fixed orientation.
 */
export function moduleDropTranslation(
  batches: ModuleBatch[],
  target: { x: number; y: number },
  snapStepStuds: number,
  host: BbmMap | null,
  partsByKey: Map<string, PartWire> | null,
  snap: ModuleSnapOptions = { reach: 0 },
): { dx: number; dy: number; ringStudX?: number; ringStudY?: number } {
  let cx = 0;
  let cy = 0;
  let n = 0;
  let minX = Infinity;
  let minY = Infinity;
  for (const batch of batches) {
    for (const b of batch.bricks) {
      const a = b.displayArea;
      cx += a.x + a.width / 2;
      cy += a.y + a.height / 2;
      minX = Math.min(minX, a.x);
      minY = Math.min(minY, a.y);
      n++;
    }
  }
  if (n === 0) return { dx: 0, dy: 0 };
  cx /= n;
  cy /= n;
  let tx = target.x;
  let ty = target.y;
  if (snapStepStuds > 0) {
    const offX = minX - cx;
    const offY = minY - cy;
    tx = Math.round((tx + offX) / snapStepStuds) * snapStepStuds - offX;
    ty = Math.round((ty + offY) / snapStepStuds) * snapStepStuds - offY;
  }
  const dx = tx - cx;
  const dy = ty - cy;

  const reach = snap.bypass ? 0 : snap.reach;
  if (host && partsByKey && reach > 0) {
    const targets = freeConnectionsCached(host, partsByKey);
    const limit = holdReach(reach);
    const limitSq = limit * limit;
    interface Pair extends SnapCandidate {
      ex: number;
      ey: number;
      tx: number;
      ty: number;
    }
    const pairs: Pair[] = [];
    if (targets.length > 0) {
      let brickIndex = 0;
      for (const batch of batches) {
        for (const b of batch.bricks) {
          const bi = brickIndex++;
          const meta = lookupPart(partsByKey, b.partNumber);
          if (!meta || meta.connections.length === 0) continue;
          const a = b.displayArea;
          const bx = a.x + a.width / 2 + dx;
          const by = a.y + a.height / 2 + dy;
          const t = ((b.orientation ?? 0) * Math.PI) / 180;
          const cos = Math.cos(t);
          const sin = Math.sin(t);
          for (let ci = 0; ci < meta.connections.length; ci++) {
            const c = meta.connections[ci]!;
            if (!c.type) continue;
            const wx = bx + c.x * cos - c.y * sin;
            const wy = by + c.x * sin + c.y * cos;
            for (const tc of targets) {
              if (tc.type !== c.type) continue;
              const ex = tc.x - wx;
              const ey = tc.y - wy;
              const sq = ex * ex + ey * ey;
              if (sq > limitSq) continue;
              pairs.push({
                movingKey: `module#${bi}#${ci}`,
                targetKey: connKey(tc.brickId, tc.index),
                dist: Math.sqrt(sq),
                mouseDist: Math.hypot(wx - target.x, wy - target.y),
                ex,
                ey,
                tx: tc.x,
                ty: tc.y,
              });
            }
          }
        }
      }
    }
    const best = snap.session
      ? snap.session.step(pairs, reach, { ...(snap.final ? { final: true } : {}) })
      : pickSnap(pairs, null, reach);
    if (best) return { dx: dx + best.ex, dy: dy + best.ey, ringStudX: best.tx, ringStudY: best.ty };
  } else if (snap.session) {
    snap.session.lock = null;
  }
  return { dx, dy };
}

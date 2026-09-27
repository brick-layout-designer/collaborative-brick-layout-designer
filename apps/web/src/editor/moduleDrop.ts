// Pure placement math for dropping / importing a module — port of the
// module branch of desktop `MapView::dropEvent` (MapView.cpp:1900-2060)
// and `batchesFromModuleMap` (MainWindow.cpp:1291-1308).

import type { BbmMap } from '@cld/model';
import type { PartWire } from '../api';
import type { ModuleBatch } from './mutations';
import { connectionSnapReach, freeConnectionsCached, lookupPart } from './snap';

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
): { dx: number; dy: number } {
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
  let dx = tx - cx;
  let dy = ty - cy;

  if (host && partsByKey) {
    const targets = freeConnectionsCached(host, partsByKey);
    if (targets.length > 0) {
      const reach = connectionSnapReach(snapStepStuds);
      let bestSq = reach * reach;
      let best: { x: number; y: number } | null = null;
      for (const batch of batches) {
        for (const b of batch.bricks) {
          const meta = lookupPart(partsByKey, b.partNumber);
          if (!meta || meta.connections.length === 0) continue;
          const a = b.displayArea;
          const bx = a.x + a.width / 2 + dx;
          const by = a.y + a.height / 2 + dy;
          const t = ((b.orientation ?? 0) * Math.PI) / 180;
          const cos = Math.cos(t);
          const sin = Math.sin(t);
          for (const c of meta.connections) {
            if (!c.type) continue;
            const wx = bx + c.x * cos - c.y * sin;
            const wy = by + c.x * sin + c.y * cos;
            for (const tc of targets) {
              if (tc.type !== c.type) continue;
              const ex = tc.x - wx;
              const ey = tc.y - wy;
              const sq = ex * ex + ey * ey;
              if (sq < bestSq) {
                bestSq = sq;
                best = { x: ex, y: ey };
              }
            }
          }
        }
      }
      if (best) {
        dx += best.x;
        dy += best.y;
      }
    }
  }
  return { dx, dy };
}

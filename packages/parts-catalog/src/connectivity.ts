// Port of desktop CLD's `src/edit/Connectivity.cpp`.
//
// O(N) connectivity recompute via spatial bucketing:
//   - bucket size = 2 studs
//   - candidate set = own bucket + 8 neighbours (3x3 block)
//   - match if same non-empty `type` AND Euclidean distance ≤ 1 stud
//   - tie-break by nearest squared distance
//
// Operates on @cld/model `BbmMap`. Mutates `Brick.connexions[i].linkedTo`
// in place, mirroring the desktop. Per-brick connection lists are grown
// or shrunk to match the catalog's connection count for that part —
// imported `.bbm` files routinely have stale or missing entries that the
// desktop also patches up on every recompute.

import type { BbmMap, Brick, Layer, LayerBrick } from '@cld/model';
import type { Catalog, ConnectionPoint, PartMetadata } from './types.js';

const BUCKET_SIZE = 2.0;
const TOL_SQ = 1.0;

interface WorldConnection {
  /** Index into `bricks` (the flattened list of every brick in the map). */
  brickIndex: number;
  /** Index into `bricks[brickIndex].connexions`. */
  connIndex: number;
  /** World-space coordinates in studs. */
  x: number;
  y: number;
  type: string;
  /** Already linked at start (preserved when no better match exists). */
  preLinked: boolean;
}

export interface RebuildConnectivityResult {
  /** Number of (brick, connIndex) pairs that ended up linked. */
  linkedCount: number;
}

export function rebuildConnectivity(
  map: BbmMap,
  catalog: Catalog,
): RebuildConnectivityResult {
  // Phase 1: flatten every brick across every brick layer, sized to its
  // catalog connection list. Bricks whose part is unknown to the catalog
  // get their existing connection list left intact (we don't have ground
  // truth on connection-point shapes).
  const bricks = collectBricks(map);
  const worldPoints: WorldConnection[] = [];
  for (let i = 0; i < bricks.length; i++) {
    const b = bricks[i]!;
    const meta = catalogLookup(catalog, b.partNumber);
    if (meta) padConnexions(b, meta);
    for (let j = 0; j < b.connexions.length; j++) {
      const cp = catalogConnection(meta, j);
      if (!cp || cp.type === '') continue;
      const [wx, wy] = transformLocal(cp.x, cp.y, b);
      worldPoints.push({
        brickIndex: i,
        connIndex: j,
        x: wx,
        y: wy,
        type: cp.type,
        preLinked: b.connexions[j]!.linkedTo !== '',
      });
      // Reset linkage; we'll re-establish it in phase 2.
      b.connexions[j]!.linkedTo = '';
    }
  }

  // Phase 2: bucket by integer cells of size BUCKET_SIZE. Each point's
  // candidate set is itself + the 8 neighbours.
  const buckets = bucketize(worldPoints);
  let linkedCount = 0;

  for (let pi = 0; pi < worldPoints.length; pi++) {
    const a = worldPoints[pi]!;
    if (bricks[a.brickIndex]!.connexions[a.connIndex]!.linkedTo !== '') continue;

    let bestIdx = -1;
    let bestDistSq = TOL_SQ + 1; // strictly greater than tolerance — any candidate beats this
    const bx = Math.floor(a.x / BUCKET_SIZE);
    const by = Math.floor(a.y / BUCKET_SIZE);

    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const indices = buckets.get(bucketKey(bx + dx, by + dy));
        if (!indices) continue;
        for (const qi of indices) {
          if (qi <= pi) continue; // pair each unordered match once
          const b = worldPoints[qi]!;
          if (b.type !== a.type) continue;
          const ax = a.x - b.x;
          const ay = a.y - b.y;
          const distSq = ax * ax + ay * ay;
          if (distSq > TOL_SQ) continue;
          if (bricks[b.brickIndex]!.connexions[b.connIndex]!.linkedTo !== '') continue;
          if (distSq < bestDistSq) {
            bestDistSq = distSq;
            bestIdx = qi;
          }
        }
      }
    }

    if (bestIdx !== -1) {
      const a2 = worldPoints[bestIdx]!;
      const aBrick = bricks[a.brickIndex]!;
      const bBrick = bricks[a2.brickIndex]!;
      aBrick.connexions[a.connIndex]!.linkedTo = bBrick.connexions[a2.connIndex]!.id;
      bBrick.connexions[a2.connIndex]!.linkedTo = aBrick.connexions[a.connIndex]!.id;
      linkedCount += 2;
      void a.preLinked; // reserved for a future "sticky links" mode
    }
  }

  return { linkedCount };
}

function collectBricks(map: BbmMap): Brick[] {
  const out: Brick[] = [];
  for (const layer of map.layers) {
    if (isBrickLayer(layer)) out.push(...layer.bricks);
  }
  return out;
}

function isBrickLayer(layer: Layer): layer is LayerBrick {
  return layer.type === 'brick';
}

function catalogLookup(catalog: Catalog, partNumber: string): PartMetadata | undefined {
  // The catalog key is `<partNumber>.<colorCode>` lowercased. The .bbm
  // stores partNumber WITHOUT a color code embedded, so we try the bare
  // lookup first, then any matching color variant.
  const lower = partNumber.toLowerCase();
  if (catalog.has(lower)) return catalog.get(lower);
  // Find any entry whose partNumber matches (color variant fallback).
  for (const entry of catalog.values()) {
    if (entry.partNumber.toLowerCase() === lower) return entry;
  }
  return undefined;
}

function catalogConnection(meta: PartMetadata | undefined, index: number): ConnectionPoint | undefined {
  if (!meta) return undefined;
  return meta.connections[index];
}

/**
 * Grow or shrink `brick.connexions` to match the catalog's count for that
 * part. Extras get appended with empty linkedTo + a fresh id derived from
 * the brick id. Excess entries are dropped — the desktop trims the same way.
 */
function padConnexions(brick: Brick, meta: PartMetadata): void {
  const target = meta.connections.length;
  if (brick.connexions.length < target) {
    let counter = brick.connexions.length;
    while (brick.connexions.length < target) {
      brick.connexions.push({ id: `${brick.id}_${counter}`, linkedTo: '' });
      counter += 1;
    }
  } else if (brick.connexions.length > target) {
    brick.connexions.length = target;
  }
}

/**
 * Convert a local connection-point coordinate to world space.
 *   world = displayArea.center + rotate(localCp, brick.orientation)
 * Orientation is in degrees; positive = clockwise (BlueBrick convention).
 */
function transformLocal(localX: number, localY: number, brick: Brick): [number, number] {
  const cx = brick.displayArea.x + brick.displayArea.width / 2;
  const cy = brick.displayArea.y + brick.displayArea.height / 2;
  const theta = (brick.orientation * Math.PI) / 180;
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  // Rotation matches the desktop's `rotatePoint`: +y rotates "forward" at
  // 0°, i.e. world coordinates are (x*cos − y*sin, x*sin + y*cos).
  const rx = localX * cos - localY * sin;
  const ry = localX * sin + localY * cos;
  return [cx + rx, cy + ry];
}

function bucketize(points: WorldConnection[]): Map<string, number[]> {
  const buckets = new Map<string, number[]>();
  for (let i = 0; i < points.length; i++) {
    const p = points[i]!;
    const key = bucketKey(Math.floor(p.x / BUCKET_SIZE), Math.floor(p.y / BUCKET_SIZE));
    const arr = buckets.get(key);
    if (arr) arr.push(i);
    else buckets.set(key, [i]);
  }
  return buckets;
}

function bucketKey(bx: number, by: number): string {
  return `${bx},${by}`;
}

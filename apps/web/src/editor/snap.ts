// Snap helpers for the place + drag tools.
//
// Two snap strategies, applied in order:
//
//   1. Connection snap. Find the nearest unlinked connection point on
//      any existing brick that matches a connection on the candidate
//      part. If the distance is within `CONN_SNAP_STUDS`, return the
//      offset that would put the candidate's matching point exactly on
//      the existing point. Mirrors desktop's `applyLiveConnectionSnap`.
//
//   2. Grid snap. If no connection snap fired, round the candidate's
//      centre to the nearest grid intersection (`GRID_SNAP_STUDS`).
//      Matches the desktop's "Snap to grid" toggle behaviour.
//
// All inputs are in stud-space.

import type { BbmMap, Brick, LayerBrick } from '@cld/model';
import type { PartWire } from '../api';

/**
 * Connection-snap reach in studs — port of desktop's
 * `connectionSnapThresholdStuds` (MapViewDrag.cpp:225-237):
 *   - if grid step > 0 → grid step + 2 studs of grace
 *   - else fall back to 4 studs ("half a brick unit")
 */
export function connectionSnapReach(snapStepStuds: number): number {
  return snapStepStuds > 0 ? snapStepStuds + 2 : 4;
}

export interface PlaceCandidate {
  part: PartWire;
  /** World-space target centre, before snapping. */
  centreX: number;
  centreY: number;
  /** Brick orientation in degrees (clockwise positive). */
  orientation: number;
  /** Brick width/height in studs (display area). */
  width: number;
  height: number;
  /** Active grid snap step in studs (0 = grid snap disabled). */
  snapStepStuds: number;
}

export interface SnapResult {
  /** Final centre after snapping. */
  centreX: number;
  centreY: number;
  /** True if a connection snap fired (overrides grid snap). */
  snappedToConnection: boolean;
  /**
   * Orientation the candidate brick should be rotated to when a
   * connection snap fired. `null` when `snappedToConnection` is false.
   */
  newOrientation: number | null;
}

export interface AnchorSnapResult extends SnapResult {
  /**
   * Index into `newPart.connections` of the connection that was used to
   * snap. The outgoing connection (for the next chain step) is:
   *   newPart.connections[newConnIndex].nextConnexionPreference ?? (the other one)
   * Store this on the placed brick as `activeConnectionPointIndex` so the
   * next click-to-place knows which end is the free outgoing end without
   * needing the connectivity worker to run first.
   */
  newConnIndex: number;
}

/**
 * Selection-anchor snap — port of `resolvePartPlacement` lines 1147-1202
 * (MapView.cpp). When exactly one brick is selected, find the correct free
 * connection on it that is compatible with any connection on `newPart`.
 * Returns the rotation-aligned centre + orientation for the new brick so
 * the two connections meet mouth-to-mouth.
 *
 * "Correct free connection" priority:
 *   1. If connexions data exists (connectivity has run), skip linked ones.
 *   2. If connexions is empty (just placed, no connectivity yet), use
 *      `anchorBrick.activeConnectionPointIndex` as the preferred anchor
 *      connection — this was set after the previous snap placement so it
 *      points to the outgoing free end. Only fall through to index 0 if
 *      `activeConnectionPointIndex` has no compatible connection.
 *
 * Returns `null` if:
 *   - the anchor has no free compatible connection with `newPart`, or
 *   - `newPart` has no connections at all.
 */
export function snapToAnchorBrick(
  anchorBrick: import('@cld/model').Brick,
  anchorMeta: PartWire,
  newPart: PartWire,
  newWidth: number,
  newHeight: number,
): AnchorSnapResult | null {
  if (newPart.connections.length === 0) return null;

  const anchorCx = anchorBrick.displayArea.x + anchorBrick.displayArea.width / 2;
  const anchorCy = anchorBrick.displayArea.y + anchorBrick.displayArea.height / 2;
  const rA = (anchorBrick.orientation * Math.PI) / 180;
  const cosA = Math.cos(rA);
  const sinA = Math.sin(rA);

  const hasConnectivityData = anchorBrick.connexions.length > 0;

  // Build the iteration order for anchor connections. When connectivity
  // data is absent (freshly placed brick), try `activeConnectionPointIndex`
  // first so we chain off the outgoing end rather than doubling back.
  const n = anchorMeta.connections.length;
  const preferred = anchorBrick.activeConnectionPointIndex ?? 0;
  const order: number[] = [];
  if (!hasConnectivityData && preferred >= 0 && preferred < n) {
    order.push(preferred);
    for (let i = 0; i < n; i++) { if (i !== preferred) order.push(i); }
  } else {
    for (let i = 0; i < n; i++) order.push(i);
  }

  for (const i of order) {
    const ac = anchorMeta.connections[i]!;
    if (!ac.type) continue;
    // Skip already-linked connections when connectivity data is available.
    if (hasConnectivityData) {
      const link = anchorBrick.connexions[i];
      if (link && link.linkedTo !== '') continue;
    }

    // Find the first compatible connection on the new part.
    let newCi = -1;
    for (let j = 0; j < newPart.connections.length; j++) {
      if (newPart.connections[j]!.type === ac.type) { newCi = j; break; }
    }
    if (newCi < 0) continue;

    const nc = newPart.connections[newCi]!;

    // World position of the anchor connection point.
    const acWorldX = anchorCx + ac.x * cosA - ac.y * sinA;
    const acWorldY = anchorCy + ac.x * sinA + ac.y * cosA;

    // New orientation so nc.angle + newOrient = ac.angle + anchor.orient + 180°.
    const targetAngle = ac.angle + anchorBrick.orientation;
    let newOrient = targetAngle + 180 - nc.angle;
    // Normalise to (-180, 180] — matches desktop's while-loop.
    while (newOrient >  180) newOrient -= 360;
    while (newOrient <= -180) newOrient += 360;

    const rN = (newOrient * Math.PI) / 180;
    const cosN = Math.cos(rN);
    const sinN = Math.sin(rN);

    // New centre: anchor CP world pos - rotate(nc.position, newOrient).
    const newCentreX = acWorldX - (nc.x * cosN - nc.y * sinN);
    const newCentreY = acWorldY - (nc.x * sinN + nc.y * cosN);

    return {
      centreX: newCentreX,
      centreY: newCentreY,
      snappedToConnection: true,
      newOrientation: newOrient,
      newConnIndex: newCi,
    };
  }

  return null;
}

/**
 * Snap the candidate brick's centre to either a nearby existing
 * connection point or the grid. Existing free connection points are
 * collected from every brick layer in `map`.
 */
export function snapPlacement(
  candidate: PlaceCandidate,
  map: BbmMap,
  partsByKey: Map<string, PartWire>,
): SnapResult {
  const candidateConns = candidate.part.connections;
  if (candidateConns.length > 0) {
    const free = collectFreeConnectionsInWorld(map, partsByKey);
    const best = findBestConnectionMatch(candidate, candidateConns, free, candidate.snapStepStuds);
    if (best) {
      return {
        centreX: best.newCentreX,
        centreY: best.newCentreY,
        snappedToConnection: true,
        newOrientation: best.newOrientation,
      };
    }
  }

  // Desktop rounds the brick's TOP-LEFT corner of displayArea, not the
  // centre — see MapView.cpp:1244-1248. For odd-stud-wide bricks this
  // matters: a 3-stud brick centred at 0 snaps to displayArea.x=-1.5
  // → rounded to -2 → centre = -2 + 1.5 = -0.5, NOT 0.
  // When snap step is 0 ("off") the desktop skips this rounding entirely.
  if (candidate.snapStepStuds <= 0) {
    return {
      centreX: candidate.centreX,
      centreY: candidate.centreY,
      snappedToConnection: false,
      newOrientation: null,
    };
  }
  const tlX = candidate.centreX - candidate.width / 2;
  const tlY = candidate.centreY - candidate.height / 2;
  const snappedTlX = roundToStep(tlX, candidate.snapStepStuds);
  const snappedTlY = roundToStep(tlY, candidate.snapStepStuds);
  return {
    centreX: snappedTlX + candidate.width / 2,
    centreY: snappedTlY + candidate.height / 2,
    snappedToConnection: false,
    newOrientation: null,
  };
}

interface WorldConnection {
  x: number;
  y: number;
  type: string;
  /** World-space outward angle in degrees. Used for orientation snap. */
  angle: number;
}

/**
 * Walk every brick in every brick layer and emit world-space positions
 * for every free (unlinked) connection point. The catalog is consulted
 * for the connection geometry; bricks whose part isn't in the catalog
 * are skipped (no ground truth to snap to).
 */
function collectFreeConnectionsInWorld(
  map: BbmMap,
  partsByKey: Map<string, PartWire>,
): WorldConnection[] {
  const out: WorldConnection[] = [];
  for (const layer of map.layers) {
    if (!isBrickLayer(layer)) continue;
    for (const brick of layer.bricks) {
      const meta = lookupPart(partsByKey, brick.partNumber);
      if (!meta) continue;
      for (let i = 0; i < meta.connections.length; i++) {
        const cp = meta.connections[i]!;
        if (!cp.type) continue;
        const link = brick.connexions[i];
        if (link && link.linkedTo !== '') continue; // already taken
        const [wx, wy] = transformLocalToWorld(cp.x, cp.y, brick);
        out.push({ x: wx, y: wy, type: cp.type, angle: mod360(cp.angle + brick.orientation) });
      }
    }
  }
  return out;
}

interface MatchOffset {
  /** Rotation-aligned centre — where the brick should be placed with `newOrientation`. */
  newCentreX: number;
  newCentreY: number;
  /** New orientation for the candidate brick after snapping, degrees. */
  newOrientation: number;
}

/**
 * Find the (existing connection, candidate connection) pair whose worlds
 * are closest. Returns the rotation-aligned centre and new orientation so
 * the candidate's CP meets the target CP mouth-to-mouth.
 *
 * Mirrors desktop `newPartPlacementSnap` (ConnectionSnap.cpp:117-156):
 *   newCenter = target.worldPos - rotatePoint(c.position, newOrient)
 *
 * Null if nothing is within reach.
 */
function findBestConnectionMatch(
  candidate: PlaceCandidate,
  candidateConns: PartWire['connections'],
  free: WorldConnection[],
  snapStepStuds: number,
): MatchOffset | null {
  const reach = connectionSnapReach(snapStepStuds);
  const threshSq = reach * reach;
  let best: { distSq: number; newCentreX: number; newCentreY: number; newOrientation: number } | null = null;

  // Pre-rotate candidate connection points using current orientation to
  // compute world positions for distance checks.
  const theta0 = (candidate.orientation * Math.PI) / 180;
  const cos0 = Math.cos(theta0);
  const sin0 = Math.sin(theta0);

  for (const cc of candidateConns) {
    if (!cc.type) continue;
    // Current world position of this CP (at candidate's current orientation).
    const candWorldX = candidate.centreX + cc.x * cos0 - cc.y * sin0;
    const candWorldY = candidate.centreY + cc.x * sin0 + cc.y * cos0;
    for (const fc of free) {
      if (fc.type !== cc.type) continue;
      const ddx = fc.x - candWorldX;
      const ddy = fc.y - candWorldY;
      const distSq = ddx * ddx + ddy * ddy;
      if (distSq > threshSq) continue;
      // Required orientation: moving CP angle + newOrientation = target angle + 180°
      const newOrientation = mod360(fc.angle + 180 - cc.angle);
      // Rotation-aligned centre: target.worldPos - rotate(cp.position, newOrient)
      // Mirrors ConnectionSnap.cpp:149-151.
      const thetaNew = (newOrientation * Math.PI) / 180;
      const cosN = Math.cos(thetaNew);
      const sinN = Math.sin(thetaNew);
      const newCentreX = fc.x - (cc.x * cosN - cc.y * sinN);
      const newCentreY = fc.y - (cc.x * sinN + cc.y * cosN);
      if (!best || distSq < best.distSq) {
        best = { distSq, newCentreX, newCentreY, newOrientation };
      }
    }
  }
  return best;
}

/** displayArea (top-left, w, h) → centre, then rotate local point into world. */
function transformLocalToWorld(
  localX: number,
  localY: number,
  brick: Brick,
): [number, number] {
  const cx = brick.displayArea.x + brick.displayArea.width / 2;
  const cy = brick.displayArea.y + brick.displayArea.height / 2;
  const theta = (brick.orientation * Math.PI) / 180;
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  return [cx + localX * cos - localY * sin, cy + localX * sin + localY * cos];
}

function isBrickLayer(layer: { type: string }): layer is LayerBrick {
  return layer.type === 'brick';
}

function lookupPart(
  partsByKey: Map<string, PartWire>,
  partNumber: string,
): PartWire | undefined {
  // Bricks store the catalog KEY (`<partNumber>.<colorCode>` lowercased)
  // in their `partNumber` field. The catalog's `partNumber` is just the
  // numeric prefix WITHOUT colour code. Look up by `key` first; only
  // fall back to a `partNumber`-only match for bricks that arrived
  // without a colour code (group parts, some custom uploads).
  const lower = partNumber.toLowerCase();
  const direct = partsByKey.get(lower);
  if (direct) return direct;
  for (const p of partsByKey.values()) {
    if (p.partNumber.toLowerCase() === lower) return p;
  }
  return undefined;
}

function roundToStep(v: number, step: number): number {
  return Math.round(v / step) * step;
}

function mod360(v: number): number {
  const r = v % 360;
  return r < 0 ? r + 360 : r;
}

// ---------------------------------------------------------------------------
// Live drag snap — port of MapView::applyLiveConnectionSnap
// (MapViewDrag.cpp:239-410).
// ---------------------------------------------------------------------------

export interface DragSnapInput {
  /** Catalog metadata for the dragged brick (the "leader" — the one
   *  the cursor is on; the rest of the selection moves rigidly with it). */
  part: PartWire;
  /** Brick id of the leader (excluded from "free targets"). */
  movingId: string;
  /**
   * Every brick id participating in this drag — for multi-select drag
   * the user grabs ONE brick but the entire selection translates. We
   * use this to mask out free conns on the rest of the selection so a
   * group never "self-snaps" to itself. Empty/unset = single-brick drag,
   * same as `[movingId]`.
   */
  movingIds?: string[];
  /**
   * The leader's current per-connection link state. Index-aligned with
   * `part.connections`. Connections whose `linkedTo` is non-empty are
   * skipped — they're already glued to another brick, so the user is
   * moving the whole chain and we don't try to re-snap that joint.
   * Mirrors `MapView::applyLiveConnectionSnap` lines 277-279 and the
   * `master.connections[activeConnIdx].linkedToId` check in
   * `masterBrickSnap` (ConnectionSnap.cpp:93-94).
   */
  movingLinks: { linkedTo: string }[];
  /** Current (mid-drag) centre of the LEADER in studs. */
  centreX: number;
  centreY: number;
  /** Mouse position in studs — used as a tiebreaker between snap candidates. */
  mouseStudX: number;
  mouseStudY: number;
  /** Leader brick orientation. */
  orientation: number;
  /** Active grid snap step in studs (0 = off). */
  snapStepStuds: number;
}

export interface DragSnapResult {
  /** Where the brick's centre should be placed. */
  centreX: number;
  centreY: number;
  /** True if a connection-snap fired. */
  snappedToConnection: boolean;
  /**
   * World-space coords of the connection point that fired the snap —
   * used to draw the green ring overlay. Null when no connection snap.
   */
  ringStudX: number | null;
  ringStudY: number | null;
  /**
   * Orientation the dragged brick should be rotated to so the matched
   * CPs align angle-to-angle (mouth-to-mouth). Null when no connection snap
   * fired. Degrees, clockwise positive, [0, 360).
   */
  newOrientation: number | null;
}

/**
 * Compute the centre position the dragged brick should be at, given:
 *   - free connections on the dragged brick (local-coords from catalog)
 *   - free connections on every NON-moving brick in the map
 * Picks the (moving conn, target conn) pair with the smallest required
 * translation, breaking ties with mouse proximity (matches
 * MapViewDrag.cpp:303-328 — `kTieStudsSq = 16`).
 *
 * Falls back to grid snap when no connection match is in range.
 */
export function liveDragSnap(
  drag: DragSnapInput,
  map: BbmMap,
  partsByKey: Map<string, PartWire>,
): DragSnapResult {
  const reach = connectionSnapReach(drag.snapStepStuds);
  const reachSq = reach * reach;
  const TIE_SQ = 16; // 4 studs squared (MapViewDrag.cpp:303)

  // Free targets — every brick NOT in the moving set. For a multi-brick
  // drag this excludes the whole selection so the group can't snap to
  // its own connection points (matches desktop's `movingGuids` arg to
  // `scanForNearestFreeTarget` — ConnectionSnap.cpp:32-69).
  const movingSet = new Set<string>(drag.movingIds ?? [drag.movingId]);
  if (!movingSet.has(drag.movingId)) movingSet.add(drag.movingId);
  const targets = collectFreeConnectionsExcludingSet(map, partsByKey, movingSet);

  // Free connections on the dragged brick at its CURRENT pose.
  // Skip conns that are already linked to another brick — desktop
  // bails on those at MapView::applyLiveConnectionSnap:277-279 and
  // ConnectionSnap.cpp:93-94. Without this filter, a track in the
  // middle of a chain tries to "snap" to its already-linked neighbour
  // every frame.
  const theta = (drag.orientation * Math.PI) / 180;
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  const movingConns: Array<{ worldX: number; worldY: number; type: string; mouseDistSq: number; localAngle: number }> = [];
  for (let i = 0; i < drag.part.connections.length; i++) {
    const cp = drag.part.connections[i]!;
    if (!cp.type) continue;
    const link = drag.movingLinks[i];
    if (link && link.linkedTo !== '') continue;
    const wx = drag.centreX + cp.x * cos - cp.y * sin;
    const wy = drag.centreY + cp.x * sin + cp.y * cos;
    const mdx = wx - drag.mouseStudX;
    const mdy = wy - drag.mouseStudY;
    movingConns.push({ worldX: wx, worldY: wy, type: cp.type, mouseDistSq: mdx * mdx + mdy * mdy, localAngle: cp.angle });
  }

  if (movingConns.length === 0 || targets.length === 0) {
    return gridFallback(drag);
  }

  let best: {
    dx: number;
    dy: number;
    transSq: number;
    mouseDistSq: number;
    ringX: number;
    ringY: number;
    newOrientation: number;
  } | null = null;

  for (const mc of movingConns) {
    for (const tc of targets) {
      if (tc.type !== mc.type) continue;
      const dx = tc.x - mc.worldX;
      const dy = tc.y - mc.worldY;
      const transSq = dx * dx + dy * dy;
      if (transSq > reachSq) continue;
      // Required orientation: moving CP's local angle + new orientation = target angle + 180°
      // → newOrientation = targetAngle + 180° − movingCpLocalAngle
      const newOrientation = mod360(tc.angle + 180 - mc.localAngle);
      // Pick the smallest translation; tiebreak on mouse proximity.
      // Same logic as MapViewDrag.cpp:313-319.
      let take = false;
      if (best === null || transSq + TIE_SQ < best.transSq) take = true;
      else if (Math.abs(transSq - best.transSq) <= TIE_SQ && mc.mouseDistSq < best.mouseDistSq) {
        take = true;
      }
      if (take) {
        best = {
          dx,
          dy,
          transSq,
          mouseDistSq: mc.mouseDistSq,
          ringX: tc.x,
          ringY: tc.y,
          newOrientation,
        };
      }
    }
  }

  if (best === null) return gridFallback(drag);
  return {
    centreX: drag.centreX + best.dx,
    centreY: drag.centreY + best.dy,
    snappedToConnection: true,
    ringStudX: best.ringX,
    ringStudY: best.ringY,
    newOrientation: best.newOrientation,
  };
}

function gridFallback(drag: DragSnapInput): DragSnapResult {
  if (drag.snapStepStuds <= 0) {
    return {
      centreX: drag.centreX,
      centreY: drag.centreY,
      snappedToConnection: false,
      ringStudX: null,
      ringStudY: null,
      newOrientation: null,
    };
  }
  const sx = roundToStep(drag.centreX, drag.snapStepStuds);
  const sy = roundToStep(drag.centreY, drag.snapStepStuds);
  return {
    centreX: sx,
    centreY: sy,
    snappedToConnection: false,
    ringStudX: null,
    ringStudY: null,
    newOrientation: null,
  };
}

/**
 * Same as `collectFreeConnectionsInWorld` but skips every brick whose
 * id is in `excludeIds` so a multi-brick drag can't snap to its own
 * free connections.
 */
function collectFreeConnectionsExcludingSet(
  map: BbmMap,
  partsByKey: Map<string, PartWire>,
  excludeIds: Set<string>,
): WorldConnection[] {
  const out: WorldConnection[] = [];
  for (const layer of map.layers) {
    if (!isBrickLayer(layer)) continue;
    for (const brick of layer.bricks) {
      if (excludeIds.has(brick.id)) continue;
      const meta = lookupPart(partsByKey, brick.partNumber);
      if (!meta) continue;
      for (let i = 0; i < meta.connections.length; i++) {
        const cp = meta.connections[i]!;
        if (!cp.type) continue;
        const link = brick.connexions[i];
        if (link && link.linkedTo !== '') continue;
        const [wx, wy] = transformLocalToWorld(cp.x, cp.y, brick);
        out.push({ x: wx, y: wy, type: cp.type, angle: mod360(cp.angle + brick.orientation) });
      }
    }
  }
  return out;
}

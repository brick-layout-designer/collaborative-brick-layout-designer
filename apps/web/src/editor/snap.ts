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
import { pivotOf } from './brickGeometry';

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
  /**
   * Pivot minus displayArea centre, in studs (non-zero only for parts
   * with a <hull>). `centreX/Y` are the pivot; the grid rounds the box.
   */
  pivotOffsetX?: number;
  pivotOffsetY?: number;
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
  _newWidth: number,
  _newHeight: number,
): AnchorSnapResult | null {
  if (newPart.connections.length === 0) return null;

  // Connection points hang off the sprite centre (BlueBrick's pivot).
  const { x: anchorCx, y: anchorCy } = pivotOf(anchorBrick, anchorMeta);
  const rA = (anchorBrick.orientation * Math.PI) / 180;
  const cosA = Math.cos(rA);
  const sinA = Math.sin(rA);

  // Desktop tries the anchor's connections in order and takes the first
  // free one with a compatible connection on the new part
  // (MapView.cpp:1226-1258). Links are current: placement rebuilds
  // connectivity straight away.
  for (let i = 0; i < anchorMeta.connections.length; i++) {
    const ac = anchorMeta.connections[i]!;
    if (!ac.type) continue;
    const link = anchorBrick.connexions[i];
    if (link && link.linkedTo !== '') continue;

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
  const ox = (candidate.pivotOffsetX ?? 0) + candidate.width / 2;
  const oy = (candidate.pivotOffsetY ?? 0) + candidate.height / 2;
  return {
    centreX: roundToStep(candidate.centreX - ox, candidate.snapStepStuds) + ox,
    centreY: roundToStep(candidate.centreY - oy, candidate.snapStepStuds) + oy,
    snappedToConnection: false,
    newOrientation: null,
  };
}

export interface WorldConnection {
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
  return freeConnectionsCached(map, partsByKey);
}

export interface OwnedWorldConnection extends WorldConnection {
  brickId: string;
}

// Free-connection lists per (map, catalog). A drag fires dragmove at
// frame rate against the same map object, and the placement ghost
// re-snaps on every dragover; rebuilding every free connection point of
// every brick each time cost ~3.6 ms per frame at 5k bricks. Maps are
// immutable snapshots (the editor's shared projection gets a new object
// on every doc change), so keying on identity is safe.
const freeConnCache = new WeakMap<
  BbmMap,
  { partsByKey: Map<string, PartWire>; conns: OwnedWorldConnection[] }
>();

export function freeConnectionsCached(
  map: BbmMap,
  partsByKey: Map<string, PartWire>,
): OwnedWorldConnection[] {
  const hit = freeConnCache.get(map);
  if (hit && hit.partsByKey === partsByKey) return hit.conns;
  const conns: OwnedWorldConnection[] = [];
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
        const [wx, wy] = transformLocalToWorld(cp.x, cp.y, brick, meta);
        conns.push({
          x: wx,
          y: wy,
          type: cp.type,
          angle: mod360(cp.angle + brick.orientation),
          brickId: brick.id,
        });
      }
    }
  }
  freeConnCache.set(map, { partsByKey, conns });
  return conns;
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

/** The brick's pivot (sprite centre), then rotate the local point into world. */
function transformLocalToWorld(
  localX: number,
  localY: number,
  brick: Brick,
  part: PartWire,
): [number, number] {
  const { x: cx, y: cy } = pivotOf(brick, part);
  const theta = (brick.orientation * Math.PI) / 180;
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  return [cx + localX * cos - localY * sin, cy + localX * sin + localY * cos];
}

function isBrickLayer(layer: { type: string }): layer is LayerBrick {
  return layer.type === 'brick';
}

export function lookupPart(
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
  // The partNumber-only fallback is an O(catalog) scan; memoise it per
  // catalog (hits AND misses) instead of rescanning for every brick on
  // every drag frame (~166 ms/frame at 5k bricks of an unknown part).
  let memo = fallbackMemo.get(partsByKey);
  if (!memo) {
    memo = new Map();
    fallbackMemo.set(partsByKey, memo);
  }
  if (memo.has(lower)) return memo.get(lower);
  let found: PartWire | undefined;
  for (const p of partsByKey.values()) {
    if (p.partNumber.toLowerCase() === lower) {
      found = p;
      break;
    }
  }
  memo.set(lower, found);
  return found;
}

const fallbackMemo = new WeakMap<Map<string, PartWire>, Map<string, PartWire | undefined>>();

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

/**
 * A non-leader brick moving rigidly with the leader in a multi-select
 * drag. Its current centre is `leader centre + (offsetX, offsetY)`.
 */
export interface DragSibling {
  id: string;
  /** Catalog metadata; undefined = no connection geometry (skipped). */
  part: PartWire | undefined;
  /** Per-connection link state, index-aligned with `part.connections`. */
  links: { linkedTo: string }[];
  /** Centre offset from the leader's centre, in studs. */
  offsetX: number;
  offsetY: number;
  orientation: number;
}

export interface DragSnapInput {
  /** Catalog metadata for the dragged brick (the "leader" — the one
   *  the cursor is on; the rest of the selection moves rigidly with it). */
  part: PartWire | undefined;
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
   * The other bricks of a multi-select drag, with their connection
   * geometry. Desktop tries EVERY free connection of EVERY moving brick
   * (MapViewDrag.cpp:270-290), not only the grabbed one's.
   */
  siblings?: DragSibling[];
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
  /** Current (mid-drag) pivot (sprite centre) of the LEADER in studs. */
  centreX: number;
  centreY: number;
  /**
   * Leader displayArea size in studs. The grid fallback rounds the
   * displayArea TOP-LEFT like desktop's commit (MapViewDrag.cpp:572-580);
   * omitted = 0, i.e. round the centre.
   */
  width?: number;
  height?: number;
  /** Leader pivot minus displayArea centre (parts with a <hull>); omitted = 0. */
  pivotOffsetX?: number;
  pivotOffsetY?: number;
  /** Mouse position in studs — used as a tiebreaker between snap candidates. */
  mouseStudX: number;
  mouseStudY: number;
  /** Leader brick orientation. */
  orientation: number;
  /** Active grid snap step in studs (0 = off). */
  snapStepStuds: number;
  /**
   * Grab anchor: index into `part.connections` of the leader connection
   * nearest the click that started the drag (desktop `captureGrabAnchor`,
   * MapViewDrag.cpp:155-217 + MapView.cpp:538-543). For a single-brick
   * drag this connection leads the snap: it is tried on its own first,
   * and the other free connections are only considered when it has no
   * target in reach. Ignored for multi-brick drags.
   */
  leadConnIndex?: number;
}

export interface DragSnapResult {
  /** Where the LEADER's centre should be placed. For a multi-brick drag
   *  every sibling moves by the same (result - input) translation. */
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
   * CPs align angle-to-angle (mouth-to-mouth). Only for a single-brick
   * drag — desktop never rotates a multi-brick group on snap
   * (MapViewDrag.cpp:551-567). Null otherwise. Degrees, [0, 360).
   * When set, `centreX/Y` is the rotation-aligned centre: the moving
   * connection, rotated to `newOrientation`, lands exactly on the target.
   */
  newOrientation: number | null;
  /** Free connections considered on the moving set (status-bar hint). */
  movingConnCount: number;
}

/**
 * Compute the centre position the dragged brick should be at, given:
 *   - free connections on every moving brick (local-coords from catalog)
 *   - free connections on every NON-moving brick in the map
 * Picks the (moving conn, target conn) pair with the smallest required
 * translation, breaking ties with mouse proximity (matches
 * MapViewDrag.cpp:303-328 — `kTieStudsSq = 16`).
 *
 * Single brick: the result is rotation-aligned (ConnectionSnap.cpp:103-110,
 * newCentre = target - rotate(conn.local, newOrient)). Multi-brick: pure
 * translation of the whole group.
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
  const siblings = drag.siblings ?? [];
  const movingSet = new Set<string>(drag.movingIds ?? [drag.movingId]);
  movingSet.add(drag.movingId);
  for (const s of siblings) movingSet.add(s.id);
  const targets = collectFreeConnectionsExcludingSet(map, partsByKey, movingSet);
  const single = siblings.length === 0;

  // Free connections on every moving brick at its CURRENT pose. Skip
  // conns that are already linked to another brick — desktop bails on
  // those at MapView::applyLiveConnectionSnap:277-279.
  interface MovingConn {
    /** True for the leader's connections; `index` is into its part. */
    leader: boolean;
    index: number;
    worldX: number;
    worldY: number;
    type: string;
    mouseDistSq: number;
    localX: number;
    localY: number;
    localAngle: number;
  }
  const movingConns: MovingConn[] = [];
  const addConns = (
    leader: boolean,
    part: PartWire | undefined,
    links: { linkedTo: string }[],
    cx: number,
    cy: number,
    orientation: number,
  ) => {
    if (!part) return;
    const theta = (orientation * Math.PI) / 180;
    const cos = Math.cos(theta);
    const sin = Math.sin(theta);
    for (let i = 0; i < part.connections.length; i++) {
      const cp = part.connections[i]!;
      if (!cp.type) continue;
      const link = links[i];
      if (link && link.linkedTo !== '') continue;
      const wx = cx + cp.x * cos - cp.y * sin;
      const wy = cy + cp.x * sin + cp.y * cos;
      const mdx = wx - drag.mouseStudX;
      const mdy = wy - drag.mouseStudY;
      movingConns.push({
        leader,
        index: i,
        worldX: wx,
        worldY: wy,
        type: cp.type,
        mouseDistSq: mdx * mdx + mdy * mdy,
        localX: cp.x,
        localY: cp.y,
        localAngle: cp.angle,
      });
    }
  };
  addConns(true, drag.part, drag.movingLinks, drag.centreX, drag.centreY, drag.orientation);
  for (const s of siblings) {
    addConns(false, s.part, s.links, drag.centreX + s.offsetX, drag.centreY + s.offsetY, s.orientation);
  }

  if (movingConns.length === 0 || targets.length === 0) {
    return gridFallback(drag, movingConns.length);
  }

  type Best = { mc: MovingConn; tc: WorldConnection; transSq: number; mouseDistSq: number };
  const search = (candidates: MovingConn[]): Best | null => {
    let best: Best | null = null;
    for (const mc of candidates) {
      for (const tc of targets) {
        if (tc.type !== mc.type) continue;
        const dx = tc.x - mc.worldX;
        const dy = tc.y - mc.worldY;
        const transSq = dx * dx + dy * dy;
        if (transSq > reachSq) continue;
        // Pick the smallest translation; tiebreak on mouse proximity.
        // Same logic as MapViewDrag.cpp:313-319.
        let take = false;
        if (best === null || transSq + TIE_SQ < best.transSq) take = true;
        else if (Math.abs(transSq - best.transSq) <= TIE_SQ && mc.mouseDistSq < best.mouseDistSq) {
          take = true;
        }
        if (take) best = { mc, tc, transSq, mouseDistSq: mc.mouseDistSq };
      }
    }
    return best;
  };

  // Grab anchor leads a single-brick drag; fall back to every free
  // connection when it has nothing in reach.
  let best: Best | null = null;
  if (single && drag.leadConnIndex !== undefined && drag.leadConnIndex >= 0) {
    best = search(movingConns.filter((m) => m.leader && m.index === drag.leadConnIndex));
  }
  if (best === null) best = search(movingConns);

  if (best === null) return gridFallback(drag, movingConns.length);
  const { mc, tc } = best;
  if (!single) {
    return {
      centreX: drag.centreX + (tc.x - mc.worldX),
      centreY: drag.centreY + (tc.y - mc.worldY),
      snappedToConnection: true,
      ringStudX: tc.x,
      ringStudY: tc.y,
      newOrientation: null,
      movingConnCount: movingConns.length,
    };
  }
  // Required orientation: moving CP's local angle + new orientation = target angle + 180°.
  const newOrientation = mod360(tc.angle + 180 - mc.localAngle);
  const aligned = rotationAlignedCentre(tc.x, tc.y, mc.localX, mc.localY, newOrientation);
  return {
    centreX: aligned.x,
    centreY: aligned.y,
    snappedToConnection: true,
    ringStudX: tc.x,
    ringStudY: tc.y,
    newOrientation,
    movingConnCount: movingConns.length,
  };
}

/**
 * Grab anchor — port of desktop `nearestConnectionIndex`
 * (MapViewDrag.cpp:60-101). The connection of `brick` whose world
 * position is nearest to the click, preferring free (unlinked) ones so
 * clicking a brick already connected at one end grabs the OTHER end.
 * Falls back to the nearest connection of any link state; -1 when the
 * part has no typed connections.
 */
export function nearestConnectionIndex(
  brick: Pick<Brick, 'displayArea' | 'orientation' | 'connexions'>,
  part: PartWire | undefined,
  clickX: number,
  clickY: number,
): number {
  if (!part || part.connections.length === 0) return -1;
  const { x: cx, y: cy } = pivotOf(brick, part);
  const t = (brick.orientation * Math.PI) / 180;
  const cos = Math.cos(t);
  const sin = Math.sin(t);
  const pick = (freeOnly: boolean): number => {
    let bestIdx = -1;
    let bestSq = Infinity;
    for (let i = 0; i < part.connections.length; i++) {
      const c = part.connections[i]!;
      if (!c.type) continue;
      if (freeOnly) {
        const link = brick.connexions[i];
        if (link && link.linkedTo !== '') continue;
      }
      const wx = cx + c.x * cos - c.y * sin;
      const wy = cy + c.x * sin + c.y * cos;
      const sq = (wx - clickX) ** 2 + (wy - clickY) ** 2;
      if (sq < bestSq) {
        bestSq = sq;
        bestIdx = i;
      }
    }
    return bestIdx;
  };
  const free = pick(true);
  return free >= 0 ? free : pick(false);
}

/**
 * Centre that puts a brick's local connection point `(localX, localY)`
 * exactly on `(targetX, targetY)` once the brick is at `orientation`:
 * `target - rotate(local, orientation)` (ConnectionSnap.cpp:109).
 */
export function rotationAlignedCentre(
  targetX: number,
  targetY: number,
  localX: number,
  localY: number,
  orientation: number,
): { x: number; y: number } {
  const t = (orientation * Math.PI) / 180;
  const c = Math.cos(t);
  const s = Math.sin(t);
  return { x: targetX - (localX * c - localY * s), y: targetY - (localX * s + localY * c) };
}

/**
 * Grid fallback: round the leader's displayArea TOP-LEFT to the grid, as
 * desktop does when committing a drag (MapViewDrag.cpp:572-580) and when
 * placing (MapView.cpp:1244-1248). For odd-sized bricks this differs from
 * rounding the centre by half a stud.
 */
function gridFallback(drag: DragSnapInput, movingConnCount: number): DragSnapResult {
  const base = {
    snappedToConnection: false,
    ringStudX: null,
    ringStudY: null,
    newOrientation: null,
    movingConnCount,
  };
  if (drag.snapStepStuds <= 0) return { ...base, centreX: drag.centreX, centreY: drag.centreY };
  const hw = (drag.width ?? 0) / 2 + (drag.pivotOffsetX ?? 0);
  const hh = (drag.height ?? 0) / 2 + (drag.pivotOffsetY ?? 0);
  return {
    ...base,
    centreX: roundToStep(drag.centreX - hw, drag.snapStepStuds) + hw,
    centreY: roundToStep(drag.centreY - hh, drag.snapStepStuds) + hh,
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
  const all = freeConnectionsCached(map, partsByKey);
  const out: WorldConnection[] = [];
  for (const c of all) {
    if (!excludeIds.has(c.brickId)) out.push(c);
  }
  return out;
}

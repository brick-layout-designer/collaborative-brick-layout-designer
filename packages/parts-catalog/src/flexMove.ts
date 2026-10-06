// BlueBrick's flex move (Actions/Bricks/FlexMove.cs + MapData/Tools/
// IKSolver.cs), ported from desktop edit/FlexMove.cpp: double-click-drag a
// piece of a selected chain that has hinged connections (PFS flex track,
// magnet couplings...) and the chain bends, each hinge limited to its
// connection type's hinge angle, so its free end follows the mouse (a CCD
// inverse-kinematics solve). Operates on a layer's bricks in place.

import type { Brick, LayerBrick, RectangleF } from '@cld/model';
import { makeCatalogLookup } from './connectivity.js';
import { footprint, imageOffset } from './footprint.js';
import type { Catalog, PartMetadata } from './types.js';

type Pt = { x: number; y: number };

/** The hinge angle (degrees) of a connection type (ConnectionTypeList.xml); 0 when rigid. */
export function connectionHingeAngle(type: string): number {
  switch (type) {
    case 'flexpivot':
      return 10;
    case 'magnet':
      return 37;
    case 'threequarterhinge':
      return 90;
    case 'halfhinge':
      return 45;
    default:
      return 0;
  }
}

/** A connection of a brick, or (brick null, index ≥ 0 unused) a fixed point where a chain ends free. */
interface Conn {
  brick: Brick | null;
  index: number;
  fixed: Pt;
}
const NULL_CONN = (): Conn => ({ brick: null, index: -1, fixed: { x: 0, y: 0 } });
const sameConn = (a: Conn, b: Conn) => a.brick === b.brick && a.index === b.index;
const isNull = (c: Conn) => !c.brick && c.index < 0;

/** IKSolver.Bone_2D_CCD. World coordinates have y up (BlueBrick's are y down). */
interface Bone {
  localAngle: number;
  maxAngle: number;
  worldX: number;
  worldY: number;
  conn: Conn;
}

const enum Ccd {
  Success,
  Processing,
  Failure,
}

function simplifyAngle(angle: number): number {
  angle %= 2 * Math.PI;
  if (angle < -Math.PI) angle += 2 * Math.PI;
  else if (angle > Math.PI) angle -= 2 * Math.PI;
  return angle;
}

/** IKSolver.CalcIK_2D_CCD (Ryan Juckett's CCD, with BlueBrick's per-bone limit). */
function solveCcd(bones: Bone[], targetX: number, targetY: number, arrivalDist: number, numBones: number): Ccd {
  const epsilon = 0.0001;
  const trivialArcLength = 0.00001;
  if (numBones < 2) return Ccd.Failure;
  const arrivalDistSqr = arrivalDist * arrivalDist;
  let endX = bones[numBones - 1]!.worldX;
  let endY = bones[numBones - 1]!.worldY;
  let modifiedBones = false;
  for (let i = numBones - 2; i >= 0; --i) {
    const bone = bones[i]!;
    const curToEndX = endX - bone.worldX;
    const curToEndY = endY - bone.worldY;
    const curToEndMag = Math.sqrt(curToEndX * curToEndX + curToEndY * curToEndY);
    const curToTargetX = targetX - bone.worldX;
    const curToTargetY = targetY - bone.worldY;
    const curToTargetMag = Math.sqrt(curToTargetX * curToTargetX + curToTargetY * curToTargetY);
    let cosRot: number;
    let sinRot: number;
    const endTargetMag = curToEndMag * curToTargetMag;
    if (endTargetMag <= epsilon) {
      cosRot = 1;
      sinRot = 0;
    } else {
      cosRot = (curToEndX * curToTargetX + curToEndY * curToTargetY) / endTargetMag;
      sinRot = (curToEndX * curToTargetY - curToEndY * curToTargetX) / endTargetMag;
    }
    let rot = Math.acos(Math.max(-1, Math.min(1, cosRot)));
    if (sinRot < 0) rot = -rot;
    let newLocal = simplifyAngle(bone.localAngle + rot);
    let recompute = false;
    if (newLocal > bone.maxAngle) {
      rot -= newLocal - bone.maxAngle;
      newLocal = bone.maxAngle;
      recompute = true;
    } else if (newLocal < -bone.maxAngle) {
      rot -= newLocal + bone.maxAngle;
      newLocal = -bone.maxAngle;
      recompute = true;
    }
    bone.localAngle = newLocal;
    if (recompute) {
      cosRot = Math.cos(rot);
      sinRot = Math.sin(rot);
    }
    endX = bone.worldX + cosRot * curToEndX - sinRot * curToEndY;
    endY = bone.worldY + sinRot * curToEndX + cosRot * curToEndY;
    const dx = targetX - endX;
    const dy = targetY - endY;
    if (dx * dx + dy * dy <= arrivalDistSqr) return Ccd.Success;
    if (!modifiedBones && Math.abs(rot) * curToEndMag > trivialArcLength) modifiedBones = true;
  }
  return modifiedBones ? Ccd.Processing : Ccd.Failure;
}

function simplifyDegrees(angle: number): number {
  if (angle <= -360) angle += 360;
  if (angle >= 360) angle -= 360;
  return angle;
}

/** System.Drawing Matrix.Rotate + TransformVectors. */
function rotateVector(v: Pt, degrees: number): Pt {
  const r = (degrees * Math.PI) / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  return { x: v.x * c - v.y * s, y: v.x * s + v.y * c };
}

const areaCentre = (a: RectangleF): Pt => ({ x: a.x + a.width / 2, y: a.y + a.height / 2 });

export interface FlexState {
  id: string;
  orientation: number;
  displayArea: RectangleF;
}

interface ChainLink {
  first: Conn; // on the next brick (or a fixed point)
  second: Conn; // on this brick
  angleBetween: number;
}

/** A free connection a flex move's end may join. */
export interface FlexSnapTarget {
  key: string;
  type: string;
  world: Pt;
  angle: number;
}

export class FlexMove {
  private readonly lookup: (partNumber: string) => PartMetadata | undefined;
  private readonly metas = new Map<Brick, PartMetadata | undefined>();
  private readonly byId = new Map<string, Conn>();
  private bones: Bone[] = [];
  private chain: ChainLink[] = [];
  private chainBricks: Brick[] = [];
  private rootLink = 0;
  private initialStaticOrientation = 0;
  private lastBoneVector: Pt = { x: 0, y: 0 };
  private primaryTarget: Pt = { x: 0, y: 0 };
  private secondaryTarget: Pt = { x: 0, y: 0 };
  private useTwoTargets = false;
  private status = Ccd.Failure;
  private grabbed: Brick | null = null;
  private grabDelta: Pt = { x: 0, y: 0 };
  private targets: FlexSnapTarget[] | null = null;
  private targetConns: Conn[] = [];
  private initial: FlexState[] = [];

  private constructor(
    private readonly layer: LayerBrick,
    catalog: Catalog,
  ) {
    this.lookup = makeCatalogLookup(catalog);
  }

  /**
   * Start a flex move of `grabbedId` within the `selection` of `layer`, or
   * null when the selection has no flexible chain through that brick. The
   * layer's bricks are edited in place while the move runs.
   */
  static start(layer: LayerBrick, selection: ReadonlySet<string>, grabbedId: string, mouse: Pt, catalog: Catalog): FlexMove | null {
    const d = new FlexMove(layer, catalog);
    const list = new Set<Brick>();
    for (const b of layer.bricks) {
      const count = Math.min(b.connexions.length, d.connectionCount(b));
      for (let i = 0; i < count; i++) if (b.connexions[i]!.id) d.byId.set(b.connexions[i]!.id, d.conn(b, i));
      if (selection.has(b.id)) list.add(b);
      if (b.id === grabbedId) d.grabbed = b;
    }
    const g = d.grabbed;
    if (!g || !list.has(g)) return null;
    const conns = d.metaOf(g)?.connections ?? [];
    const n = conns.length;
    if (!conns.some((c) => c.type !== '') || n > 2 || g.connexions.length < n) return null;
    let startConn = NULL_CONN();
    if (n === 1) {
      if (connectionHingeAngle(conns[0]!.type) === 0) return null;
    } else {
      const s = d.startingConnection(list, g, mouse);
      if (!s) return null;
      startConn = s;
    }
    d.createChain(list, g, startConn);
    if (d.bones.length < 2 || d.chain.length === 0 || d.chainBricks.length === 0) return null;
    const active = Math.min(Math.max(g.activeConnectionPointIndex, 0), n - 1);
    const a = d.world(d.conn(g, active));
    d.grabDelta = { x: mouse.x - a.x, y: mouse.y - a.y };
    d.initial = d.currentState();
    return d;
  }

  /** The chain's bricks (those the move changes) before the move. */
  initialState(): readonly FlexState[] {
    return this.initial;
  }

  currentState(): FlexState[] {
    return this.chainBricks.map((b) => ({ id: b.id, orientation: b.orientation, displayArea: { ...b.displayArea } }));
  }

  /**
   * The joints bent as far as their hinge allows (studs, where the joint
   * is): shown while bending, so it's clear why the end stops following.
   * The desktop's FlexMove::hingesAtLimit.
   */
  hingesAtLimit(): Pt[] {
    const out: Pt[] = [];
    // The last bone is the chain's end: the solver never turns it.
    for (let i = 0; i + 1 < this.bones.length; i++) {
      const b = this.bones[i]!;
      if (isNull(b.conn) || b.maxAngle <= 0) continue;
      if (Math.abs(b.localAngle) >= b.maxAngle - 1e-6) out.push({ x: b.worldX, y: -b.worldY });
    }
    return out;
  }

  /** Put the chain back as it was. */
  restore(): void {
    for (const s of this.initial) {
      for (const b of this.chainBricks) {
        if (b.id !== s.id) continue;
        b.orientation = s.orientation;
        b.displayArea = { ...s.displayArea };
      }
    }
  }

  /**
   * Bend the chain so its end reaches `mouse`, snapping (unless `snap` is
   * off) the grabbed brick's active connection to a free connection of its
   * type on a brick outside the chain, within `reachStuds` (the editor's
   * connection-snap reach; LayerBrick.getMovedSnapPoint used max(grid, 4)).
   * Returns the snap point, if any.
   */
  moveTo(mouse: Pt, reachStuds: number, snap = true): Pt | null {
    let target = NULL_CONN();
    const g = this.grabbed!;
    const n = this.connectionCount(g);
    const active = this.conn(g, Math.min(Math.max(g.activeConnectionPointIndex, 0), n - 1));
    if (snap && reachStuds > 0 && this.isFree(active)) {
      const type = this.type(active);
      const virtual = { x: mouse.x - this.grabDelta.x, y: mouse.y - this.grabDelta.y };
      let best = reachStuds * reachStuds;
      for (const b of this.layer.bricks) {
        if (this.chainBricks.includes(b)) continue;
        const conns = this.metaOf(b)?.connections ?? [];
        for (let i = 0; i < conns.length && i < b.connexions.length; i++) {
          if (conns[i]!.type !== type || b.connexions[i]!.linkedTo !== '') continue;
          const p = this.world(this.conn(b, i));
          const sq = (p.x - virtual.x) ** 2 + (p.y - virtual.y) ** 2;
          if (sq < best) {
            best = sq;
            target = this.conn(b, i);
          }
        }
      }
    }
    if (!isNull(target)) {
      const p = this.world(target);
      this.reach(p, target);
      return p;
    }
    this.reach(mouse, NULL_CONN());
    return null;
  }

  /**
   * For the editor's calm snapping (snapFeel): the free connections the
   * moving end may join (of its type, on bricks outside the chain), the
   * desktop's FlexMove::snapTargets.
   */
  snapTargets(): readonly FlexSnapTarget[] {
    if (this.targets) return this.targets;
    this.targets = [];
    const active = this.activeConn();
    if (!this.isFree(active)) return this.targets;
    const type = this.type(active);
    for (const b of this.layer.bricks) {
      if (this.chainBricks.includes(b)) continue;
      const conns = this.metaOf(b)?.connections ?? [];
      for (let i = 0; i < conns.length && i < b.connexions.length; i++) {
        if (conns[i]!.type !== type || b.connexions[i]!.linkedTo) continue;
        const c = this.conn(b, i);
        this.targetConns.push(c);
        this.targets.push({ key: `${b.id}#${i}`, type, world: this.world(c), angle: b.orientation + this.angle(c) });
      }
    }
    return this.targets;
  }

  /** Where the moving end is for a pointer at `mouse` (studs). */
  endFor(mouse: Pt): Pt {
    return { x: mouse.x - this.grabDelta.x, y: mouse.y - this.grabDelta.y };
  }

  /**
   * Bend the chain so its end follows `mouse`, or onto snapTargets()[target]
   * (the end facing it). False when that target is out of the chain's reach
   * (each hinge within its limit): the end then follows the pointer.
   */
  bendTo(mouse: Pt, target = -1): boolean {
    const targets = this.snapTargets();
    if (target >= 0 && target < targets.length) {
      const to = this.targetConns[target]!;
      const p = this.world(to);
      this.reach(p, to);
      // Joined only where the end really got: links are made from positions.
      const end = this.world(this.activeConn());
      if (Math.hypot(end.x - p.x, end.y - p.y) <= 0.2) return true;
    }
    this.reach(mouse, NULL_CONN());
    return false;
  }

  private activeConn(): Conn {
    const g = this.grabbed!;
    const n = this.connectionCount(g);
    return this.conn(g, Math.min(Math.max(g.activeConnectionPointIndex, 0), n - 1));
  }

  // ---------------------------------------------------------------------

  private metaOf(b: Brick): PartMetadata | undefined {
    if (!this.metas.has(b)) this.metas.set(b, this.lookup(b.partNumber));
    return this.metas.get(b);
  }
  private connectionCount(b: Brick): number {
    return this.metaOf(b)?.connections.length ?? 0;
  }
  private type(c: Conn): string {
    return c.brick ? (this.metaOf(c.brick)?.connections[c.index]?.type ?? '') : '';
  }
  private angle(c: Conn): number {
    return c.brick ? Math.fround(this.metaOf(c.brick)?.connections[c.index]?.angle ?? 0) : 0;
  }
  private conn(b: Brick, i: number): Conn {
    return { brick: b, index: i, fixed: { x: 0, y: 0 } };
  }
  private imageCentre(b: Brick): Pt {
    const c = areaCentre(b.displayArea);
    const m = this.metaOf(b);
    if (!m) return c;
    const off = imageOffset(m, b.orientation);
    return { x: c.x + off.x, y: c.y + off.y };
  }
  private world(c: Conn): Pt {
    if (!c.brick) return c.fixed;
    const cp = this.metaOf(c.brick)!.connections[c.index]!;
    const centre = this.imageCentre(c.brick);
    const r = rotateVector(cp, c.brick.orientation);
    return { x: centre.x + r.x, y: centre.y + r.y };
  }
  /** Put the brick's sprite centre at `centre`, its box the footprint at its orientation (placeByImageCentre). */
  private placeByImageCentre(b: Brick, centre: Pt): void {
    const m = this.metaOf(b);
    const fp = m ? footprint(m, b.orientation) : null;
    const size = fp
      ? { w: fp.size.w, h: fp.size.h }
      : b.displayArea.width > 0 && b.displayArea.height > 0
        ? { w: b.displayArea.width, h: b.displayArea.height }
        : { w: 2, h: 2 };
    const off = m ? imageOffset(m, b.orientation) : { x: 0, y: 0 };
    b.displayArea = { x: centre.x - off.x - size.w / 2, y: centre.y - off.y - size.h / 2, width: size.w, height: size.h };
  }
  /** ConnectionPoint.ConnectionLink: the connection this one is linked to. */
  private link(c: Conn): Conn {
    if (!c.brick || c.index >= c.brick.connexions.length) return NULL_CONN();
    const to = c.brick.connexions[c.index]!.linkedTo;
    return to ? (this.byId.get(to) ?? NULL_CONN()) : NULL_CONN();
  }
  private isFree(c: Conn): boolean {
    return isNull(this.link(c));
  }

  private addBone(c: Conn, brick: Brick, maxAngleDeg: number): void {
    const p = isNull(c) ? areaCentre(brick.displayArea) : this.world(c);
    this.bones.unshift({ localAngle: 0, maxAngle: (maxAngleDeg * Math.PI) / 180, worldX: p.x, worldY: -p.y, conn: c });
  }

  private follow(lead: { c: Conn }, flag: { v: boolean }): void {
    if (isNull(lead.c)) return;
    flag.v ||= connectionHingeAngle(this.type(lead.c)) !== 0;
    if (flag.v) {
      lead.c = NULL_CONN();
      return;
    }
    lead.c = this.link(lead.c);
    if (isNull(lead.c)) return;
    if (this.connectionCount(lead.c.brick!) === 2) lead.c = this.conn(lead.c.brick!, lead.c.index === 0 ? 1 : 0);
    else lead.c = NULL_CONN();
  }

  /** FlexMove.findStartingConnectionPoint */
  private startingConnection(list: Set<Brick>, g: Brick, mouse: Pt): Conn | null {
    const first = this.conn(g, 0);
    const second = this.conn(g, 1);
    const firstHinge = connectionHingeAngle(this.type(first));
    const secondHinge = connectionHingeAngle(this.type(second));
    if (firstHinge !== 0 && secondHinge === 0) return second;
    if (firstHinge === 0 && secondHinge !== 0) return first;
    if (firstHinge === 0 && secondHinge === 0) {
      const firstFlexible = { v: false };
      const secondFlexible = { v: false };
      const firstLead = { c: first };
      const secondLead = { c: second };
      const remaining = new Set(list);
      while ((!firstFlexible.v || !secondFlexible.v) && (!isNull(firstLead.c) || !isNull(secondLead.c))) {
        const firstBrick = firstLead.c.brick;
        const secondBrick = secondLead.c.brick;
        if (!firstBrick || !remaining.has(firstBrick)) firstLead.c = NULL_CONN();
        if (!secondBrick || !remaining.has(secondBrick)) secondLead.c = NULL_CONN();
        if (firstBrick) remaining.delete(firstBrick);
        if (secondBrick) remaining.delete(secondBrick);
        this.follow(firstLead, firstFlexible);
        this.follow(secondLead, secondFlexible);
      }
      if (firstFlexible.v && !secondFlexible.v) return second;
      if (!firstFlexible.v && secondFlexible.v) return first;
      if (!firstFlexible.v && !secondFlexible.v) return null;
    }
    const n1 = this.link(first).brick;
    const n2 = this.link(second).brick;
    const firstNeighbourIn = !!n1 && list.has(n1);
    const secondNeighbourIn = !!n2 && list.has(n2);
    if (firstNeighbourIn && !secondNeighbourIn) return second;
    if (!firstNeighbourIn && secondNeighbourIn) return first;
    const w1 = this.world(first);
    const w2 = this.world(second);
    const d1 = (w1.x - mouse.x) ** 2 + (w1.y - mouse.y) ** 2;
    const d2 = (w2.x - mouse.x) ** 2 + (w2.y - mouse.y) ** 2;
    return d1 < d2 ? first : second;
  }

  /** FlexMove.ceateFlexChain */
  private createChain(list: Set<Brick>, g: Brick, currentFirstIn: Conn): void {
    let current: Brick | null = g;
    let currentFirst = currentFirstIn;
    let hingedLink = -1; // counted from the chain's end: links are inserted at the front
    // Each brick once: links that lead round in a circle not through `g`
    // (two halves joined at both ends, entered by a stale link) would
    // otherwise grow the chain without end. BlueBrick trusted the links.
    const seen = new Set<Brick>([g]);
    this.addBone(currentFirst, g, 0);
    while (current && list.has(current) && (isNull(currentFirst) || this.connectionCount(current) === 2)) {
      const secondIndex = sameConn(currentFirst, this.conn(current, 0)) ? 1 : 0;
      const currentSecond = this.conn(current, secondIndex);
      const nextFirst = this.link(currentSecond);
      const next = nextFirst.brick;
      const l: ChainLink = { first: NULL_CONN(), second: currentSecond, angleBetween: 0 };
      if (!isNull(nextFirst)) {
        l.first = nextFirst;
        let a = Math.fround(this.angle(currentSecond) + 180 - this.angle(nextFirst));
        if (a >= 360) a -= 360;
        if (a < 0) a += 360;
        l.angleBetween = a;
      } else {
        l.first = { brick: null, index: -1, fixed: this.world(currentSecond) };
      }
      this.chain.unshift(l);
      if (hingedLink >= 0) ++hingedLink;
      const hinge = connectionHingeAngle(this.type(currentSecond));
      if (hinge !== 0) {
        hingedLink = 0;
        this.addBone(currentSecond, current, hinge);
        let deg = 0;
        if (next) deg = simplifyDegrees(Math.fround(next.orientation - current.orientation - l.angleBetween));
        this.bones[0]!.localAngle = (deg * Math.PI) / 180;
        this.initialStaticOrientation = next ? -next.orientation : -current.orientation;
      }
      current = next;
      currentFirst = nextFirst;
      if (current === g) break;
      if (current && seen.has(current)) break;
      if (current) seen.add(current);
    }
    if (hingedLink >= 0) this.rootLink = hingedLink;
    if (this.chain.length === 0 || this.rootLink < 0 || this.rootLink >= this.chain.length) {
      this.chain = [];
      return; // no chain: start() says so
    }

    if (this.bones.length > 2) {
      const last = this.bones.length - 1;
      this.lastBoneVector = { x: this.bones[last - 1]!.worldX - this.bones[last]!.worldX, y: this.bones[last - 1]!.worldY - this.bones[last]!.worldY };
      const lastConn = this.bones[last]!.conn;
      if (!isNull(lastConn)) this.lastBoneVector = rotateVector(this.lastBoneVector, lastConn.brick!.orientation);
    }

    const root = this.chain[this.rootLink]!.first;
    if (root.brick) this.chainBricks.push(root.brick);
    for (let i = this.rootLink; i < this.chain.length; i++) this.chainBricks.push(this.chain[i]!.second.brick!);
  }

  /** FlexMove.computeBrickPositionAndOrientation */
  private place(): void {
    let boneIndex = 0;
    let flexible = 0;
    let rigid = this.initialStaticOrientation;
    for (let li = this.rootLink; li < this.chain.length; li++) {
      const l = this.chain[li]!;
      const previous = this.world(l.first);
      const brick = l.second.brick!;
      if (boneIndex < this.bones.length && sameConn(l.second, this.bones[boneIndex]!.conn)) {
        this.bones[boneIndex]!.worldX = previous.x;
        this.bones[boneIndex]!.worldY = -previous.y;
        flexible = Math.fround(flexible + Math.fround((this.bones[boneIndex]!.localAngle * 180) / Math.PI));
        ++boneIndex;
      }
      rigid = Math.fround(rigid + l.angleBetween);
      brick.orientation = Math.fround(-flexible - rigid);
      const cp = this.metaOf(brick)!.connections[l.second.index]!;
      const r = rotateVector(cp, brick.orientation);
      this.placeByImageCentre(brick, { x: previous.x - r.x, y: previous.y - r.y });
    }
    if (this.bones.length > 0) {
      const last = this.bones[this.bones.length - 1]!;
      let p: Pt = { x: 0, y: 0 };
      if (!isNull(last.conn)) p = this.world(last.conn);
      else if (this.bones.length > 1) p = areaCentre(this.bones[this.bones.length - 2]!.conn.brick!.displayArea);
      last.worldX = p.x;
      last.worldY = -p.y;
    }
  }

  /** FlexMove.reachTarget + update(), run until the solver settles. */
  private reach(target: Pt, targetConn: Conn): void {
    this.primaryTarget = target;
    this.useTwoTargets = !isNull(targetConn);
    if (this.useTwoTargets) {
      const v = rotateVector(this.lastBoneVector, targetConn.brick!.orientation + this.angle(targetConn) + 180);
      this.secondaryTarget = { x: target.x + v.x, y: target.y + v.y };
    }
    this.status = Ccd.Processing;
    // BlueBrick's 0.1 stud; tighter when joining a connection, so the end
    // also faces it (the second target sets its direction).
    const precision = this.useTwoTargets ? 0.02 : 0.1; // studs
    const count = this.bones.length;
    for (let step = 0; step < 5000 && this.status === Ccd.Processing; step++) {
      let second = Ccd.Success;
      if (this.useTwoTargets) {
        second = solveCcd(this.bones, this.secondaryTarget.x, -this.secondaryTarget.y, precision, count - 1);
        this.place();
      }
      this.status = solveCcd(this.bones, this.primaryTarget.x, -this.primaryTarget.y, precision, count);
      this.place();
      // Joining a connection: done once the end also faces it (BlueBrick
      // stopped at the position alone, often a few degrees off).
      if (this.status === Ccd.Success && second === Ccd.Processing) this.status = Ccd.Processing;
    }
  }
}

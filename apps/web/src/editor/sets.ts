// Sets from the parts library (a <group> XML, such as flex.group) as real
// BlueBrick groups — the desktop's core/Groups.h and edit/Sets.cpp. An
// item (brick or group) names its parent group with `myGroup`; a group
// from the library has a part number, a user's group none.

import type { BbmMap, Brick, Group, LayerBrick } from '@cld/model';
import type { SidecarModule } from '@cld/bbm';
import { connectionHingeAngle } from '@cld/parts-catalog/browser';
import type { PartWire } from '../api';
import { areaSize, connectionWorld, pivotOf, rotated, type Pt } from './brickGeometry';

type Parts = ReadonlyMap<string, PartWire>;
const partOf = (parts: Parts, key: string) => parts.get(key.toLowerCase());

/** `id` and its parents, innermost first (cycles and dangling ids stop it). */
export function groupChain(groups: readonly Group[] | undefined, id: string | undefined): Group[] {
  if (!groups || groups.length === 0 || !id) return [];
  const byId = new Map(groups.map((g) => [g.id, g]));
  const chain: Group[] = [];
  const seen = new Set<string>();
  let cur: string | undefined = id;
  while (cur && !seen.has(cur) && chain.length < 64) {
    const g = byId.get(cur);
    if (!g) break;
    seen.add(cur);
    chain.push(g);
    cur = g.myGroup;
  }
  return chain;
}

/** The outermost group above an item whose parent is `id`, or ''. */
export function topGroupId(groups: readonly Group[] | undefined, id: string | undefined): string {
  const chain = groupChain(groups, id);
  return chain.length > 0 ? chain[chain.length - 1]!.id : '';
}

/** Ids of every brick of `layer` under the same outermost group as `brick` (just itself when loose). */
export function groupMates(layer: Pick<LayerBrick, 'bricks' | 'groups'>, brick: Pick<Brick, 'id' | 'myGroup'>): string[] {
  const top = topGroupId(layer.groups, brick.myGroup);
  if (!top) return [brick.id];
  return layer.bricks.filter((b) => topGroupId(layer.groups, b.myGroup) === top).map((b) => b.id);
}

/** `ids` with every brick of the same outermost groups (a set picks whole, as in BlueBrick). */
export function expandToGroups(ids: readonly string[], map: Pick<BbmMap, 'layers'> | null | undefined): string[] {
  if (!map || ids.length === 0) return [...ids];
  const want = new Set(ids);
  const out = [...ids];
  for (const layer of map.layers) {
    if (layer.type !== 'brick' || !layer.groups?.length) continue;
    const tops = new Set<string>();
    for (const b of layer.bricks) if (want.has(b.id) && b.myGroup) tops.add(topGroupId(layer.groups, b.myGroup));
    tops.delete('');
    if (tops.size === 0) continue;
    for (const b of layer.bricks)
      if (!want.has(b.id) && b.myGroup && tops.has(topGroupId(layer.groups, b.myGroup))) {
        want.add(b.id);
        out.push(b.id);
      }
  }
  return out;
}

/**
 * BlueBrick's LibraryBrickList: the part numbers a part list or a budget
 * counts — a set once (its top named group, TopNamedItem), a loose brick
 * by itself.
 */
export function libraryItems(layer: Pick<LayerBrick, 'bricks' | 'groups'>): string[] {
  const out: string[] = [];
  const counted = new Set<string>();
  for (const b of layer.bricks) {
    let named: Group | null = null;
    for (const g of groupChain(layer.groups, b.myGroup)) {
      if (!g.partNumber) break;
      named = g;
    }
    if (!named) out.push(b.partNumber);
    else if (!counted.has(named.id)) {
      counted.add(named.id);
      out.push(named.partNumber!);
    }
  }
  return out;
}

/**
 * Copies of `source`'s groups above `bricks` (copies still naming the old
 * groups) under fresh ids; returns the bricks moved to the new ids.
 */
export function cloneGroups<T extends { myGroup?: string }>(
  source: readonly Group[],
  bricks: readonly T[],
  newId: () => string,
): { bricks: T[]; groups: Group[] } {
  const renamed = new Map<string, string>();
  const groups: Group[] = [];
  const out = bricks.map((b) => {
    const chain = groupChain(source, b.myGroup);
    for (const g of chain) {
      if (renamed.has(g.id)) continue;
      renamed.set(g.id, newId());
      groups.push({ ...g, id: renamed.get(g.id)! });
    }
    return { ...b, myGroup: chain.length > 0 ? renamed.get(chain[0]!.id)! : '' };
  });
  for (const g of groups) g.myGroup = (g.myGroup && renamed.get(g.myGroup)) || '';
  return { bricks: out, groups };
}

export interface SetBrick {
  partNumber: string;
  displayArea: { x: number; y: number; width: number; height: number };
  orientation: number;
  myGroup: string;
}

export interface ExpandedSet {
  bricks: SetBrick[];
  /** The outermost group first. */
  groups: Group[];
}

const normalised = (deg: number) => {
  let a = deg % 360;
  if (a > 180) a -= 360;
  if (a <= -180) a += 360;
  return a;
};
const angleGap = (a: number, b: number) => Math.abs(normalised(a - b));

/**
 * `key` placed with its set-local origin at `centre` (studs), turned
 * `angle` degrees, as BlueBrick's Group(string) constructor builds it:
 * every sub-part at its world transform (its XML position is its box
 * centre), nested sets as child groups. Empty when `key` isn't a set.
 * `sizeOf` gives a part's box at an angle (default: its footprint).
 */
export function expandSet(
  parts: Parts,
  key: string,
  centre: Pt,
  angle: number,
  newId: () => string,
  sizeOf: (part: PartWire | undefined, angle: number) => { width: number; height: number } = (p, a) => areaSize(p, a),
): ExpandedSet {
  const out: ExpandedSet = { bricks: [], groups: [] };
  const top = partOf(parts, key);
  if (!top || top.kind !== 'group' || top.subparts.length === 0) return out;
  const visit = (set: PartWire, at: Pt, turn: number, parent: string, depth: number) => {
    const group: Group = { id: newId(), partNumber: set.key.toUpperCase(), myGroup: parent };
    out.groups.push(group);
    for (const sp of set.subparts) {
      const r = rotated({ x: sp.x, y: sp.y }, turn);
      const pos = { x: at.x + r.x, y: at.y + r.y };
      const turned = turn + sp.angle;
      const sub = partOf(parts, sp.subKey);
      if (sub && sub.kind === 'group' && depth < 16) {
        visit(sub, pos, turned, group.id, depth + 1);
        continue;
      }
      const orientation = normalised(turned);
      const size = sizeOf(sub, orientation);
      out.bricks.push({
        partNumber: sub ? sub.key.toUpperCase() : sp.subKey.toUpperCase(),
        displayArea: { x: pos.x - size.width / 2, y: pos.y - size.height / 2, width: size.width, height: size.height },
        orientation,
        myGroup: group.id,
      });
    }
  };
  visit(top, centre, angle, '', 0);
  return out;
}

/** A module that is exactly one placed set. */
export interface SetModule {
  moduleId: string;
  setKey: string;
  layerId: string;
  groups: Group[];
  /** Member brick id → its group. */
  parentOf: Map<string, string>;
}

type Member = Pick<Brick, 'id' | 'partNumber' | 'displayArea' | 'orientation' | 'connexions'>;

function matchByLayout(parts: Parts, leaves: readonly SetBrick[], members: readonly Member[]): number[] | null {
  // Sprite centres: unlike the box centre, they turn with the part.
  const centre = (b: Pick<Brick, 'displayArea' | 'orientation' | 'partNumber'>) => pivotOf(b, partOf(parts, b.partNumber));
  const first = leaves[0]!;
  const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
  for (const anchor of members) {
    if (!same(anchor.partNumber, first.partNumber)) continue;
    const turn = anchor.orientation - first.orientation;
    const fc = rotated(centre(first), turn);
    const ac = centre(anchor);
    const shift = { x: ac.x - fc.x, y: ac.y - fc.y };
    const used = new Array<boolean>(members.length).fill(false);
    const pick: number[] = [];
    let ok = true;
    for (const leaf of leaves) {
      const w = rotated(centre(leaf), turn);
      const want = { x: w.x + shift.x, y: w.y + shift.y };
      const m = members.findIndex(
        (mb, i) =>
          !used[i] &&
          same(mb.partNumber, leaf.partNumber) &&
          Math.hypot(centre(mb).x - want.x, centre(mb).y - want.y) <= 0.02 &&
          angleGap(mb.orientation, leaf.orientation + turn) <= 0.1,
      );
      if (m < 0) { ok = false; break; }
      used[m] = true;
      pick.push(m);
    }
    if (ok) return pick;
  }
  return null;
}

/** A set of distinct parts joined by hinges: each joint linked between the members, bent within its hinge angle. */
function matchByJoints(parts: Parts, leaves: readonly SetBrick[], members: readonly Member[]): number[] | null {
  const pick: number[] = [];
  for (const leaf of leaves) {
    const found = members.flatMap((m, i) => (m.partNumber.toLowerCase() === leaf.partNumber.toLowerCase() ? [i] : []));
    if (found.length !== 1) return null;
    pick.push(found[0]!);
  }
  let joints = 0;
  let hinged = false;
  for (let a = 0; a < leaves.length; a++) {
    const pa = partOf(parts, leaves[a]!.partNumber);
    if (!pa) return null;
    for (let b = a + 1; b < leaves.length; b++) {
      const pb = partOf(parts, leaves[b]!.partNumber);
      if (!pb) return null;
      for (let i = 0; i < pa.connections.length; i++) {
        for (let j = 0; j < pb.connections.length; j++) {
          const type = pa.connections[i]!.type;
          if (!type || type !== pb.connections[j]!.type) continue;
          const wa = connectionWorld(leaves[a]!, pa, i);
          const wb = connectionWorld(leaves[b]!, pb, j);
          if (Math.hypot(wa.x - wb.x, wa.y - wb.y) > 0.05) continue;
          const A = members[pick[a]!]!;
          const B = members[pick[b]!]!;
          const link = A.connexions[i]?.linkedTo;
          if (!link || link !== B.connexions[j]?.id) return null;
          const hinge = connectionHingeAngle(type);
          hinged ||= hinge > 0;
          const setTurn = leaves[b]!.orientation - leaves[a]!.orientation;
          if (angleGap(B.orientation - A.orientation, setTurn) > hinge + 0.1) return null;
          joints++;
        }
      }
    }
  }
  return hinged && joints >= leaves.length - 1 ? pick : null;
}

const defaultLook = (m: SidecarModule) =>
  !m.pinned && m.showName !== false && !m.outlineColor && !m.nameColor && m.sameColor !== false && !m.sourceFile;

/**
 * Modules that older versions made of placed sets and that are still
 * exactly one: one brick layer; the set's parts (through nested sets) and
 * nothing else, none already grouped; at the set's relative positions and
 * angles (0.02 stud, 0.1 degree), or for a set of distinct parts joined
 * by hinges (flex track), linked at each joint and bent within its hinge
 * angle; still named after the set; unpinned, with the default look.
 */
export function findSetModules(map: BbmMap, modules: readonly SidecarModule[], parts: Parts, newId: () => string): SetModule[] {
  const out: SetModule[] = [];
  if (modules.length === 0) return out;
  const setsByName = new Map<string, string[]>();
  const add = (name: string, key: string) => {
    const k = name.trim().toLowerCase();
    if (k) setsByName.set(k, [...(setsByName.get(k) ?? []), key]);
  };
  for (const p of parts.values()) {
    if (p.kind !== 'group' || p.subparts.length === 0) continue;
    add(p.key, p.key);
    add(p.description, p.key);
  }
  for (const mod of modules) {
    if (!defaultLook(mod) || mod.members.length === 0) continue;
    const candidates = [...new Set(setsByName.get(mod.name.trim().toLowerCase()) ?? [])];
    if (candidates.length === 0) continue;
    const ids = new Set(mod.members);
    let layerId = '';
    const members: Member[] = [];
    let ok = true;
    for (const layer of map.layers) {
      if (layer.type !== 'brick') continue;
      for (const b of layer.bricks) {
        if (!ids.has(b.id)) continue;
        if ((layerId && layerId !== layer.id) || b.myGroup) ok = false;
        layerId = layer.id;
        members.push(b);
      }
    }
    if (!ok || members.length !== ids.size) continue;
    for (const key of candidates) {
      const set = expandSet(parts, key, { x: 0, y: 0 }, 0, newId);
      if (set.bricks.length !== members.length) continue;
      const want = set.bricks.map((b) => b.partNumber.toUpperCase()).sort();
      const have = members.map((b) => b.partNumber.toUpperCase()).sort();
      if (want.join('\n') !== have.join('\n')) continue;
      const pick = matchByLayout(parts, set.bricks, members) ?? matchByJoints(parts, set.bricks, members);
      if (!pick) continue;
      out.push({
        moduleId: mod.id,
        setKey: key,
        layerId,
        groups: set.groups,
        parentOf: new Map(set.bricks.map((b, l) => [members[pick[l]!]!.id, b.myGroup])),
      });
      break;
    }
  }
  return out;
}

/**
 * What Ungroup would do to `selection`: nothing grouped, split something,
 * or only sets that are always used whole (`canUngroup` says no).
 */
export function ungroupState(
  map: Pick<BbmMap, 'layers'> | null | undefined,
  selection: readonly string[],
  canUngroup: (group: Group) => boolean,
): 'nothing' | 'splits' | 'whole' {
  if (!map) return 'nothing';
  const want = new Set(selection);
  let grouped = false;
  for (const layer of map.layers) {
    if (layer.type !== 'brick' || !layer.groups?.length) continue;
    for (const b of layer.bricks) {
      if (!want.has(b.id) || !b.myGroup) continue;
      const top = layer.groups.find((g) => g.id === topGroupId(layer.groups, b.myGroup));
      if (!top) continue;
      grouped = true;
      if (canUngroup(top)) return 'splits';
    }
  }
  return grouped ? 'whole' : 'nothing';
}

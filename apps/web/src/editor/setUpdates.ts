// Placed custom sets keep track of the set's version, like modules from the
// Module library: the sidecar's `sets` (never the .bbm) says which version
// of the set each placed copy (its outermost group) came from, and one of
// its parts with where that part sits in the set. When the set changes on
// the server (its parts, where they sit, or its name), the catalog's
// `setVersion` differs and the layout says "Update available" for that copy.
// Updating replaces the copy's parts with the set's current ones where the
// copy sits now, in one undo step; nothing updates by itself. Library sets
// (bundled with the app) have no version and aren't tracked. The desktop
// does the same (edit/SetUpdates.cpp).

import * as Y from 'yjs';
import type { BbmMap, Brick, Group, LayerBrick } from '@cld/model';
import type { PlacedSet, SidecarModule } from '@cld/bbm';
import { readSidecarCache, writeSidecarCache } from '@cld/ydoc';
import type { PartWire } from '../api';
import { areaCentre, areaSize, rotated, type Pt } from './brickGeometry';
import { LOCAL_ORIGIN } from './useLayoutDoc';
import { expandSet, groupChain } from './sets';

type Parts = ReadonlyMap<string, PartWire>;

/** A custom set with a version: the ones placed copies keep track of. */
export function trackedSet(parts: Parts, key: string | undefined): PartWire | null {
  if (!key) return null;
  const p = parts.get(key.toLowerCase());
  return p && p.kind === 'group' && p.source === 'custom' && p.setVersion ? p : null;
}

/** Where the first part of set `key` sits in the set (its box centre and turn), or null. */
export function setAnchorPose(parts: Parts, key: string, sizeOf?: Parameters<typeof expandSet>[5]): { x: number; y: number; angle: number } | null {
  let n = 0;
  const first = expandSet(parts, key, { x: 0, y: 0 }, 0, () => `a${n++}`, sizeOf).bricks[0];
  if (!first) return null;
  const c = areaCentre(first.displayArea);
  return { x: c.x, y: c.y, angle: first.orientation };
}

/** The link for a copy of `set` just placed as group `groupId`, its first part `firstBrickId`. */
export function placedSetLink(parts: Parts, set: PartWire, groupId: string, firstBrickId: string | undefined): PlacedSet | null {
  if (!set.setVersion || !groupId) return null;
  const pose = firstBrickId ? setAnchorPose(parts, set.key) : null;
  return { id: groupId, version: set.setVersion, ...(pose && firstBrickId ? { anchor: { brick: firstBrickId, ...pose } } : {}) };
}

export function getPlacedSets(cache: Record<string, unknown> | null | undefined): PlacedSet[] {
  const list = cache?.sets;
  return Array.isArray(list) ? (list as PlacedSet[]).filter((s) => s && typeof s.id === 'string' && typeof s.version === 'string') : [];
}

/** Add or replace these links in the sidecar. Call inside a transaction. */
export function writePlacedSets(doc: Y.Doc, links: readonly PlacedSet[]): void {
  if (links.length === 0) return;
  const cache = readSidecarCache(doc) ?? {};
  const ids = new Set(links.map((l) => l.id));
  writeSidecarCache(doc, { ...cache, sets: [...getPlacedSets(cache).filter((s) => !ids.has(s.id)), ...links] });
}

/** Record links for copies just placed, as its own step (merged into the placing one by the undo manager). */
export function recordPlacedSets(doc: Y.Doc, links: readonly PlacedSet[]): void {
  if (links.length === 0) return;
  doc.transact(() => writePlacedSets(doc, links), LOCAL_ORIGIN);
}

/** The links by their anchor part, for copying: a copy of an anchor part brings its set's link along. */
export function linksByAnchor(cache: Record<string, unknown> | null | undefined): Map<string, PlacedSet> {
  return new Map(getPlacedSets(cache).flatMap((l) => (l.anchor ? [[l.anchor.brick, l] as const] : [])));
}

/**
 * Parts just copied (Duplicate, Paste) that were the anchor part of a placed
 * set (`copies`: each copy and its original's link) give the copy of that
 * set its own link, to the group the copy is in now. Call inside the
 * copying transaction.
 */
export function copyPlacedSets(doc: Y.Doc, copies: ReadonlyArray<{ brick: string; link: PlacedSet }>): void {
  const added: PlacedSet[] = [];
  for (const { brick, link } of copies) {
    const group = topGroupOfBrick(doc, brick);
    if (group && link.anchor) added.push({ ...link, id: group, anchor: { ...link.anchor, brick } });
  }
  writePlacedSets(doc, added);
}

function topGroupOfBrick(doc: Y.Doc, brickId: string): string {
  const layerData = doc.getMap('layerData');
  for (const layerId of doc.getArray<string>('layers').toArray()) {
    const l = layerData.get(layerId);
    if (!(l instanceof Y.Map)) continue;
    const bricks = l.get('bricks');
    const groups = l.get('groups');
    if (!(bricks instanceof Y.Array)) continue;
    let myGroup = '';
    bricks.forEach((b) => {
      if (b instanceof Y.Map && b.get('id') === brickId) myGroup = (b.get('myGroup') as string) || '';
    });
    if (!myGroup) continue;
    const list: Group[] = [];
    if (groups instanceof Y.Array) {
      groups.forEach((g) => {
        if (g instanceof Y.Map) list.push({ id: g.get('id') as string, myGroup: (g.get('myGroup') as string) || '', ...(g.get('partNumber') ? { partNumber: g.get('partNumber') as string } : {}) });
      });
    }
    // The set's own group: the outermost one with a part number below any group of the user's.
    const chain = groupChain(list, myGroup);
    let named = '';
    for (const g of chain) {
      if (!g.partNumber) break;
      named = g.id;
    }
    return named;
  }
  return '';
}

/** A placed copy of a set whose set has changed since. */
export interface SetUpdate {
  link: PlacedSet;
  layerId: string;
  group: Group;
  set: PartWire;
  /** The set's name, for menus and notices. */
  name: string;
}

/** Every placed copy whose set has a newer version than it came from. */
export function findSetUpdates(map: Pick<BbmMap, 'layers'> | null | undefined, cache: Record<string, unknown> | null | undefined, parts: Parts): SetUpdate[] {
  const links = getPlacedSets(cache);
  if (!map || links.length === 0) return [];
  const where = new Map<string, { layerId: string; group: Group }>();
  for (const l of map.layers) {
    if (l.type !== 'brick') continue;
    for (const g of l.groups ?? []) where.set(g.id, { layerId: l.id, group: g });
  }
  const out: SetUpdate[] = [];
  for (const link of links) {
    const at = where.get(link.id);
    if (!at) continue;
    const set = trackedSet(parts, at.group.partNumber);
    if (!set || set.setVersion === link.version) continue;
    out.push({ link, layerId: at.layerId, group: at.group, set, name: set.description || set.partNumber });
  }
  return out;
}

/** The update for the set `ids` are exactly the parts of, if it has one. */
export function updateForSelection(map: Pick<BbmMap, 'layers'> | null | undefined, updates: readonly SetUpdate[], ids: readonly string[]): SetUpdate | null {
  if (!map || ids.length === 0 || updates.length === 0) return null;
  const want = new Set(ids);
  for (const u of updates) {
    const layer = map.layers.find((l): l is LayerBrick => l.id === u.layerId && l.type === 'brick');
    if (!layer) continue;
    const members = layer.bricks.filter((b) => inside(layer.groups, b, u.group.id));
    if (members.length > 0 && members.length === want.size && members.every((b) => want.has(b.id))) return u;
  }
  return null;
}

function inside(groups: readonly Group[] | undefined, b: Pick<Brick, 'myGroup'>, groupId: string): boolean {
  return groupChain(groups, b.myGroup).some((g) => g.id === groupId);
}

/**
 * Where the copy sits now: its set-local origin and turn. From its anchor
 * part when that's still there; else from a part matching one of the
 * set's parts by number; else its parts' middle, unturned.
 */
export function placedSetPose(layer: Pick<LayerBrick, 'bricks' | 'groups'>, u: Pick<SetUpdate, 'link' | 'group' | 'set'>, parts: Parts): { centre: Pt; angle: number } {
  const members = layer.bricks.filter((b) => inside(layer.groups, b, u.group.id));
  const fromPart = (b: Brick, local: { x: number; y: number; angle: number }) => {
    const angle = b.orientation - local.angle;
    const r = rotated({ x: local.x, y: local.y }, angle);
    const c = areaCentre(b.displayArea);
    return { centre: { x: c.x - r.x, y: c.y - r.y }, angle };
  };
  const anchor = u.link.anchor;
  const a = anchor ? members.find((b) => b.id === anchor.brick) : undefined;
  if (anchor && a) return fromPart(a, anchor);
  // No anchor: the first of its parts that the set (as it is now) has too.
  let n = 0;
  const leaves = expandSet(parts, u.set.key, { x: 0, y: 0 }, 0, () => `p${n++}`).bricks;
  for (const b of members) {
    const leaf = leaves.find((l) => l.partNumber.toLowerCase() === b.partNumber.toLowerCase());
    if (leaf) {
      const c = areaCentre(leaf.displayArea);
      return fromPart(b, { x: c.x, y: c.y, angle: leaf.orientation });
    }
  }
  if (members.length === 0) return { centre: { x: 0, y: 0 }, angle: 0 };
  const mid = members.reduce((acc, b) => {
    const c = areaCentre(b.displayArea);
    return { x: acc.x + c.x / members.length, y: acc.y + c.y / members.length };
  }, { x: 0, y: 0 });
  return { centre: mid, angle: 0 };
}

/**
 * Update a placed copy: its parts become the set's current ones, where it
 * sits now (place and turn), in ONE transaction (one undo step). The copy
 * keeps its group id (and its place in a group of yours), so labels on it
 * and its link stay; a module it was in gets the new parts. Returns the new
 * part ids. Connections are made again by the caller's connectivity pass.
 */
export function applySetUpdate(
  doc: Y.Doc,
  map: Pick<BbmMap, 'layers'>,
  u: SetUpdate,
  parts: Parts,
  newId: () => string,
  sizeOf: Parameters<typeof expandSet>[5] = (p, a) => areaSize(p, a),
): string[] {
  const layer = map.layers.find((l): l is LayerBrick => l.id === u.layerId && l.type === 'brick');
  if (!layer) return [];
  const pose = placedSetPose(layer, u, parts);
  const expanded = expandSet(parts, u.set.key, pose.centre, pose.angle, newId, sizeOf);
  if (expanded.bricks.length === 0) return [];
  // The outermost group keeps the copy's id and parent.
  const topNew = expanded.groups[0]!.id;
  const groups = expanded.groups.map((g, i) => (i === 0 ? { ...g, id: u.group.id, myGroup: u.group.myGroup ?? '' } : { ...g, myGroup: g.myGroup === topNew ? u.group.id : g.myGroup }));
  const bricks = expanded.bricks.map((b) => ({ ...b, myGroup: b.myGroup === topNew ? u.group.id : b.myGroup }));
  const oldBricks = new Set(layer.bricks.filter((b) => inside(layer.groups, b, u.group.id)).map((b) => b.id));
  const oldGroups = new Set((layer.groups ?? []).filter((g) => g.id !== u.group.id && groupChain(layer.groups, g.id).some((x) => x.id === u.group.id)).map((g) => g.id));
  const ids: string[] = [];
  doc.transact(() => {
    const l = doc.getMap('layerData').get(u.layerId);
    if (!(l instanceof Y.Map)) return;
    const yBricks = l.get('bricks');
    const yGroups = l.get('groups');
    if (!(yBricks instanceof Y.Array) || !(yGroups instanceof Y.Array)) return;
    // Where its first old part was, so the new parts keep their place in the drawing order.
    let at = -1;
    for (let i = yBricks.length - 1; i >= 0; i--) {
      const b = yBricks.get(i);
      if (b instanceof Y.Map && oldBricks.has(b.get('id') as string)) {
        yBricks.delete(i, 1);
        at = i;
      }
    }
    for (let i = yGroups.length - 1; i >= 0; i--) {
      const g = yGroups.get(i);
      if (g instanceof Y.Map && (oldGroups.has(g.get('id') as string) || g.get('id') === u.group.id)) yGroups.delete(i, 1);
    }
    const yNew = bricks.map((b) => {
      const id = newId();
      ids.push(id);
      const y = new Y.Map<unknown>();
      y.set('id', id);
      y.set('displayArea', { ...b.displayArea });
      y.set('myGroup', b.myGroup);
      y.set('partNumber', b.partNumber);
      y.set('orientation', b.orientation);
      y.set('activeConnectionPointIndex', 0);
      y.set('altitude', 0);
      y.set('connexions', []);
      return y;
    });
    yBricks.insert(at >= 0 ? Math.min(at, yBricks.length) : yBricks.length, yNew);
    yGroups.push(
      groups.map((g) => {
        const y = new Y.Map<unknown>();
        y.set('id', g.id);
        if (g.partNumber !== undefined) y.set('partNumber', g.partNumber);
        y.set('myGroup', g.myGroup ?? '');
        return y;
      }),
    );
    // The link: the new version, and the new first part as its anchor.
    const cache = readSidecarCache(doc) ?? {};
    const pose0 = setAnchorPose(parts, u.set.key, sizeOf);
    const link: PlacedSet = { ...u.link, version: u.set.setVersion!, ...(pose0 && ids[0] ? { anchor: { brick: ids[0], ...pose0 } } : {}) };
    if (!(pose0 && ids[0])) delete link.anchor;
    // A module it was in: the new parts take the old ones' place.
    const modules = (Array.isArray(cache.modules) ? (cache.modules as SidecarModule[]) : []).map((m) =>
      m.members.some((id) => oldBricks.has(id)) ? { ...m, members: [...m.members.filter((id) => !oldBricks.has(id)), ...ids] } : m,
    );
    writeSidecarCache(doc, {
      ...cache,
      ...(Array.isArray(cache.modules) ? { modules } : {}),
      sets: [...getPlacedSets(cache).filter((s) => s.id !== u.link.id), link],
    });
  }, LOCAL_ORIGIN);
  return ids;
}

// Library sets as BlueBrick groups (sets.ts): placing one, grouping and
// ungrouping around it, counting it, copying it, saving it, and turning
// the modules older versions made of placed sets back into sets — the
// desktop's SetsTest.

import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import type { BbmMap, LayerBrick } from '@cld/model';
import { readBbm, writeBbm } from '@cld/bbm/browser';
import { createDefaultLayoutDoc, docToBbm, readSidecarFromDoc } from '@cld/ydoc';
import type { PartWire } from '../../api';
import {
  createSidecarModule,
  groupBricksAcrossLayers,
  insertSet,
  makeId,
  makeSetsOfModules,
  ungroupBricksAcrossLayers,
  updateSidecarModule,
} from '../mutations';
import { catalogFromParts, recomputeConnectivity } from '../useConnectivity';
import { LOCAL_ORIGIN } from '../useLayoutDoc';
import { buildPartList } from '../partList';
import { cloneGroups, expandSet, expandToGroups, findSetModules, libraryItems, ungroupState } from '../sets';

const part = (key: string, connections: unknown[], extra: Partial<PartWire> = {}) =>
  ({
    key,
    partNumber: key.split('.')[0],
    colorCode: key.split('.')[1] ?? '',
    kind: 'leaf',
    description: key,
    pxPerStud: 8,
    hullPts: [],
    connections,
    subparts: [],
    spriteSize: { w: 18, h: 32 },
    ...extra,
  }) as unknown as PartWire;
// 88492.8 / 88493.8 and flex.group from BlueBrickParts (studs).
const FEMALE = part('88492.8', [
  { type: '1', x: -1.15, y: 0, angle: 180, electricPlug: 0 },
  { type: 'flexpivot', x: 0.85, y: 0, angle: 0, electricPlug: 0 },
]);
const MALE = part('88493.8', [
  { type: '1', x: 1.25, y: 0, angle: 0, electricPlug: 0 },
  { type: 'flexpivot', x: -0.75, y: 0, angle: 180, electricPlug: 0 },
]);
const FLEX = part('flex.group', [], {
  kind: 'group',
  description: 'Flex Track',
  canUngroup: false,
  subparts: [
    { subKey: '88492.8', x: -0.8, y: 0, angle: 0 },
    { subKey: '88493.8', x: 0.8, y: 0, angle: 0 },
  ],
} as Partial<PartWire>);
const HOUSE = part('house.group', [], { kind: 'group', description: 'House', subparts: [{ subKey: '88492.8', x: 0, y: 0, angle: 90 }] } as Partial<PartWire>);
const TOWN = part('town.group', [], {
  kind: 'group',
  description: 'Town',
  subparts: [
    { subKey: 'house.group', x: 10, y: 0, angle: 90 },
    { subKey: '88493.8', x: 0, y: 0, angle: 0 },
  ],
} as Partial<PartWire>);
const PARTS = new Map([FEMALE, MALE, FLEX, HOUSE, TOWN].map((p) => [p.key, p]));
const canUngroup = (g: { partNumber?: string }) => !g.partNumber || PARTS.get(g.partNumber.toLowerCase())?.canUngroup !== false;

function newDoc() {
  const doc = createDefaultLayoutDoc();
  const layerId = docToBbm(doc).layers.find((l) => l.type === 'brick')!.id;
  return { doc, layerId };
}
const layerOf = (doc: Y.Doc) => docToBbm(doc).layers.find((l): l is LayerBrick => l.type === 'brick')!;

function place(doc: Y.Doc, layerId: string, key: string, at: { x: number; y: number }) {
  const ids = insertSet(doc, layerId, expandSet(PARTS, key, at, 0, makeId));
  recomputeConnectivity(doc, catalogFromParts([...PARTS.values()]));
  return ids;
}

/** What an older version made of a placed set: loose parts in a module. */
function placeAsModule(doc: Y.Doc, layerId: string, at: { x: number; y: number }, name: string, turn = 0) {
  const set = expandSet(PARTS, 'flex.group', at, turn, makeId);
  const ids = insertSet(doc, layerId, { bricks: set.bricks.map((b) => ({ ...b, myGroup: '' })), groups: [] });
  createSidecarModule(doc, name, ids);
  recomputeConnectivity(doc, catalogFromParts([...PARTS.values()]));
  return ids;
}

describe('placing a set', () => {
  it('is one named group of its parts, its joint linked', () => {
    const { doc, layerId } = newDoc();
    place(doc, layerId, 'flex.group', { x: 10, y: 10 });
    const L = layerOf(doc);
    expect(L.groups.map((g) => g.partNumber)).toEqual(['FLEX.GROUP']);
    expect(L.bricks.map((b) => [b.partNumber, b.myGroup])).toEqual([
      ['88492.8', L.groups[0]!.id],
      ['88493.8', L.groups[0]!.id],
    ]);
    expect(L.bricks[0]!.displayArea.x + L.bricks[0]!.displayArea.width / 2).toBeCloseTo(9.2);
    expect(L.bricks[0]!.connexions[1]!.linkedTo).toBe(L.bricks[1]!.connexions[1]!.id);
    expect(readSidecarFromDoc(doc)?.modules ?? []).toEqual([]);
  });

  it('makes a nested set a child group, and a click picks the whole', () => {
    const { doc, layerId } = newDoc();
    place(doc, layerId, 'town.group', { x: 0, y: 0 });
    const L = layerOf(doc);
    const outer = L.groups.find((g) => !g.myGroup)!;
    const inner = L.groups.find((g) => g.myGroup)!;
    expect([outer.partNumber, inner.partNumber, inner.myGroup]).toEqual(['TOWN.GROUP', 'HOUSE.GROUP', outer.id]);
    // The house's part sits at the town's (10, 0), turned 90 + 90.
    const house = L.bricks.find((b) => b.myGroup === inner.id)!;
    expect(house.orientation).toBeCloseTo(180);
    expect(house.displayArea.x + house.displayArea.width / 2).toBeCloseTo(10);
    expect(expandToGroups([house.id], docToBbm(doc)).sort()).toEqual(L.bricks.map((b) => b.id).sort());
    expect(libraryItems(L)).toEqual(['TOWN.GROUP']);
  });
});

describe('counting', () => {
  it('lists a set once, not its halves', () => {
    const { doc, layerId } = newDoc();
    place(doc, layerId, 'flex.group', { x: 0, y: 0 });
    place(doc, layerId, 'flex.group', { x: 0, y: 20 });
    const [group] = buildPartList(docToBbm(doc), PARTS);
    expect(group!.rows.map((r) => [r.partNumber, r.count])).toEqual([['FLEX.GROUP', 2]]);
  });
});

describe('group and ungroup around sets', () => {
  it('keeps the sets whole inside a group, and never splits a flex track', () => {
    const { doc, layerId } = newDoc();
    place(doc, layerId, 'flex.group', { x: 0, y: 0 });
    place(doc, layerId, 'flex.group', { x: 0, y: 20 });
    const all = layerOf(doc).bricks.map((b) => b.id);
    expect(groupBricksAcrossLayers(doc, new Map([[layerId, all]]))).toHaveLength(1);
    let L = layerOf(doc);
    expect(L.groups).toHaveLength(3);
    for (const b of L.bricks) expect(L.groups.find((g) => g.id === b.myGroup)?.partNumber).toBe('FLEX.GROUP');
    expect(ungroupState(docToBbm(doc), all, canUngroup)).toBe('splits');
    expect(ungroupBricksAcrossLayers(doc, new Map([[layerId, all]]), canUngroup)).toEqual({ refused: 0 });
    L = layerOf(doc);
    expect(L.groups.map((g) => [g.partNumber, g.myGroup ?? ''])).toEqual([['FLEX.GROUP', ''], ['FLEX.GROUP', '']]);
    expect(ungroupState(docToBbm(doc), all, canUngroup)).toBe('whole');
    expect(ungroupBricksAcrossLayers(doc, new Map([[layerId, all]]), canUngroup)).toEqual({ refused: 2 });
    expect(layerOf(doc).groups).toHaveLength(2);
  });

  it('copies sets with their groups under new ids', () => {
    const { doc, layerId } = newDoc();
    place(doc, layerId, 'flex.group', { x: 0, y: 0 });
    const L = layerOf(doc);
    const copy = cloneGroups(L.groups, L.bricks, makeId);
    expect(copy.groups).toHaveLength(1);
    expect(copy.groups[0]!.id).not.toBe(L.groups[0]!.id);
    expect(copy.bricks.map((b) => b.myGroup)).toEqual([copy.groups[0]!.id, copy.groups[0]!.id]);
  });
});

describe('saving', () => {
  it('leaves out a group whose parts were all deleted', () => {
    const { doc, layerId } = newDoc();
    place(doc, layerId, 'flex.group', { x: 0, y: 0 });
    place(doc, layerId, 'flex.group', { x: 0, y: 20 });
    const map = docToBbm(doc) as BbmMap;
    const L = map.layers.find((l): l is LayerBrick => l.type === 'brick')!;
    const kept = L.groups[1]!.id;
    L.bricks.splice(0, 2);
    const back = readBbm(writeBbm(map)).map.layers.find((l): l is LayerBrick => l.type === 'brick')!;
    expect(back.groups.map((g) => [g.id, g.partNumber])).toEqual([[kept, 'FLEX.GROUP']]);
  });
});

describe('modules older versions made of placed sets', () => {
  it('become sets when exactly one (also turned or bent), in one undo step', () => {
    const { doc, layerId } = newDoc();
    const um = new Y.UndoManager([doc.getMap('layerData'), doc.getMap('meta')], { trackedOrigins: new Set([LOCAL_ORIGIN]) });
    placeAsModule(doc, layerId, { x: 3, y: 4 }, 'Flex Track');
    placeAsModule(doc, layerId, { x: 30, y: 4 }, 'Flex Track', 90);
    // A third, bent 8 degrees at its hinge as a flex move leaves it.
    const [, male] = placeAsModule(doc, layerId, { x: 60, y: 4 }, 'flex.group');
    doc.transact(() => {
      const bricks = (doc.getMap('layerData').get(layerId) as Y.Map<unknown>).get('bricks') as Y.Array<Y.Map<unknown>>;
      const y = bricks.toArray().find((b) => b.get('id') === male)!;
      const area = y.get('displayArea') as { x: number; y: number; width: number; height: number };
      // Turn about the hinge (60.05, 4): the box centre (60.8, 4) moves to 60.05 + 0.75 cos 8.
      const r = (8 * Math.PI) / 180;
      y.set('displayArea', { ...area, x: 60.05 + 0.75 * Math.cos(r) - area.width / 2, y: 4 + 0.75 * Math.sin(r) - area.height / 2 });
      y.set('orientation', 8);
    }, LOCAL_ORIGIN);
    um.clear();
    const sets = findSetModules(docToBbm(doc), readSidecarFromDoc(doc)?.modules ?? [], PARTS, makeId);
    expect(sets).toHaveLength(3);
    makeSetsOfModules(doc, sets);
    expect(readSidecarFromDoc(doc)?.modules ?? []).toEqual([]);
    expect(libraryItems(layerOf(doc))).toEqual(['FLEX.GROUP', 'FLEX.GROUP', 'FLEX.GROUP']);
    expect(um.undoStack).toHaveLength(1);
    um.undo();
    expect(readSidecarFromDoc(doc)?.modules ?? []).toHaveLength(3);
    expect(layerOf(doc).groups).toEqual([]);
  });

  it('stay modules when not exactly a set', () => {
    const { doc, layerId } = newDoc();
    placeAsModule(doc, layerId, { x: 3, y: 4 }, 'Flex Track');
    placeAsModule(doc, layerId, { x: 30, y: 4 }, 'My loop'); // renamed
    const [pinned] = placeAsModule(doc, layerId, { x: 60, y: 4 }, 'Flex Track');
    const modules = readSidecarFromDoc(doc)?.modules ?? [];
    const pinnedModule = modules.find((m) => m.members.includes(pinned!))!;
    updateSidecarModule(doc, pinnedModule.id, (m) => ({ ...m, pinned: true }));
    const [apart] = placeAsModule(doc, layerId, { x: 90, y: 4 }, 'Flex Track'); // pulled apart
    doc.transact(() => {
      const bricks = (doc.getMap('layerData').get(layerId) as Y.Map<unknown>).get('bricks') as Y.Array<Y.Map<unknown>>;
      const y = bricks.toArray().find((b) => b.get('id') === apart)!;
      const area = y.get('displayArea') as { x: number };
      y.set('displayArea', { ...area, x: area.x - 0.5 });
    }, LOCAL_ORIGIN);
    recomputeConnectivity(doc, catalogFromParts([...PARTS.values()]));
    const sets = findSetModules(docToBbm(doc), readSidecarFromDoc(doc)?.modules ?? [], PARTS, makeId);
    expect(sets.map((s) => s.moduleId)).toEqual([modules[0]!.id]);
  });
});

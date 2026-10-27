// Placed custom sets keep track of their set's version (setUpdates.ts): the
// link a placed copy gets, "Update available" once the set changes, the
// update itself (where the copy sits now, its group and module kept, one
// undo step), and copies of a placed set keeping track too.

import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import type { LayerBrick } from '@cld/model';
import { createDefaultLayoutDoc, docToBbm, readSidecarFromDoc } from '@cld/ydoc';
import type { PartWire } from '../../api';
import { createSidecarModule, insertBricks, insertSet, makeId } from '../mutations';
import { indexParts } from '../partIndex';
import { expandSet } from '../sets';
import { applySetUpdate, copyPlacedSets, findSetUpdates, getPlacedSets, linksByAnchor, placedSetLink, placedSetPose, updateForSelection, writePlacedSets } from '../setUpdates';
import { LOCAL_ORIGIN } from '../useLayoutDoc';
import { createUndoManager } from '../useUndoManager';

const leaf = (id: string, partNumber: string) =>
  ({ key: `custom:${id}`, partNumber, colorCode: '', kind: 'leaf', description: partNumber, pxPerStud: 8, hullPts: [], connections: [], subparts: [], spriteSize: { w: 64, h: 32 }, source: 'custom', customPartId: id }) as unknown as PartWire;
const set = (version: string, subparts: { subKey: string; x: number; y: number; angle: number }[], description = 'Yard') =>
  ({ key: 'custom:yard', partNumber: 'Yard', colorCode: '', kind: 'group', description, pxPerStud: 8, hullPts: [], connections: [], subparts, source: 'custom', customPartId: 'yard', noSprite: true, setVersion: version }) as unknown as PartWire;

const V1 = [
  { subKey: 'shed', x: 0, y: 0, angle: 0 },
  { subKey: 'lamp', x: 8, y: 0, angle: 90 },
];
const V2 = [...V1, { subKey: 'lamp', x: 16, y: 4, angle: 0 }];
const parts = (version: string, subparts = V1) => indexParts([leaf('s', 'SHED'), leaf('l', 'LAMP'), set(version, subparts)]);

function newDoc() {
  const doc = createDefaultLayoutDoc();
  const layerId = docToBbm(doc).layers.find((l) => l.type === 'brick')!.id;
  return { doc, layerId };
}
const layerOf = (doc: Y.Doc) => docToBbm(doc).layers.find((l): l is LayerBrick => l.type === 'brick')!;
const cache = (doc: Y.Doc) => readSidecarFromDoc(doc) as Record<string, unknown> | null;

/** Place the yard as the editor does: its parts, its groups and its link, in one step. */
function placeYard(doc: Y.Doc, layerId: string, p: Map<string, PartWire>, at: { x: number; y: number }, turn = 0) {
  const s = expandSet(p, 'custom:yard', at, turn, makeId);
  let ids: string[] = [];
  doc.transact(() => {
    ids = insertSet(doc, layerId, s);
    writePlacedSets(doc, [placedSetLink(p, p.get('custom:yard')!, s.groups[0]!.id, ids[0])!]);
  }, LOCAL_ORIGIN);
  return { ids, group: s.groups[0]!.id };
}

describe('placed custom sets and their versions', () => {
  it('a placed copy remembers its version and where its first part sits; a newer set says Update available', () => {
    const { doc, layerId } = newDoc();
    const { ids, group } = placeYard(doc, layerId, parts('v1'), { x: 40, y: 20 });
    expect(getPlacedSets(cache(doc))).toEqual([{ id: group, version: 'v1', anchor: { brick: ids[0], x: 0, y: 0, angle: 0 } }]);
    // The .bbm never carries it.
    expect(JSON.stringify(docToBbm(doc))).not.toContain('"v1"');

    expect(findSetUpdates(docToBbm(doc), cache(doc), parts('v1'))).toEqual([]);
    const updates = findSetUpdates(docToBbm(doc), cache(doc), parts('v2', V2));
    expect(updates.map((u) => [u.group.id, u.name, u.set.setVersion])).toEqual([[group, 'Yard', 'v2']]);
    // Picking the copy offers it; picking one of its parts alone doesn't.
    expect(updateForSelection(docToBbm(doc), updates, ids)?.group.id).toBe(group);
    expect(updateForSelection(docToBbm(doc), updates, ids.slice(0, 1))).toBeNull();
    // A library set (no version) is never tracked.
    const lib = indexParts([leaf('s', 'SHED'), leaf('l', 'LAMP'), { ...set('', V1), source: 'bundled', setVersion: undefined } as unknown as PartWire]);
    expect(findSetUpdates(docToBbm(doc), cache(doc), lib)).toEqual([]);
  });

  it('updating puts the new parts where the copy sits now, turned as it is, keeping its group, in one undo step', () => {
    const { doc, layerId } = newDoc();
    const v1 = parts('v1');
    const { group } = placeYard(doc, layerId, v1, { x: 40, y: 20 }, 90);
    // Someone moved it since: it is now 10 studs to the right.
    doc.transact(() => {
      const yBricks = (doc.getMap('layerData').get(layerId) as Y.Map<unknown>).get('bricks') as Y.Array<Y.Map<unknown>>;
      yBricks.forEach((b) => {
        const a = b.get('displayArea') as { x: number; y: number; width: number; height: number };
        b.set('displayArea', { ...a, x: a.x + 10 });
      });
    }, LOCAL_ORIGIN);
    const before = layerOf(doc).bricks.map((b) => ({ ...b.displayArea }));
    const um = createUndoManager(doc);
    const v2 = parts('v2', V2);
    const [u] = findSetUpdates(docToBbm(doc), cache(doc), v2);
    expect(placedSetPose(layerOf(doc), u!, v2)).toEqual({ centre: { x: 50, y: 20 }, angle: 90 });

    const ids = applySetUpdate(doc, docToBbm(doc), u!, v2, makeId);
    expect(ids).toHaveLength(3);
    const L = layerOf(doc);
    // Exactly the set as it is now, placed at (50, 20) turned 90°.
    const want = expandSet(v2, 'custom:yard', { x: 50, y: 20 }, 90, makeId).bricks;
    expect(L.bricks.map((b) => [b.partNumber, b.orientation, b.displayArea])).toEqual(want.map((b) => [b.partNumber, b.orientation, b.displayArea]));
    // The same group, and the link now at v2 with its new first part.
    expect(L.groups.map((g) => g.id)).toEqual([group]);
    expect(L.bricks.every((b) => b.myGroup === group)).toBe(true);
    expect(getPlacedSets(cache(doc))).toEqual([{ id: group, version: 'v2', anchor: { brick: ids[0], x: 0, y: 0, angle: 0 } }]);
    expect(findSetUpdates(docToBbm(doc), cache(doc), v2)).toEqual([]);

    // One undo step puts the old parts and the old version back.
    um.undo();
    expect(layerOf(doc).bricks.map((b) => b.displayArea)).toEqual(before);
    expect(getPlacedSets(cache(doc))[0]!.version).toBe('v1');
  });

  it('a module the copy was in gets the new parts', () => {
    const { doc, layerId } = newDoc();
    const { ids } = placeYard(doc, layerId, parts('v1'), { x: 0, y: 0 });
    const other = insertBricks(doc, layerId, [{ partNumber: 'custom:s', displayArea: { x: 100, y: 0, width: 8, height: 4 } }]);
    createSidecarModule(doc, 'Station', [...ids, ...other]);
    const v2 = parts('v2', V2);
    const newIds = applySetUpdate(doc, docToBbm(doc), findSetUpdates(docToBbm(doc), cache(doc), v2)[0]!, v2, makeId);
    expect(readSidecarFromDoc(doc)?.modules?.[0]?.members.sort()).toEqual([...other, ...newIds].sort());
  });

  it('a copy of a placed set (Duplicate, Paste) keeps track of its version too', () => {
    const { doc, layerId } = newDoc();
    const v1 = parts('v1');
    const { ids } = placeYard(doc, layerId, v1, { x: 0, y: 0 });
    const anchors = linksByAnchor(cache(doc));
    expect([...anchors.keys()]).toEqual([ids[0]]);
    // A copy of its parts in a new group, as Duplicate makes it.
    const copy = expandSet(v1, 'custom:yard', { x: 30, y: 0 }, 0, makeId);
    doc.transact(() => {
      const copied = insertSet(doc, layerId, copy);
      copyPlacedSets(doc, [{ brick: copied[0]!, link: anchors.get(ids[0]!)! }]);
    }, LOCAL_ORIGIN);
    const links = getPlacedSets(cache(doc));
    expect(links).toHaveLength(2);
    expect(links[1]).toMatchObject({ id: copy.groups[0]!.id, version: 'v1' });
    expect(findSetUpdates(docToBbm(doc), cache(doc), parts('v2', V2))).toHaveLength(2);
  });

  it('without its anchor part, the place comes from a part the set still has', () => {
    const { doc, layerId } = newDoc();
    const { ids } = placeYard(doc, layerId, parts('v1'), { x: 40, y: 20 }, 180);
    // The shed (the anchor) was taken out of the set.
    doc.transact(() => {
      const yBricks = (doc.getMap('layerData').get(layerId) as Y.Map<unknown>).get('bricks') as Y.Array<Y.Map<unknown>>;
      for (let i = yBricks.length - 1; i >= 0; i--) if (yBricks.get(i).get('id') === ids[0]) yBricks.delete(i, 1);
    }, LOCAL_ORIGIN);
    const v2 = parts('v2', V2);
    const [u] = findSetUpdates(docToBbm(doc), cache(doc), v2);
    const pose = placedSetPose(layerOf(doc), u!, v2);
    expect(Math.abs(pose.angle)).toBe(180); // (-180 and 180 are the same turn)
    expect(pose.centre.x).toBeCloseTo(40);
    expect(pose.centre.y).toBeCloseTo(20);
  });
});

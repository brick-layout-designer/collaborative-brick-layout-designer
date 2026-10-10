// Moving parts to another part sheet (Aaron, 2026-10-08: "we need to be
// able to send things to other sheets").

import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { addLayer, ensureBrickLayer, groupBricks, moveBricksToLayer, placeBrick } from '../mutations';
import { createUndoManager } from '../useUndoManager';

const spec = (x: number) => ({ partNumber: '3001.1', x, y: 0, width: 4, height: 2 });

function bricks(doc: Y.Doc, layerId: string): Y.Map<unknown>[] {
  const l = doc.getMap('layerData').get(layerId) as Y.Map<unknown>;
  return ((l.get('bricks') as Y.Array<Y.Map<unknown>> | undefined)?.toArray() ?? []);
}
function groups(doc: Y.Doc, layerId: string): Y.Map<unknown>[] {
  const l = doc.getMap('layerData').get(layerId) as Y.Map<unknown>;
  return ((l.get('groups') as Y.Array<Y.Map<unknown>> | undefined)?.toArray() ?? []);
}
const ids = (bs: Y.Map<unknown>[]) => bs.map((b) => b.get('id'));

describe('moveBricksToLayer', () => {
  it('moves the parts on top of the other sheet, keeping their ids, places and details', () => {
    const doc = new Y.Doc();
    const a = ensureBrickLayer(doc);
    const b = addLayer(doc, 'brick');
    const kept = placeBrick(doc, a, spec(0));
    const p1 = placeBrick(doc, a, spec(4));
    const already = placeBrick(doc, b, spec(20));
    expect(moveBricksToLayer(doc, new Map([[a, [p1]]]), b)).toBe(1);
    expect(ids(bricks(doc, a))).toEqual([kept]);
    expect(ids(bricks(doc, b))).toEqual([already, p1]);
    const moved = bricks(doc, b)[1]!;
    expect(moved.get('partNumber')).toBe('3001.1');
    expect((moved.get('displayArea') as { x: number }).x).toBe(4);
  });

  it('takes a whole group with it, and a part leaves a group that stays', () => {
    const doc = new Y.Doc();
    const a = ensureBrickLayer(doc);
    const b = addLayer(doc, 'brick');
    const g1 = placeBrick(doc, a, spec(0));
    const g2 = placeBrick(doc, a, spec(4));
    const h1 = placeBrick(doc, a, spec(10));
    const h2 = placeBrick(doc, a, spec(14));
    const whole = groupBricks(doc, a, [g1, g2])!;
    const split = groupBricks(doc, a, [h1, h2])!;
    moveBricksToLayer(doc, new Map([[a, [g1, g2, h1]]]), b);
    expect(groups(doc, b).map((g) => g.get('id'))).toEqual([whole]);
    expect(groups(doc, a).map((g) => g.get('id'))).toEqual([split]);
    const byId = new Map(bricks(doc, b).map((x) => [x.get('id'), x]));
    expect(byId.get(g1)!.get('myGroup')).toBe(whole);
    expect(byId.get(h1)!.get('myGroup')).toBe('');
    expect(bricks(doc, a)[0]!.get('myGroup')).toBe(split);
  });

  it('is one undo step, and refuses a sheet that isn’t for parts', () => {
    const doc = new Y.Doc();
    const a = ensureBrickLayer(doc);
    const b = addLayer(doc, 'brick');
    const text = addLayer(doc, 'text');
    const p = placeBrick(doc, a, spec(0));
    const undo = createUndoManager(doc);
    expect(moveBricksToLayer(doc, new Map([[a, [p]]]), text)).toBe(0);
    moveBricksToLayer(doc, new Map([[a, [p]]]), b);
    expect(ids(bricks(doc, b))).toEqual([p]);
    undo.undo();
    expect(ids(bricks(doc, a))).toEqual([p]);
    expect(ids(bricks(doc, b))).toEqual([]);
  });
});

describe('drawing order, like BlueBrick', () => {
  it('a new altitude sorts the sheet (equal ones keep their order); other edits leave it', async () => {
    const { editBrick, reorderBricks } = await import('../mutations');
    const doc = new Y.Doc();
    const a = ensureBrickLayer(doc);
    const [p, q, r] = [0, 4, 8].map((x) => placeBrick(doc, a, spec(x)));
    editBrick(doc, a, r!, { altitude: 2 });
    expect(ids(bricks(doc, a))).toEqual([p, q, r]);
    reorderBricks(doc, [r!], 'back');
    expect(ids(bricks(doc, a))).toEqual([r, p, q]);  // Send to Back works whatever the altitude
    editBrick(doc, a, p!, { altitude: 5, x: 30 });
    expect(ids(bricks(doc, a))).toEqual([q, r, p]);
    const moved = bricks(doc, a)[2]!;
    expect(moved.get('altitude')).toBe(5);
    expect((moved.get('displayArea') as { x: number }).x).toBe(30);
    editBrick(doc, a, q!, { orientation: 90 });
    expect(ids(bricks(doc, a))).toEqual([q, r, p]);
  });
});

describe('reordering keeps other people\'s edits', () => {
  it('Bring to Front moves only the picked part, so a concurrent edit to another survives', async () => {
    const { reorderBricks } = await import('../mutations');
    const a = new Y.Doc();
    const L = ensureBrickLayer(a);
    const [p, q, r] = [0, 4, 8].map((x) => placeBrick(a, L, spec(x)));
    const b = new Y.Doc();
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
    const sv = Y.encodeStateVector(a);
    // A brings p to the front; at the same time B moves q.
    reorderBricks(a, [p!], 'front');
    const qInB = bricks(b, L).find((x) => x.get('id') === q)!;
    b.transact(() => qInB.set('displayArea', { ...(qInB.get('displayArea') as object), x: 99 }));
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a, Y.encodeStateVector(b)));
    Y.applyUpdate(a, Y.encodeStateAsUpdate(b, sv));
    for (const doc of [a, b]) {
      expect(ids(bricks(doc, L))).toEqual([q, r, p]);
      expect((bricks(doc, L).find((x) => x.get('id') === q)!.get('displayArea') as { x: number }).x).toBe(99);
    }
  });

  it('moving to another sheet keeps the parts\' connection points, unlinked', () => {
    const doc = new Y.Doc();
    const a = ensureBrickLayer(doc);
    const b = addLayer(doc, 'brick');
    const p = placeBrick(doc, a, spec(0));
    const yp = bricks(doc, a)[0]!;
    doc.transact(() => yp.set('connexions', [{ id: 'c1', linkedTo: 'x9' }]));
    moveBricksToLayer(doc, new Map([[a, [p]]]), b);
    expect(bricks(doc, b)[0]!.get('connexions')).toEqual([{ id: 'c1', linkedTo: '' }]);
  });
});

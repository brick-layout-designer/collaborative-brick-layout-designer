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

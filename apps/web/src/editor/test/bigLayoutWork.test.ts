// Big layouts: how much work an edit does, counted (not timed, so it holds
// on any machine). A paste of 500 parts into a 5,000-part sheet reads the
// sheet once, not once per part.

import { afterEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { itemsInOrder } from '@cld/ydoc';
import { ensureBrickLayer, insertBricks } from '../mutations';

const part = (i: number) => ({ partNumber: '3001.1', displayArea: { x: i * 2, y: 0, width: 2, height: 4 } });

function bigSheet(n: number): { doc: Y.Doc; layerId: string; bricks: Y.Array<Y.Map<unknown>> } {
  const doc = new Y.Doc();
  const layerId = ensureBrickLayer(doc)!;
  insertBricks(doc, layerId, Array.from({ length: n }, (_, i) => part(i)));
  const bricks = (doc.getMap('layerData').get(layerId) as Y.Map<unknown>).get('bricks') as Y.Array<Y.Map<unknown>>;
  return { doc, layerId, bricks };
}

describe('pasting many parts into a big sheet', () => {
  afterEach(() => vi.restoreAllMocks());

  it('reads the sheet once for 500 parts, not once per part', () => {
    const { doc, layerId, bricks } = bigSheet(5000);
    const reads = vi.spyOn(Y.Map.prototype, 'get');
    const ids = insertBricks(doc, layerId, Array.from({ length: 500 }, (_, i) => part(i)), { dx: 0, dy: 10 });
    expect(ids).toHaveLength(500);
    // The z on top read once: each sheet entry's z, once (each part used
    // to read them all again: 500 × 5,000).
    const zReads = reads.mock.calls.filter(([key]) => key === 'z').length;
    expect(zReads).toBeLessThanOrEqual(5000 + 500);
    expect(bricks.length).toBe(5500);
  });

  it('puts the pasted parts on top, in the order given', () => {
    const { doc, layerId, bricks } = bigSheet(20);
    // A sheet ordered by z (as after a reorder).
    doc.transact(() => bricks.forEach((b, i) => b.set('z', i * 10)));
    const ids = insertBricks(doc, layerId, Array.from({ length: 5 }, (_, i) => part(i)));
    const order = itemsInOrder(bricks).map((b) => b.get('id'));
    expect(order.slice(-5)).toEqual(ids);
    expect(ids.map((id) => bricks.toArray().find((b) => b.get('id') === id)!.get('z'))).toEqual([191, 192, 193, 194, 195]);
  });
});

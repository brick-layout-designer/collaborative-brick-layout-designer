// A picked part that leaves the map (someone else deleted it, or an undo
// took it away) leaves the selection.

import { describe, expect, it } from 'vitest';
import { createDefaultLayoutDoc, docToBbm } from '@cld/ydoc';
import { brickIdsInDoc, stillPicked } from '../mixedSelection';
import { deleteBricks, placeBrick } from '../mutations';

describe('stillPicked', () => {
  it('keeps the parts still on the map and says when nothing changed', () => {
    const doc = createDefaultLayoutDoc();
    const layerId = docToBbm(doc).layers.find((l) => l.type === 'brick')!.id;
    const a = placeBrick(doc, layerId, { partNumber: 'x.1', x: 0, y: 0, width: 2, height: 2 });
    const b = placeBrick(doc, layerId, { partNumber: 'x.1', x: 4, y: 0, width: 2, height: 2 });
    expect(stillPicked(brickIdsInDoc(doc), [a, b])).toBeNull();
    expect(stillPicked(brickIdsInDoc(doc), [])).toBeNull();
    deleteBricks(doc, layerId, [a]);
    expect(stillPicked(brickIdsInDoc(doc), [a, b])).toEqual([b]);
    deleteBricks(doc, layerId, [b]);
    expect(stillPicked(brickIdsInDoc(doc), [a, b])).toEqual([]);
  });
});

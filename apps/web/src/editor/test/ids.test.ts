// Regression: brick/layer/group ids must be unique even when many are
// minted in the same millisecond (paste, set placement, module insert),
// and must stay parseable as a decimal `ulong` for .bbm round-trip.

import { describe, expect, it } from 'vitest';
import { createDefaultLayoutDoc, docToBbm } from '@cld/ydoc';
import { insertBricks, makeId } from '../mutations';

describe('makeId', () => {
  it('is a decimal string that fits in an unsigned 64-bit integer', () => {
    for (let i = 0; i < 1000; i++) {
      const id = makeId();
      expect(id).toMatch(/^[1-9]\d*$/);
      expect(BigInt(id) < 2n ** 64n).toBe(true);
    }
  });

  it('does not collide across 100k ids minted back-to-back', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 100_000; i++) ids.add(makeId());
    expect(ids.size).toBe(100_000);
  });

  it('a 50-brick paste never produces duplicate ids', () => {
    for (let r = 0; r < 50; r++) {
      const doc = createDefaultLayoutDoc();
      const layerId = docToBbm(doc).layers.find((l) => l.type === 'brick')!.id;
      const ids = insertBricks(
        doc,
        layerId,
        Array.from({ length: 50 }, () => ({
          partNumber: 'a',
          displayArea: { x: 0, y: 0, width: 1, height: 1 },
        })),
      );
      expect(new Set(ids).size).toBe(ids.length);
    }
  });
});

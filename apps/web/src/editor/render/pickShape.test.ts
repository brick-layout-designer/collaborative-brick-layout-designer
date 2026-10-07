import { describe, expect, it } from 'vitest';
import { insidePickShape, type PickShape } from './pickShape';

const L: PickShape = [[{ x: -4, y: -4 }, { x: 0, y: -4 }, { x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 4 }, { x: -4, y: 4 }]];
// A ring of track: a 12 x 12 square with a 6 x 6 hole, the hole's ring traced the same way round.
const RING: PickShape = [
  [{ x: -6, y: -6 }, { x: 6, y: -6 }, { x: 6, y: 6 }, { x: -6, y: 6 }],
  [{ x: -3, y: -3 }, { x: 3, y: -3 }, { x: 3, y: 3 }, { x: -3, y: 3 }],
];

describe('insidePickShape', () => {
  it('an L-shaped import is hit as an L', () => {
    expect(insidePickShape(L, -2, -2)).toBe(true);
    expect(insidePickShape(L, 2, 2)).toBe(true);
    expect(insidePickShape(L, 2, -2)).toBe(false); // the empty corner
  });

  it('a click in a hole misses, so the part beneath is picked', () => {
    expect(insidePickShape(RING, 0, 0)).toBe(false);
    expect(insidePickShape(RING, -5, 0)).toBe(true);
    expect(insidePickShape(RING, 7, 0)).toBe(false);
  });
});

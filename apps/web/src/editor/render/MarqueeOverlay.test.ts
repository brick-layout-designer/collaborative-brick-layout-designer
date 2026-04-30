import { describe, expect, it } from 'vitest';
import { bricksInMarquee } from './marqueeMath';

const make = (id: string, x: number, y: number, w = 8, h = 8) => ({
  id,
  displayArea: { x, y, width: w, height: h },
});

describe('bricksInMarquee', () => {
  const bricks = [
    make('a', 0, 0),
    make('b', 50, 50),
    make('c', 100, 100),
    make('d', -10, -10),
  ];

  it('returns bricks fully inside the marquee', () => {
    expect(bricksInMarquee({ x0: -20, y0: -20, x1: 60, y1: 60 }, bricks).sort()).toEqual([
      'a',
      'b',
      'd',
    ]);
  });

  it('treats overlap (not full containment) as selected', () => {
    // 'a' is at (0,0)-(8,8); marquee at (5,5)-(20,20) overlaps the corner.
    expect(bricksInMarquee({ x0: 5, y0: 5, x1: 20, y1: 20 }, bricks)).toEqual(['a']);
  });

  it('handles inverted marquees (drag bottom-right → top-left)', () => {
    expect(bricksInMarquee({ x0: 60, y0: 60, x1: -20, y1: -20 }, bricks).sort()).toEqual([
      'a',
      'b',
      'd',
    ]);
  });

  it('returns empty when nothing intersects', () => {
    expect(bricksInMarquee({ x0: 200, y0: 200, x1: 300, y1: 300 }, bricks)).toEqual([]);
  });
});

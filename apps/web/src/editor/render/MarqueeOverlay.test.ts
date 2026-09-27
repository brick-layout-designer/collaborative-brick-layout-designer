import { describe, expect, it } from 'vitest';
import { brickFootprint, bricksInMarquee, polygonIntersectsMarquee, rotatedRectCorners } from './marqueeMath';

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

describe('bricksInMarquee — rotated item shape (regression: was AABB)', () => {
  // A 20×4 brick rotated 30° about (10, 10): its AABB is ~19.3×13.5 and
  // covers corners the rotated sprite does not.
  const c = Math.cos(Math.PI / 6);
  const s = Math.sin(Math.PI / 6);
  const W = 20 * c + 4 * s;
  const H = 20 * s + 4 * c;
  const rotated = { id: 'r', orientation: 30, displayArea: { x: 10 - W / 2, y: 10 - H / 2, width: W, height: H } };

  it('misses a band over an empty AABB corner', () => {
    // Top-right AABB corner lies far from the 30°-rotated bar (which runs
    // top-left → bottom-right).
    const corner = { x0: 10 + W / 2 - 1.5, y0: 10 - H / 2, x1: 10 + W / 2, y1: 10 - H / 2 + 1.5 };
    expect(bricksInMarquee(corner, [rotated])).toEqual([]);
  });

  it('hits a band over the rotated bar itself', () => {
    const end = { x: 10 + 9 * c, y: 10 + 9 * s };
    expect(bricksInMarquee({ x0: end.x - 0.5, y0: end.y - 0.5, x1: end.x + 0.5, y1: end.y + 0.5 }, [rotated])).toEqual(['r']);
  });

  it('recovers the footprint from the AABB, and uses the sprite size near 45°', () => {
    const f = brickFootprint(rotated.displayArea, 30);
    expect(f.w).toBeCloseTo(20, 6);
    expect(f.h).toBeCloseTo(4, 6);
    expect(brickFootprint({ x: 0, y: 0, width: 10, height: 10 }, 45, { w: 12, h: 2 })).toEqual({ w: 12, h: 2 });
    expect(brickFootprint({ x: 0, y: 0, width: 10, height: 10 }, 45)).toEqual({ w: 10, h: 10 });
  });

  it('polygonIntersectsMarquee handles containment both ways', () => {
    const sq = rotatedRectCorners({ x: 0, y: 0 }, 10, 10, 0);
    expect(polygonIntersectsMarquee(sq, { x0: 2, y0: 2, x1: 3, y1: 3 })).toBe(true);
    expect(polygonIntersectsMarquee(sq, { x0: -5, y0: -5, x1: 50, y1: 50 })).toBe(true);
    expect(polygonIntersectsMarquee(sq, { x0: 11, y0: 0, x1: 12, y1: 5 })).toBe(false);
  });
});

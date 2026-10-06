// The electric overlay's path through a part (circuitPath.ts). The table is
// a copy of the desktop's fixtures/electric/circuit-paths.json, written by
// its CircuitPathTest: both apps draw identical rails.

import { describe, expect, it } from 'vitest';
import { CIRCUIT_RAIL_OFFSET, circuitPath, offsetPath, type Pt } from '../render/circuitPath';
import table from './circuit-paths.json';

const rot = (v: Pt, deg: number): Pt => {
  const r = (deg * Math.PI) / 180;
  return { x: v.x * Math.cos(r) - v.y * Math.sin(r), y: v.x * Math.sin(r) + v.y * Math.cos(r) };
};

// Connection positions and angles from BlueBrickParts (studs, degrees).
const c1 = { x: -8.1875, y: -1.375 };
const c2 = { x: 7.1198, y: 1.6698 }; // 2867.8, R40 curve
const shift = { x: 100.5, y: -20.25 };
const moved = (p: Pt) => {
  const r = rot(p, 37);
  return { x: r.x + shift.x, y: r.y + shift.y };
};
const cases: Record<string, [Pt, number, Pt, number]> = {
  'straight 2865': [{ x: -8, y: 0 }, 180, { x: 8, y: 0 }, 0],
  'curve 2867': [c1, 180, c2, 22.5],
  'curve 2867 backwards': [c2, 22.5, c1, 180],
  'curve 2867 turned 37 and moved': [moved(c1), 217, moved(c2), 59.5],
  'switch 2861 branch': [{ x: -16.9375, y: 6.375 }, 180, { x: 15.7552, y: -6.58018 }, -22.5],
  'crossover 7996 diagonal': [{ x: -24, y: -8 }, 180, { x: 24, y: 8 }, 0],
};

describe('circuitPath', () => {
  it('matches the desktop point for point', () => {
    expect(Object.keys(cases).sort()).toEqual(Object.keys(table).sort());
    for (const [name, [p1, a1, p2, a2]] of Object.entries(cases)) {
      const want = (table as Record<string, number[][]>)[name]!;
      const got = circuitPath(p1, a1, p2, a2);
      expect(got.length, name).toBe(want.length);
      got.forEach((pt, i) => {
        const w = want[i]!;
        for (const [k, v] of [pt.p.x, pt.p.y, pt.normal.x, pt.normal.y, pt.s].entries()) expect(v, `${name} ${i}`).toBeCloseTo(w[k]!, 9);
      });
    }
  });

  it('draws a curve as one arc, with concentric rails', () => {
    const path = circuitPath(c1, 180, c2, 22.5);
    const centre = { x: c1.x, y: c1.y + 40 };
    for (const pt of path) expect(Math.hypot(pt.p.x - centre.x, pt.p.y - centre.y)).toBeCloseTo(40, 2);
    for (const p of offsetPath(path, CIRCUIT_RAIL_OFFSET)) expect(Math.hypot(p.x - centre.x, p.y - centre.y)).toBeCloseTo(37.5, 2);
  });
});

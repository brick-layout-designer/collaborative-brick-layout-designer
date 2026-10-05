// The connection-snap feel (snapFeel.ts): the shared cases the desktop
// runs too (fixtures/snap-vectors.json), then a few checks of our own.

import { describe, expect, it } from 'vitest';
import VEC from './fixtures/snap-vectors.json';
import {
  SNAP_FEEL,
  SNAP_STRENGTH_SCALE,
  SnapSession,
  SpeedMeter,
  holdReach,
  isSnapStrength,
  pickSnap,
  snapBypassed,
  snapReachStuds,
  type SnapCandidate,
  type SnapLock,
  type SnapStrength,
} from '../snapFeel';

interface VecCand {
  m: string;
  t: string;
  d: number;
  c: number;
}
const cands = (list: VecCand[]): SnapCandidate[] =>
  list.map((c) => ({ movingKey: c.m, targetKey: c.t, dist: c.d, mouseDist: c.c }));
const lockOf = (s: string | null): SnapLock | null => {
  if (!s) return null;
  const [movingKey, targetKey] = s.split('>') as [string, string];
  return { movingKey, targetKey };
};
const name = (c: SnapCandidate | null) => (c ? `${c.movingKey}>${c.targetKey}` : null);

describe('snap feel: shared cases (snap-vectors.json)', () => {
  it('uses the shared numbers', () => {
    const { strength, ...numbers } = VEC.constants;
    expect(SNAP_FEEL).toEqual(numbers);
    expect(SNAP_STRENGTH_SCALE).toEqual(strength);
  });

  for (const c of VEC.reach) {
    it(`reach: ${c.name}`, () => {
      expect(snapReachStuds(c.pxPerStud, c.strength as SnapStrength)).toBeCloseTo(c.reach, 9);
    });
  }

  for (const c of VEC.pick) {
    it(`pick: ${c.name}`, () => {
      const opts = {
        ...('fast' in c && c.fast ? { fast: true } : {}),
        ...('bypass' in c && c.bypass ? { bypass: true } : {}),
      };
      expect(name(pickSnap(cands(c.candidates), lockOf(c.lock), c.reach, opts))).toBe(c.expect);
    });
  }

  for (const c of VEC.speed) {
    it(`speed: ${c.name}`, () => {
      const m = new SpeedMeter();
      for (const [x, y, t] of c.samples as [number, number, number][]) m.sample(x, y, t);
      expect(m.speed()).toBeCloseTo(c.speed, 6);
      expect(m.isFast()).toBe(c.fast);
    });
  }

  for (const c of VEC.session) {
    it(`session: ${c.name}`, () => {
      const s = new SnapSession();
      c.frames.forEach((f, i) => {
        for (const [x, y, t] of ('samples' in f ? f.samples : []) as [number, number, number][]) s.sample(x, y, t);
        const got = s.step(cands(f.candidates), c.reach, {
          ...('bypass' in f && f.bypass ? { bypass: true } : {}),
          ...('final' in f && f.final ? { final: true } : {}),
        });
        expect(name(got), `frame ${i}`).toBe(f.expect);
        expect(s.lock ? `${s.lock.movingKey}>${s.lock.targetKey}` : null, `lock after frame ${i}`).toBe(f.expect);
      });
    });
  }
});

describe('snap feel', () => {
  it('hold distance is 1.6x the reach', () => {
    expect(holdReach(2)).toBeCloseTo(3.2, 9);
  });

  it('knows the three strengths and nothing else', () => {
    expect(['off', 'gentle', 'strong'].every(isSnapStrength)).toBe(true);
    expect(isSnapStrength('medium')).toBe(false);
    expect(isSnapStrength(undefined)).toBe(false);
  });

  it('Alt bypasses connection snap', () => {
    expect(snapBypassed({ altKey: true })).toBe(true);
    expect(snapBypassed({ altKey: false })).toBe(false);
    expect(snapBypassed(undefined)).toBe(false);
  });

  it('a pointer that goes back in time starts the speed afresh', () => {
    const m = new SpeedMeter();
    m.sample(0, 0, 100);
    m.sample(500, 0, 110);
    m.sample(500, 0, 50);
    expect(m.speed()).toBe(0);
  });

  it('reset forgets the held join and the speed', () => {
    const s = new SnapSession();
    s.sample(0, 0, 0);
    s.sample(100, 0, 10);
    expect(s.meter.isFast()).toBe(true);
    s.lock = { movingKey: 'a', targetKey: 'b' };
    s.reset();
    expect(s.lock).toBeNull();
    expect(s.meter.speed()).toBe(0);
  });
});

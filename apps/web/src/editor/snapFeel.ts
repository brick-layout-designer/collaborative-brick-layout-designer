// How connection snapping feels: how far it reaches, how it holds on, when
// it lets go, and how fast drags are left alone. Pure and shared by every
// snapping path (dragging parts and groups, placing a new part, inserting a
// module, touch drags; a flex move only takes the reach). The desktop app
// has the same numbers in src/ui/SnapFeel.h, and both test the same cases
// (test/fixtures/snap-vectors.json).
//
// The rules:
//   - Reach is a distance on screen (about 14 px), turned into studs with
//     the current zoom and kept between 0.5 and 4 studs. It no longer
//     depends on the grid. The Snap strength setting scales it.
//   - Once snapped, a part stays on that target until its connection is
//     more than 1.6x the reach away from it.
//   - It only moves to a different target that is clearly closer (by 30%
//     and by at least half a stud).
//   - Near-equal targets are settled the same way every time: the current
//     one, then the one whose connection is nearest the cursor, then a
//     fixed order.
//   - While the pointer moves fast (over 1200 screen px/s, over the last
//     few moves) no new snap starts; one already made holds. The drop
//     always runs one last snap at the normal reach.
//   - Alt (Option on a Mac) while dragging places without connection snap.

export const SNAP_FEEL = {
  /** Reach on screen, CSS px. */
  reachScreenPx: 14,
  minReachStuds: 0.5,
  maxReachStuds: 4,
  /** Stay snapped until the connection is this many reaches away. */
  holdFactor: 1.6,
  /** Switch only to a target at most this fraction of the current distance... */
  switchRatio: 0.7,
  /** ...and at least this many studs closer. */
  switchMinStuds: 0.5,
  /** Targets within this many studs of the nearest count as level. */
  tieStuds: 0.25,
  /** Faster than this (screen px/s) is a fast drag. */
  fastPxPerSecond: 1200,
  /** Pointer moves averaged for the speed. */
  speedSamples: 4,
  /** Older moves than this (ms) don't count towards the speed. */
  speedWindowMs: 200,
} as const;

export const SNAP_STRENGTHS = ['off', 'gentle', 'strong'] as const;
export type SnapStrength = (typeof SNAP_STRENGTHS)[number];
export const DEFAULT_SNAP_STRENGTH: SnapStrength = 'gentle';

/** Reach multiplier for each Snap strength. */
export const SNAP_STRENGTH_SCALE: Record<SnapStrength, number> = { off: 0, gentle: 1, strong: 1.6 };

export function isSnapStrength(v: unknown): v is SnapStrength {
  return typeof v === 'string' && (SNAP_STRENGTHS as readonly string[]).includes(v);
}

/**
 * Connection-snap reach in studs for a view showing `screenPxPerStud`
 * screen pixels per stud: the screen reach in studs, kept between the
 * limits, times the strength. 0 when snapping is off.
 */
export function snapReachStuds(screenPxPerStud: number, strength: SnapStrength = DEFAULT_SNAP_STRENGTH): number {
  const scale = SNAP_STRENGTH_SCALE[strength] ?? 1;
  if (scale <= 0) return 0;
  const raw = screenPxPerStud > 0 && Number.isFinite(screenPxPerStud) ? SNAP_FEEL.reachScreenPx / screenPxPerStud : SNAP_FEEL.maxReachStuds;
  const base = Math.min(SNAP_FEEL.maxReachStuds, Math.max(SNAP_FEEL.minReachStuds, raw));
  return base * scale;
}

/** One possible join: a moving connection and a free target connection. */
export interface SnapCandidate {
  /** Which moving connection (stable for the whole drag). */
  movingKey: string;
  /** Which target connection. */
  targetKey: string;
  /** Studs the moving connection, where the pointer has it, is from the target. */
  dist: number;
  /** Studs from the moving connection to the cursor. */
  mouseDist: number;
}

/** The join a drag is holding on to. */
export interface SnapLock {
  movingKey: string;
  targetKey: string;
}

export interface PickOptions {
  /** The pointer is moving fast: keep a held snap, start none. */
  fast?: boolean;
  /** Alt is down: no connection snap. */
  bypass?: boolean;
}

/** Candidates worth handing to `pickSnap`: those within the hold distance. */
export function holdReach(reach: number): number {
  return reach * SNAP_FEEL.holdFactor;
}

/**
 * Pick the join for this frame. `candidates` may include any within the
 * hold distance (`holdReach(reach)`); new ones only count within `reach`.
 */
export function pickSnap<C extends SnapCandidate>(
  candidates: readonly C[],
  lock: SnapLock | null,
  reach: number,
  opts: PickOptions = {},
): C | null {
  if (opts.bypass || !(reach > 0)) return null;
  const hold = holdReach(reach);
  let held: C | null = null;
  if (lock) {
    for (const c of candidates) {
      if (c.movingKey === lock.movingKey && c.targetKey === lock.targetKey && c.dist <= hold) {
        held = c;
        break;
      }
    }
  }
  const best = bestNew(candidates, reach);
  if (held) {
    if (opts.fast || !best || best === held) return held;
    const clearlyCloser = best.dist <= held.dist * SNAP_FEEL.switchRatio && held.dist - best.dist >= SNAP_FEEL.switchMinStuds;
    return clearlyCloser ? best : held;
  }
  if (opts.fast) return null;
  return best;
}

/**
 * The best candidate within reach, the same whatever order they come in:
 * the nearest, and among those level with it (within `tieStuds`), the one
 * whose connection is nearest the cursor, then the lowest keys.
 */
function bestNew<C extends SnapCandidate>(candidates: readonly C[], reach: number): C | null {
  let nearest = Infinity;
  for (const c of candidates) if (c.dist <= reach && c.dist < nearest) nearest = c.dist;
  if (nearest === Infinity) return null;
  let best: C | null = null;
  for (const c of candidates) {
    if (c.dist > reach || c.dist > nearest + SNAP_FEEL.tieStuds) continue;
    if (!best || better(c, best)) best = c;
  }
  return best;
}

function better(a: SnapCandidate, b: SnapCandidate): boolean {
  if (Math.abs(a.mouseDist - b.mouseDist) > 1e-9) return a.mouseDist < b.mouseDist;
  if (Math.abs(a.dist - b.dist) > 1e-9) return a.dist < b.dist;
  if (a.targetKey !== b.targetKey) return a.targetKey < b.targetKey;
  return a.movingKey < b.movingKey;
}

/** Pointer speed in screen px/s over the last few moves. */
export class SpeedMeter {
  private samples: { x: number; y: number; t: number }[] = [];

  sample(x: number, y: number, t: number): void {
    const last = this.samples[this.samples.length - 1];
    if (last && t < last.t) this.samples = [];
    this.samples.push({ x, y, t });
    if (this.samples.length > SNAP_FEEL.speedSamples + 1) this.samples.shift();
  }

  /** px/s; 0 until there are two moves within the window. */
  speed(): number {
    const s = this.samples;
    if (s.length < 2) return 0;
    const newest = s[s.length - 1]!.t;
    let first = s.length - 1;
    while (first > 0 && newest - s[first - 1]!.t <= SNAP_FEEL.speedWindowMs) first--;
    const elapsed = newest - s[first]!.t;
    if (elapsed <= 0) return 0;
    let path = 0;
    for (let i = first + 1; i < s.length; i++) path += Math.hypot(s[i]!.x - s[i - 1]!.x, s[i]!.y - s[i - 1]!.y);
    return (path / elapsed) * 1000;
  }

  isFast(): boolean {
    return this.speed() > SNAP_FEEL.fastPxPerSecond;
  }

  reset(): void {
    this.samples = [];
  }
}

/** One drag's snap state: the held join and the pointer speed. */
export class SnapSession {
  lock: SnapLock | null = null;
  readonly meter = new SpeedMeter();

  /** A pointer move, in screen px at time `t` ms. */
  sample(x: number, y: number, t: number): void {
    this.meter.sample(x, y, t);
  }

  /**
   * This frame's join, remembered for the next. `final` is the drop: the
   * speed gate is off, so a snap the fast drag held back happens now.
   */
  step<C extends SnapCandidate>(candidates: readonly C[], reach: number, opts: { bypass?: boolean; final?: boolean } = {}): C | null {
    const fast = !opts.final && this.meter.isFast();
    const pick = pickSnap(candidates, this.lock, reach, { fast, ...(opts.bypass ? { bypass: true } : {}) });
    this.lock = pick ? { movingKey: pick.movingKey, targetKey: pick.targetKey } : null;
    return pick;
  }

  reset(): void {
    this.lock = null;
    this.meter.reset();
  }
}

/** Alt (Option on a Mac) held: place without connection snap. */
export function snapBypassed(e: { altKey?: boolean } | null | undefined): boolean {
  return !!e?.altKey;
}

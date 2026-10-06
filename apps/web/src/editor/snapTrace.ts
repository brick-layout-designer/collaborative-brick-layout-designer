// Snap trace: a hidden debug switch that records every frame of the last
// drag (or flex bend) so someone seeing a twitchy snap can send it in.
// Turned on with /settings?snaptrace=1 (or off with =0); Settings then
// shows "Copy snap trace". Off, nothing is recorded.

export interface SnapTraceFrame {
  /** ms since the drag started. */
  t: number;
  kind: 'drag' | 'flex';
  pointer: 'mouse' | 'touch';
  /** Pointer on the stage, screen px. */
  px: number;
  py: number;
  /** The grabbed part where the pointer has it, studs (before any snap). */
  rawX: number;
  rawY: number;
  /** Where it is drawn, studs, and its turn. */
  drawnX: number;
  drawnY: number;
  rot: number;
  /** Pointer speed, screen px/s, and whether it counted as fast. */
  speed: number;
  fast: boolean;
  /** Reach and hold distance, studs. */
  reach: number;
  hold: number;
  /** The joined target and its distance from the raw grabbed end, if any. */
  target: string | null;
  dist: number | null;
  decision: 'acquire' | 'hold' | 'switch' | 'release' | 'none' | 'drop';
}

const KEY = 'cld:snapTrace';
const MAX = 2000;
let frames: SnapTraceFrame[] = [];
let start = 0;
let last: string | null = null;

export function snapTraceEnabled(): boolean {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

export function setSnapTraceEnabled(on: boolean): void {
  try {
    if (on) localStorage.setItem(KEY, '1');
    else localStorage.removeItem(KEY);
  } catch {
    // Storage blocked: the switch just doesn't stick.
  }
}

/** A new drag begins: the previous trace is replaced. */
export function traceStart(now: number): void {
  if (!snapTraceEnabled()) return;
  frames = [];
  start = now;
  last = null;
}

/** Record a frame; the decision is worked out from the target before. */
export function traceFrame(now: number, f: Omit<SnapTraceFrame, 't' | 'decision'>, drop = false): void {
  if (!snapTraceEnabled()) return;
  const decision: SnapTraceFrame['decision'] = drop
    ? 'drop'
    : f.target === null
      ? last === null
        ? 'none'
        : 'release'
      : last === null
        ? 'acquire'
        : last === f.target
          ? 'hold'
          : 'switch';
  last = f.target;
  if (frames.length >= MAX) frames.shift();
  frames.push({ t: Math.round((now - start) * 10) / 10, ...f, decision });
}

/** The last drag's frames. */
export function lastSnapTrace(): SnapTraceFrame[] {
  return frames.slice();
}

/** The trace as text to paste in a message. */
export function snapTraceText(): string {
  return JSON.stringify({ app: 'web', userAgent: globalThis.navigator?.userAgent ?? '', frames }, null, 1);
}

// For support and the end-to-end tests.
(globalThis as unknown as { __cldSnapTrace?: () => SnapTraceFrame[] }).__cldSnapTrace = lastSnapTrace;

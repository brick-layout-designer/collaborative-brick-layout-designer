// Touch pan and pinch zoom for the canvas (the phone viewer).
//
// Pure maths so it can be unit tested: one finger drags the view, two
// fingers zoom about their midpoint and pan with it, so the map point
// that was under the fingers when they came down stays under them.

export interface Pt {
  x: number;
  y: number;
}

export interface View {
  zoom: number;
  panX: number;
  panY: number;
}

/** One-finger drag: move the view by how far the finger moved. */
export function panView(start: View, from: Pt, to: Pt): View {
  return { zoom: start.zoom, panX: start.panX + (to.x - from.x), panY: start.panY + (to.y - from.y) };
}

const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);
const mid = (a: Pt, b: Pt): Pt => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

/**
 * Two-finger pinch: zoom by the change in finger spread, clamped to
 * `range`, keeping the map point under the starting midpoint under the
 * current midpoint.
 */
export function pinchView(
  start: View,
  startA: Pt,
  startB: Pt,
  curA: Pt,
  curB: Pt,
  range: { min: number; max: number },
): View {
  const d0 = dist(startA, startB);
  const d1 = dist(curA, curB);
  const scale = d0 > 0 && d1 > 0 ? d1 / d0 : 1;
  const zoom = Math.max(range.min, Math.min(range.max, start.zoom * scale));
  const m0 = mid(startA, startB);
  const m1 = mid(curA, curB);
  // The map point under the starting midpoint…
  const worldX = (m0.x - start.panX) / start.zoom;
  const worldY = (m0.y - start.panY) / start.zoom;
  // …lands under the current midpoint.
  return { zoom, panX: m1.x - worldX * zoom, panY: m1.y - worldY * zoom };
}

// ---- touch editing ---------------------------------------------------
//
// Phones (and tablets) edit by touch: a tap picks a part, a press held
// still picks more, one finger on a picked part drags it, one finger
// anywhere else moves the view, two fingers zoom.

/** How far a finger may wander and still count as a tap or a held press. */
export const TAP_SLOP_PX = 10;
/** How long a press is held, still, before it counts as a long press. */
export const LONG_PRESS_MS = 500;

/** True once the finger has moved far enough that the press is a drag. */
export function movedBeyondSlop(from: Pt, to: Pt, slop = TAP_SLOP_PX): boolean {
  return Math.hypot(to.x - from.x, to.y - from.y) > slop;
}

export type PressOutcome = 'tap' | 'long' | 'move';

/** What a one-finger press that went from `from` to `to` in `ms` was. */
export function pressOutcome(from: Pt, to: Pt, ms: number): PressOutcome {
  if (movedBeyondSlop(from, to)) return 'move';
  return ms >= LONG_PRESS_MS ? 'long' : 'tap';
}

/**
 * Konva fires its own `tap` on a part when a finger lifts. A press that
 * moved the view, or a long press, already did something else: the part
 * must not then be picked on its own. Set while a press is in progress.
 */
export const tapGuard = { suppress: false };

/** The parts placed most recently, newest first, without repeats. */
export function pushRecent(list: readonly string[], key: string, max = 8): string[] {
  return [key, ...list.filter((k) => k !== key)].slice(0, max);
}

/** Where a duplicate lands on a touch screen: beside the original, not on top of it. */
export function besideTarget(areas: readonly { x: number; y: number; width: number; height: number }[], gap = 8): Pt | null {
  if (areas.length === 0) return null;
  let x1 = Infinity;
  let y1 = Infinity;
  let x2 = -Infinity;
  let y2 = -Infinity;
  for (const a of areas) {
    x1 = Math.min(x1, a.x);
    y1 = Math.min(y1, a.y);
    x2 = Math.max(x2, a.x + a.width);
    y2 = Math.max(y2, a.y + a.height);
  }
  // Centred a gap to the right of the group, at the same height.
  return { x: x2 + gap + (x2 - x1) / 2, y: (y1 + y2) / 2 };
}

/** The phone's View / Edit choice, kept per layout for this visit (sessionStorage). */
export function readPhoneEdit(storage: Pick<Storage, 'getItem'> | null, layoutId: string): boolean {
  try {
    return storage?.getItem(`cld:phoneMode:${layoutId}`) === 'edit';
  } catch {
    return false;
  }
}

export function writePhoneEdit(storage: Pick<Storage, 'setItem' | 'removeItem'> | null, layoutId: string, edit: boolean): void {
  try {
    if (edit) storage?.setItem(`cld:phoneMode:${layoutId}`, 'edit');
    else storage?.removeItem(`cld:phoneMode:${layoutId}`);
  } catch {
    // Private mode or blocked storage: the choice lasts until the page closes.
  }
}

/** A touch, whether the browser reports it as a TouchEvent or a touch PointerEvent. */
export function isTouchEvent(evt: unknown): boolean {
  if (!evt || typeof evt !== 'object') return false;
  if (typeof TouchEvent !== 'undefined' && evt instanceof TouchEvent) return true;
  return (evt as { pointerType?: string }).pointerType === 'touch';
}

/** sessionStorage, or null where the browser blocks it. */
export function safeSessionStorage(): Storage | null {
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage;
  } catch {
    return null;
  }
}

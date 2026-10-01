import { useEffect, useRef } from 'react';
import { LONG_PRESS_MS, movedBeyondSlop, panView, pinchView, tapGuard, type Pt, type View } from './touchGesture';

interface Options {
  /** One finger drags the view. Otherwise one finger is left to the canvas. */
  oneFingerPan: boolean;
  range: { min: number; max: number };
  /**
   * Touch editing: whether a finger coming down at `p` moves the view.
   * A finger on a picked part drags the part instead (Konva's drag).
   */
  panFrom?: (p: Pt) => boolean;
  /** A second finger came down: whatever one finger was dragging stops. */
  onPinchStart?: () => void;
  /** One finger came down and lifted without moving. */
  onTap?: (p: Pt) => void;
  /** One finger held still for LONG_PRESS_MS. */
  onLongPress?: (p: Pt) => void;
}

/**
 * Touch pan and pinch zoom on `el`: two fingers always zoom and pan the
 * canvas; one finger pans too when `oneFingerPan` is set (and `panFrom`
 * agrees). Taps and long presses are reported for touch editing. The
 * listeners are not passive, so the browser's own page zoom and scrolling
 * don't fight the canvas (the element also carries `touch-action: none`).
 */
export function useTouchView(
  el: HTMLElement | null,
  getView: () => View,
  setView: (v: View) => void,
  options: Options,
): void {
  const latest = useRef({ getView, setView, ...options });
  latest.current = { getView, setView, ...options };

  useEffect(() => {
    if (!el) return;
    let gesture:
      | { kind: 'pan'; start: View; from: Pt }
      | { kind: 'pinch'; start: View; a: Pt; b: Pt }
      | null = null;
    // The current one-finger press, for taps and long presses.
    let press: { from: Pt; moved: boolean; long: boolean; timer: ReturnType<typeof setTimeout> | null } | null = null;
    const endPress = () => {
      if (press?.timer) clearTimeout(press.timer);
      press = null;
    };
    const local = (t: Touch): Pt => {
      const r = el.getBoundingClientRect();
      return { x: t.clientX - r.left, y: t.clientY - r.top };
    };
    // (Re)start from whatever fingers are down now, so lifting one of two
    // fingers carries on as a pan without a jump.
    const begin = (e: TouchEvent) => {
      const { getView: get, oneFingerPan: pan, panFrom } = latest.current;
      if (e.touches.length >= 2) {
        gesture = { kind: 'pinch', start: get(), a: local(e.touches[0]!), b: local(e.touches[1]!) };
      } else if (e.touches.length === 1 && pan && (panFrom?.(local(e.touches[0]!)) ?? true)) {
        gesture = { kind: 'pan', start: get(), from: local(e.touches[0]!) };
      } else {
        gesture = null;
      }
    };
    // Buttons laid over the map (the touch bar, Undo / Redo) take their
    // own taps: a gesture there would swallow the click.
    const onControl = (e: TouchEvent) => !!(e.target as Element | null)?.closest?.('[data-no-gesture]');
    const onStart = (e: TouchEvent) => {
      if (onControl(e)) return;
      const wasPinch = gesture?.kind === 'pinch';
      begin(e);
      if (e.touches.length === 1) {
        // A fresh press: Konva's tap on a part counts unless this press
        // turns into something else.
        tapGuard.suppress = false;
        endPress();
        const from = local(e.touches[0]!);
        const p: NonNullable<typeof press> = { from, moved: false, long: false, timer: null };
        if (latest.current.onLongPress) {
          p.timer = setTimeout(() => {
            if (press !== p || p.moved) return;
            p.long = true;
            p.timer = null;
            tapGuard.suppress = true;
            latest.current.onLongPress?.(from);
          }, LONG_PRESS_MS);
        }
        press = p;
      } else {
        // Two fingers: no tap, no long press, and no part drag either.
        tapGuard.suppress = true;
        endPress();
        if (!wasPinch && gesture?.kind === 'pinch') latest.current.onPinchStart?.();
      }
      if (gesture) e.preventDefault();
    };
    const onMove = (e: TouchEvent) => {
      if (press && !press.moved && e.touches.length === 1 && movedBeyondSlop(press.from, local(e.touches[0]!))) {
        press.moved = true;
        tapGuard.suppress = true;
        if (press.timer) clearTimeout(press.timer);
        press.timer = null;
      }
      if (!gesture) return;
      e.preventDefault();
      const { setView: set, range: r } = latest.current;
      if (gesture.kind === 'pinch' && e.touches.length >= 2) {
        set(pinchView(gesture.start, gesture.a, gesture.b, local(e.touches[0]!), local(e.touches[1]!), r));
      } else if (gesture.kind === 'pan' && e.touches.length === 1) {
        set(panView(gesture.start, gesture.from, local(e.touches[0]!)));
      }
    };
    const onEnd = (e: TouchEvent) => {
      if (press && e.touches.length === 0) {
        const p = press;
        endPress();
        if (!p.moved && !p.long && e.type === 'touchend') latest.current.onTap?.(p.from);
      }
      if (!gesture) return;
      // Lifting a finger of a pinch: the one left pans (when one finger
      // pans at all), from where it is now.
      const { getView: get, oneFingerPan: pan } = latest.current;
      if (e.touches.length === 1 && gesture.kind === 'pinch') {
        gesture = pan ? { kind: 'pan', start: get(), from: local(e.touches[0]!) } : null;
      } else {
        begin(e);
      }
    };
    el.addEventListener('touchstart', onStart, { passive: false });
    el.addEventListener('touchmove', onMove, { passive: false });
    el.addEventListener('touchend', onEnd);
    el.addEventListener('touchcancel', onEnd);
    return () => {
      endPress();
      el.removeEventListener('touchstart', onStart);
      el.removeEventListener('touchmove', onMove);
      el.removeEventListener('touchend', onEnd);
      el.removeEventListener('touchcancel', onEnd);
    };
  }, [el]);
}

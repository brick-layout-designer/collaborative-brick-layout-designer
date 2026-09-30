import { useEffect, useRef } from 'react';
import { panView, pinchView, type Pt, type View } from './touchGesture';

interface Options {
  /** One finger drags the view (the phone viewer). Otherwise one finger is left to the canvas. */
  oneFingerPan: boolean;
  range: { min: number; max: number };
}

/**
 * Touch pan and pinch zoom on `el`: two fingers always zoom and pan the
 * canvas; one finger pans too when `oneFingerPan` is set. The listeners
 * are not passive, so the browser's own page zoom and scrolling don't
 * fight the canvas (the element also carries `touch-action: none`).
 */
export function useTouchView(
  el: HTMLElement | null,
  getView: () => View,
  setView: (v: View) => void,
  { oneFingerPan, range }: Options,
): void {
  const latest = useRef({ getView, setView, oneFingerPan, range });
  latest.current = { getView, setView, oneFingerPan, range };

  useEffect(() => {
    if (!el) return;
    let gesture:
      | { kind: 'pan'; start: View; from: Pt }
      | { kind: 'pinch'; start: View; a: Pt; b: Pt }
      | null = null;
    const local = (t: Touch): Pt => {
      const r = el.getBoundingClientRect();
      return { x: t.clientX - r.left, y: t.clientY - r.top };
    };
    // (Re)start from whatever fingers are down now, so lifting one of two
    // fingers carries on as a pan without a jump.
    const begin = (e: TouchEvent) => {
      const { getView: get, oneFingerPan: pan } = latest.current;
      if (e.touches.length >= 2) {
        gesture = { kind: 'pinch', start: get(), a: local(e.touches[0]!), b: local(e.touches[1]!) };
      } else if (e.touches.length === 1 && pan) {
        gesture = { kind: 'pan', start: get(), from: local(e.touches[0]!) };
      } else {
        gesture = null;
      }
    };
    const onStart = (e: TouchEvent) => {
      begin(e);
      if (gesture) e.preventDefault();
    };
    const onMove = (e: TouchEvent) => {
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
      if (!gesture) return;
      begin(e);
    };
    el.addEventListener('touchstart', onStart, { passive: false });
    el.addEventListener('touchmove', onMove, { passive: false });
    el.addEventListener('touchend', onEnd);
    el.addEventListener('touchcancel', onEnd);
    return () => {
      el.removeEventListener('touchstart', onStart);
      el.removeEventListener('touchmove', onMove);
      el.removeEventListener('touchend', onEnd);
      el.removeEventListener('touchcancel', onEnd);
    };
  }, [el]);
}

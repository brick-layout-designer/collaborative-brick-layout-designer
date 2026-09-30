import { useCallback, useEffect, useState } from 'react';

export interface Size {
  width: number;
  height: number;
}

/**
 * The real, current size of an element (the canvas area), for sizing the
 * Konva stage and fitting the layout to what is actually visible.
 *
 * A ResizeObserver catches everything that changes the box: the header
 * wrapping, a phone rotating, and (because the page is sized in `dvh`)
 * the browser's address bar showing or hiding. `visualViewport` resize is
 * listened to as well, since some mobile browsers resize it without a
 * layout change reaching the observer straight away.
 */
export function useElementSize(fallback: Size): [(el: HTMLElement | null) => void, Size, HTMLElement | null] {
  const [el, setEl] = useState<HTMLElement | null>(null);
  const [size, setSize] = useState<Size>(fallback);
  const ref = useCallback((node: HTMLElement | null) => setEl(node), []);

  useEffect(() => {
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      const width = Math.max(1, Math.round(r.width));
      const height = Math.max(1, Math.round(r.height));
      setSize((s) => (s.width === width && s.height === height ? s : { width, height }));
    };
    measure();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    ro?.observe(el);
    const vv = typeof window !== 'undefined' ? window.visualViewport : null;
    vv?.addEventListener('resize', measure);
    window.addEventListener('orientationchange', measure);
    window.addEventListener('resize', measure);
    return () => {
      ro?.disconnect();
      vv?.removeEventListener('resize', measure);
      window.removeEventListener('orientationchange', measure);
      window.removeEventListener('resize', measure);
    };
  }, [el]);

  return [ref, size, el];
}

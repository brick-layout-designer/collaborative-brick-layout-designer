// Right-click menus open at the pointer. Near the bottom or right edge of
// the window that put half the menu off screen (a Modules panel docked low
// could not reach "Save to Module library"), so the menu moves back in.

import { useLayoutEffect, useState, type RefObject } from 'react';

const MARGIN = 4;

/** Where a w×h menu asked for at (x, y) goes so it stays inside a vw×vh window. */
export function fitOnScreen(
  x: number, y: number, w: number, h: number, vw: number, vh: number,
): { left: number; top: number } {
  const left = Math.max(MARGIN, Math.min(x, vw - w - MARGIN));
  const top = Math.max(MARGIN, Math.min(y, vh - h - MARGIN));
  return { left, top };
}

/** The fixed-position style for a menu at `at`, moved inside the window once it is measured. */
export function useOnScreen(
  ref: RefObject<HTMLElement | null>, at: { x: number; y: number } | null,
): { position: 'fixed'; left: number; top: number; zIndex: number } {
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!at || !el) { setPos(null); return; }
    const r = el.getBoundingClientRect();
    const next = fitOnScreen(at.x, at.y, r.width, r.height, window.innerWidth, window.innerHeight);
    setPos((p) => (p && p.left === next.left && p.top === next.top ? p : next));
  }, [ref, at]);
  return { position: 'fixed', left: pos?.left ?? at?.x ?? 0, top: pos?.top ?? at?.y ?? 0, zIndex: 9999 };
}

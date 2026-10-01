import { useEffect, useState } from 'react';

const MOBILE_BREAKPOINT = 768;
/** A touch screen this short is a phone on its side, whatever its width. */
const PHONE_LANDSCAPE_MAX_HEIGHT = 500;
const SIDEBAR_PX = 260;
const TOOLBAR_PX = 48;

export interface ViewportInfo {
  width: number;
  height: number;
  isMobile: boolean;
}

/**
 * Track the editor canvas's available size and a mobile breakpoint.
 *
 * Below `MOBILE_BREAKPOINT` we drop the parts-panel sidebar so the
 * canvas gets the full window width. The editor uses `isMobile` to
 * open in View mode on small screens, with touch editing behind a
 * View / Edit switch (PLAN.md, "Touch editing").
 */
export function useViewportSize(): ViewportInfo {
  const [info, setInfo] = useState(() => measure());
  useEffect(() => {
    function onResize() {
      setInfo(measure());
    }
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);
    window.visualViewport?.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('orientationchange', onResize);
      window.visualViewport?.removeEventListener('resize', onResize);
    };
  }, []);
  return info;
}

function measure(): ViewportInfo {
  const innerWidth = typeof window === 'undefined' ? 1024 : window.innerWidth;
  const innerHeight = typeof window === 'undefined' ? 768 : window.innerHeight;
  const isMobile = isPhoneSize(innerWidth, innerHeight, coarsePointer());
  return {
    width: Math.max(100, innerWidth - (isMobile ? 0 : SIDEBAR_PX)),
    height: Math.max(100, innerHeight - TOOLBAR_PX),
    isMobile,
  };
}

export function coarsePointer(): boolean {
  try {
    return typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches;
  } catch {
    return false;
  }
}

/**
 * Phone-sized: narrower than the breakpoint, or a touch screen that is
 * short (a phone turned sideways, 915 x 412). A short desktop window with
 * a mouse keeps the full editor.
 */
export function isPhoneSize(width: number, height: number, coarse: boolean): boolean {
  return width < MOBILE_BREAKPOINT || (coarse && height < PHONE_LANDSCAPE_MAX_HEIGHT);
}

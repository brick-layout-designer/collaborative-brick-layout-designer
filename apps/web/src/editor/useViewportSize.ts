import { useEffect, useState } from 'react';

const MOBILE_BREAKPOINT = 768;
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
 * force read-only behaviour on small screens (PLAN.md §1: read-only
 * mobile viewer, no touch editing).
 */
export function useViewportSize(): ViewportInfo {
  const [info, setInfo] = useState(() => measure());
  useEffect(() => {
    function onResize() {
      setInfo(measure());
    }
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return info;
}

function measure(): ViewportInfo {
  const innerWidth = typeof window === 'undefined' ? 1024 : window.innerWidth;
  const innerHeight = typeof window === 'undefined' ? 768 : window.innerHeight;
  const isMobile = innerWidth < MOBILE_BREAKPOINT;
  return {
    width: Math.max(100, innerWidth - (isMobile ? 0 : SIDEBAR_PX)),
    height: Math.max(100, innerHeight - TOOLBAR_PX),
    isMobile,
  };
}

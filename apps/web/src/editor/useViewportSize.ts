import { useEffect, useState } from 'react';

/** Track the editor canvas's available size. Subtracts the toolbar + sidebar. */
export function useViewportSize(): { width: number; height: number } {
  const [size, setSize] = useState(() => measure());
  useEffect(() => {
    function onResize() {
      setSize(measure());
    }
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return size;
}

const SIDEBAR_PX = 260;
const TOOLBAR_PX = 48;

function measure(): { width: number; height: number } {
  return {
    width: Math.max(100, (typeof window === 'undefined' ? 1024 : window.innerWidth) - SIDEBAR_PX),
    height: Math.max(100, (typeof window === 'undefined' ? 768 : window.innerHeight) - TOOLBAR_PX),
  };
}

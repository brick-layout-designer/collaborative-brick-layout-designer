// Pages with sections (/settings#look, /profile#devices): bring the
// section named in the address into view on arrival and whenever the
// address's #part changes, so the Settings menu's links land on it.

import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

/** `ready`: the page's sections are on screen (pass false while loading). */
export function useHashScroll(ready = true): void {
  const { hash, key } = useLocation();
  useEffect(() => {
    if (!ready || hash.length < 2) return;
    let id = hash.slice(1);
    try {
      id = decodeURIComponent(id);
    } catch {
      /* keep it as it came */
    }
    document.getElementById(id)?.scrollIntoView?.({ block: 'start' });
    // `key` too: following the same link again scrolls back to it.
  }, [ready, hash, key]);
}

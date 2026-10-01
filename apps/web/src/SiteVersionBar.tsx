// "A new version of the site is ready · Reload": when the server was
// updated after this page loaded. Asks /api/version every few minutes and
// whenever the tab comes back into view. It never reloads by itself, so
// nobody loses their place while editing; the layout itself is saved live.

import { useEffect, useState } from 'react';

/** How often to ask, besides on focus. */
export const VERSION_POLL_MS = 5 * 60 * 1000;

/** Whether the server's version now differs from the one this page loaded with. */
export function isNewSiteVersion(loadedWith: string | null, now: string | null): boolean {
  if (!loadedWith || !now || loadedWith === 'unknown' || now === 'unknown') return false;
  return loadedWith !== now;
}

async function serverVersion(): Promise<string | null> {
  try {
    const res = await fetch('/api/version', { cache: 'no-store' });
    if (!res.ok) return null;
    const body = (await res.json()) as { version?: unknown };
    return typeof body.version === 'string' ? body.version : null;
  } catch {
    return null; // offline: ask again later
  }
}

export function SiteVersionBar() {
  const [ready, setReady] = useState(false);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    let loadedWith: string | null = null;
    let stopped = false;
    const check = async () => {
      const now = await serverVersion();
      if (stopped || !now) return;
      if (loadedWith === null) loadedWith = now;
      else if (isNewSiteVersion(loadedWith, now)) setReady(true);
    };
    void check();
    const timer = window.setInterval(() => void check(), VERSION_POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === 'visible') void check();
    };
    window.addEventListener('focus', onVisible);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      stopped = true;
      window.clearInterval(timer);
      window.removeEventListener('focus', onVisible);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  if (!ready || hidden) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex justify-center px-4">
      <div
        data-testid="site-version-bar"
        className="pointer-events-auto flex w-full max-w-md items-center gap-3 rounded-card border border-line bg-panel py-2 pl-4 pr-2 text-ink shadow-pop"
      >
        <span role="status" aria-live="polite" className="min-w-0 flex-1 text-sm">
          A new version of the site is ready.
        </span>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-ink hover:bg-accent-hover"
        >
          Reload
        </button>
        <button
          type="button"
          aria-label="Not now"
          title="Not now"
          onClick={() => setHidden(true)}
          className="rounded-md px-2 py-1.5 text-sm text-muted hover:bg-soft hover:text-ink"
        >
          ✕
        </button>
      </div>
    </div>
  );
}

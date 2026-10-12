// React.lazy for panels and dialogs that must keep working when the show's
// Wi-Fi drops. A plain lazy() whose download fails throws, and with no error
// boundary the whole page went blank (opening the Modules panel offline did it).
//
// lazyRetry:
//   - remembers its loader, so preloadLazy() can fetch every panel and dialog
//     while the Wi-Fi is up (the editor does it once it's idle);
//   - offline, waits for the Wi-Fi instead of failing, and says so;
//   - online, tries a few more times before giving up (a server restart).

import { lazy, type ComponentType } from 'react';
import { showToast } from './ConfirmDialog';

type Module<T> = { default: T };

const loaders = new Set<() => Promise<unknown>>();

/** What shows while a panel waits for the Wi-Fi to load. */
export const WAITING_FOR_WIFI = 'You’re offline. This opens when the Wi-Fi is back.';

function isOffline(): boolean {
  return typeof navigator !== 'undefined' && navigator.onLine === false;
}

function whenOnline(): Promise<void> {
  return new Promise((resolve) => window.addEventListener('online', () => resolve(), { once: true }));
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Loads `load()` until it works: offline it waits for the Wi-Fi (once saying
 * so), online it gives up after `tries` failures.
 */
export async function loadWithRetry<T>(load: () => Promise<T>, tries = 3, delayMs = 1500): Promise<T> {
  let told = false;
  for (let failures = 0; ; ) {
    try {
      return await load();
    } catch (e) {
      if (isOffline()) {
        if (!told) showToast(WAITING_FOR_WIFI);
        told = true;
        await whenOnline();
        continue;
      }
      failures += 1;
      if (failures >= tries) throw e;
      await wait(delayMs);
    }
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- React.lazy's own bound
export function lazyRetry<T extends ComponentType<any>>(load: () => Promise<Module<T>>) {
  let loaded: Promise<Module<T>> | null = null;
  const remember = (p: Promise<Module<T>>) => {
    loaded = p.catch((e: unknown) => {
      loaded = null;
      throw e;
    });
    return loaded;
  };
  // A quiet single try: a preload never waits or speaks up.
  loaders.add(() => loaded ?? remember(load()));
  // A preload that failed (or is failing) gets a patient retry here.
  return lazy(() => (loaded ?? remember(loadWithRetry(load))).catch(() => remember(loadWithRetry(load))));
}

/** Fetches every lazyRetry panel and dialog now, so they open without the Wi-Fi later. */
export function preloadLazy(): Promise<void> {
  if (isOffline()) return Promise.resolve();
  return Promise.all([...loaders].map((get) => get().catch(() => undefined))).then(() => undefined);
}

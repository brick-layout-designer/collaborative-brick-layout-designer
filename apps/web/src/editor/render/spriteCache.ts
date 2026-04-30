// Browser-side sprite cache. One Image promise per URL — concurrent callers
// share the same in-flight load. Phase 4 may swap to a service worker
// pre-cache so an offline tab can keep rendering existing layouts.

const cache = new Map<string, Promise<HTMLImageElement>>();

export function loadSprite(url: string): Promise<HTMLImageElement> {
  const existing = cache.get(url);
  if (existing) return existing;
  const promise = new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`failed to load sprite: ${url}`));
    img.src = url;
  });
  cache.set(url, promise);
  // If the load fails, drop the cache entry so a retry can happen later.
  promise.catch(() => cache.delete(url));
  return promise;
}

/** Synchronous lookup for already-loaded sprites; returns null on miss. */
const ready = new Map<string, HTMLImageElement>();
export function getSpriteSync(url: string): HTMLImageElement | null {
  return ready.get(url) ?? null;
}

/** Awaits the load and stashes into the sync cache for subsequent renders. */
export async function ensureSprite(url: string): Promise<HTMLImageElement> {
  const existing = ready.get(url);
  if (existing) return existing;
  const img = await loadSprite(url);
  ready.set(url, img);
  return img;
}

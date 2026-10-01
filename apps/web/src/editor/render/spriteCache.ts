// Browser-side sprite cache. One Image promise per URL — concurrent callers
// share the same in-flight load. Phase 4 may swap to a service worker
// pre-cache so an offline tab can keep rendering existing layouts.
//
// It also keeps a loading counter (how many pictures are wanted, loaded and
// failed) so the map can show "Loading part pictures… 132 of 480" while a
// layout's pictures arrive. The counter covers one "batch": a batch starts
// when a picture is asked for while nothing is loading and nothing has
// failed, so placing one new part after the layout has finished counts as
// "1 of 1", not "481 of 481".

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

/** The loading counter of the current batch. */
export interface SpriteProgress {
  /** Distinct pictures asked for in this batch. */
  wanted: number;
  /** Of those, how many have arrived. */
  loaded: number;
  /** Of those, how many couldn't be loaded. */
  failed: number;
  /** True for the first batch after `resetSpriteProgress` (a layout opening). */
  initial: boolean;
}

const batchWanted = new Set<string>();
const batchLoaded = new Set<string>();
const batchFailed = new Set<string>();
let batchInitial = true;
let snapshot: SpriteProgress = { wanted: 0, loaded: 0, failed: 0, initial: true };
const progressListeners = new Set<() => void>();
const readyListeners = new Map<string, Set<() => void>>();

function publish(): void {
  snapshot = { wanted: batchWanted.size, loaded: batchLoaded.size, failed: batchFailed.size, initial: batchInitial };
  for (const l of [...progressListeners]) l();
}

function batchSettled(): boolean {
  return batchLoaded.size + batchFailed.size >= batchWanted.size;
}

/** The current counter. The same object until something changes (for useSyncExternalStore). */
export function getSpriteProgress(): SpriteProgress {
  return snapshot;
}

/** Called whenever the counter changes. Returns the unsubscribe. */
export function subscribeSpriteProgress(listener: () => void): () => void {
  progressListeners.add(listener);
  return () => progressListeners.delete(listener);
}

/** Called once `url` has loaded (e.g. after a Retry). Returns the unsubscribe. */
export function onSpriteReady(url: string, listener: () => void): () => void {
  let set = readyListeners.get(url);
  if (!set) readyListeners.set(url, (set = new Set()));
  set.add(listener);
  return () => {
    set.delete(listener);
    if (set.size === 0) readyListeners.delete(url);
  };
}

/** Starts a fresh counter — a layout is opening. */
export function resetSpriteProgress(): void {
  batchWanted.clear();
  batchLoaded.clear();
  batchFailed.clear();
  batchInitial = true;
  publish();
}

function track(url: string): void {
  if (batchWanted.has(url) && !batchFailed.has(url)) return;
  if (batchWanted.size > 0 && batchSettled() && batchFailed.size === 0) {
    // The last batch finished cleanly: this is a new one.
    batchWanted.clear();
    batchLoaded.clear();
    batchInitial = false;
  }
  batchFailed.delete(url);
  batchWanted.add(url);
  publish();
}

/**
 * Awaits the load and stashes into the sync cache for subsequent renders.
 * `count: false` leaves it out of the loading counter: the parts panel's
 * thumbnails aren't the map's pictures.
 */
export async function ensureSprite(url: string, opts: { count?: boolean } = {}): Promise<HTMLImageElement> {
  const existing = ready.get(url);
  if (existing) return existing;
  if (opts.count !== false) track(url);
  try {
    const img = await loadSprite(url);
    ready.set(url, img);
    if (batchWanted.has(url)) {
      batchLoaded.add(url);
      publish();
    }
    for (const l of [...(readyListeners.get(url) ?? [])]) l();
    return img;
  } catch (e) {
    if (batchWanted.has(url) && !batchLoaded.has(url)) {
      batchFailed.add(url);
      publish();
    }
    throw e;
  }
}

/** Asks for every picture in `urls` at once, so the counter knows the full total. */
export function wantSprites(urls: Iterable<string>): void {
  for (const u of urls) {
    if (!ready.has(u)) void ensureSprite(u).catch(() => undefined);
  }
}

/** Tries the pictures that failed again. */
export function retryFailedSprites(): void {
  wantSprites([...batchFailed]);
}

/** Test hook: forget every picture and the counter. */
export function _resetSpriteCacheForTests(): void {
  cache.clear();
  ready.clear();
  readyListeners.clear();
  resetSpriteProgress();
}

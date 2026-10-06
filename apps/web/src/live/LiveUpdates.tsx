// Live updates: one event stream per tab (GET /api/events) while signed
// in. Each message is a small hint ("a module of this club changed");
// the lists that show it refetch through the normal routes. When the
// stream drops it reconnects with a growing wait, and refetches the
// lists once it is back (a hint may have been missed). Coming back to
// the window also refetches them, as a fallback.

import { useEffect } from 'react';
import { useQuery, useQueryClient, type QueryClient, type QueryKey } from '@tanstack/react-query';
import { api, onApiWrite } from '../api';
import { deletedId, focusKeys, hintsForWrite, isHintKind, keysFor, refetchKey, type Hint } from './invalidate';

/** Fired on window for every hint, for parts of the page that react to one (notices). */
export const HINT_EVENT = 'cld-live-hint';

/** Hints that arrive together refetch once. */
const BATCH_MS = 100;
/** At most one refetch-everything on focus in this long. */
const FOCUS_THROTTLE_MS = 15_000;

export function parseHint(data: string): Hint | null {
  try {
    const v = JSON.parse(data) as Partial<Hint> | null;
    if (!v || !isHintKind(v.kind)) return null;
    const hint: Hint = { kind: v.kind };
    if (typeof v.action === 'string') hint.action = v.action;
    if (typeof v.id === 'string') hint.id = v.id;
    if (v.owner && (v.owner.kind === 'user' || v.owner.kind === 'org') && typeof v.owner.id === 'string') hint.owner = { kind: v.owner.kind, id: v.owner.id };
    return hint;
  } catch {
    return null;
  }
}

/** Wait before reconnect attempt `n` (1, 2, 4 … 30 s, with a little jitter). */
export function backoffMs(n: number, rand: number = Math.random()): number {
  return Math.min(30_000, 1000 * 2 ** n) * (0.8 + 0.4 * rand);
}

function invalidateKeys(qc: QueryClient, keys: Iterable<QueryKey>, gone?: ReadonlySet<string>): void {
  for (const queryKey of keys) void refetchKey(qc, queryKey, gone);
}

function setStatus(s: 'open' | 'connecting' | 'off'): void {
  document.documentElement.dataset.live = s;
}

/** Collects the keys of hints that arrive together and refetches them once. */
export function createBatcher(qc: QueryClient, ms: number = BATCH_MS) {
  const pending = new Map<string, QueryKey>();
  // Ids of things the hints say were deleted: their own queries aren't refetched.
  const gone = new Set<string>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const flush = () => {
    timer = undefined;
    const keys = [...pending.values()];
    const deleted = new Set(gone);
    pending.clear();
    gone.clear();
    invalidateKeys(qc, keys, deleted);
  };
  return {
    add(hint: Hint) {
      for (const k of keysFor(hint)) pending.set(JSON.stringify(k), k);
      const id = deletedId(hint);
      if (id) gone.add(id);
      timer ??= setTimeout(flush, ms);
    },
    cancel() {
      clearTimeout(timer);
      timer = undefined;
      pending.clear();
      gone.clear();
    },
  };
}

export function LiveUpdates() {
  const qc = useQueryClient();
  const me = useQuery({ queryKey: ['me'], queryFn: api.me });
  const userId = me.data?.user?.id ?? null;

  // This tab's own changes: refetch what they touched straight away.
  useEffect(() => {
    const batch = createBatcher(qc, 0);
    const off = onApiWrite((method, path) => {
      for (const hint of hintsForWrite(method, path)) batch.add(hint);
    });
    return () => {
      off();
      batch.cancel();
    };
  }, [qc]);

  useEffect(() => {
    if (!userId || typeof EventSource === 'undefined') return;
    let es: EventSource | null = null;
    let attempt = 0;
    let everOpen = false;
    let retryTimer: number | undefined;
    const batch = createBatcher(qc);
    let stopped = false;

    const connect = () => {
      if (stopped) return;
      setStatus('connecting');
      es = new EventSource('/api/events', { withCredentials: true });
      es.onopen = () => {
        setStatus('open');
        // Back after a drop: something may have changed meanwhile.
        if (everOpen) invalidateKeys(qc, focusKeys());
        everOpen = true;
        attempt = 0;
      };
      es.onmessage = (e: MessageEvent<string>) => {
        const hint = parseHint(e.data);
        if (!hint) return;
        batch.add(hint);
        window.dispatchEvent(new CustomEvent<Hint>(HINT_EVENT, { detail: hint }));
      };
      es.onerror = () => {
        // The browser retries a dropped stream by itself; a refused one
        // (signed out, server restarting) is closed, so retry it here.
        if (es?.readyState !== EventSource.CLOSED) {
          setStatus('connecting');
          return;
        }
        es.close();
        setStatus('off');
        retryTimer = window.setTimeout(connect, backoffMs(attempt++));
      };
    };
    connect();

    return () => {
      stopped = true;
      es?.close();
      window.clearTimeout(retryTimer);
      batch.cancel();
      setStatus('off');
    };
  }, [qc, userId]);

  // Fallback: coming back to the window refetches the lists on screen.
  useEffect(() => {
    if (!userId) return;
    let last = Date.now();
    const onFocus = () => {
      if (document.visibilityState === 'hidden') return;
      const now = Date.now();
      if (now - last < FOCUS_THROTTLE_MS) return;
      last = now;
      invalidateKeys(qc, focusKeys());
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onFocus);
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onFocus);
    };
  }, [qc, userId]);

  return null;
}

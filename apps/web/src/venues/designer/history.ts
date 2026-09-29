// Undo / redo for the Venue Designer: whole-venue snapshots (venues are
// small), capped so a long session doesn't grow without end.

import type { Venue } from '@cld/bbm';

export const HISTORY_LIMIT = 200;

export interface History {
  past: Venue[];
  present: Venue;
  future: Venue[];
}

export const startHistory = (v: Venue): History => ({ past: [], present: v, future: [] });

/** A new state after an edit; nothing when it didn't change the venue. */
export function commit(h: History, next: Venue): History {
  if (next === h.present) return h;
  const past = [...h.past, h.present];
  return { past: past.length > HISTORY_LIMIT ? past.slice(past.length - HISTORY_LIMIT) : past, present: next, future: [] };
}

export function undo(h: History): History {
  const prev = h.past[h.past.length - 1];
  if (!prev) return h;
  return { past: h.past.slice(0, -1), present: prev, future: [h.present, ...h.future] };
}

export function redo(h: History): History {
  const next = h.future[0];
  if (!next) return h;
  return { past: [...h.past, h.present], present: next, future: h.future.slice(1) };
}

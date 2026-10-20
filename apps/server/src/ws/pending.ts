// Updates waiting for changes a room doesn't have yet.
//
// Yjs keeps the part of an update whose dependencies are missing in
// doc.store.pendingStructs / pendingDs, retries it on every later update and
// writes it into every snapshot, until the missing changes arrive. Normal
// flows never leave anything there: every client syncs the room before it
// edits, and its sync step 2 carries everything the room lacks
// (routes/test/wsUpdateGuard.test.ts measures the desktop's first sync, a
// paste of 1000 parts and an offline session: 0 bytes). So a room holds at
// most MAX_PENDING_BYTES of it.

import type * as Y from 'yjs';

/** Pending bytes (structs + deletions) one room holds at most. */
export const MAX_PENDING_BYTES = 2 * 1024 * 1024;

export interface PendingState {
  structs: { missing: Map<number, number>; update: Uint8Array } | null;
  ds: Uint8Array | null;
  bytes: number;
}

export function pendingBytes(doc: Y.Doc): number {
  const { pendingStructs, pendingDs } = doc.store;
  return (pendingStructs?.update.length ?? 0) + (pendingDs?.length ?? 0);
}

/** What is pending now (a copy: Yjs updates its pending record in place). */
export function savePending(doc: Y.Doc): PendingState {
  const { pendingStructs, pendingDs } = doc.store;
  return {
    structs: pendingStructs ? { missing: new Map(pendingStructs.missing), update: pendingStructs.update } : null,
    ds: pendingDs,
    bytes: pendingBytes(doc),
  };
}

/**
 * Put back what was pending before. What an update integrated stays (it is
 * in the doc, stored and sent); only what it left waiting goes. Anything of
 * the saved state that has since been integrated is skipped by Yjs when it
 * retries it, so this never changes the doc.
 */
export function restorePending(doc: Y.Doc, saved: PendingState): void {
  doc.store.pendingStructs = saved.structs ? { missing: new Map(saved.structs.missing), update: saved.structs.update } : null;
  doc.store.pendingDs = saved.ds;
}

/** Drop everything pending (it can't be read until changes nobody sent arrive). */
export function dropPending(doc: Y.Doc): void {
  doc.store.pendingStructs = null;
  doc.store.pendingDs = null;
}

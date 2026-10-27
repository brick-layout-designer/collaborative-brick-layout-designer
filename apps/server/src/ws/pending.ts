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

import * as Y from 'yjs';
import type { DecodedUpdate } from './decoded.js';

/** Pending bytes (structs + deletions) one room holds at most. */
export const MAX_PENDING_BYTES = 2 * 1024 * 1024;

/**
 * Pending deletions one room holds at most. Yjs reads all of them again on
 * every update the room takes (utils/encoding.js readUpdateV2), so they
 * cost every edit of everyone in the room; normal flows leave none.
 */
export const MAX_PENDING_DS_BYTES = 16 * 1024;

/** The clients whose changes the pending deletions wait for, read once per pending record. */
const dsClients = new WeakMap<Uint8Array, Set<number>>();
function pendingDsClients(ds: Uint8Array): Set<number> {
  let out = dsClients.get(ds);
  if (!out) {
    try {
      out = new Set(Y.decodeUpdateV2(ds).ds.clients.keys());
    } catch {
      out = new Set();
    }
    dsClients.set(ds, out);
  }
  return out;
}

/**
 * Could what is pending in `doc` land with `update`? Yjs retries pending
 * structs only once a client they wait for gets past the clock they wait
 * for, and applies a pending deletion only to a struct that arrives: so
 * only an update with structs of such a client can. Every other update
 * lands on the document as it is, whatever waits.
 */
export function pendingMayLand(doc: Y.Doc | null, update: DecodedUpdate): boolean {
  const ps = doc?.store.pendingStructs;
  const pds = doc?.store.pendingDs;
  if (!ps && !pds) return false;
  const deletes = pds ? pendingDsClients(pds) : null;
  for (const [client, structs] of update.byClient) {
    if (deletes?.has(client)) return true;
    const waits = ps?.missing.get(client);
    if (waits === undefined) continue;
    for (const s of structs) if (s.id.clock + s.length > waits) return true;
  }
  return false;
}

export interface PendingState {
  structs: { missing: Map<number, number>; update: Uint8Array } | null;
  ds: Uint8Array | null;
  bytes: number;
}

/** Pending deletion bytes (MAX_PENDING_DS_BYTES). */
export function pendingDsBytes(doc: Y.Doc): number {
  return doc.store.pendingDs?.length ?? 0;
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

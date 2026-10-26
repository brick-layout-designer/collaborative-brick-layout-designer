// Catch an update that would merge another layout into this one.
//
// An older desktop kept its Yjs doc when it opened a second live layout, so
// the first layout went to the second one's room (desktop #171 fixed the
// cause; ops/unmergeLayouts repairs the damage). This check runs on every
// incoming sync step 2 / update BEFORE it is applied.
//
// The rule is structural, not a size guess. Every client that edits a
// layout first syncs it, so whatever it adds to the layer order is placed
// next to entries it saw: a new entry's left or right origin is an item the
// room already has, or another new entry that is itself placed that way. A
// layout merged in brings its own layer order, made by clients that never
// saw this room: a chain of entries whose origins are only each other (or
// nothing). One such entry in a layout that already has a layer order is a
// cross-merge; no normal flow makes one:
//   - adding, importing, pasting, undoing: inserted next to synced entries;
//   - Make module: sidecarItems / meta keys only, no layer entries;
//   - offline edits replayed on reconnect: made on the synced doc, however
//     long the session and whatever others deleted meanwhile (anchors
//     stay in the room as tombstones), also after a server restart or a
//     rollback to a backup of this layout (routes/test/wsOfflineSessions);
//   - a desktop opening a layout fresh: an empty doc, or its own cache of
//     this layout (items the room has, or edits placed among them);
//   - a brand-new layout (no layer order yet): allowed whatever it holds.
//
// It is cheap: one decode of the update (shared with the grid guard,
// ws/decoded.ts) and lookups against the room's store, no copy of the doc.
//
// A second, softer signal is only reported: one update carrying new items
// from many clients this room has never seen. A merge of two layouts that
// share history (both started from the same catalog layout) would look
// like that without adding foreign layer entries, but so could a desktop
// restoring its cache after a server restore, so it is flagged, not refused.

import * as Y from 'yjs';
import { decodeIncoming, findStruct, type DecodedUpdate, type Struct } from './decoded.js';

/** What the check found in one incoming update. */
export interface MergeCheck {
  /** Refuse the update: it would merge another layout's layers in. */
  refuse: boolean;
  /** Apply it, but tell the admins (many unseen clients at once). */
  suspicious: boolean;
  /** Layer-order entries that aren't placed among this layout's. */
  foreignLayers: number;
  /** Clients this room has never seen that bring new items. */
  unseenClients: number;
  /** Layer-order entries the layout has now (live). */
  docLayers: number;
  updateBytes: number;
}

/** Unseen clients in one update at or above which it is flagged. */
export const SUSPICIOUS_UNSEEN_CLIENTS = 4;

const LAYERS = 'layers';

export function checkIncomingUpdate(doc: Y.Doc, update: Uint8Array): MergeCheck {
  return checkIncomingDecoded(doc, update, decodeIncoming(update));
}

/**
 * checkIncomingUpdate with the update already decoded (the live handler
 * shares one decode); null when Yjs can't read it.
 */
export function checkIncomingDecoded(doc: Y.Doc, update: Uint8Array, decoded: DecodedUpdate | null): MergeCheck {
  const order = doc.share.get(LAYERS);
  const result: MergeCheck = {
    refuse: false,
    suspicious: false,
    foreignLayers: 0,
    unseenClients: 0,
    docLayers: order ? order._length : 0,
    updateBytes: update.length,
  };
  if (!decoded) return result; // unreadable: Yjs will reject it on its own
  if (decoded.structs.length === 0) return result;

  // The room's state per client, read from its store (no state vector copy).
  const state = (client: number): number => Y.getState(doc.store, client);
  const known = (id: Y.ID): boolean => id.clock < state(id.client);
  const clients = decoded.byClient;
  const inUpdate = (id: Y.ID): Struct | null => findStruct(clients.get(id.client), id.clock);

  for (const [client, list] of clients) {
    if (state(client) === 0 && list.some((s) => s instanceof Y.Item)) result.unseenClients += 1;
  }
  result.suspicious = result.unseenClients >= SUSPICIOUS_UNSEEN_CLIENTS;

  // A layout with no layer order yet takes anything (a fresh layout).
  if (!order || order._start === null) return result;

  // Which root an item of the update sits in: its parent when encoded,
  // else its neighbour's (origins share the parent).
  // (Iterative: a long brick list is one long chain of origins.)
  const parentMemo = new Map<Struct, string | null>();
  const rootOf = (start: Y.Item): string | null => {
    const chain: Y.Item[] = [];
    const seen = new Set<Y.Item>();
    let item: Y.Item | null = start;
    let root: string | null = null;
    while (item) {
      if (parentMemo.has(item)) {
        root = parentMemo.get(item)!;
        break;
      }
      chain.push(item);
      seen.add(item);
      const p = item.parent as unknown;
      if (typeof p === 'string') {
        root = p;
        break;
      }
      if (p !== null) break; // nested in a type: not a root entry
      const ref: Y.ID | null = item.origin ?? item.rightOrigin;
      item = null;
      if (!ref) break;
      if (known(ref)) {
        try {
          const there = Y.getItem(doc.store, ref);
          if (there instanceof Y.Item && there.parent === order) root = LAYERS;
        } catch {
          /* not in the doc after all */
        }
        break;
      }
      const s = inUpdate(ref);
      if (s instanceof Y.Item && !seen.has(s)) item = s;
    }
    for (const c of chain) parentMemo.set(c, root);
    return root;
  };

  // The layer-order entries the update adds.
  const entries: Y.Item[] = [];
  for (const list of clients.values()) {
    for (const s of list) {
      if (!(s instanceof Y.Item)) continue;
      // Starts inside what the room has: its new part follows a known item.
      if (known(s.id)) continue;
      if (s.parentSub !== null) continue;
      // (Deleted ones too: a later entry can be placed next to one.)
      if (rootOf(s) === LAYERS) entries.push(s);
    }
  }
  if (entries.length === 0) return result;

  // Placed among the layout's own entries: an origin the room knows, or a
  // neighbour in the update that is itself placed so (breadth first from
  // the ones next to known items).
  const placed = new Set<Struct>();
  const waiting = new Map<Struct, Y.Item[]>();
  const queue: Y.Item[] = [];
  for (const e of entries) {
    let anchored = false;
    for (const ref of [e.origin, e.rightOrigin]) {
      if (!ref) continue;
      if (known(ref)) anchored = true;
      else {
        const s = inUpdate(ref);
        // In a struct that starts inside what the room has (an update made
        // against an older state: its new tail continues a known run).
        if (s && known(s.id)) anchored = true;
        else if (s && s !== e) {
          let w = waiting.get(s);
          if (!w) waiting.set(s, (w = []));
          w.push(e);
        }
      }
    }
    if (anchored) {
      placed.add(e);
      queue.push(e);
    }
  }
  while (queue.length > 0) {
    const s = queue.pop()!;
    for (const next of waiting.get(s) ?? []) {
      if (placed.has(next)) continue;
      placed.add(next);
      queue.push(next);
    }
  }
  for (const e of entries) {
    if (!placed.has(e) && !(e.content instanceof Y.ContentDeleted)) result.foreignLayers += e.length;
  }
  result.refuse = result.foreignLayers > 0;
  return result;
}

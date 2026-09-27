// y-websocket protocol handler. Routes the standard message types over
// a single WebSocket per (layout, client):
//
//   message-type   payload                  reply (server)
//   ──────────────────────────────────────────────────────────────────
//   sync          encoding/decoding via    sync step 2 + any local
//                 y-protocols/sync         updates the client is missing
//   awareness     awareness updates        broadcast to other clients
//
// Reference: y-websocket's bin/utils.js and the y-protocols documentation.
// This file is small because Yjs's protocol library does the heavy lifting.

import type { WebSocket } from '@fastify/websocket';
import * as syncProtocol from 'y-protocols/sync';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import type { DocSession } from './docHub.js';
import { CLOSE_LAYOUT_GONE, docHub } from './docHub.js';
import {
  MESSAGE_AWARENESS,
  MESSAGE_SYNC,
  encodeAwarenessUpdate,
  sendBytes,
} from './protocol.js';
import { resolveResourceRole } from '../access/resolveResourceRole.js';

/**
 * How often we re-check whether the connected user still has access to
 * this layout. Catches the "admin removes a collaborator while they're
 * editing" case so a removed user can't keep editing until they refresh.
 * 30s is short enough that real users barely notice; long enough that
 * the database load is negligible.
 */
const ROLE_REVALIDATE_MS = 30_000;

/**
 * Per-connection lifecycle. The handler does NOT close the WS itself;
 * callers handle close + access denial. Returns the function to call when
 * the socket disconnects (cleans up listeners and detaches from the hub).
 *
 * `role` is the user's resolved role on this layout. Viewers receive the
 * full sync stream (so they can see live edits) and may send sync step 1
 * (the "what am I missing?" request that makes the server answer with the
 * doc), but the server drops any sync step 2 / update they send —
 * preventing a hostile viewer from corrupting the doc. Awareness updates
 * are still accepted from viewers because cursor/selection broadcasting
 * is purely cosmetic.
 *
 * Persisting and broadcasting doc / awareness updates is done ONCE per
 * layout by the DocSession (see DocSession.startBroadcasting); this
 * function only wires the per-socket message handling and bookkeeping.
 */
export async function attachWsHandlers(
  ws: WebSocket,
  layoutId: string,
  userId: string,
  role: 'owner' | 'editor' | 'viewer' = 'editor',
): Promise<() => Promise<void>> {
  const session = await docHub.getOrCreate(layoutId);
  docHub.attach(session, ws, userId);
  if (session.closed) {
    // The layout was deleted between hydrate and attach.
    ws.close(CLOSE_LAYOUT_GONE, 'layout_deleted');
    return async () => {
      await docHub.detach(session, ws);
    };
  }

  // 1. Send the current state to the new client (sync step 1).
  sendSyncStep1(ws, session);

  // 2. Send the current awareness so the new client knows about peers.
  if (session.awareness.getStates().size > 0) {
    sendBytes(
      ws,
      encodeAwarenessUpdate(session.awareness, [...session.awareness.getStates().keys()]),
    );
  }

  // 3. Doc and awareness updates (persist + fan-out, awareness identity
  //    pinning) are handled by the session's single listeners.

  // 4. Wire up message handling.
  let currentRole = role;
  ws.on('message', (data: Buffer) => {
    try {
      handleMessage(ws, session, new Uint8Array(data), currentRole);
    } catch {
      // Drop malformed messages silently — Yjs protocol errors should
      // never propagate to the client.
    }
  });

  // 5. Periodic role revalidation. If the user is removed from the layout
  //    mid-session (admin yanks their share, layout is transferred away),
  //    we need to drop the connection rather than let them keep editing.
  //    Polling is the simplest fit — a DB-trigger-style notification would
  //    avoid the 30s window but pulls in pub/sub infrastructure.
  const revalidateTimer = setInterval(() => {
    void (async () => {
      try {
        const { role: refreshedRole } = await resolveResourceRole(
          userId,
          'layout',
          layoutId,
        );
        if (refreshedRole === null) {
          // Access revoked. Close with our "not_found" code so the client
          // surfaces the same error as a stale page reload would.
          ws.close(4404, 'access_revoked');
          return;
        }
        if (refreshedRole !== currentRole) {
          // Role downgraded (or upgraded). Update the in-memory copy so
          // subsequent message handling honours the new tier. We don't
          // disconnect on role change because the user still has access;
          // the editor's UI will catch up next time it refetches the
          // layout-detail query.
          currentRole = refreshedRole;
        }
      } catch {
        /* DB transient — try again next tick */
      }
    })();
  }, ROLE_REVALIDATE_MS);

  return async () => {
    clearInterval(revalidateTimer);
    // Remove this client's awareness state so others see them disappear.
    const owned = session.clientAwarenessIds.get(ws);
    if (owned && owned.size > 0 && !session.closed) {
      awarenessProtocol.removeAwarenessStates(session.awareness, [...owned], ws);
    }
    await docHub.detach(session, ws);
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function handleMessage(
  ws: WebSocket,
  session: DocSession,
  msg: Uint8Array,
  role: 'owner' | 'editor' | 'viewer',
): void {
  const decoder = decoding.createDecoder(msg);
  const messageType = decoding.readVarUint(decoder);
  switch (messageType) {
    case MESSAGE_SYNC: {
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, MESSAGE_SYNC);
      if (role === 'viewer') {
        // A viewer's sync step 1 is a read ("send me what I'm missing")
        // and is how y-websocket clients get the document at all, so it
        // must be answered. Step 2 and update messages carry the
        // viewer's own state/edits: write paths, dropped.
        const syncType = decoding.readVarUint(decoder);
        if (syncType !== syncProtocol.messageYjsSyncStep1) return;
        syncProtocol.readSyncStep1(decoder, encoder, session.doc);
      } else {
        // For step 1 (request) and step 2 (response with missing
        // updates) readSyncMessage writes the reply into `encoder`.
        syncProtocol.readSyncMessage(
          decoder,
          encoder,
          session.doc,
          ws, // origin so our own broadcasts skip this client
        );
      }
      if (encoding.length(encoder) > 1) {
        sendBytes(ws, encoding.toUint8Array(encoder));
      }
      break;
    }
    case MESSAGE_AWARENESS: {
      awarenessProtocol.applyAwarenessUpdate(
        session.awareness,
        decoding.readVarUint8Array(decoder),
        ws,
      );
      break;
    }
    default:
      // Unknown message type — ignore.
      break;
  }
}

function sendSyncStep1(ws: WebSocket, session: DocSession): void {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MESSAGE_SYNC);
  syncProtocol.writeSyncStep1(encoder, session.doc);
  sendBytes(ws, encoding.toUint8Array(encoder));
}

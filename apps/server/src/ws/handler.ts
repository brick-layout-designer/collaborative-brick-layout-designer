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
import * as Y from 'yjs';
import * as syncProtocol from 'y-protocols/sync';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import type { DocSession } from './docHub.js';
import { docHub } from './docHub.js';
import { resolveResourceRole } from '../access/resolveResourceRole.js';

const MESSAGE_SYNC = 0;
const MESSAGE_AWARENESS = 1;

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
 * full sync stream (so they can see live edits) but the server drops any
 * sync MESSAGE they try to send — preventing a hostile viewer from
 * corrupting the doc. Awareness updates are still accepted from viewers
 * because cursor/selection broadcasting is purely cosmetic.
 */
export async function attachWsHandlers(
  ws: WebSocket,
  layoutId: string,
  userId: string,
  role: 'owner' | 'editor' | 'viewer' = 'editor',
): Promise<() => Promise<void>> {
  const session = await docHub.getOrCreate(layoutId);
  docHub.attach(session, ws);

  // 1. Send the current state to the new client (sync step 1).
  sendSyncStep1(ws, session);

  // 2. Send the current awareness so the new client knows about peers.
  if (session.awareness.getStates().size > 0) {
    sendAwareness(ws, session.awareness, [...session.awareness.getStates().keys()]);
  }

  // 3. Local doc updates → persist + broadcast to everyone except the
  //    client that originated them (the origin is the WS itself).
  const onUpdate = (update: Uint8Array, origin: unknown): void => {
    void session.persistUpdate(update);
    broadcastUpdate(session, update, origin);
  };
  session.doc.on('update', onUpdate);

  // Track which awareness clientID(s) this WS has ever set — Yjs
  // assigns a fresh random clientID per Y.Doc, so a browser tab's
  // awareness clientID has no fixed relationship to anything else we
  // track (definitely not `session.doc.clientID`, which is the
  // server's OWN clientID for the shared doc, common to every
  // connection in the room). We learn the real clientID(s) the first
  // time this ws's updates flow through (`origin === ws` below), and
  // use that set to clean up on disconnect.
  const ownedClientIds = new Set<number>();

  const onAwarenessChange = (
    changes: { added: number[]; updated: number[]; removed: number[] },
    origin: unknown,
  ): void => {
    // Identity validation: a client could send awareness state with a
    // forged `user.id` / `displayName`. We don't know which client a
    // given clientID belongs to in general, but when the change came
    // FROM a specific WS (via applyAwarenessUpdate(awareness, bytes,
    // ws)), `origin === ws` and we know that client's true userId.
    // For each clientID that changed AND originated from `ws`, peek at
    // the state and overwrite `user.id` if it doesn't match.
    if (origin === ws) {
      for (const clientId of [...changes.added, ...changes.updated]) {
        ownedClientIds.add(clientId);
        const state = session.awareness.getStates().get(clientId) as
          | { user?: { id?: string } }
          | undefined;
        if (state?.user?.id && state.user.id !== userId) {
          // Spoof attempt — overwrite the user.id with the authenticated
          // value. We don't drop the rest of the state (cursor /
          // selection / displayName are cosmetic and clients are
          // responsible for using their own data anyway).
          state.user.id = userId;
        }
      }
    }

    const changedClients = [...changes.added, ...changes.updated, ...changes.removed];
    if (changedClients.length === 0) return;
    const payload = encodeAwarenessUpdate(session.awareness, changedClients);
    for (const client of session.clients) {
      const peer = client as WebSocket;
      // Skip the origin — but only if it's a peer ws. For server-side
      // origins (e.g. our hydration applyUpdate) we want everyone to see.
      if (peer === origin) continue;
      sendBytes(peer, payload);
    }
  };
  session.awareness.on('update', onAwarenessChange);

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
    session.doc.off('update', onUpdate);
    session.awareness.off('update', onAwarenessChange);
    // Remove this client's awareness state so others see them disappear.
    awarenessProtocol.removeAwarenessStates(
      session.awareness,
      [...ownedClientIds],
      ws,
    );
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
      // Viewers receive the doc state via the server-initiated step-1
      // (sent on attach in `sendSyncStep1`) and via doc.update broadcasts
      // for ongoing edits — neither path reaches this handler. So we
      // safely drop ALL sync messages a viewer tries to send: that's
      // their attempted step-2 (uploading their state) or update
      // messages (proposing edits). Both are write paths and viewers
      // have no write rights.
      if (role === 'viewer') return;
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, MESSAGE_SYNC);
      // readSyncMessage returns the response message type (0/1/2). For
      // step 1 (request) and step 2 (response with missing updates), we
      // write the reply into `encoder`.
      const syncMessageType = syncProtocol.readSyncMessage(
        decoder,
        encoder,
        session.doc,
        ws, // origin so our own broadcasts skip this client
      );
      if (encoding.length(encoder) > 1) {
        sendBytes(ws, encoding.toUint8Array(encoder));
      }
      void syncMessageType;
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

function sendAwareness(
  ws: WebSocket,
  awareness: awarenessProtocol.Awareness,
  changedClients: number[],
): void {
  const payload = encodeAwarenessUpdate(awareness, changedClients);
  sendBytes(ws, payload);
}

function encodeAwarenessUpdate(
  awareness: awarenessProtocol.Awareness,
  changedClients: number[],
): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MESSAGE_AWARENESS);
  encoding.writeVarUint8Array(
    encoder,
    awarenessProtocol.encodeAwarenessUpdate(awareness, changedClients),
  );
  return encoding.toUint8Array(encoder);
}

function broadcastUpdate(
  session: DocSession,
  update: Uint8Array,
  origin: unknown,
): void {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MESSAGE_SYNC);
  syncProtocol.writeUpdate(encoder, update);
  const bytes = encoding.toUint8Array(encoder);
  for (const client of session.clients) {
    const peer = client as WebSocket;
    if (peer === origin) continue;
    sendBytes(peer, bytes);
  }
}

function sendBytes(ws: WebSocket, bytes: Uint8Array): void {
  if (ws.readyState !== ws.OPEN) return;
  try {
    ws.send(bytes);
  } catch {
    // Socket closed mid-send; ignore — the close handler runs cleanup.
  }
}

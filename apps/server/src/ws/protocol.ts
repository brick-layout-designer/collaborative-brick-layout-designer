// y-websocket wire helpers shared by the per-connection handler
// (handler.ts) and the per-layout session (docHub.ts). Kept in their own
// module so docHub can broadcast without importing the handler.

import * as syncProtocol from 'y-protocols/sync';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as encoding from 'lib0/encoding';

export const MESSAGE_SYNC = 0;
export const MESSAGE_AWARENESS = 1;

/**
 * The slice of a WebSocket the hub needs. `@fastify/websocket`'s socket
 * (a `ws` WebSocket) satisfies it; unit tests can pass plain objects.
 */
export interface WsPeer {
  readonly readyState: number;
  readonly OPEN: number;
  send(bytes: Uint8Array): void;
  close(code?: number, reason?: string): void;
}

export function isWsPeer(x: unknown): x is WsPeer {
  return (
    typeof x === 'object' &&
    x !== null &&
    typeof (x as WsPeer).send === 'function' &&
    typeof (x as WsPeer).readyState === 'number'
  );
}

export function encodeSyncUpdate(update: Uint8Array): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MESSAGE_SYNC);
  syncProtocol.writeUpdate(encoder, update);
  return encoding.toUint8Array(encoder);
}

export function encodeAwarenessUpdate(
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

export function sendBytes(ws: unknown, bytes: Uint8Array): void {
  if (!isWsPeer(ws) || ws.readyState !== ws.OPEN) return;
  try {
    ws.send(bytes);
  } catch {
    // Socket closed mid-send; ignore — the close handler runs cleanup.
  }
}

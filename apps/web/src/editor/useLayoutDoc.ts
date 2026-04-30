// Owns the Y.Doc lifecycle for the editor.
//
// In Phase 4 this is a thin shim over y-websocket's `WebsocketProvider`.
// The provider:
//   - opens `ws://.../ws/layout/:id` (or wss in prod)
//   - performs the y-websocket sync handshake on connect
//   - streams local edits to the server, applies remote edits to the doc
//   - exposes a `Awareness` instance for cursor/selection broadcasts
//
// Persistence is now the server's job — every accepted update is written
// to `layout_updates` and periodically compacted into a fresh snapshot
// (see apps/server/src/ws/docHub.ts). The client doesn't ship a
// "save" message anymore; the Save button forces a server-side
// snapshot write via `POST /api/layouts/:id/snapshot/flush` (TODO),
// and Cmd-S becomes a no-op (every edit is already saved).

import { useCallback, useEffect, useMemo, useState } from 'react';
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import type { Awareness } from 'y-protocols/awareness';

export type SaveStatus =
  | { kind: 'connecting' }
  | { kind: 'synced' }
  | { kind: 'reconnecting'; lastSyncedAt: number | null }
  | { kind: 'offline'; lastSyncedAt: number | null }
  | { kind: 'error'; message: string };

export interface LayoutDocState {
  doc: Y.Doc | null;
  awareness: Awareness | null;
  /** Connection status — drives the synced/reconnecting indicator. */
  status: SaveStatus;
  /** Backwards-compatible no-op kept for the explicit Save button + Cmd-S. */
  saveNow: () => Promise<void>;
  /** Surfaced to the UI for "couldn't connect" cases (auth, 404, etc). */
  loadError: Error | null;
  loading: boolean;
}

/**
 * Origin tag used on every transaction the local user makes. UndoManager
 * is configured with `trackedOrigins: new Set([LOCAL_ORIGIN])` so undo
 * only walks back transactions matching this id. The origin is
 * deliberately a runtime symbol so a server-relayed update (origin =
 * the WebsocketProvider instance) doesn't get reverted by Cmd-Z.
 */
export const LOCAL_ORIGIN = Symbol('cld-local-origin');

const SYNC_TIMEOUT_MS = 10_000;

/** Build the WS URL relative to the current page (so dev + prod both work). */
function wsUrlBase(): string {
  if (typeof window === 'undefined') return '';
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${window.location.host}`;
}

export function useLayoutDoc(layoutId: string): LayoutDocState {
  const [doc, setDoc] = useState<Y.Doc | null>(null);
  const [awareness, setAwareness] = useState<Awareness | null>(null);
  const [status, setStatus] = useState<SaveStatus>({ kind: 'connecting' });
  const [loadError, setLoadError] = useState<Error | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setDoc(null);
    setAwareness(null);
    setLoading(true);
    setLoadError(null);
    setStatus({ kind: 'connecting' });

    const fresh = new Y.Doc();
    // y-websocket appends `/<roomname>` to the base URL; we want the
    // ROOM to be the literal layout id (no slashes), so we include the
    // `/ws/layout` prefix in `wsUrlBase` and use `layoutId` as room.
    const provider = new WebsocketProvider(`${wsUrlBase()}/ws/layout`, layoutId, fresh, {
      // params: we rely on the session cookie for auth; nothing else.
      connect: true,
    });

    let lastSyncedAt: number | null = null;
    let syncTimer: ReturnType<typeof setTimeout> | null = setTimeout(() => {
      // If the handshake doesn't complete within 10s, surface a clear
      // error rather than spinning forever. Common cause: the layout
      // doesn't exist or the user isn't authorized.
      setLoadError(new Error('connection timed out'));
      setStatus({ kind: 'error', message: 'connection timed out' });
    }, SYNC_TIMEOUT_MS);

    const onSync = (isSynced: boolean): void => {
      if (isSynced) {
        if (syncTimer) {
          clearTimeout(syncTimer);
          syncTimer = null;
        }
        lastSyncedAt = Date.now();
        setLoading(false);
        setDoc(fresh);
        setAwareness(provider.awareness);
        setStatus({ kind: 'synced' });
      }
    };

    const onStatus = (event: { status: 'disconnected' | 'connecting' | 'connected' }): void => {
      switch (event.status) {
        case 'connected':
          // 'sync' fires shortly after to flip us to synced.
          break;
        case 'connecting':
          setStatus({ kind: 'reconnecting', lastSyncedAt });
          break;
        case 'disconnected':
          setStatus({ kind: 'offline', lastSyncedAt });
          break;
      }
    };

    const onConnectionClose = (event: CloseEvent): void => {
      if (event.code === 4404) setLoadError(new Error('layout not found'));
      else if (event.code === 1008) setLoadError(new Error('not signed in'));
      else if (event.code === 4429) setLoadError(new Error('too many connections'));
    };

    provider.on('sync', onSync);
    provider.on('status', onStatus);
    provider.on('connection-close', onConnectionClose);

    return () => {
      if (syncTimer) clearTimeout(syncTimer);
      provider.off('sync', onSync);
      provider.off('status', onStatus);
      provider.off('connection-close', onConnectionClose);
      provider.disconnect();
      provider.destroy();
      fresh.destroy();
    };
  }, [layoutId]);

  // Save is implicit (every edit goes over WS). Kept as a no-op for the
  // Save button + Cmd-S binding so the existing UI keeps compiling. A
  // forthcoming follow-up may add a "force snapshot now" REST call.
  const saveNow = useCallback(async (): Promise<void> => {
    /* implicit save */
  }, []);

  return useMemo(
    () => ({ doc, awareness, status, saveNow, loadError, loading }),
    [doc, awareness, status, saveNow, loadError, loading],
  );
}

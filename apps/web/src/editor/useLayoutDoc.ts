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
// "save" message anymore: the server appends every accepted update to
// `layout_updates` before relaying it, so an edit is durable as soon as
// the socket is connected and synced. Save / Cmd-S therefore reports
// whether that is the case (see `saveNow`), and the editor offers a local
// .bbm download when it isn't.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import type { Awareness } from 'y-protocols/awareness';
import { canReadDoc } from '@cld/ydoc';

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
  /**
   * Explicit Save / Cmd-S. Resolves 'saved' when the socket is connected
   * and synced (every edit has then reached the server, which persists
   * each update), 'offline' otherwise.
   */
  saveNow: () => Promise<SaveResult>;
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

export type SaveResult = 'saved' | 'offline';

const SYNC_TIMEOUT_MS = 10_000;

/** Why a layout won't open when its doc is newer than this page reads. */
export const UNREADABLE_LAYOUT =
  'This layout was saved by a newer version of Brick Layout Designer. Reload the page to get the newest version, then open it again.';

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
  const providerRef = useRef<WebsocketProvider | null>(null);

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
    providerRef.current = provider;

    let lastSyncedAt: number | null = null;
    let syncTimer: ReturnType<typeof setTimeout> | null = setTimeout(() => {
      // If the handshake doesn't complete within 10s, surface a clear
      // error rather than spinning forever. Common cause: the layout
      // doesn't exist or the user isn't authorized.
      setLoadError(new Error('connection timed out'));
      setStatus({ kind: 'error', message: 'connection timed out' });
    }, SYNC_TIMEOUT_MS);

    // A layout written by a newer (or much older) version than this page
    // reads: stop syncing rather than edit what we don't understand.
    const meta = fresh.getMap('meta');
    const unreadable = (): boolean => {
      if (canReadDoc(meta.get('schemaVersion'))) return false;
      provider.disconnect();
      if (syncTimer) {
        clearTimeout(syncTimer);
        syncTimer = null;
      }
      setDoc(null);
      setLoadError(new Error(UNREADABLE_LAYOUT));
      return true;
    };
    const onMeta = (): void => {
      unreadable();
    };
    meta.observe(onMeta);

    const onSync = (isSynced: boolean): void => {
      if (isSynced) {
        if (unreadable()) return;
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

    const onConnectionClose = (event: CloseEvent | null): void => {
      if (!event) return;
      if (event.code === 4404 || event.code === 1008) {
        // Terminal: retrying can't succeed, and y-websocket would
        // otherwise keep reconnecting with backoff forever.
        provider.disconnect();
        if (syncTimer) {
          clearTimeout(syncTimer);
          syncTimer = null;
        }
        setLoadError(new Error(event.code === 4404 ? 'layout not found' : 'not signed in'));
      } else if (event.code === 4429) {
        setLoadError(
          new Error(
            event.reason === 'limit_reached'
              ? 'Too many people have this layout open right now. Try again in a little while.'
              : 'too many connections',
          ),
        );
      }
    };

    provider.on('sync', onSync);
    provider.on('status', onStatus);
    provider.on('connection-close', onConnectionClose);

    return () => {
      if (syncTimer) clearTimeout(syncTimer);
      meta.unobserve(onMeta);
      provider.off('sync', onSync);
      provider.off('status', onStatus);
      provider.off('connection-close', onConnectionClose);
      provider.disconnect();
      provider.destroy();
      if (providerRef.current === provider) providerRef.current = null;
      fresh.destroy();
    };
  }, [layoutId]);

  // Edits stream over the socket and the server persists each update on
  // receipt, so "saved" means: connected and synced right now.
  const saveNow = useCallback(async (): Promise<SaveResult> => {
    const p = providerRef.current;
    return p && p.wsconnected && p.synced ? 'saved' : 'offline';
  }, []);

  return useMemo(
    () => ({ doc, awareness, status, saveNow, loadError, loading }),
    [doc, awareness, status, saveNow, loadError, loading],
  );
}

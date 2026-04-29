// Owns the Y.Doc lifecycle for the editor:
//   - hydrate from /api/layouts/:id/snapshot
//   - track in-memory mutations (subscribe so the UI re-renders)
//   - debounced auto-save back to the server
//   - expose an explicit Save callback for UI buttons + Cmd-S
//
// Phase 4 will replace the fetch-based loader with a y-websocket connection,
// at which point this hook becomes a thin shim over y-websocket's provider.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as Y from 'yjs';
import { api } from '../api';

const AUTOSAVE_DEBOUNCE_MS = 2000;

export type SaveStatus =
  | { kind: 'idle' }
  | { kind: 'dirty' }
  | { kind: 'saving' }
  | { kind: 'saved'; at: number }
  | { kind: 'error'; message: string };

export interface LayoutDocState {
  /** The Y.Doc once loaded, or null while fetching. */
  doc: Y.Doc | null;
  /** Loading errors from the initial fetch. */
  loadError: Error | null;
  /** True until the first hydration completes. */
  loading: boolean;
  /** Save status — drives the "saved 3s ago" indicator. */
  status: SaveStatus;
  /** Server's reported docVersion. Bumps after a successful save. */
  docVersion: number;
  /** Trigger an immediate save (Save button / Cmd-S). */
  saveNow: () => Promise<void>;
}

/**
 * Origin tag used on every transaction the local user makes. Y.UndoManager
 * is configured with `trackedOrigins: new Set([clientID])` so undo only
 * walks back transactions matching this id.
 *
 * In Phase 4 this becomes the local Yjs `clientID` so other peers'
 * transactions (which carry their own clientID origin) aren't undone by us.
 */
export const LOCAL_ORIGIN = Symbol('cld-local-origin');

export function useLayoutDoc(layoutId: string): LayoutDocState {
  const [doc, setDoc] = useState<Y.Doc | null>(null);
  const [loadError, setLoadError] = useState<Error | null>(null);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<SaveStatus>({ kind: 'idle' });
  const [docVersion, setDocVersion] = useState(0);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlight = useRef<Promise<void> | null>(null);

  // Hydrate.
  useEffect(() => {
    let cancelled = false;
    setDoc(null);
    setLoading(true);
    setLoadError(null);
    api.layouts
      .snapshot(layoutId)
      .then(({ bytes, docVersion }) => {
        if (cancelled) return;
        const fresh = new Y.Doc();
        if (bytes.length > 0) Y.applyUpdate(fresh, bytes);
        setDoc(fresh);
        setDocVersion(docVersion);
        setLoading(false);
      })
      .catch((err: Error) => {
        if (cancelled) return;
        setLoadError(err);
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [layoutId]);

  // Define save first so the dirty-tracker effect below can call it.
  const saveNow = useCallback(async (): Promise<void> => {
    if (!doc) return;
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    if (inFlight.current) await inFlight.current;
    setStatus({ kind: 'saving' });
    const bytes = Y.encodeStateAsUpdate(doc);
    const promise = api.layouts
      .saveSnapshot(layoutId, bytes)
      .then((res) => {
        setStatus({ kind: 'saved', at: res.updatedAt });
        setDocVersion((v) => v + 1);
      })
      .catch((err: Error) => {
        setStatus({ kind: 'error', message: err.message });
      })
      .finally(() => {
        inFlight.current = null;
      });
    inFlight.current = promise;
    await promise;
  }, [doc, layoutId]);

  // Track dirty + schedule auto-save. Subscribe at doc level so any update,
  // anywhere, triggers a debounced save. Y.UndoManager edits also fire
  // `update` events, so undo/redo trigger the same save path.
  useEffect(() => {
    if (!doc) return;
    const onUpdate = (_update: Uint8Array, origin: unknown) => {
      // Skip the initial applyUpdate during hydration: that fires with
      // origin === null on a freshly-attached doc. We only want to mark
      // dirty for genuine local edits.
      if (origin === null) return;
      setStatus((s) => (s.kind === 'saving' ? s : { kind: 'dirty' }));
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        saveTimer.current = null;
        void saveNow();
      }, AUTOSAVE_DEBOUNCE_MS);
    };
    doc.on('update', onUpdate);
    return () => {
      doc.off('update', onUpdate);
      if (saveTimer.current) {
        clearTimeout(saveTimer.current);
        saveTimer.current = null;
      }
    };
  }, [doc, saveNow]);

  // Cmd/Ctrl-S binding.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void saveNow();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [saveNow]);

  return useMemo(
    () => ({ doc, loadError, loading, status, docVersion, saveNow }),
    [doc, loadError, loading, status, docVersion, saveNow],
  );
}

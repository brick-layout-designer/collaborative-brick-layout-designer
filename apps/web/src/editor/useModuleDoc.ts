// The module editor's Y.Doc: loaded once from the module's snapshot and
// saved back with Save (modules aren't live-shared like layouts, so there's
// no socket). Same shape as useLayoutDoc so the editor can use either.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as Y from 'yjs';
import { Awareness } from 'y-protocols/awareness';
import { canReadDoc, createDefaultLayoutDoc, docToBbm } from '@cld/ydoc';
import { api } from '../api';
import { UNREADABLE_LAYOUT, type LayoutDocState, type SaveResult, type SaveStatus } from './useLayoutDoc';

/** Whether a module doc has nothing to put parts on (a blank module from before modules opened). */
function hasNoLayers(doc: Y.Doc): boolean {
  try {
    return (docToBbm(doc)?.layers.length ?? 0) === 0;
  } catch {
    return true;
  }
}

export function useModuleDoc(moduleId: string): LayoutDocState {
  const [doc, setDoc] = useState<Y.Doc | null>(null);
  const [awareness, setAwareness] = useState<Awareness | null>(null);
  const [status, setStatus] = useState<SaveStatus>({ kind: 'connecting' });
  const [loadError, setLoadError] = useState<Error | null>(null);
  const [loading, setLoading] = useState(true);
  const docRef = useRef<Y.Doc | null>(null);
  /** Bumped on every edit, so an edit made while saving still counts as unsaved. */
  const editsRef = useRef(0);
  const afterSaveRef = useRef<(() => Promise<unknown>) | null>(null);
  const noteRef = useRef('');
  const setSaveNote = useCallback((note: string) => {
    noteRef.current = note;
  }, []);
  const setAfterSave = useCallback((fn: (() => Promise<unknown>) | null) => {
    afterSaveRef.current = fn;
  }, []);

  useEffect(() => {
    let cancelled = false;
    let loaded: Y.Doc | null = null;
    let aw: Awareness | null = null;
    setDoc(null);
    setAwareness(null);
    setLoading(true);
    setLoadError(null);
    setStatus({ kind: 'connecting' });
    editsRef.current = 0;
    const onUpdate = () => {
      editsRef.current += 1;
      setStatus({ kind: 'unsaved' });
    };
    void (async () => {
      try {
        const bytes = await api.modules.snapshot(moduleId);
        if (cancelled) return;
        let d = new Y.Doc();
        Y.applyUpdate(d, bytes);
        if (!canReadDoc(d.getMap('meta').get('schemaVersion'))) throw new Error(UNREADABLE_LAYOUT);
        // A blank module made before modules could be opened has no layers:
        // start it like a new layout (a grid and an empty brick layer).
        if (hasNoLayers(d)) {
          d.destroy();
          d = createDefaultLayoutDoc();
        }
        loaded = d;
        aw = new Awareness(d);
        d.on('update', onUpdate);
        docRef.current = d;
        setDoc(d);
        setAwareness(aw);
        setStatus({ kind: 'synced' });
        setLoading(false);
      } catch (e) {
        if (cancelled) return;
        setLoadError(e instanceof Error ? e : new Error(String(e)));
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
      if (loaded) {
        loaded.off('update', onUpdate);
        aw?.destroy();
        loaded.destroy();
      }
      docRef.current = null;
    };
  }, [moduleId]);

  // Save: the whole doc goes up as the module's new snapshot.
  const saveNow = useCallback(async (): Promise<SaveResult> => {
    const d = docRef.current;
    if (!d) return 'offline';
    const before = editsRef.current;
    setStatus({ kind: 'saving' });
    try {
      await api.modules.saveSnapshot(moduleId, Y.encodeStateAsUpdate(d), noteRef.current);
      noteRef.current = '';
    } catch (e) {
      setStatus({ kind: 'unsaved' });
      throw e;
    }
    // Its picture; a failed picture never fails the save.
    await afterSaveRef.current?.().catch(() => undefined);
    setStatus(editsRef.current === before ? { kind: 'synced' } : { kind: 'unsaved' });
    return 'saved';
  }, [moduleId]);

  return useMemo(
    () => ({ doc, awareness, status, saveNow, setAfterSave, setSaveNote, loadError, loading }),
    [doc, awareness, status, saveNow, setAfterSave, setSaveNote, loadError, loading],
  );
}

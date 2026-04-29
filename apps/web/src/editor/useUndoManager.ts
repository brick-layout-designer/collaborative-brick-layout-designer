// Per-user undo/redo via Y.UndoManager.
//
// Y.UndoManager scopes by `trackedOrigins`: only transactions whose origin
// matches an entry in the set are reversible. Phase 4 (realtime collab)
// will swap LOCAL_ORIGIN for the y-websocket clientID so each user only
// undoes their OWN edits, not their collaborators'. For Phase 3 (single
// user), LOCAL_ORIGIN is enough — every mutation goes through that origin.
//
// We bind the manager to the doc's top-level `layerData` Y.Map so any
// nested change (brick add, brick delete, brick move, brick rotate) is
// captured. Mutations that change `meta` (rename, etc.) are not reversible
// from here — they go through their own UndoManager if needed.

import { useEffect, useState } from 'react';
import * as Y from 'yjs';
import { LOCAL_ORIGIN } from './useLayoutDoc';

export interface UndoState {
  manager: Y.UndoManager | null;
  canUndo: boolean;
  canRedo: boolean;
  undo: () => void;
  redo: () => void;
}

export function useUndoManager(doc: Y.Doc | null): UndoState {
  const [state, setState] = useState<UndoState>({
    manager: null,
    canUndo: false,
    canRedo: false,
    undo: noop,
    redo: noop,
  });

  useEffect(() => {
    if (!doc) {
      setState({ manager: null, canUndo: false, canRedo: false, undo: noop, redo: noop });
      return;
    }

    const manager = new Y.UndoManager(doc.getMap('layerData'), {
      trackedOrigins: new Set([LOCAL_ORIGIN]),
      // 200ms group means rapid keypress-driven edits (e.g. holding Q) all
      // collapse into one undo step. Larger drag operations are already
      // single transactions, so this only affects micro-edits.
      captureTimeout: 200,
    });

    const updateState = () => {
      setState({
        manager,
        canUndo: manager.canUndo(),
        canRedo: manager.canRedo(),
        undo: () => manager.undo(),
        redo: () => manager.redo(),
      });
    };

    manager.on('stack-item-added', updateState);
    manager.on('stack-item-popped', updateState);
    updateState();

    function onKey(e: KeyboardEvent) {
      if (!(e.metaKey || e.ctrlKey)) return;
      if (e.target instanceof HTMLElement && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) {
        return;
      }
      if (e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        manager.undo();
      } else if ((e.key === 'z' && e.shiftKey) || e.key === 'y') {
        e.preventDefault();
        manager.redo();
      }
    }
    window.addEventListener('keydown', onKey);

    return () => {
      window.removeEventListener('keydown', onKey);
      manager.destroy();
    };
  }, [doc]);

  return state;
}

function noop(): void {
  // intentional
}

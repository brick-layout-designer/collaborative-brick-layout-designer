// Re-render on any deep change in a Y.Doc / Y.Map / Y.Array.
//
// Listens to 'afterAllTransactions' on the Y.Doc (fires once per
// transaction batch, including undo/redo) so the canvas always re-renders
// with the fully-committed post-transaction state.

import { useCallback, useEffect, useState } from 'react';
import * as Y from 'yjs';

/** Re-renders the calling component whenever any change fires on `target`. */
export function useYjsSnapshot(target: Y.Doc | Y.AbstractType<unknown> | null): number {
  const [rev, setRev] = useState(0);
  const bump = useCallback(() => setRev((r) => r + 1), []);

  useEffect(() => {
    if (!target) return;
    if (target instanceof Y.Doc) {
      // 'afterAllTransactions' fires once after every committed batch
      // (including undo/redo), guaranteeing the doc is fully settled.
      target.on('afterAllTransactions', bump);
      return () => target.off('afterAllTransactions', bump);
    }
    target.observeDeep(bump);
    return () => target.unobserveDeep(bump);
  }, [target, bump]);

  return rev;
}


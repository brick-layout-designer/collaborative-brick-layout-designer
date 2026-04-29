// Re-render on any deep change in a Y.Doc / Y.Map / Y.Array.
//
// React's render model expects derived state to be a pure function of
// "what changed". For Yjs, the cheapest signal is "anything changed" —
// we just bump a counter and let the consumer re-derive whatever it needs.
// More targeted subscriptions can come later if they're a measurable win.

import { useEffect, useState, useSyncExternalStore } from 'react';
import * as Y from 'yjs';

/** Re-renders the calling component whenever any change fires on `target`. */
export function useYjsSnapshot(target: Y.Doc | Y.AbstractType<unknown> | null): number {
  const [revision, setRev] = useState(0);
  useEffect(() => {
    if (!target) return;
    const bump = () => setRev((r) => r + 1);
    if (target instanceof Y.Doc) {
      target.on('update', bump);
      return () => target.off('update', bump);
    }
    target.observeDeep(bump);
    return () => target.unobserveDeep(bump);
  }, [target]);
  return revision;
}

/**
 * Cheap external-store subscription for a Y.Doc. Equivalent to the hook
 * above but uses `useSyncExternalStore` so React 18's tearing protections
 * apply — useful when the doc updates during a concurrent render.
 */
export function useYjsDoc(doc: Y.Doc | null): Y.Doc | null {
  const subscribe = (onChange: () => void): (() => void) => {
    if (!doc) return () => undefined;
    doc.on('update', onChange);
    return () => doc.off('update', onChange);
  };
  // The "snapshot" is just the doc reference; we want React to re-render
  // when an update fires, but not to compare doc bytes.
  const getSnapshot = () => doc;
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

// Shared, structurally-shared BbmMap projection of the live layout doc.
//
// Every consumer (Editor, Canvas, Layers panel, Used-parts panel, status
// bar) used to run its own full `docToBbm` on every Yjs transaction —
// 3-4 full projections per edit, each allocating fresh Brick objects so
// no memoised renderer could ever skip work. One cached projector per doc
// now serves them all: a call is O(1) while the doc is unchanged, and
// after an edit only the touched bricks/layers get new objects.
//
// The returned map is SHARED and must be treated as read-only. Use
// `docToBbm(doc)` when you need a private copy to mutate.

import { useMemo } from 'react';
import type * as Y from 'yjs';
import type { BbmMap } from '@cld/model';
import { createDocProjector, type DocProjector } from '@cld/ydoc';
import { useYjsSnapshot } from './useYjsSnapshot';

// One projector per doc for the doc's lifetime. Kept in a WeakMap rather
// than tied to a component so StrictMode's mount/unmount/remount can't
// leave a component holding a detached projector. `doc.destroy()` drops
// the observers; the WeakMap entry is collected with the doc.
const projectors = new WeakMap<Y.Doc, DocProjector>();

export function getDocProjector(doc: Y.Doc): DocProjector {
  let p = projectors.get(doc);
  if (!p) {
    p = createDocProjector(doc);
    projectors.set(doc, p);
  }
  return p;
}

/** Latest projection of `doc` (null while the doc is incomplete). */
export function projectDoc(doc: Y.Doc | null): BbmMap | null {
  if (!doc) return null;
  try {
    return getDocProjector(doc).project();
  } catch {
    return null;
  }
}

/** Subscribe to `doc` and return its shared projection. */
export function useDocMap(doc: Y.Doc | null): BbmMap | null {
  const rev = useYjsSnapshot(doc);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => projectDoc(doc), [doc, rev]);
}

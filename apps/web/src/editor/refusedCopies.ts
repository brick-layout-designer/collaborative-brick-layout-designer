// Layouts whose changes the server refused (1008 layout_merge_refused,
// apps/server/src/ws/mergeGuard.ts): the page's copy is the only place that
// work lives, so it's kept here, outside the editor, until the person has
// saved it as a new layout or downloaded it. Leaving the editor doesn't
// drop it, and the page asks before it is closed or reloaded meanwhile.
// RefusedCopies.tsx shows them on every page.

import * as Y from 'yjs';
import { create } from 'zustand';

/**
 * Why the server never got the copy's changes: it refused them as a merge
 * (1008 layout_merge_refused) or as something the apps can't read (1008
 * unreadable_update, apps/server/src/ws/updateGuard.ts), the person was
 * signed out, or the layout was deleted (or unshared).
 */
export type RefusedWhy = 'merge' | 'unreadable' | 'signed_out' | 'gone';

export interface RefusedCopy {
  /** Unique per copy (one layout can be refused twice). */
  key: number;
  layoutId: string;
  doc: Y.Doc;
  why: RefusedWhy;
  /** Saved as a new layout or downloaded: safe to let go of. */
  kept: boolean;
}

interface State {
  copies: RefusedCopy[];
}

export const useRefusedCopies = create<State>(() => ({ copies: [] }));

let nextKey = 1;

function onUnload(e: BeforeUnloadEvent): void {
  if (!useRefusedCopies.getState().copies.some((c) => !c.kept)) return;
  e.preventDefault();
  e.returnValue = '';
}

function guardUnload(on: boolean): void {
  if (typeof window === 'undefined') return;
  if (on) window.addEventListener('beforeunload', onUnload);
  else window.removeEventListener('beforeunload', onUnload);
}

/** Whether a doc holds anything at all (a refusal before the layout arrived holds nothing). */
function hasContent(doc: Y.Doc): boolean {
  return doc.store.clients.size > 0;
}

/**
 * Keep a refused layout's doc. The caller hands it over: it must not
 * destroy it. Returns false when there was nothing to keep.
 */
export function keepRefusedCopy(layoutId: string, doc: Y.Doc, why: RefusedWhy = 'merge'): boolean {
  if (!hasContent(doc)) return false;
  const { copies } = useRefusedCopies.getState();
  if (copies.some((c) => c.doc === doc)) return true;
  if (copies.length === 0) guardUnload(true);
  useRefusedCopies.setState({ copies: [...copies, { key: nextKey++, layoutId, doc, why, kept: false }] });
  return true;
}

/** Saved or downloaded: closing the page no longer asks about it. */
export function markRefusedCopyKept(key: number): void {
  useRefusedCopies.setState((s) => ({ copies: s.copies.map((c) => (c.key === key ? { ...c, kept: true } : c)) }));
}

/** Let go of a copy (after it was kept, or the person chose to discard it). */
export function dropRefusedCopy(key: number): void {
  const { copies } = useRefusedCopies.getState();
  const gone = copies.find((c) => c.key === key);
  if (!gone) return;
  const rest = copies.filter((c) => c.key !== key);
  useRefusedCopies.setState({ copies: rest });
  if (rest.length === 0) guardUnload(false);
  gone.doc.destroy();
}

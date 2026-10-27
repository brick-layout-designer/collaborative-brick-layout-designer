// "Update available" for placed custom sets whose set changed since they
// were placed (editor/setUpdates.ts): which ones, with Update and Show.
// Nothing updates by itself; the bar comes back when a set changes again.

import { useState } from 'react';
import { HelpButton } from '../help/HelpButton';
import type { SetUpdate } from './setUpdates';

interface Props {
  updates: readonly SetUpdate[];
  /** Update these placed copies (one undo step). */
  onUpdate: (updates: readonly SetUpdate[]) => void;
  /** Pick these placed copies on the map. */
  onShow: (updates: readonly SetUpdate[]) => void;
  /** On a phone: at the top, under Undo / Redo (a phone on its side has little map below). */
  top?: boolean;
}

export function SetUpdatesBar({ updates, onUpdate, onShow, top = false }: Props) {
  // Closed for these versions; a newer version shows it again.
  const [closedFor, setClosedFor] = useState('');
  const key = updates.map((u) => `${u.link.id}:${u.set.setVersion}`).join(',');
  if (updates.length === 0 || closedFor === key) return null;
  const names = new Map<string, number>();
  for (const u of updates) names.set(u.name, (names.get(u.name) ?? 0) + 1);
  const listed = [...names].map(([name, n]) => (n > 1 ? `“${name}” (${n} placed)` : `“${name}”`)).join(', ');
  const one = updates.length === 1;
  return (
    // On the map, not the screen: it never covers the panels beside it. Above
    // the scale card and the touch bar, or on a phone under Undo / Redo.
    <div
      className="pointer-events-none absolute inset-x-0 z-30 flex justify-center px-3"
      style={top ? { top: 'var(--touch-top, 0.5rem)' } : { bottom: 'calc(4.5rem + var(--touch-bar-h, 0px))' }}
    >
      <div
        role="status"
        data-testid="set-updates"
        className="pointer-events-auto flex min-w-0 max-w-xl flex-wrap items-center gap-x-3 gap-y-2 rounded-card border border-accent bg-panel px-4 py-3 text-sm text-ink shadow-lg"
      >
        <span className="flex min-w-0 items-start gap-1">
          <span>
            <span className="font-semibold">Update available:</span> {names.size === 1 ? `the set ${listed} changed since it was placed.` : `the sets ${listed} changed since they were placed.`}
          </span>
          <HelpButton helpKey="set.updates" />
        </span>
        <span className="flex gap-2">
          <button type="button" onClick={() => onShow(updates)} className="min-h-9 rounded-lg border border-border px-3 py-1 hover:bg-soft">
            Show
          </button>
          <button type="button" onClick={() => onUpdate(updates)} className="min-h-9 rounded-lg bg-accent px-3 py-1 font-semibold text-accent-ink hover:bg-accent-hover">
            {one ? 'Update' : `Update all ${updates.length}`}
          </button>
          <button type="button" aria-label="Not now" title="Not now" onClick={() => setClosedFor(key)} className="min-h-9 min-w-9 rounded-control px-1.5 text-muted hover:bg-soft hover:text-ink">
            ×
          </button>
        </span>
      </div>
    </div>
  );
}

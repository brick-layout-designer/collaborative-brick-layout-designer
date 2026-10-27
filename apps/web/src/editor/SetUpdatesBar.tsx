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
  /** Editing by touch: sit above the touch bar. */
  lifted?: boolean;
}

export function SetUpdatesBar({ updates, onUpdate, onShow, lifted = false }: Props) {
  // Closed for these versions; a newer version shows it again.
  const [closedFor, setClosedFor] = useState('');
  const key = updates.map((u) => `${u.link.id}:${u.set.setVersion}`).join(',');
  if (updates.length === 0 || closedFor === key) return null;
  const names = new Map<string, number>();
  for (const u of updates) names.set(u.name, (names.get(u.name) ?? 0) + 1);
  const listed = [...names].map(([name, n]) => (n > 1 ? `“${name}” (${n} placed)` : `“${name}”`)).join(', ');
  const one = updates.length === 1;
  return (
    <div className={`pointer-events-none fixed inset-x-0 z-30 flex justify-center px-4 ${lifted ? 'bottom-52' : 'bottom-28'}`}>
      <div
        role="status"
        data-testid="set-updates"
        className="pointer-events-auto flex max-w-xl flex-wrap items-center gap-x-3 gap-y-2 rounded-card border border-accent bg-panel px-4 py-3 text-sm text-ink shadow-lg"
      >
        <span className="flex items-start gap-1">
          <span>
            <span className="font-semibold">Update available:</span> {names.size === 1 ? `the set ${listed} changed since it was placed.` : `the sets ${listed} changed since they were placed.`}
          </span>
          <HelpButton helpKey="set.updates" />
        </span>
        <span className="flex gap-2">
          <button type="button" onClick={() => onShow(updates)} className="rounded-lg border border-border px-3 py-1 hover:bg-soft">
            Show
          </button>
          <button type="button" onClick={() => onUpdate(updates)} className="rounded-lg bg-accent px-3 py-1 font-semibold text-accent-ink hover:bg-accent-hover">
            {one ? 'Update' : `Update all ${updates.length}`}
          </button>
          <button type="button" aria-label="Not now" title="Not now" onClick={() => setClosedFor(key)} className="rounded-control px-1.5 text-muted hover:bg-soft hover:text-ink">
            ×
          </button>
        </span>
      </div>
    </div>
  );
}

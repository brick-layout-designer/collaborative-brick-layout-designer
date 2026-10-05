// The bar over the map while a module is edited: "Editing module ‹name›",
// who else is in it ("Sam is here too", from presence), and Done. The
// desktop's MapView shows the same bar.

import type * as Y from 'yjs';
import type { Awareness } from 'y-protocols/awareness';
import { readSidecarFromDoc } from '@cld/ydoc';
import { useEditorStore } from './editorStore';
import { useRemotePeers } from './useAwareness';
import { hereTooText } from './moduleEdit';
import { leaveModuleEdit } from './moduleActions';
import { HelpButton } from '../help/HelpButton';

export function ModuleEditBar({ doc, awareness }: { doc: Y.Doc; awareness: Awareness | null }) {
  const editingId = useEditorStore((s) => s.editingModuleId);
  const peers = useRemotePeers(awareness);
  if (!editingId) return null;
  const mod = readSidecarFromDoc(doc)?.modules?.find((m) => m.id === editingId);
  if (!mod) return null;
  const others = hereTooText(peers.filter((p) => p.state.editingModule === editingId).map((p) => p.state.user.displayName));
  return (
    <div
      role="status"
      data-testid="module-edit-bar"
      className="pointer-events-none absolute inset-x-0 top-2 z-20 flex justify-center px-4"
    >
      <div className="pointer-events-auto flex max-w-full items-center gap-3 rounded-full border border-line bg-panel/95 py-1.5 pl-4 pr-1.5 text-sm text-ink shadow-lg">
        <span className="min-w-0 truncate">
          Editing module <strong className="font-semibold">{mod.name || '(module)'}</strong>
        </span>
        {others && (
          <span data-testid="module-edit-others" className="truncate text-xs text-muted">
            {others}
          </span>
        )}
        <HelpButton helpKey="module.edit" />
        <button
          type="button"
          onClick={leaveModuleEdit}
          className="rounded-full bg-accent px-3 py-1 text-sm font-medium text-accent-ink hover:bg-accent-hover"
          title="Back to the whole layout (Esc)"
        >
          Done
        </button>
      </div>
    </div>
  );
}

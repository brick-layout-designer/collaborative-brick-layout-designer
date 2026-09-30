// "Insert module" command. Lists the user's modules, downloads the
// chosen module's Y.Doc snapshot, extracts its bricks, and inserts
// them into the active layout at the centre of the viewport.
//
// Modules are stored as Y.Doc snapshots with the same shape as a
// layout (PLAN.md §3.2). We reuse `docToBbm` to extract bricks; only
// LayerBrick contents are copied — text cells / areas / rulers in
// modules are silently skipped because the desktop's `Module` doesn't
// model those either.

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type * as Y from 'yjs';
import { api } from '../api';
import { useEditorStore } from './editorStore';
import { importBricksAsModule } from './mutations';
import { fetchModuleBatches } from './moduleSnapshot';

interface Props {
  doc: Y.Doc;
  onClose: () => void;
}

export function InsertModuleDialog({ doc, onClose }: Props) {
  const list = useQuery({ queryKey: ['modules'], queryFn: api.modules.list });
  const [error, setError] = useState<string | null>(null);

  const insert = useMutation({
    mutationFn: async (moduleId: string) => {
      const batches = await fetchModuleBatches(moduleId);
      // Modules are saved centred on the origin, so the block lands at
      // (0,0); drag from the Module Library to drop it at the cursor.
      // Bricks keep their source layer names and become a sidecar module
      // in the same undo step (desktop ImportBbmAsModuleCommand).
      const title = list.data?.modules.find((m) => m.id === moduleId)?.title ?? 'Module';
      const res = importBricksAsModule(doc, batches, { name: title });
      if (res) useEditorStore.getState().setSelection(res.ids);
    },
    onSuccess: () => onClose(),
    onError: (e: Error) => setError(e.message),
  });

  return (
    <div className="fixed inset-0 grid place-items-center bg-black/60 p-4">
      <div className="w-full max-w-md space-y-3 rounded-lg border border-line bg-panel p-6 text-sm">
        <div className="flex items-start justify-between">
          <div>
            <h3 className="text-lg font-semibold">Insert module</h3>
            <p className="text-xs text-muted">
              Pick a saved module to drop its bricks into the active layer.
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded-sm p-1 text-muted hover:bg-soft"
          >
            ✕
          </button>
        </div>

        {list.isLoading && <p className="text-muted">Loading…</p>}
        {list.data && list.data.modules.length === 0 && (
          <p className="rounded-sm border border-dashed border-line p-4 text-muted">
            No saved modules yet. Create one from the Library page.
          </p>
        )}
        {list.data && list.data.modules.length > 0 && (
          <ul className="max-h-80 divide-y divide-line overflow-y-auto rounded-sm border border-line">
            {list.data.modules.map((m) => (
              <li
                key={m.id}
                className="flex items-center justify-between px-3 py-2"
              >
                <div>
                  <p>{m.title}</p>
                  <p className="text-xs text-muted">
                    v{m.docVersion} · updated {new Date(m.updatedAt).toLocaleString()}
                  </p>
                </div>
                <button
                  onClick={() => insert.mutate(m.id)}
                  disabled={insert.isPending}
                  className="rounded-sm bg-accent text-accent-ink px-3 py-1 text-xs hover:bg-accent-hover disabled:opacity-50"
                >
                  Insert
                </button>
              </li>
            ))}
          </ul>
        )}

        {error && (
          <p className="rounded-sm border border-red-900 bg-red-950/30 p-2 text-xs text-red-300">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}


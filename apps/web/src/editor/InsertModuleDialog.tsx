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
      <div className="w-full max-w-md space-y-3 rounded-lg border border-neutral-800 bg-neutral-900 p-6 text-sm">
        <div className="flex items-start justify-between">
          <div>
            <h3 className="text-lg font-semibold">Insert module</h3>
            <p className="text-xs text-neutral-500">
              Pick a saved module to drop its bricks into the active layer.
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded p-1 text-neutral-400 hover:bg-neutral-800"
          >
            ✕
          </button>
        </div>

        {list.isLoading && <p className="text-neutral-500">Loading…</p>}
        {list.data && list.data.modules.length === 0 && (
          <p className="rounded border border-dashed border-neutral-800 p-4 text-neutral-500">
            No saved modules yet. Create one from the Library page.
          </p>
        )}
        {list.data && list.data.modules.length > 0 && (
          <ul className="max-h-80 divide-y divide-neutral-800 overflow-y-auto rounded border border-neutral-800">
            {list.data.modules.map((m) => (
              <li
                key={m.id}
                className="flex items-center justify-between px-3 py-2"
              >
                <div>
                  <p>{m.title}</p>
                  <p className="text-xs text-neutral-500">
                    v{m.docVersion} · updated {new Date(m.updatedAt).toLocaleString()}
                  </p>
                </div>
                <button
                  onClick={() => insert.mutate(m.id)}
                  disabled={insert.isPending}
                  className="rounded bg-blue-600 px-3 py-1 text-xs hover:bg-blue-500 disabled:opacity-50"
                >
                  Insert
                </button>
              </li>
            ))}
          </ul>
        )}

        {error && (
          <p className="rounded border border-red-900 bg-red-950/30 p-2 text-xs text-red-300">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}


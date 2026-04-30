// Module Library Panel — port of desktop ModuleLibraryPanel.cpp.
// Lists the user's saved server modules; supports click-to-insert and
// drag-to-canvas (MIME `application/x-cld-module` carrying the module id).
// Drag drop is handled by the canvas event listeners in EditorPage.

import { useState } from 'react';
import * as Y from 'yjs';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { docToBbm } from '@cld/ydoc';
import type { ModuleSummary } from '../api';
import { api } from '../api';
import { useEditorStore } from './editorStore';
import { ensureBrickLayer, insertBricks } from './mutations';

export const MODULE_MIME = 'application/x-cld-module';

interface Props {
  doc: Y.Doc;
  isViewer: boolean;
}

export function ModuleLibraryPanel({ doc, isViewer }: Props) {
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ['modules'], queryFn: api.modules.list, staleTime: 30_000 });
  const [filter, setFilter] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [inserting, setInserting] = useState<string | null>(null);
  const activeLayerId = useEditorStore((s) => s.activeLayerId);

  const modules = (list.data?.modules ?? []).filter((m) =>
    !filter.trim() || m.title.toLowerCase().includes(filter.trim().toLowerCase()),
  );

  async function insertModule(moduleId: string) {
    if (inserting) return;
    setError(null);
    setInserting(moduleId);
    try {
      const res = await fetch(`/api/modules/${moduleId}/snapshot`, { credentials: 'include' });
      if (!res.ok) throw new Error(`snapshot fetch failed: ${res.status}`);
      const buf = await res.arrayBuffer();
      const moduleDoc = new Y.Doc();
      Y.applyUpdate(moduleDoc, new Uint8Array(buf));
      let map: ReturnType<typeof docToBbm>;
      try { map = docToBbm(moduleDoc); } catch { moduleDoc.destroy(); throw new Error('snapshot invalid or empty'); }
      moduleDoc.destroy();
      const bricks = map.layers
        .filter((l): l is Extract<typeof l, { type: 'brick' }> => l.type === 'brick')
        .flatMap((l) => l.bricks);
      if (bricks.length === 0) throw new Error('module has no bricks');
      const layerId = activeLayerId ?? ensureBrickLayer(doc);
      insertBricks(doc, layerId, bricks);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setInserting(null);
    }
  }

  return (
    <aside className="flex h-full min-h-0 w-full flex-col bg-neutral-925 text-sm">
      <div className="border-b border-neutral-800 p-2">
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter modules…"
          className="w-full rounded border border-neutral-700 bg-neutral-800 px-2 py-1 text-xs"
        />
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto">
        {list.isLoading && <p className="p-3 text-xs text-neutral-500">Loading…</p>}
        {!list.isLoading && modules.length === 0 && (
          <p className="p-3 text-xs text-neutral-500">
            {filter ? 'No modules match.' : 'No saved modules yet.'}
          </p>
        )}
        {error && (
          <p className="mx-2 mt-2 rounded border border-red-900 bg-red-950/30 px-2 py-1 text-xs text-red-300">
            {error}
          </p>
        )}
        <ul className="divide-y divide-neutral-800/60">
          {modules.map((m) => (
            <ModuleLibraryRow
              key={m.id}
              module={m}
              isViewer={isViewer}
              isInserting={inserting === m.id}
              onInsert={() => void insertModule(m.id)}
              onDelete={() => {
                if (!confirm(`Delete module "${m.title}"?`)) return;
                void api.modules.remove(m.id).then(() =>
                  qc.invalidateQueries({ queryKey: ['modules'] }),
                );
              }}
            />
          ))}
        </ul>
      </div>
    </aside>
  );
}

function ModuleLibraryRow({
  module,
  isViewer,
  isInserting,
  onInsert,
  onDelete,
}: {
  module: ModuleSummary;
  isViewer: boolean;
  isInserting: boolean;
  onInsert: () => void;
  onDelete: () => void;
}) {
  return (
    <li
      draggable
      onDragStart={(e) => {
        if (!e.dataTransfer) return;
        e.dataTransfer.effectAllowed = 'copy';
        e.dataTransfer.setData(MODULE_MIME, module.id);
        e.dataTransfer.setData('text/plain', module.id);
      }}
      className="group flex cursor-grab items-start justify-between gap-2 px-2 py-2 hover:bg-neutral-800/60 active:cursor-grabbing"
    >
      <div className="min-w-0 flex-1 leading-tight" onDoubleClick={isViewer ? undefined : onInsert}>
        <p className="truncate font-medium text-neutral-200 text-xs">{module.title}</p>
        <p className="text-[10px] text-neutral-600">
          v{module.docVersion} · {new Date(module.updatedAt).toLocaleDateString()}
        </p>
      </div>
      {!isViewer && (
        <div className="flex shrink-0 gap-1 opacity-0 group-hover:opacity-100">
          <button
            onClick={onInsert}
            disabled={isInserting}
            title="Insert into layout"
            className="rounded px-1.5 py-0.5 text-[10px] text-blue-400 hover:bg-blue-900/40 disabled:opacity-40"
          >
            {isInserting ? '…' : '↓'}
          </button>
          <button
            onClick={onDelete}
            title="Delete module"
            className="rounded px-1.5 py-0.5 text-[10px] text-red-400 hover:bg-red-900/40"
          >
            ✕
          </button>
        </div>
      )}
    </li>
  );
}

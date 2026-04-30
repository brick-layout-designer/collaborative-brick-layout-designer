// "Save selection as module" dialog — port of desktop's
// CreateModuleCommand (ModuleCommands.cpp). Collects the selected bricks
// from all brick layers, normalises positions so the centroid is at the
// origin, seeds a new Y.Doc, and POSTs it to /api/modules.

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import * as Y from 'yjs';
import { seedFromBbm, encodeDoc } from '@cld/ydoc';
import type { BbmMap, Brick } from '@cld/model';
import { api } from '../api';

interface Props {
  map: BbmMap;
  selection: string[];
  onClose: () => void;
  onSaved: (moduleId: string, title: string) => void;
}

export function SaveModuleDialog({ map, selection, onClose, onSaved }: Props) {
  const [title, setTitle] = useState('');
  const [error, setError] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const save = useMutation({
    mutationFn: async (name: string) => {
      const selSet = new Set(selection);

      // Collect selected bricks per brick layer.
      const bricksByLayer: { name: string; bricks: Brick[] }[] = [];
      for (const layer of map.layers) {
        if (layer.type !== 'brick') continue;
        const picked = layer.bricks.filter((b) => selSet.has(b.id));
        if (picked.length > 0) bricksByLayer.push({ name: layer.name, bricks: picked });
      }
      const allBricks = bricksByLayer.flatMap((l) => l.bricks);
      if (allBricks.length === 0) throw new Error('No bricks selected');

      // Translate so the centroid lands at (0, 0).
      let sumX = 0, sumY = 0;
      for (const b of allBricks) {
        sumX += b.displayArea.x + b.displayArea.width / 2;
        sumY += b.displayArea.y + b.displayArea.height / 2;
      }
      const cx = sumX / allBricks.length;
      const cy = sumY / allBricks.length;

      const defaultHull = { isVisible: false, hullColor: { kind: 'known' as const, name: 'black' }, hullThickness: 1 };

      const moduleMap: BbmMap = {
        version: map.version,
        nbItems: allBricks.length,
        backgroundColor: map.backgroundColor,
        author: map.author,
        lug: map.lug,
        event: map.event,
        date: map.date,
        comment: '',
        exportInfo: map.exportInfo,
        selectedLayerIndex: 0,
        layers: bricksByLayer.map((layer, i) => ({
          type: 'brick' as const,
          id: `module-layer-${i}`,
          name: layer.name,
          visible: true,
          transparency: 0,
          displayBrickElevation: false,
          hullProperties: defaultHull,
          groups: [],
          bricks: layer.bricks.map((b) => ({
            ...b,
            connexions: [],
            displayArea: {
              ...b.displayArea,
              x: b.displayArea.x - cx,
              y: b.displayArea.y - cy,
            },
          })),
        })),
      };

      const doc = seedFromBbm(moduleMap);
      const bytes = encodeDoc(doc);
      doc.destroy();

      const created = await api.modules.create({ title: name });
      await api.modules.saveSnapshot(created.id, bytes);
      return { id: created.id, title: created.title };
    },
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: ['modules'] });
      onSaved(result.id, result.title);
    },
    onError: (e) => setError((e as Error).message),
  });

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const name = title.trim();
    if (!name) { setError('Module name is required'); return; }
    save.mutate(name);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="w-80 rounded-lg border border-neutral-700 bg-neutral-900 p-5 shadow-xl">
        <h2 className="mb-4 text-sm font-semibold text-neutral-200">Save Selection as Module</h2>
        <form onSubmit={onSubmit} className="flex flex-col gap-3">
          <div>
            <label className="mb-1 block text-xs text-neutral-400">Module name</label>
            <input
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="My module"
              className="w-full rounded border border-neutral-700 bg-neutral-800 px-3 py-1.5 text-sm outline-none focus:border-blue-500"
            />
          </div>
          {error && <p className="text-xs text-red-400">{error}</p>}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded px-3 py-1.5 text-xs text-neutral-400 hover:bg-neutral-800"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={save.isPending}
              className="rounded bg-blue-600 px-3 py-1.5 text-xs text-white hover:bg-blue-500 disabled:opacity-50"
            >
              {save.isPending ? 'Saving…' : 'Save'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

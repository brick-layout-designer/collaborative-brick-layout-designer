// Import .bbm as Module — port of ImportBbmAsModuleCommand (ModuleCommands.cpp).
// Opens a file picker, reads the .bbm XML, and inserts the bricks of every
// brick layer onto the host layer with the same name (creating it when
// missing), centred on the origin. The inserted bricks are registered as
// a sidecar module named after the file, in the same undo step.

import { useRef, useState } from 'react';
import type * as Y from 'yjs';
import { readBbm } from '@cld/bbm';
import { useEditorStore } from './editorStore';
import { importBricksAsModule } from './mutations';
import { moduleBatchesFromMap } from './moduleDrop';

interface Props {
  doc: Y.Doc;
  onClose: () => void;
}

export function ImportBbmDialog({ doc, onClose }: Props) {
  const [error, setError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true);
    setError(null);
    try {
      const xml = await file.text();
      const result = readBbm(xml);
      const map = result.map;

      const batches = moduleBatchesFromMap(map);
      const allBricks = batches.flatMap((b) => b.bricks);
      if (allBricks.length === 0) throw new Error('No bricks found in this .bbm file');

      // Translate centroid to origin so the module inserts at the viewport
      // centre (matches InsertModuleDialog behaviour).
      let sumX = 0, sumY = 0;
      for (const b of allBricks) {
        sumX += b.displayArea.x + b.displayArea.width / 2;
        sumY += b.displayArea.y + b.displayArea.height / 2;
      }
      const cx = sumX / allBricks.length;
      const cy = sumY / allBricks.length;

      const name = file.name.replace(/\.bbm$/i, '') || 'Module';
      const res = importBricksAsModule(doc, batches, {
        name,
        offset: { dx: -cx, dy: -cy },
        sourceFile: file.name,
      });
      if (res) {
        useEditorStore.getState().setSelection(res.ids);
        useEditorStore
          .getState()
          .showStatusMessage(`Imported ${res.ids.length} bricks as module '${name}'`, 4000);
      }
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setImporting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={onClose}
    >
      <div
        className="w-96 rounded-lg border border-neutral-700 bg-neutral-900 p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-1 text-sm font-semibold text-neutral-200">Import .bbm as Module</h2>
        <p className="mb-4 text-xs text-neutral-500">
          Bricks keep their layers (matched by name, created when missing),
          are centred at the map origin and become a module named after the file.
        </p>

        <input
          ref={fileRef}
          type="file"
          accept=".bbm"
          className="hidden"
          onChange={onFile}
        />

        {error && <p className="mb-3 text-xs text-red-400">{error}</p>}

        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded px-3 py-1.5 text-xs text-neutral-400 hover:bg-neutral-800"
          >
            Cancel
          </button>
          <button
            onClick={() => fileRef.current?.click()}
            disabled={importing}
            className="rounded bg-blue-600 px-3 py-1.5 text-xs text-white hover:bg-blue-500 disabled:opacity-50"
          >
            {importing ? 'Importing…' : 'Choose .bbm file…'}
          </button>
        </div>
      </div>
    </div>
  );
}

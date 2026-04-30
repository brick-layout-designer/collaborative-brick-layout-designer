// Modules panel — port of desktop's ModulesPanel (`src/ui/ModulesPanel.cpp`).
// Lists sidecar modules: name, member count, optional sourceFile.
// Click → toggle member-brick selection.
// Right-click → Select Members / Rename / Flatten / Delete.
// Create / Save to Library / Import… are handled elsewhere (SaveModuleDialog,
// ImportBbmDialog, InsertModuleDialog).

import { useEffect, useRef, useState } from 'react';
import * as Y from 'yjs';
import type { SidecarModule } from '@cld/bbm';
import { docToBbm, readSidecarFromDoc } from '@cld/ydoc';
import { useEditorStore } from './editorStore';
import { api } from '../api';
import {
  cloneModuleBricks,
  deleteSidecarModule,
  ensureBrickLayer,
  flattenSidecarModule,
  moveModuleBricks,
  patchSidecarModule,
  renameSidecarModule,
  rescanModuleFromBricks,
  rotateModuleBricks,
} from './mutations';

interface Props {
  doc: Y.Doc;
  isViewer: boolean;
}

export function ModulesPanel({ doc, isViewer }: Props) {
  const sidecar = readSidecarFromDoc(doc);
  const modules = sidecar?.modules ?? [];

  if (modules.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-xs text-neutral-600">
        No modules in this layout
      </div>
    );
  }

  return (
    <aside className="flex h-full min-h-0 w-full flex-col bg-neutral-925 text-sm">
      <div className="flex items-center justify-between border-b border-neutral-800 px-2 py-1.5 text-xs uppercase tracking-wider text-neutral-400">
        <span>Modules</span>
        <span className="text-neutral-600">{modules.length}</span>
      </div>
      <ul className="flex-1 min-h-0 overflow-y-auto">
        {modules.map((mod) => (
          <ModuleRow key={mod.id} module={mod} doc={doc} isViewer={isViewer} />
        ))}
      </ul>
    </aside>
  );
}

function ModuleRow({
  module,
  doc,
  isViewer,
}: {
  module: SidecarModule;
  doc: Y.Doc;
  isViewer: boolean;
}) {
  const selection = useEditorStore((s) => s.selection);
  const setSelection = useEditorStore((s) => s.setSelection);
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number } | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(module.name);
  const [showMove, setShowMove] = useState(false);
  const [saving, setSaving] = useState(false);
  const [rescanning, setRescanning] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const isMembersSelected =
    module.members.length > 0 &&
    module.members.every((id) => selection.includes(id));

  useEffect(() => {
    if (!ctxMenu) return;
    function onDown(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setCtxMenu(null);
    }
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [ctxMenu]);

  function selectMembers() {
    setSelection(module.members);
    setCtxMenu(null);
  }

  function toggleMembers() {
    if (isMembersSelected) {
      setSelection(selection.filter((id) => !module.members.includes(id)));
    } else {
      const combined = new Set([...selection, ...module.members]);
      setSelection([...combined]);
    }
  }

  function commitRename() {
    const name = draft.trim() || module.name;
    renameSidecarModule(doc, module.id, name);
    setRenaming(false);
    setCtxMenu(null);
  }

  async function saveToLibrary() {
    setCtxMenu(null);
    if (module.members.length === 0) {
      alert('This module has no brick members.');
      return;
    }
    setSaving(true);
    try {
      // Build a Y.Doc containing only the member bricks, then encode as snapshot.
      const moduleDoc = new Y.Doc();
      // Seed meta so docToBbm doesn't throw.
      moduleDoc.getMap('meta').set('author', '');
      moduleDoc.getMap('meta').set('event', module.name || 'Module');
      const layerId = ensureBrickLayer(moduleDoc);
      const layerData = moduleDoc.getMap('layerData').get(layerId);
      const idSet = new Set(module.members);
      const layerOrder = doc.getArray<string>('layers');
      if (layerData instanceof Y.Map) {
        const yBricks = layerData.get('bricks') as Y.Array<Y.Map<unknown>>;
        for (const lid of layerOrder.toArray()) {
          const ld = doc.getMap('layerData').get(lid);
          if (!(ld instanceof Y.Map)) continue;
          const bs = ld.get('bricks');
          if (!(bs instanceof Y.Array)) continue;
          for (let i = 0; i < bs.length; i++) {
            const b = bs.get(i);
            if (!(b instanceof Y.Map) || !idSet.has(b.get('id') as string)) continue;
            const copy = new Y.Map<unknown>();
            for (const [k, v] of b.entries()) copy.set(k, v);
            yBricks.push([copy]);
          }
        }
      }
      const bytes = Y.encodeStateAsUpdate(moduleDoc);
      moduleDoc.destroy();
      const res = await api.modules.create({ title: module.name || 'Module' });
      await api.modules.saveSnapshot(res.id, bytes);
      patchSidecarModule(doc, module.id, { sourceFile: res.id });
    } catch (e) {
      alert(`Save to library failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSaving(false);
    }
  }

  async function rescanFromSource() {
    setCtxMenu(null);
    if (!module.sourceFile) {
      alert('This module has no source file (it was created from a selection, not saved to library).');
      return;
    }
    setRescanning(true);
    try {
      const res = await fetch(`/api/modules/${module.sourceFile}/snapshot`, { credentials: 'include' });
      if (!res.ok) throw new Error(`fetch failed: ${res.status}`);
      const buf = await res.arrayBuffer();
      const moduleDoc = new Y.Doc();
      Y.applyUpdate(moduleDoc, new Uint8Array(buf));
      let map: ReturnType<typeof docToBbm>;
      try { map = docToBbm(moduleDoc); } catch { moduleDoc.destroy(); throw new Error('snapshot invalid'); }
      moduleDoc.destroy();
      const freshBricks = map.layers
        .filter((l): l is Extract<typeof l, { type: 'brick' }> => l.type === 'brick')
        .flatMap((l) => l.bricks.map((b) => ({
          partNumber: b.partNumber,
          displayArea: b.displayArea,
          orientation: b.orientation,
          altitude: b.altitude ?? 0,
        })));
      if (freshBricks.length === 0) throw new Error('module has no bricks');
      const targetLayerId = ensureBrickLayer(doc);
      rescanModuleFromBricks(doc, module, freshBricks, targetLayerId);
    } catch (e) {
      alert(`Re-scan failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setRescanning(false);
    }
  }

  return (
    <li
      onClick={toggleMembers}
      onContextMenu={(e) => {
        if (isViewer) return;
        e.preventDefault();
        setCtxMenu({ x: e.clientX, y: e.clientY });
      }}
      className={
        'relative cursor-pointer border-b border-neutral-800/60 px-2 py-1.5 text-xs hover:bg-neutral-800/60 ' +
        (isMembersSelected ? 'bg-blue-900/30' : '')
      }
    >
      {renaming ? (
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commitRename();
            else if (e.key === 'Escape') { setDraft(module.name); setRenaming(false); }
          }}
          onBlur={commitRename}
          className="w-full rounded border border-neutral-700 bg-neutral-800 px-1 py-0.5 text-xs"
        />
      ) : (
        <>
          <span className="font-medium text-neutral-200">{module.name || '(untitled)'}</span>
          <span className="ml-2 text-neutral-600">
            {module.members.length} brick{module.members.length !== 1 ? 's' : ''}
            {module.sourceFile ? ` — ${module.sourceFile.split(/[\\/]/).pop()}` : ''}
          </span>
        </>
      )}

      {showMove && (
        <ModuleMoveDialog
          moduleName={module.name}
          onMove={(dx, dy) => { moveModuleBricks(doc, module.members, dx, dy); setShowMove(false); }}
          onClose={() => setShowMove(false)}
        />
      )}
      {ctxMenu && (
        <div
          ref={menuRef}
          style={{ position: 'fixed', left: ctxMenu.x, top: ctxMenu.y, zIndex: 9999 }}
          className="min-w-[170px] rounded border border-neutral-700 bg-neutral-900 py-1 text-xs shadow-lg"
          onContextMenu={(e) => e.preventDefault()}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            className="block w-full px-3 py-1 text-left hover:bg-neutral-700"
            onClick={selectMembers}
          >
            Select Members
          </button>
          <hr className="my-1 border-neutral-700" />
          <button
            className="block w-full px-3 py-1 text-left hover:bg-neutral-700"
            onClick={() => { setCtxMenu(null); setShowMove(true); }}
          >
            Move…
          </button>
          <div className="group relative">
            <button className="block w-full px-3 py-1 text-left hover:bg-neutral-700">
              Rotate ▸
            </button>
            <div className="absolute left-full top-0 hidden min-w-[100px] rounded border border-neutral-700 bg-neutral-900 py-1 shadow-lg group-hover:block">
              {([-90, -45, 45, 90, 180] as const).map((deg) => (
                <button
                  key={deg}
                  className="block w-full px-3 py-1 text-left text-xs hover:bg-neutral-700"
                  onClick={() => {
                    setCtxMenu(null);
                    rotateModuleBricks(doc, module.members, deg);
                  }}
                >
                  {deg > 0 ? `+${deg}°` : `${deg}°`}
                </button>
              ))}
            </div>
          </div>
          <hr className="my-1 border-neutral-700" />
          <button
            className="block w-full px-3 py-1 text-left hover:bg-neutral-700"
            onClick={() => { setCtxMenu(null); setDraft(module.name); setRenaming(true); }}
          >
            Rename…
          </button>
          <button
            className="block w-full px-3 py-1 text-left hover:bg-neutral-700"
            onClick={() => { setCtxMenu(null); cloneModuleBricks(doc, module); }}
          >
            Clone
          </button>
          <button
            className="block w-full px-3 py-1 text-left hover:bg-neutral-700"
            onClick={() => void saveToLibrary()}
            disabled={saving}
          >
            {saving ? 'Saving…' : 'Save to Library'}
          </button>
          <button
            className={
              'block w-full px-3 py-1 text-left hover:bg-neutral-700 ' +
              (!module.sourceFile ? 'text-neutral-600' : '')
            }
            onClick={() => void rescanFromSource()}
            disabled={rescanning || !module.sourceFile}
            title={module.sourceFile ? undefined : 'No library source — save to library first'}
          >
            {rescanning ? 'Re-scanning…' : 'Re-scan from source'}
          </button>
          <button
            className="block w-full px-3 py-1 text-left hover:bg-neutral-700"
            onClick={() => {
              setCtxMenu(null);
              if (!confirm(`Flatten module "${module.name}"? This removes it from the module list but leaves its bricks in place.`)) return;
              flattenSidecarModule(doc, module.id);
            }}
          >
            Flatten
          </button>
          <hr className="my-1 border-neutral-700" />
          <button
            className="block w-full px-3 py-1 text-left text-red-400 hover:bg-neutral-700"
            onClick={() => {
              setCtxMenu(null);
              if (!confirm(`Delete module "${module.name}"? Its bricks will remain.`)) return;
              deleteSidecarModule(doc, module.id);
            }}
          >
            Delete
          </button>
          <hr className="my-1 border-neutral-700" />
          <button
            className="block w-full px-3 py-1 text-left text-neutral-500 hover:bg-neutral-700"
            onClick={() => setCtxMenu(null)}
          >
            Cancel
          </button>
        </div>
      )}
    </li>
  );
}

function ModuleMoveDialog({
  moduleName,
  onMove,
  onClose,
}: {
  moduleName: string;
  onMove: (dx: number, dy: number) => void;
  onClose: () => void;
}) {
  const [dx, setDx] = useState('0');
  const [dy, setDy] = useState('0');

  function submit(e: { preventDefault(): void }) {
    e.preventDefault();
    const dxN = parseFloat(dx) || 0;
    const dyN = parseFloat(dy) || 0;
    if (dxN === 0 && dyN === 0) { onClose(); return; }
    onMove(dxN, dyN);
  }

  return (
    <div
      className="fixed inset-0 z-[10000] grid place-items-center bg-black/60 p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <form
        onSubmit={submit}
        className="w-72 space-y-3 rounded-lg border border-neutral-800 bg-neutral-900 p-5 text-sm shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="font-semibold">Move module — {moduleName}</h3>
        <label className="block">
          <span className="mb-1 block text-xs text-neutral-400">ΔX (studs)</span>
          <input
            type="number"
            step="0.5"
            value={dx}
            onChange={(e) => setDx(e.target.value)}
            autoFocus
            className="w-full rounded border border-neutral-700 bg-neutral-800 px-3 py-1.5 text-sm"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs text-neutral-400">ΔY (studs)</span>
          <input
            type="number"
            step="0.5"
            value={dy}
            onChange={(e) => setDy(e.target.value)}
            className="w-full rounded border border-neutral-700 bg-neutral-800 px-3 py-1.5 text-sm"
          />
        </label>
        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-neutral-700 px-3 py-1.5 text-sm hover:bg-neutral-800"
          >
            Cancel
          </button>
          <button
            type="submit"
            className="rounded bg-blue-600 px-3 py-1.5 text-sm hover:bg-blue-500"
          >
            Move
          </button>
        </div>
      </form>
    </div>
  );
}

// Layers panel — port of desktop's LayerPanel (`src/ui/LayerPanel.cpp`).
// Renders every layer in the doc with:
//   - kind glyph + index + kind name
//   - editable name (double-click to rename inline)
//   - visibility checkbox
//   - transparency slider
//   - active-row highlight (clicking sets the active layer)
//   - up/down/delete buttons
//
// Bottom row: + (Add Brick / Area / Text / Ruler) and a "Show all" /
// "Solo" pair.

import { useEffect, useRef, useState } from 'react';
import type * as Y from 'yjs';
import type { BbmMap, Layer } from '@cld/model';
import { useEditorStore } from './editorStore';
import {
  addLayer,
  deleteLayer,
  moveLayer,
  renameLayer,
  setLayerTransparency,
  setLayerVisible,
  showAllLayers,
  soloLayer,
  type LayerKind,
} from './mutations';
import { LayerOptionsDialog } from './LayerOptionsDialog';

interface Props {
  map: BbmMap;
  doc: Y.Doc;
  isViewer: boolean;
}

const KIND_GLYPH: Record<Layer['type'], string> = {
  grid: '#',
  brick: '▮',
  text: 'T',
  area: '▦',
  ruler: '─',
};

/** Number of items on a layer — parts on a parts (brick) layer, cells/areas/rulers on the others. */
function layerItemCount(layer: Layer): number | null {
  switch (layer.type) {
    case 'brick':
      return layer.bricks.length;
    case 'text':
      return layer.textCells.length;
    case 'area':
      return layer.areas.length;
    case 'ruler':
      return layer.rulerItems.length;
    case 'grid':
      return null;
  }
}

export function LayersPanel({ map, doc, isViewer }: Props) {
  const activeLayerId = useEditorStore((s) => s.activeLayerId);
  const setActiveLayer = useEditorStore((s) => s.setActiveLayer);

  // map.layers is in **document order**. The desktop's LayerPanel
  // reverses for display so topmost (last drawn = highest z) is first.
  const rows = [...map.layers].reverse();

  return (
    <aside className="flex h-full min-h-0 w-full flex-col bg-neutral-925 text-sm">
      <div className="flex items-center justify-between border-b border-neutral-800 px-2 py-1.5 text-xs uppercase tracking-wider text-neutral-400">
        <span>Layers</span>
        <span className="text-neutral-600">{map.layers.length}</span>
      </div>
      <ul className="flex-1 min-h-0 overflow-y-auto">
        {rows.map((layer) => (
          <LayerRow
            key={layer.id}
            layer={layer}
            doc={doc}
            isActive={layer.id === activeLayerId}
            isViewer={isViewer}
            onActivate={() => setActiveLayer(layer.id)}
          />
        ))}
      </ul>
      {!isViewer && (
        <div className="flex flex-col gap-1 border-t border-neutral-800 p-1">
          <div className="flex items-center gap-1">
            <AddLayerButton doc={doc} onAdd={setActiveLayer} />
            <button
              onClick={() => {
                if (!activeLayerId) return;
                moveLayer(doc, activeLayerId, 'up');
              }}
              disabled={!activeLayerId}
              className="rounded px-2 py-0.5 text-xs hover:bg-neutral-800 disabled:opacity-30"
              title="Move active layer toward the top"
            >
              ▲
            </button>
            <button
              onClick={() => {
                if (!activeLayerId) return;
                moveLayer(doc, activeLayerId, 'down');
              }}
              disabled={!activeLayerId}
              className="rounded px-2 py-0.5 text-xs hover:bg-neutral-800 disabled:opacity-30"
              title="Move active layer toward the bottom"
            >
              ▼
            </button>
            <button
              onClick={() => {
                if (!activeLayerId) return;
                if (!confirm('Delete this layer? This is undo-able.')) return;
                deleteLayer(doc, activeLayerId);
              }}
              disabled={!activeLayerId}
              className="rounded px-2 py-0.5 text-xs hover:bg-red-900/40 disabled:opacity-30"
              title="Delete active layer"
            >
              ✕
            </button>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => showAllLayers(doc)}
              className="flex-1 rounded py-0.5 text-xs hover:bg-neutral-800"
              title="Make all layers visible"
            >
              Show all
            </button>
            <button
              onClick={() => {
                if (!activeLayerId) return;
                soloLayer(doc, activeLayerId);
              }}
              disabled={!activeLayerId}
              className="flex-1 rounded py-0.5 text-xs hover:bg-neutral-800 disabled:opacity-30"
              title="Show only the active layer, hide all others"
            >
              Solo
            </button>
          </div>
        </div>
      )}
    </aside>
  );
}

function LayerRow({
  layer,
  doc,
  isActive,
  isViewer,
  onActivate,
}: {
  layer: Layer;
  doc: Y.Doc;
  isActive: boolean;
  isViewer: boolean;
  onActivate: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draftName, setDraftName] = useState(layer.name);
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number } | null>(null);
  const [showOptions, setShowOptions] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const itemCount = layerItemCount(layer);

  // Re-sync the draft when the layer's name changes externally (remote
  // collaborator rename, undo). Only when NOT actively editing — we
  // don't want to clobber the user's in-progress text on every Yjs
  // round-trip.
  useEffect(() => {
    if (!editing) setDraftName(layer.name);
  }, [layer.name, editing]);

  useEffect(() => {
    if (!ctxMenu) return;
    function onDown(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setCtxMenu(null);
    }
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [ctxMenu]);

  function startRename() {
    setDraftName(layer.name);
    setEditing(true);
    setCtxMenu(null);
  }

  return (
    <li
      onClick={onActivate}
      onContextMenu={(e) => {
        if (isViewer) return;
        e.preventDefault();
        setCtxMenu({ x: e.clientX, y: e.clientY });
      }}
      title={isActive && layer.type === 'brick' ? 'Active layer — new parts are placed here' : undefined}
      className={
        'relative cursor-pointer border-b border-neutral-800/60 py-1.5 ' +
        (isActive
          ? 'border-l-2 border-l-blue-500 bg-blue-900/30 pl-1.5 pr-2'
          : 'border-l-2 border-l-transparent pl-1.5 pr-2 hover:bg-neutral-800/60')
      }
    >
      <div className="flex items-center gap-2">
        <span className="w-4 text-center text-neutral-500" aria-hidden="true">
          {KIND_GLYPH[layer.type]}
        </span>
        <input
          type="checkbox"
          checked={layer.visible}
          disabled={isViewer}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => setLayerVisible(doc, layer.id, e.target.checked)}
          title="Visible"
          className="cursor-pointer"
        />
        {editing ? (
          <input
            autoFocus
            value={draftName}
            onChange={(e) => setDraftName(e.target.value)}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                renameLayer(doc, layer.id, draftName.trim() || layer.name);
                setEditing(false);
              } else if (e.key === 'Escape') {
                setDraftName(layer.name);
                setEditing(false);
              }
            }}
            onBlur={() => {
              renameLayer(doc, layer.id, draftName.trim() || layer.name);
              setEditing(false);
            }}
            className="flex-1 rounded border border-neutral-700 bg-neutral-800 px-1 py-0.5 text-xs"
          />
        ) : (
          <span
            onDoubleClick={(e) => {
              e.stopPropagation();
              if (!isViewer) startRename();
            }}
            className={
              'flex-1 truncate text-sm ' +
              (isActive ? 'font-semibold text-white ' : '') +
              (layer.visible ? '' : 'text-neutral-500 line-through')
            }
          >
            {layer.name || '(untitled)'}
          </span>
        )}
        {!editing && itemCount !== null && (
          <span
            className="shrink-0 tabular-nums text-[10px] text-neutral-500"
            title={layer.type === 'brick' ? `${itemCount} part${itemCount === 1 ? '' : 's'} on this layer` : undefined}
          >
            {itemCount}
          </span>
        )}
      </div>
      <div className="ml-9 mt-1 flex items-center gap-2 text-[10px] text-neutral-500">
        <input
          type="range"
          min={0}
          max={100}
          step={1}
          value={layer.transparency}
          disabled={isViewer}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => setLayerTransparency(doc, layer.id, parseInt(e.target.value, 10))}
          title="Transparency (0% transparent → 100% opaque)"
          className="flex-1 accent-blue-600"
        />
        <span className="w-7 text-right tabular-nums">{layer.transparency}%</span>
      </div>
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
            onClick={() => { setLayerVisible(doc, layer.id, !layer.visible); setCtxMenu(null); }}
          >
            {layer.visible ? 'Hide layer' : 'Show layer'}
          </button>
          <button
            className="block w-full px-3 py-1 text-left hover:bg-neutral-700"
            onClick={() => { soloLayer(doc, layer.id); setCtxMenu(null); }}
          >
            Solo (hide others)
          </button>
          <button
            className="block w-full px-3 py-1 text-left hover:bg-neutral-700"
            onClick={() => { showAllLayers(doc); setCtxMenu(null); }}
          >
            Show all layers
          </button>
          <hr className="my-1 border-neutral-700" />
          <button
            className="block w-full px-3 py-1 text-left hover:bg-neutral-700"
            onClick={() => { setCtxMenu(null); setShowOptions(true); }}
          >
            Layer Options…
          </button>
          <button
            className="block w-full px-3 py-1 text-left hover:bg-neutral-700"
            onClick={startRename}
          >
            Rename…
          </button>
          <button
            className="block w-full px-3 py-1 text-left hover:bg-neutral-700"
            onClick={() => { moveLayer(doc, layer.id, 'up'); setCtxMenu(null); }}
          >
            Move up
          </button>
          <button
            className="block w-full px-3 py-1 text-left hover:bg-neutral-700"
            onClick={() => { moveLayer(doc, layer.id, 'down'); setCtxMenu(null); }}
          >
            Move down
          </button>
          <hr className="my-1 border-neutral-700" />
          <button
            className="block w-full px-3 py-1 text-left text-red-400 hover:bg-neutral-700"
            onClick={() => {
              setCtxMenu(null);
              if (!confirm('Delete this layer? This is undo-able.')) return;
              deleteLayer(doc, layer.id);
            }}
          >
            Delete layer
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
      {showOptions && (
        <LayerOptionsDialog
          layer={layer}
          doc={doc}
          onClose={() => setShowOptions(false)}
        />
      )}
    </li>
  );
}

const ADD_LAYER_OPTIONS: { kind: LayerKind; label: string }[] = [
  { kind: 'brick', label: 'Parts layer' },
  { kind: 'area', label: 'Area layer' },
  { kind: 'text', label: 'Text layer' },
  { kind: 'ruler', label: 'Ruler layer' },
];

function AddLayerButton({ doc, onAdd }: { doc: Y.Doc; onAdd: (layerId: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="rounded px-2 py-0.5 text-xs hover:bg-neutral-800"
        title="Add a new layer"
      >
        + Add layer
      </button>
      {open && (
        <ul
          className="absolute bottom-7 left-0 z-10 w-40 rounded border border-neutral-700 bg-neutral-900 text-xs shadow"
          onClick={() => setOpen(false)}
        >
          {ADD_LAYER_OPTIONS.map(({ kind, label }) => (
            <li key={kind}>
              <button
                onClick={() => onAdd(addLayer(doc, kind))}
                className="block w-full px-2 py-1 text-left hover:bg-neutral-800"
              >
                {label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

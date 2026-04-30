// Layer Options dialog — port of desktop's LayerOptionsDialog.cpp.
// Editable fields: name, hull visibility, hull colour, hull thickness,
// and (for brick layers) display-brick-elevation toggle.

import { useState } from 'react';
import type * as Y from 'yjs';
import type { Layer } from '@cld/model';
import {
  renameLayer,
  setLayerHullProperties,
  setLayerDisplayBrickElevation,
} from './mutations';

interface Props {
  layer: Layer;
  doc: Y.Doc;
  onClose: () => void;
}

export function LayerOptionsDialog({ layer, doc, onClose }: Props) {
  const [name, setName] = useState(layer.name);
  const hull = layer.hullProperties;
  const [hullVisible, setHullVisible] = useState(hull.isVisible);
  const [hullThickness, setHullThickness] = useState(hull.hullThickness);
  const initHullHex =
    hull.hullColor.kind === 'argb'
      ? `#${hull.hullColor.argb.slice(2, 8).padStart(6, '0')}`
      : '#000000';
  const [hullHex, setHullHex] = useState(initHullHex);
  const [dispElev, setDispElev] = useState(
    layer.type === 'brick' ? layer.displayBrickElevation : false,
  );

  function commit() {
    const trimmed = name.trim() || layer.name;
    if (trimmed !== layer.name) renameLayer(doc, layer.id, trimmed);
    setLayerHullProperties(doc, layer.id, hullVisible, {
      kind: 'argb',
      argb: `FF${hullHex.slice(1).toUpperCase()}`,
    }, hullThickness);
    if (layer.type === 'brick') {
      setLayerDisplayBrickElevation(doc, layer.id, dispElev);
    }
    onClose();
  }

  const rowCls = 'flex items-center justify-between gap-4 py-1.5';
  const labelCls = 'text-xs text-neutral-400 w-40 shrink-0';
  const inputCls = 'flex-1 rounded border border-neutral-700 bg-neutral-800 px-2 py-1 text-xs';

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={onClose}
    >
      <div
        className="w-96 rounded-lg border border-neutral-700 bg-neutral-900 p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-4 text-sm font-semibold text-neutral-200">Layer Options</h2>

        <div className="flex flex-col gap-0.5">
          <div className={rowCls}>
            <span className={labelCls}>Name</span>
            <input
              type="text"
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') commit(); else if (e.key === 'Escape') onClose(); }}
              className={inputCls}
            />
          </div>

          <div className={rowCls}>
            <span className={labelCls}>Show hull outline</span>
            <input
              type="checkbox"
              checked={hullVisible}
              onChange={(e) => setHullVisible(e.target.checked)}
              className="accent-blue-500"
            />
          </div>

          <div className={rowCls}>
            <span className={labelCls}>Hull colour</span>
            <input
              type="color"
              value={hullHex}
              onChange={(e) => setHullHex(e.target.value)}
              className="h-7 w-12 cursor-pointer rounded border border-neutral-700 bg-neutral-800 p-0.5"
            />
          </div>

          <div className={rowCls}>
            <span className={labelCls}>Hull thickness (px)</span>
            <input
              type="number"
              min={1}
              max={20}
              value={hullThickness}
              onChange={(e) => setHullThickness(Math.max(1, parseInt(e.target.value, 10) || 1))}
              className={inputCls}
            />
          </div>

          {layer.type === 'brick' && (
            <div className={rowCls}>
              <span className={labelCls}>Show brick elevation</span>
              <input
                type="checkbox"
                checked={dispElev}
                onChange={(e) => setDispElev(e.target.checked)}
                className="accent-blue-500"
              />
            </div>
          )}
        </div>

        <div className="mt-5 flex justify-end gap-2 border-t border-neutral-700 pt-4">
          <button onClick={onClose} className="rounded px-3 py-1.5 text-xs text-neutral-400 hover:bg-neutral-800">
            Cancel
          </button>
          <button
            onClick={commit}
            className="rounded bg-blue-600 px-3 py-1.5 text-xs text-white hover:bg-blue-500"
          >
            OK
          </button>
        </div>
      </div>
    </div>
  );
}

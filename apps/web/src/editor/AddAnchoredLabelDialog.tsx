// Add Anchored Label dialog — port of the desktop's AddAnchoredLabelCommand
// (LabelCommands.cpp) + the "Insert → Anchored Label..." menu entry
// (MainWindowMenus.cpp:440-472).
//
// Supports World (kind=0) and Brick (kind=1) anchors; Group/Module anchors
// (kind=2/3) are deferred (no module registry in the web client yet).
//
// When a single brick is selected, the dialog defaults to Brick-anchor mode
// with that brick's id pre-filled. Otherwise it defaults to World.

import { useState } from 'react';
import type * as Y from 'yjs';
import type { AnchoredLabel } from '@cld/bbm';
import { addAnchoredLabel, editAnchoredLabel } from './mutations';

interface Props {
  doc: Y.Doc;
  /** Id of the single currently-selected brick, or null. */
  defaultTargetId: string | null;
  /** When set, the dialog is in edit mode — pre-populates fields and calls editAnchoredLabel. */
  initialLabel?: AnchoredLabel;
  onClose: () => void;
}

function makeId(): string {
  return `${Date.now()}${Math.floor(Math.random() * 1000).toString().padStart(3, '0')}`;
}

export function AddAnchoredLabelDialog({ doc, defaultTargetId, initialLabel, onClose }: Props) {
  const isEdit = !!initialLabel;
  const initStyle = (initialLabel?.font.style ?? '').toLowerCase();
  const [text, setText] = useState(initialLabel?.text ?? '');
  const [fontFamily, setFontFamily] = useState(initialLabel?.font.family ?? 'Arial');
  const [fontSize, setFontSize] = useState(initialLabel?.font.size ?? 24);
  const [isBold, setIsBold] = useState(initStyle.includes('bold'));
  const [isItalic, setIsItalic] = useState(initStyle.includes('italic'));
  const [colorArgb, setColorArgb] = useState(
    initialLabel
      ? (initialLabel.color.known ? 'FF000000' : initialLabel.color.argb.toString(16).toUpperCase().padStart(8, '0'))
      : 'FF000000'
  );
  const [kind, setKind] = useState<0 | 1>(
    initialLabel ? (initialLabel.kind === 1 ? 1 : 0) : defaultTargetId ? 1 : 0
  );
  const [targetId, setTargetId] = useState(initialLabel?.targetId ?? defaultTargetId ?? '');
  const [offsetX, setOffsetX] = useState(initialLabel?.offset.x ?? 0);
  const [offsetY, setOffsetY] = useState(initialLabel?.offset.y ?? 0);
  const [rotation, setRotation] = useState(initialLabel?.rot ?? 0);
  const [minZoom, setMinZoom] = useState(initialLabel?.minZoom ?? 0);

  const rgb = `#${colorArgb.slice(2, 8)}`;

  function commit() {
    if (!text.trim()) return;
    const style = [isBold && 'Bold', isItalic && 'Italic'].filter(Boolean).join('');
    const argbInt = parseInt(colorArgb, 16);
    const label: AnchoredLabel = {
      id: makeId(),
      text: text.trim(),
      font: { family: fontFamily, size: fontSize, style },
      color: { known: false, argb: argbInt, name: '' },
      kind,
      targetId: kind === 1 ? targetId.trim() : '',
      offset: { x: offsetX, y: offsetY },
      rot: rotation,
      minZoom,
    };
    if (isEdit && initialLabel) {
      editAnchoredLabel(doc, initialLabel.id, label);
    } else {
      addAnchoredLabel(doc, label);
    }
    onClose();
  }

  const rowCls = 'flex items-center justify-between gap-4 py-1';
  const labelCls = 'text-xs text-neutral-400 w-36 shrink-0';
  const inputCls = 'flex-1 rounded border border-neutral-700 bg-neutral-800 px-2 py-1 text-xs';

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={onClose}
    >
      <div
        className="w-[28rem] rounded-lg border border-neutral-700 bg-neutral-900 p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-4 text-sm font-semibold text-neutral-200">{isEdit ? 'Edit Anchored Label' : 'Add Anchored Label'}</h2>

        <div className="flex flex-col gap-0.5">
          <div className={rowCls}>
            <span className={labelCls}>Text</span>
            <input
              type="text"
              autoFocus
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') commit(); else if (e.key === 'Escape') onClose(); }}
              className={inputCls}
            />
          </div>

          <div className={rowCls}>
            <span className={labelCls}>Font family</span>
            <input type="text" value={fontFamily} onChange={(e) => setFontFamily(e.target.value)} className={inputCls} />
          </div>

          <div className={rowCls}>
            <span className={labelCls}>Size (pt)</span>
            <input type="number" min={1} max={200} value={fontSize} onChange={(e) => setFontSize(Math.max(1, parseInt(e.target.value, 10) || 24))} className={inputCls} />
          </div>

          <div className={rowCls}>
            <span className={labelCls}>Style</span>
            <div className="flex flex-1 gap-3">
              <label className="flex items-center gap-1 text-xs text-neutral-300">
                <input type="checkbox" checked={isBold} onChange={(e) => setIsBold(e.target.checked)} className="accent-blue-500" />
                Bold
              </label>
              <label className="flex items-center gap-1 text-xs text-neutral-300">
                <input type="checkbox" checked={isItalic} onChange={(e) => setIsItalic(e.target.checked)} className="accent-blue-500" />
                Italic
              </label>
            </div>
          </div>

          <div className={rowCls}>
            <span className={labelCls}>Colour</span>
            <input
              type="color"
              value={rgb}
              onChange={(e) => setColorArgb(`FF${e.target.value.slice(1).toUpperCase()}`)}
              className="h-7 w-12 cursor-pointer rounded border border-neutral-700 bg-neutral-800 p-0.5"
            />
          </div>

          <div className={rowCls}>
            <span className={labelCls}>Anchor</span>
            <select value={kind} onChange={(e) => setKind(Number(e.target.value) as 0 | 1)} className={inputCls}>
              <option value={0}>World (fixed position)</option>
              <option value={1}>Brick (follows a brick)</option>
            </select>
          </div>

          {kind === 1 && (
            <div className={rowCls}>
              <span className={labelCls}>Brick ID</span>
              <input type="text" value={targetId} onChange={(e) => setTargetId(e.target.value)} placeholder="paste brick id…" className={inputCls} />
            </div>
          )}

          <div className={rowCls}>
            <span className={labelCls}>Offset X / Y (studs)</span>
            <div className="flex flex-1 gap-2">
              <input type="number" value={offsetX} onChange={(e) => setOffsetX(parseFloat(e.target.value) || 0)} className={`${inputCls} w-0`} />
              <input type="number" value={offsetY} onChange={(e) => setOffsetY(parseFloat(e.target.value) || 0)} className={`${inputCls} w-0`} />
            </div>
          </div>

          <div className={rowCls}>
            <span className={labelCls}>Rotation (°)</span>
            <input type="number" min={-360} max={360} value={rotation} onChange={(e) => setRotation(parseFloat(e.target.value) || 0)} className={inputCls} />
          </div>

          <div className={rowCls}>
            <span className={labelCls}>Min zoom (0 = always)</span>
            <input type="number" min={0} max={8} step={0.1} value={minZoom} onChange={(e) => setMinZoom(parseFloat(e.target.value) || 0)} className={inputCls} />
          </div>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onClose} className="rounded px-3 py-1.5 text-xs text-neutral-400 hover:bg-neutral-800">
            Cancel
          </button>
          <button
            onClick={commit}
            disabled={!text.trim()}
            className="rounded bg-blue-600 px-3 py-1.5 text-xs text-white hover:bg-blue-500 disabled:opacity-50"
          >
            {isEdit ? 'Save' : 'Add Label'}
          </button>
        </div>
      </div>
    </div>
  );
}

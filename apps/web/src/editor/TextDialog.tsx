// Add-Text / Edit-Text dialog — port of
// `editTextDialog` (EditDialogs.cpp `editTextDialog`) + the Edit ▸
// Insert ▸ Text... entry (MainWindowMenus.cpp:430-439).
//
// We accept a single shape with optional `existing` to switch between
// "create new at centre" and "edit existing at index".

import { useState } from 'react';
import type { TextCell } from '@cld/model';

export interface TextDialogResult {
  text: string;
  fontFamily: string;
  fontSize: number;
  isBold: boolean;
  isItalic: boolean;
  /** AARRGGBB hex (uppercase, no leading #). */
  colorArgb: string;
  /** Degrees, clockwise positive. */
  rotation: number;
}

interface Props {
  initial?: TextCell;
  onClose: () => void;
  onCommit: (r: TextDialogResult) => void;
}

export function TextDialog({ initial, onClose, onCommit }: Props) {
  const [text, setText] = useState(initial?.text ?? '');
  const [fontFamily, setFontFamily] = useState(initial?.font.family ?? 'Arial');
  const [fontSize, setFontSize] = useState(initial?.font.size ?? 24);
  const styleStr = (initial?.font.style ?? '').toLowerCase();
  const [isBold, setIsBold] = useState(styleStr.includes('bold'));
  const [isItalic, setIsItalic] = useState(styleStr.includes('italic'));
  // Initial colour: if known-color, fall back to black; else use the argb hex.
  const initArgb = initial?.fontColor.kind === 'argb' ? initial.fontColor.argb : 'FF000000';
  const [colorArgb, setColorArgb] = useState(initArgb.toUpperCase());
  const [rotation, setRotation] = useState(initial?.orientation ?? 0);

  const rgb = `#${colorArgb.slice(2)}`;
  const aa = colorArgb.slice(0, 2);

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 grid place-items-center bg-black/60"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-[28rem] rounded-lg border border-neutral-800 bg-neutral-900 p-5 shadow-xl"
      >
        <h2 className="text-base font-semibold">{initial ? 'Edit text' : 'Add text'}</h2>
        <div className="mt-4 grid grid-cols-[8rem_1fr] gap-2 text-sm">
          <label className="self-center">Text:</label>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={3}
            autoFocus
            className="rounded border border-neutral-700 bg-neutral-800 px-2 py-1"
          />
          <label className="self-center">Font:</label>
          <input
            value={fontFamily}
            onChange={(e) => setFontFamily(e.target.value)}
            className="rounded border border-neutral-700 bg-neutral-800 px-2 py-1"
          />
          <label className="self-center">Size:</label>
          <input
            type="number"
            value={fontSize}
            onChange={(e) => {
              const n = parseFloat(e.target.value);
              if (Number.isFinite(n)) setFontSize(n);
            }}
            min={1}
            step={1}
            className="rounded border border-neutral-700 bg-neutral-800 px-2 py-1"
          />
          <label className="self-center">Style:</label>
          <div className="flex items-center gap-3 text-xs">
            <label className="flex items-center gap-1">
              <input
                type="checkbox"
                checked={isBold}
                onChange={(e) => setIsBold(e.target.checked)}
              />
              Bold
            </label>
            <label className="flex items-center gap-1">
              <input
                type="checkbox"
                checked={isItalic}
                onChange={(e) => setIsItalic(e.target.checked)}
              />
              Italic
            </label>
          </div>
          <label className="self-center">Colour:</label>
          <input
            type="color"
            value={rgb}
            onChange={(e) => {
              const v = e.target.value.replace(/^#/, '').toUpperCase();
              setColorArgb(`${aa}${v}`);
            }}
            className="h-8 w-16 rounded border border-neutral-700 bg-transparent"
          />
          <label className="self-center">Rotation (°):</label>
          <input
            type="number"
            value={rotation}
            onChange={(e) => {
              const n = parseFloat(e.target.value);
              if (Number.isFinite(n)) setRotation(n);
            }}
            step={1}
            className="rounded border border-neutral-700 bg-neutral-800 px-2 py-1"
          />
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded border border-neutral-700 px-3 py-1 text-sm hover:bg-neutral-800"
          >
            Cancel
          </button>
          <button
            disabled={text.trim().length === 0}
            onClick={() =>
              onCommit({
                text,
                fontFamily,
                fontSize,
                isBold,
                isItalic,
                colorArgb,
                rotation,
              })
            }
            className="rounded bg-blue-600 px-3 py-1 text-sm hover:bg-blue-500 disabled:opacity-30"
          >
            OK
          </button>
        </div>
      </div>
    </div>
  );
}

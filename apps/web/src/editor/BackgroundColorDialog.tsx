// Map > Background Colour dialog — port of MainWindowMapMenu.cpp:48-60:
// a colour picker with an alpha channel (QColorDialog::ShowAlphaChannel),
// written to the .bbm as desktop does (lowercase `aarrggbb`).

import { useState } from 'react';
import type * as Y from 'yjs';
import type { ColorSpec } from '@cld/model';
import { setBackgroundColor } from './mutations';
import { argbSpec, hexAlpha } from './background';

interface Props {
  current: ColorSpec;
  doc: Y.Doc;
  onClose: () => void;
}

export function BackgroundColorDialog({ current, doc, onClose }: Props) {
  const initial = hexAlpha(current);
  const [rgb, setRgb] = useState(initial.hex);
  const [alpha, setAlpha] = useState(initial.alpha);

  function commit() {
    setBackgroundColor(doc, argbSpec(rgb, alpha));
    onClose();
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 grid place-items-center bg-black/60"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-[24rem] rounded-lg border border-neutral-800 bg-neutral-900 p-5 shadow-xl"
      >
        <h2 className="text-base font-semibold">Background colour</h2>
        <div className="mt-4 flex items-center gap-3 text-sm">
          <input
            type="color"
            value={rgb}
            onChange={(e) => setRgb(e.target.value)}
            className="h-10 w-20 cursor-pointer rounded-sm border border-neutral-700 bg-transparent"
          />
          <span className="font-mono text-xs uppercase">{rgb}</span>
        </div>
        <label className="mt-3 flex items-center gap-3 text-xs text-neutral-400">
          Alpha
          <input
            type="range"
            min={0}
            max={255}
            value={alpha}
            aria-label="Alpha"
            onChange={(e) => setAlpha(parseInt(e.target.value, 10))}
            className="flex-1"
          />
          <span className="w-8 text-right tabular-nums">{alpha}</span>
        </label>
        <div className="mt-5 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-sm border border-neutral-700 px-3 py-1 text-sm hover:bg-neutral-800"
          >
            Cancel
          </button>
          <button
            onClick={commit}
            className="rounded-sm bg-blue-600 px-3 py-1 text-sm hover:bg-blue-500"
          >
            OK
          </button>
        </div>
      </div>
    </div>
  );
}

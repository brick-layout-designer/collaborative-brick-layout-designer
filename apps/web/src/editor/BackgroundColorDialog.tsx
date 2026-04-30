// Map > Background Colour dialog — port of MainWindowMapMenu.cpp:51-63.
// Web simplification: a single colour picker (no alpha — the .bbm
// background is opaque per format spec).

import { useState } from 'react';
import type * as Y from 'yjs';
import type { ColorSpec } from '@cld/model';
import { setBackgroundColor } from './mutations';

interface Props {
  current: ColorSpec;
  doc: Y.Doc;
  onClose: () => void;
}

export function BackgroundColorDialog({ current, doc, onClose }: Props) {
  const initialHex = colorToHex(current);
  const [rgb, setRgb] = useState(initialHex);

  function commit() {
    // Strip leading # and uppercase to match the on-disk convention.
    const argb = `FF${rgb.replace(/^#/, '').toUpperCase()}`;
    setBackgroundColor(doc, { kind: 'argb', argb });
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
            className="h-10 w-20 cursor-pointer rounded border border-neutral-700 bg-transparent"
          />
          <span className="font-mono text-xs uppercase">{rgb}</span>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded border border-neutral-700 px-3 py-1 text-sm hover:bg-neutral-800"
          >
            Cancel
          </button>
          <button
            onClick={commit}
            className="rounded bg-blue-600 px-3 py-1 text-sm hover:bg-blue-500"
          >
            OK
          </button>
        </div>
      </div>
    </div>
  );
}

const KNOWN_HEX: Record<string, string> = {
  cornflowerblue: '#6495ed',
  white: '#ffffff',
  black: '#000000',
  lightgray: '#d3d3d3',
  gray: '#808080',
  red: '#ff0000',
  green: '#008000',
  blue: '#0000ff',
};

function colorToHex(c: ColorSpec): string {
  if (c.kind === 'known') return KNOWN_HEX[(c.name ?? '').toLowerCase()] ?? '#6495ed';
  // ARGB → strip alpha for the picker.
  return c.argb.length === 8 ? `#${c.argb.slice(2)}` : `#${c.argb}`;
}

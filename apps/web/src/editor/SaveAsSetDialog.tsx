import { useState, type FormEvent } from 'react';
import * as Y from 'yjs';
import { docToBbm } from '@cld/ydoc';
import { useEditorStore } from './editorStore';
import type { LayerBrick } from '@cld/model';

interface Props {
  doc: Y.Doc;
  onClose: () => void;
}

export function SaveAsSetDialog({ doc, onClose }: Props) {
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const selection = useEditorStore((s) => s.selection);

  // Collect selected bricks from all brick layers.
  const map = docToBbm(doc);
  const selSet = new Set(selection);
  const picked = map.layers
    .filter((l): l is LayerBrick => l.type === 'brick')
    .flatMap((l) => l.bricks)
    .filter((b) => selSet.has(b.id));

  function submit(e: FormEvent) {
    e.preventDefault();
    if (picked.length === 0) {
      setError('Select one or more bricks first.');
      return;
    }
    const trimmed = name.trim() || 'New Set';

    // Compute centroid of display-area centres (equivalent to hull-bbox
    // centres for parts without an explicit mOffset, which covers all
    // standard BlueBrickParts shapes).
    let sumX = 0, sumY = 0;
    for (const b of picked) {
      sumX += b.displayArea.x + b.displayArea.width / 2;
      sumY += b.displayArea.y + b.displayArea.height / 2;
    }
    const cx = sumX / picked.length;
    const cy = sumY / picked.length;

    const xml = buildSetXml(trimmed, picked.map((b) => ({
      partKey: b.partNumber,
      x: (b.displayArea.x + b.displayArea.width / 2) - cx,
      y: (b.displayArea.y + b.displayArea.height / 2) - cy,
      angle: b.orientation,
    })));

    // Sanitise filename — mirror desktop's rules.
    let safe = trimmed.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_');
    safe = safe.replace(/^[. ]+|[. ]+$/g, '') || 'Set';
    if (!safe.toLowerCase().endsWith('.set')) safe += '.set';
    downloadText(safe + '.xml', xml);
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <form
        onSubmit={submit}
        className="w-80 space-y-3 rounded-lg border border-neutral-700 bg-neutral-900 p-5 text-sm shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-base font-semibold">Save Selection as Set</h3>
        {picked.length === 0 && (
          <p className="text-xs text-amber-400">No bricks selected. Select bricks first.</p>
        )}
        {picked.length > 0 && (
          <p className="text-xs text-neutral-400">{picked.length} brick{picked.length !== 1 ? 's' : ''} selected.</p>
        )}
        <label className="block">
          <span className="mb-1 block text-neutral-400">Set name</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="New Set"
            className="w-full rounded border border-neutral-700 bg-neutral-800 px-3 py-2"
            autoFocus
          />
        </label>
        {error && <p className="text-xs text-red-400">{error}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-neutral-700 px-4 py-1.5 hover:bg-neutral-800"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={picked.length === 0}
            className="rounded bg-blue-600 px-4 py-1.5 hover:bg-blue-500 disabled:opacity-40"
          >
            Download .set.xml
          </button>
        </div>
      </form>
    </div>
  );
}

function buildSetXml(
  name: string,
  subparts: { partKey: string; x: number; y: number; angle: number }[],
): string {
  const lines: string[] = [];
  lines.push('<?xml version="1.0" encoding="utf-8"?>');
  lines.push('<group>');
  lines.push(`\t<Author>Collaborative Layout Designer</Author>`);
  lines.push(`\t<Description>`);
  lines.push(`\t\t<en>${escXml(name)}</en>`);
  lines.push(`\t</Description>`);
  lines.push(`\t<CanUngroup>true</CanUngroup>`);
  lines.push(`\t<SubPartList>`);
  for (const sp of subparts) {
    lines.push(`\t\t<SubPart id="${escXml(sp.partKey)}">`);
    lines.push(`\t\t\t<position>`);
    lines.push(`\t\t\t\t<x>${sp.x.toFixed(6)}</x>`);
    lines.push(`\t\t\t\t<y>${sp.y.toFixed(6)}</y>`);
    lines.push(`\t\t\t</position>`);
    lines.push(`\t\t\t<angle>${sp.angle.toFixed(4)}</angle>`);
    lines.push(`\t\t</SubPart>`);
  }
  lines.push(`\t</SubPartList>`);
  lines.push('</group>');
  return lines.join('\n') + '\n';
}

function escXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function downloadText(filename: string, text: string) {
  const blob = new Blob([text], { type: 'application/xml' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

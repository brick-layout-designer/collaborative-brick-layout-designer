// Find & Replace dialog — port of `FindDialog.cpp`.
// Searches brick part numbers and text-cell content; lists matches and
// lets the user select (brick) or replace (text) them.
// Replace for part numbers is not supported (part identity can't be
// changed without re-placing the brick).

import { useMemo, useState } from 'react';
import type * as Y from 'yjs';
import type { BbmMap } from '@cld/model';
import { useEditorStore } from './editorStore';
import { editTextCell } from './mutations';

interface Props {
  map: BbmMap;
  doc: Y.Doc;
  onClose: () => void;
}

type Scope = 'part' | 'text';

interface Hit {
  layerId: string;
  brickId?: string;
  textIndex?: number;
  preview: string;
}

export function FindDialog({ map, doc, onClose }: Props) {
  const setSelection = useEditorStore((s) => s.setSelection);
  const showStatusMessage = useEditorStore((s) => s.showStatusMessage);
  const [needle, setNeedle] = useState('');
  const [replacement, setReplacement] = useState('');
  const [scope, setScope] = useState<Scope>('part');
  const [matchCase, setMatchCase] = useState(false);

  const hits = useMemo(() => findHits(map, needle, scope, matchCase), [map, needle, scope, matchCase]);

  function replaceAll() {
    if (!needle.trim() || scope !== 'text') return;
    let count = 0;
    for (const h of hits) {
      if (h.textIndex === undefined) continue;
      const layer = map.layers.find((l) => l.id === h.layerId && l.type === 'text');
      if (!layer || layer.type !== 'text') continue;
      const cell = layer.textCells[h.textIndex];
      if (!cell) continue;
      const newText = matchCase
        ? cell.text.replaceAll(needle, replacement)
        : cell.text.replace(new RegExp(escapeRegex(needle), 'gi'), replacement);
      editTextCell(doc, h.layerId, h.textIndex, newText);
      count++;
    }
    showStatusMessage(`Replaced ${count} occurrence${count === 1 ? '' : 's'}`);
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
        className="w-[38rem] rounded-lg border border-neutral-800 bg-neutral-900 p-5 shadow-xl"
      >
        <h2 className="text-base font-semibold">Find &amp; Replace</h2>

        {/* Scope + options row */}
        <div className="mt-3 flex items-center gap-3 text-xs">
          <select
            value={scope}
            onChange={(e) => setScope(e.target.value as Scope)}
            className="rounded border border-neutral-700 bg-neutral-800 px-2 py-1"
          >
            <option value="part">Part number</option>
            <option value="text">Text content</option>
          </select>
          <label className="flex items-center gap-1">
            <input
              type="checkbox"
              checked={matchCase}
              onChange={(e) => setMatchCase(e.target.checked)}
            />
            Match case
          </label>
        </div>

        {/* Find row */}
        <div className="mt-3 flex items-center gap-2">
          <span className="w-16 text-right text-xs text-neutral-500">Find</span>
          <input
            autoFocus
            value={needle}
            onChange={(e) => setNeedle(e.target.value)}
            placeholder="Search…"
            className="flex-1 rounded border border-neutral-700 bg-neutral-800 px-2 py-1 text-sm"
          />
        </div>

        {/* Replace row — only for text scope */}
        {scope === 'text' && (
          <div className="mt-2 flex items-center gap-2">
            <span className="w-16 text-right text-xs text-neutral-500">Replace</span>
            <input
              value={replacement}
              onChange={(e) => setReplacement(e.target.value)}
              placeholder="Replacement…"
              className="flex-1 rounded border border-neutral-700 bg-neutral-800 px-2 py-1 text-sm"
            />
            <button
              onClick={replaceAll}
              disabled={!needle.trim() || hits.length === 0}
              className="rounded bg-blue-600 px-3 py-1 text-xs text-white hover:bg-blue-500 disabled:opacity-40"
            >
              Replace all
            </button>
          </div>
        )}

        {/* Results */}
        <div className="mt-3 max-h-64 min-h-[6rem] overflow-y-auto rounded border border-neutral-800">
          {needle.trim() === '' ? (
            <p className="p-2 text-xs text-neutral-500">Type a query above.</p>
          ) : hits.length === 0 ? (
            <p className="p-2 text-xs text-neutral-500">No matches.</p>
          ) : (
            <ul>
              {hits.map((h, i) => (
                <li key={i}>
                  <button
                    onClick={() => {
                      if (h.brickId) {
                        setSelection([h.brickId]);
                        onClose();
                      }
                    }}
                    className={
                      'block w-full px-2 py-1 text-left text-sm ' +
                      (h.brickId ? 'hover:bg-neutral-800' : 'cursor-default text-neutral-400')
                    }
                  >
                    {h.preview}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="mt-3 flex items-center justify-between text-xs text-neutral-500">
          <span>{hits.length} match{hits.length === 1 ? '' : 'es'}</span>
          <button
            onClick={onClose}
            className="rounded border border-neutral-700 px-3 py-1 text-sm hover:bg-neutral-800"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

function findHits(map: BbmMap, needle: string, scope: Scope, matchCase: boolean): Hit[] {
  if (!needle.trim()) return [];
  const cmp = matchCase ? (s: string) => s : (s: string) => s.toLowerCase();
  const n = cmp(needle.trim());
  const out: Hit[] = [];
  for (const layer of map.layers) {
    if (scope === 'part' && layer.type === 'brick') {
      for (const b of layer.bricks) {
        if (cmp(b.partNumber).includes(n)) {
          out.push({ layerId: layer.id, brickId: b.id, preview: `${b.partNumber}  ·  ${layer.name}` });
        }
      }
    } else if (scope === 'text' && layer.type === 'text') {
      for (let i = 0; i < layer.textCells.length; i++) {
        const t = layer.textCells[i]!;
        if (cmp(t.text).includes(n)) {
          out.push({ layerId: layer.id, textIndex: i, preview: `"${t.text}"  ·  ${layer.name}` });
        }
      }
    }
  }
  return out;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

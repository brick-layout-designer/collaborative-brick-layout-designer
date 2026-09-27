// Find & Replace dialog — port of `FindDialog.cpp`.
// Searches brick part numbers and text-cell content; lists matches and
// lets the user select them. Replace (current match) and Replace All work
// in both scopes, each as one undo step (FindDialog.cpp:150-189): part
// scope rewrites the matched text inside part numbers (e.g. 3001.1 →
// 3001.5), keeping each brick's position.

import { useMemo, useState } from 'react';
import type * as Y from 'yjs';
import type { BbmMap } from '@cld/model';
import { useEditorStore } from './editorStore';
import { findHits, replaceHits, type FindScope } from './findReplace';

interface Props {
  map: BbmMap;
  doc: Y.Doc;
  onClose: () => void;
}

export function FindDialog({ map, doc, onClose }: Props) {
  const setSelection = useEditorStore((s) => s.setSelection);
  const showStatusMessage = useEditorStore((s) => s.showStatusMessage);
  const [needle, setNeedle] = useState('');
  const [replacement, setReplacement] = useState('');
  const [scope, setScope] = useState<FindScope>('part');
  const [matchCase, setMatchCase] = useState(false);
  // Index of the current match — the one "Replace" acts on.
  const [current, setCurrent] = useState(0);

  const hits = useMemo(() => findHits(map, needle, scope, matchCase), [map, needle, scope, matchCase]);
  const cur = hits.length > 0 ? Math.min(current, hits.length - 1) : -1;

  function report(count: number) {
    showStatusMessage(`Replaced ${count} occurrence${count === 1 ? '' : 's'}`);
  }

  function replaceCurrent() {
    const h = hits[cur];
    if (!h) return;
    report(replaceHits(doc, [h], needle, replacement, matchCase));
    // The replaced item usually drops out of the list, so the same index
    // now points at the next match.
  }

  function replaceAll() {
    report(replaceHits(doc, hits, needle, replacement, matchCase));
    setCurrent(0);
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
        className="w-152 rounded-lg border border-neutral-800 bg-neutral-900 p-5 shadow-xl"
      >
        <h2 className="text-base font-semibold">Find &amp; Replace</h2>

        {/* Scope + options row */}
        <div className="mt-3 flex items-center gap-3 text-xs">
          <select
            value={scope}
            onChange={(e) => { setScope(e.target.value as FindScope); setCurrent(0); }}
            className="rounded-sm border border-neutral-700 bg-neutral-800 px-2 py-1"
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
            onChange={(e) => { setNeedle(e.target.value); setCurrent(0); }}
            placeholder="Search…"
            className="flex-1 rounded-sm border border-neutral-700 bg-neutral-800 px-2 py-1 text-sm"
          />
        </div>

        {/* Replace row */}
        <div className="mt-2 flex items-center gap-2">
          <span className="w-16 text-right text-xs text-neutral-500">Replace</span>
          <input
            value={replacement}
            onChange={(e) => setReplacement(e.target.value)}
            placeholder={scope === 'part' ? 'New part-number text…' : 'Replacement…'}
            className="flex-1 rounded-sm border border-neutral-700 bg-neutral-800 px-2 py-1 text-sm"
          />
          <button
            onClick={replaceCurrent}
            disabled={cur < 0}
            title="Replace the current (highlighted) match"
            className="rounded-sm border border-neutral-700 px-3 py-1 text-xs hover:bg-neutral-800 disabled:opacity-40"
          >
            Replace
          </button>
          <button
            onClick={replaceAll}
            disabled={!needle.trim() || hits.length === 0}
            className="rounded-sm bg-blue-600 px-3 py-1 text-xs text-white hover:bg-blue-500 disabled:opacity-40"
          >
            Replace all
          </button>
        </div>

        {/* Results */}
        <div className="mt-3 max-h-64 min-h-24 overflow-y-auto rounded-sm border border-neutral-800">
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
                      setCurrent(i);
                      if (h.brickId) setSelection([h.brickId]);
                    }}
                    onDoubleClick={() => {
                      if (h.brickId) onClose();
                    }}
                    aria-current={i === cur ? 'true' : undefined}
                    className={
                      'block w-full px-2 py-1 text-left text-sm hover:bg-neutral-800 ' +
                      (i === cur ? 'bg-blue-950/60 text-neutral-100' : h.brickId ? '' : 'text-neutral-400')
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
            className="rounded-sm border border-neutral-700 px-3 py-1 text-sm hover:bg-neutral-800"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

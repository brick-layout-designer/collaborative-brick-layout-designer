// Find & Replace dialog — port of `FindDialog.cpp`.
// Searches brick part numbers and text-cell content. Like desktop it is
// modeless (setModal(false)) — a floating panel that leaves the canvas
// usable — and selects every match live as you type (200 ms debounce,
// FindDialog.cpp:70-117); clicking a listed match selects just it. Replace (current match) and Replace All work
// in both scopes, each as one undo step (FindDialog.cpp:150-189): part
// scope rewrites the matched text inside part numbers (e.g. 3001.1 →
// 3001.5), keeping each brick's position.

import { useEffect, useMemo, useRef, useState } from 'react';
import type * as Y from 'yjs';
import type { BbmMap } from '@cld/model';
import { useEditorStore } from './editorStore';
import { findHits, hitsSelection, replaceHits, type FindHit, type FindScope } from './findReplace';

interface Props {
  map: BbmMap;
  doc: Y.Doc;
  onClose: () => void;
}

export function FindDialog({ map, doc, onClose }: Props) {
  const setMixedSelection = useEditorStore((s) => s.setMixedSelection);
  const showStatusMessage = useEditorStore((s) => s.showStatusMessage);
  const [needle, setNeedle] = useState('');
  const [replacement, setReplacement] = useState('');
  // Desktop opens on "Text content", listed first (FindDialog.cpp:36-38).
  const [scope, setScope] = useState<FindScope>('text');
  const [matchCase, setMatchCase] = useState(false);
  // Index of the current match — the one "Replace" acts on.
  const [current, setCurrent] = useState(0);

  const hits = useMemo(() => findHits(map, needle, scope, matchCase), [map, needle, scope, matchCase]);
  const cur = hits.length > 0 ? Math.min(current, hits.length - 1) : -1;

  // Live selection of every match, re-run when the query or the match set
  // changes (desktop also re-runs on every undo-stack change). An empty
  // query deselects everything.
  const hitKey = hits.map((h) => h.brickId ?? `${h.layerId}#${h.textIndex}`).join('|');
  const liveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    const t = setTimeout(() => {
      const sel = hitsSelection(hits);
      setMixedSelection(sel.bricks, sel.anno);
    }, 200);
    liveTimer.current = t;
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hitKey, setMixedSelection]);

  function selectHit(h: FindHit) {
    // A click inside the debounce window must win over the pending
    // select-all, or the clicked match is replaced by every match.
    clearTimeout(liveTimer.current);
    const sel = hitsSelection([h]);
    setMixedSelection(sel.bricks, sel.anno);
  }

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
    // Modeless: no backdrop, so the canvas stays live underneath.
    <div
      role="dialog"
      aria-modal="false"
      aria-label="Find & Replace"
      onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } }}
      className="fixed right-4 top-16 z-40 w-152 max-w-[calc(100vw-2rem)] rounded-lg border border-line bg-panel p-5 shadow-xl"
    >
      <div>
        <h2 className="text-base font-semibold">Find &amp; Replace</h2>

        {/* Scope + options row */}
        <div className="mt-3 flex items-center gap-3 text-xs">
          <select
            value={scope}
            onChange={(e) => { setScope(e.target.value as FindScope); setCurrent(0); }}
            className="rounded-lg border border-border bg-soft px-2 py-1"
          >
            <option value="text">Text content</option>
            <option value="part">Part number</option>
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
          <span className="w-16 text-right text-xs text-muted">Find</span>
          <input
            autoFocus
            value={needle}
            onChange={(e) => { setNeedle(e.target.value); setCurrent(0); }}
            placeholder="Search…"
            className="flex-1 rounded-lg border border-border bg-soft px-2 py-1 text-sm"
          />
        </div>

        {/* Replace row */}
        <div className="mt-2 flex items-center gap-2">
          <span className="w-16 text-right text-xs text-muted">Replace</span>
          <input
            value={replacement}
            onChange={(e) => setReplacement(e.target.value)}
            placeholder={scope === 'part' ? 'New part-number text…' : 'Replacement…'}
            className="flex-1 rounded-lg border border-border bg-soft px-2 py-1 text-sm"
          />
          <button
            onClick={replaceCurrent}
            disabled={cur < 0}
            title="Replace the current (highlighted) match"
            className="rounded-lg border border-border px-3 py-1 text-xs hover:bg-soft disabled:opacity-40"
          >
            Replace
          </button>
          <button
            onClick={replaceAll}
            disabled={!needle.trim() || hits.length === 0}
            className="rounded-lg bg-accent px-3 py-1 text-xs text-accent-ink hover:bg-accent-hover disabled:opacity-40"
          >
            Replace all
          </button>
        </div>

        {/* Results */}
        <div className="mt-3 max-h-64 min-h-24 overflow-y-auto rounded-lg border border-line">
          {needle.trim() === '' ? (
            <p className="p-2 text-xs text-muted">Type a query above.</p>
          ) : hits.length === 0 ? (
            <p className="p-2 text-xs text-muted">No matches.</p>
          ) : (
            <ul>
              {hits.map((h, i) => (
                <li key={i}>
                  <button
                    onClick={() => {
                      setCurrent(i);
                      selectHit(h);
                    }}
                    onDoubleClick={onClose}
                    aria-current={i === cur ? 'true' : undefined}
                    className={
                      'block w-full px-2 py-1 text-left text-sm hover:bg-soft ' +
                      (i === cur ? 'bg-blue-950/60 text-ink' : '')
                    }
                  >
                    {h.preview}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="mt-3 flex items-center justify-between text-xs text-muted">
          <span>{hits.length} match{hits.length === 1 ? '' : 'es'}</span>
          <button
            onClick={onClose}
            className="rounded-lg border border-border px-3 py-1 text-sm hover:bg-soft"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

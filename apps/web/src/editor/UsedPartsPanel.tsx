// Used Parts panel — port of PartUsagePanel.cpp.
// Aggregates brick counts from all visible layers, shows a sortable table
// of part # / count / description. Double-click selects all bricks of
// that part in the active layer (desktop: selects across all layers).

import { useEffect, useMemo, useRef, useState } from 'react';
import type * as Y from 'yjs';
import type { BbmMap } from '@cld/model';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api';
import { useEditorStore } from './editorStore';
import { docToBbm } from '@cld/ydoc';
import { useYjsSnapshot } from './useYjsSnapshot';

type SortKey = 'partNumber' | 'count' | 'description' | 'budget';
type SortDir = 'asc' | 'desc';

interface Row {
  partNumber: string;
  count: number;
  description: string;
}

export function UsedPartsPanel({ doc, budgetLimits = new Map() }: { doc: Y.Doc; budgetLimits?: Map<string, number> }) {
  const rev = useYjsSnapshot(doc);
  const map = useMemo(() => {
    try { return docToBbm(doc); } catch { return null; }
  }, [doc, rev]);

  const catalog = useQuery({
    queryKey: ['parts-catalog'],
    queryFn: api.parts.catalog,
    staleTime: 5 * 60 * 1000,
  });

  const descByKey = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of catalog.data?.parts ?? []) {
      m.set(p.key.toLowerCase(), p.description || p.partNumber);
      const bare = p.partNumber.toLowerCase();
      if (!m.has(bare)) m.set(bare, p.description || p.partNumber);
    }
    return m;
  }, [catalog.data]);

  const rows = useMemo(() => buildRows(map, descByKey), [map, descByKey]);

  const [filter, setFilter] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('count');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [ctxMenu, setCtxMenu] = useState<{ partNumber: string; x: number; y: number } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!ctxMenu) return;
    function onDown(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setCtxMenu(null);
    }
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [ctxMenu]);

  const setSelection = useEditorStore((s) => s.setSelection);

  const filtered = useMemo(() => {
    const q = filter.toLowerCase();
    return rows.filter(
      (r) =>
        !q ||
        r.partNumber.toLowerCase().includes(q) ||
        r.description.toLowerCase().includes(q),
    );
  }, [rows, filter]);

  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      let cmp = 0;
      if (sortKey === 'count') cmp = a.count - b.count;
      else if (sortKey === 'partNumber') cmp = a.partNumber.localeCompare(b.partNumber);
      else if (sortKey === 'budget') {
        const limA = budgetLimits.get(a.partNumber.toLowerCase()) ?? Infinity;
        const limB = budgetLimits.get(b.partNumber.toLowerCase()) ?? Infinity;
        cmp = (a.count - limA) - (b.count - limB);
      } else cmp = a.description.localeCompare(b.description);
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }, [filtered, sortKey, sortDir, budgetLimits]);

  const total = useMemo(() => rows.reduce((s, r) => s + r.count, 0), [rows]);

  function handleSort(key: SortKey) {
    if (sortKey === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(key); setSortDir(key === 'count' ? 'desc' : 'asc'); }
  }

  function selectAll(partNumber: string) {
    if (!map) return;
    const ids: string[] = [];
    for (const layer of map.layers) {
      if (layer.type !== 'brick') continue;
      for (const b of layer.bricks) {
        if (b.partNumber === partNumber) ids.push(b.id);
      }
    }
    setSelection(ids);
  }

  function arrow(key: SortKey) {
    if (sortKey !== key) return null;
    return <span className="ml-0.5 text-neutral-400">{sortDir === 'asc' ? '▲' : '▼'}</span>;
  }

  const thCls = 'cursor-pointer select-none px-2 py-1 text-left text-[10px] uppercase tracking-wide text-neutral-500 hover:text-neutral-300';
  const hasBudget = budgetLimits.size > 0;

  return (
    <aside className="relative flex h-full min-h-0 w-full flex-col bg-neutral-925 text-sm">
      <div className="flex items-center justify-between border-b border-neutral-800 px-2 py-1.5 text-xs uppercase tracking-wider text-neutral-400">
        <span>Used Parts</span>
        <span className="text-neutral-600">{rows.length} kinds · {total} total</span>
      </div>
      <div className="border-b border-neutral-800 px-2 py-1">
        <input
          type="search"
          placeholder="Filter…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="w-full rounded border border-neutral-700 bg-neutral-800 px-2 py-0.5 text-xs outline-none placeholder:text-neutral-600"
        />
      </div>
      <div className="flex-1 min-h-0 overflow-auto">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-neutral-900 border-b border-neutral-800">
            <tr>
              <th className={thCls} onClick={() => handleSort('partNumber')}>Part {arrow('partNumber')}</th>
              <th className={thCls + ' text-right'} onClick={() => handleSort('count')}>Count {arrow('count')}</th>
              {hasBudget && (
                <th className={thCls + ' text-right'} onClick={() => handleSort('budget')} title="Budget limit / over">Budget {arrow('budget')}</th>
              )}
              <th className={thCls} onClick={() => handleSort('description')}>Description {arrow('description')}</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((row) => {
              const limit = budgetLimits.get(row.partNumber.toLowerCase());
              const over = limit !== undefined ? row.count - limit : 0;
              return (
                <tr
                  key={row.partNumber}
                  onDoubleClick={() => selectAll(row.partNumber)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    setCtxMenu({ partNumber: row.partNumber, x: e.clientX, y: e.clientY });
                  }}
                  className={`cursor-pointer border-b border-neutral-800/50 hover:bg-neutral-800/60 ${hasBudget && over > 0 ? 'bg-red-950/30' : ''}`}
                  title="Double-click or right-click to select all of this part"
                >
                  <td className="px-2 py-1 font-mono text-neutral-300">{row.partNumber}</td>
                  <td className="px-2 py-1 text-right tabular-nums text-neutral-200">{row.count}</td>
                  {hasBudget && (
                    <td className={`px-2 py-1 text-right tabular-nums ${limit === undefined ? 'text-neutral-600' : over > 0 ? 'font-semibold text-red-400' : 'text-green-500'}`}>
                      {limit === undefined ? '—' : over > 0 ? `+${over}` : `${row.count}/${limit}`}
                    </td>
                  )}
                  <td className="px-2 py-1 text-neutral-400 truncate max-w-[10rem]">{row.description || '—'}</td>
                </tr>
              );
            })}
            {sorted.length === 0 && (
              <tr>
                <td colSpan={hasBudget ? 4 : 3} className="px-2 py-4 text-center text-neutral-600">
                  {rows.length === 0 ? 'No bricks in map' : 'No matches'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {ctxMenu && (
        <div
          ref={menuRef}
          style={{ position: 'fixed', left: ctxMenu.x, top: ctxMenu.y, zIndex: 9999 }}
          className="min-w-[160px] rounded border border-neutral-700 bg-neutral-900 py-1 shadow-lg"
          onContextMenu={(e) => e.preventDefault()}
        >
          <button
            className="block w-full px-3 py-1 text-left text-xs hover:bg-neutral-700 whitespace-nowrap"
            onClick={() => { selectAll(ctxMenu.partNumber); setCtxMenu(null); }}
          >
            Select all of this part
          </button>
          <hr className="my-1 border-neutral-700" />
          <button
            className="block w-full px-3 py-1 text-left text-xs text-neutral-500 hover:bg-neutral-700 whitespace-nowrap"
            onClick={() => setCtxMenu(null)}
          >
            Cancel
          </button>
        </div>
      )}
    </aside>
  );
}

function buildRows(map: BbmMap | null, descByKey: Map<string, string>): Row[] {
  if (!map) return [];
  const counts = new Map<string, number>();
  for (const layer of map.layers) {
    if (layer.type !== 'brick') continue;
    for (const b of layer.bricks) {
      counts.set(b.partNumber, (counts.get(b.partNumber) ?? 0) + 1);
    }
  }
  const rows: Row[] = [];
  for (const [partNumber, count] of counts) {
    rows.push({
      partNumber,
      count,
      description: descByKey.get(partNumber.toLowerCase()) ?? '',
    });
  }
  return rows;
}

// Port of BudgetDialog.cpp — modeless budget editor.
// Reads/writes BlueBrick `.bbb` XML format (Budget > BudgetEntry > PartNumber + Limit).
// Usage counts are computed from the live Yjs doc. Rows with used > limit are highlighted.

import { useState, useMemo } from 'react';
import type { BbmMap } from '@cld/model';

interface BudgetEntry {
  part: string;
  limit: number; // -1 = unlimited
}

interface Props {
  map: BbmMap | null;
  limits: Map<string, number>;
  onLimitsChange: (limits: Map<string, number>) => void;
  onClose: () => void;
}

// --- .bbb XML parse/write ---

function parseBbb(xml: string): BudgetEntry[] {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xml, 'application/xml');
  const entries: BudgetEntry[] = [];
  for (const el of Array.from(doc.querySelectorAll('BudgetEntry'))) {
    const part = el.querySelector('PartNumber')?.textContent?.trim() ?? '';
    const limitText = el.querySelector('Limit')?.textContent?.trim() ?? '';
    const limit = parseInt(limitText, 10);
    if (part) entries.push({ part, limit: isNaN(limit) ? -1 : limit });
  }
  return entries;
}

function writeBbb(entries: BudgetEntry[]): string {
  const sorted = [...entries].sort((a, b) => a.part.localeCompare(b.part));
  const rows = sorted
    .map(
      (e) =>
        `  <BudgetEntry>\n    <PartNumber>${e.part}</PartNumber>\n    <Limit>${e.limit}</Limit>\n  </BudgetEntry>`,
    )
    .join('\n');
  return `<?xml version="1.0"?>\n<Budget>\n  <Version>1</Version>\n${rows}\n</Budget>\n`;
}

// --- Usage from map ---

function countUsage(map: BbmMap | null): Map<string, number> {
  const usage = new Map<string, number>();
  if (!map) return usage;
  for (const layer of map.layers) {
    if (layer.type !== 'brick') continue;
    for (const b of layer.bricks) {
      usage.set(b.partNumber, (usage.get(b.partNumber) ?? 0) + 1);
    }
  }
  return usage;
}

export function BudgetDialog({ map, limits, onLimitsChange, onClose }: Props) {
  const setLimits = onLimitsChange;
  const [fileName, setFileName] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const usage = useMemo(() => countUsage(map), [map, refreshKey]);

  // Union of parts in usage OR in budget limits.
  const parts = useMemo(() => {
    const all = new Set<string>([...usage.keys(), ...limits.keys()]);
    return [...all].sort();
  }, [usage, limits]);

  const overBudgetCount = parts.filter((p) => {
    const limit = limits.get(p) ?? -1;
    return limit >= 0 && (usage.get(p) ?? 0) > limit;
  }).length;

  function handleNew() {
    setLimits(new Map());
    setFileName(null);
  }

  function handleOpen() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.bbb,.xml';
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return;
      file.text().then((text) => {
        const entries = parseBbb(text);
        const m = new Map<string, number>();
        for (const e of entries) m.set(e.part, e.limit);
        setLimits(m);
        setFileName(file.name);
      });
    };
    input.click();
  }

  function handleSave() {
    const entries: BudgetEntry[] = [...limits.entries()].map(([part, limit]) => ({ part, limit }));
    const xml = writeBbb(entries);
    const blob = new Blob([xml], { type: 'application/xml' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = fileName ?? 'budget.bbb';
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function setLimit(part: string, value: string) {
    const next = new Map(limits);
    const trimmed = value.trim();
    if (trimmed === '') {
      next.delete(part);
    } else {
      const n = parseInt(trimmed, 10);
      if (!isNaN(n) && n >= 0) next.set(part, n);
    }
    setLimits(next);
  }

  return (
    <div className="fixed bottom-8 right-8 z-40 flex w-[540px] flex-col rounded-lg border border-neutral-700 bg-neutral-900 shadow-2xl text-sm">
      {/* Title bar */}
      <div className="flex items-center justify-between border-b border-neutral-800 px-3 py-2">
        <span className="font-semibold text-xs">
          Budget{fileName ? ` — ${fileName}` : ''}
        </span>
        <button onClick={onClose} className="text-neutral-400 hover:text-white text-base leading-none">×</button>
      </div>

      {/* Toolbar */}
      <div className="flex gap-2 border-b border-neutral-800 px-3 py-2">
        <button onClick={handleNew}
          className="rounded border border-neutral-700 px-2 py-0.5 text-xs hover:bg-neutral-800">New</button>
        <button onClick={handleOpen}
          className="rounded border border-neutral-700 px-2 py-0.5 text-xs hover:bg-neutral-800">Open…</button>
        <button onClick={handleSave}
          className="rounded border border-neutral-700 px-2 py-0.5 text-xs hover:bg-neutral-800">Save…</button>
        <button onClick={() => setRefreshKey((k) => k + 1)}
          className="rounded border border-neutral-700 px-2 py-0.5 text-xs hover:bg-neutral-800" title="Re-count parts from current map">Refresh</button>
      </div>

      {/* Table */}
      <div className="overflow-auto" style={{ maxHeight: '340px' }}>
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-neutral-900">
            <tr className="border-b border-neutral-800 text-left text-neutral-500">
              <th className="px-2 py-1">Part</th>
              <th className="px-2 py-1 text-right">Used</th>
              <th className="px-2 py-1">Limit (blank=unlimited)</th>
            </tr>
          </thead>
          <tbody>
            {parts.length === 0 && (
              <tr>
                <td colSpan={3} className="px-2 py-3 text-center text-neutral-500">
                  No parts in map or budget. Use "Open…" to load a .bbb file.
                </td>
              </tr>
            )}
            {parts.map((part) => {
              const used = usage.get(part) ?? 0;
              const limit = limits.get(part) ?? -1;
              const over = limit >= 0 && used > limit;
              return (
                <tr key={part} className={over ? 'bg-red-950/60' : 'odd:bg-neutral-800/30'}>
                  <td className="px-2 py-1 font-mono">{part}</td>
                  <td className={`px-2 py-1 text-right ${over ? 'text-red-400 font-bold' : ''}`}>{used}</td>
                  <td className="px-2 py-1">
                    <input
                      type="number"
                      min="0"
                      placeholder="—"
                      value={limit >= 0 ? limit : ''}
                      onChange={(e) => setLimit(part, e.target.value)}
                      className="w-20 rounded border border-neutral-700 bg-neutral-800 px-1 py-0.5 text-xs"
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Status */}
      <div className="border-t border-neutral-800 px-3 py-1.5 text-xs">
        {overBudgetCount > 0
          ? <span className="text-red-400">⚠ {overBudgetCount} part(s) over budget</span>
          : <span className="text-green-400">All parts within budget</span>}
      </div>
    </div>
  );
}

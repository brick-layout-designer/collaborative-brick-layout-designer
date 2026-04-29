import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, spriteUrlFor, type PartWire } from '../api';
import { useEditorStore } from './editorStore';

export function PartsPanel() {
  const { data, isLoading } = useQuery({
    queryKey: ['parts-catalog'],
    queryFn: api.parts.catalog,
    staleTime: 5 * 60 * 1000,
  });
  const placePartKey = useEditorStore((s) => s.placePartKey);
  const setPlacePart = useEditorStore((s) => s.setPlacePart);
  const [filter, setFilter] = useState('');

  const grouped = useMemo(() => {
    if (!data) return new Map<string, PartWire[]>();
    const out = new Map<string, PartWire[]>();
    const needle = filter.trim().toLowerCase();
    for (const p of data.parts) {
      if (
        needle &&
        !p.partNumber.toLowerCase().includes(needle) &&
        !p.description.toLowerCase().includes(needle)
      ) {
        continue;
      }
      const bucket = p.sortingKey || '_';
      const arr = out.get(bucket);
      if (arr) arr.push(p);
      else out.set(bucket, [p]);
    }
    // Sort buckets alphanumerically, parts within bucket by partNumber.
    return new Map(
      [...out.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => [k, [...v].sort((a, b) => a.partNumber.localeCompare(b.partNumber))]),
    );
  }, [data, filter]);

  return (
    <aside className="row-start-2 row-end-3 flex flex-col border-r border-neutral-800 bg-neutral-925 text-sm">
      <div className="border-b border-neutral-800 p-2">
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Search parts…"
          className="w-full rounded border border-neutral-700 bg-neutral-800 px-2 py-1 text-xs"
        />
      </div>
      <div className="flex-1 overflow-y-auto">
        {isLoading && <p className="p-3 text-xs text-neutral-500">Loading catalog…</p>}
        {[...grouped.entries()].map(([bucket, parts]) => (
          <details
            key={bucket}
            // Open the first few buckets by default; collapse the rest so
            // a fresh editor doesn't render hundreds of thumbnails up front.
            // Search expands all buckets implicitly because `filter` shrinks
            // the list.
            open={filter.length > 0}
            className="border-b border-neutral-800"
          >
            <summary className="cursor-pointer bg-neutral-900 px-3 py-1 text-xs text-neutral-400">
              {bucket} ({parts.length})
            </summary>
            <ul className="grid grid-cols-2 gap-1 p-2">
              {parts.map((p) => (
                <li key={p.key}>
                  <button
                    onClick={() => setPlacePart(p.key)}
                    title={`${p.partNumber}\n${p.description}`}
                    className={
                      'flex w-full flex-col items-center rounded p-1 text-[10px] ' +
                      (placePartKey === p.key
                        ? 'bg-blue-700 text-white'
                        : 'bg-neutral-900 hover:bg-neutral-800')
                    }
                  >
                    {(() => {
                      const url = spriteUrlFor(p);
                      return url ? (
                        <img
                          src={url}
                          alt=""
                          className="h-12 w-12 object-contain"
                          loading="lazy"
                        />
                      ) : (
                        <div className="h-12 w-12 rounded bg-neutral-800" />
                      );
                    })()}
                    <span className="mt-1 line-clamp-1">{p.partNumber}</span>
                  </button>
                </li>
              ))}
            </ul>
          </details>
        ))}
      </div>
    </aside>
  );
}

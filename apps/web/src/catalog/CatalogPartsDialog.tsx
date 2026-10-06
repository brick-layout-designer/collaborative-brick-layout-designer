// The editor's Parts panel › "From the catalog…": search the public parts
// catalog and copy a part into your parts, ready to place.

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';

export function CatalogPartsDialog({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const [added, setAdded] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const items = useQuery({ queryKey: ['catalog-items', 'part', q, '', 'popular'], queryFn: () => api.catalog.items('part', { q, sort: 'popular' }) });
  const add = useMutation({
    mutationFn: (id: string) => api.catalog.add(id),
    onSuccess: (_r, id) => {
      setError(null);
      setAdded((a) => [...a, id]);
      void qc.invalidateQueries({ queryKey: ['custom-parts'] });
      // Past the browser's 60 s catalog cache, so the Parts panel shows it now.
      void qc.fetchQuery({ queryKey: ['parts-catalog'], queryFn: api.parts.catalogFresh, staleTime: 0 }).catch(() => undefined);
    },
    onError: (e: Error) => setError(e.message),
  });
  return (
    <div className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-black/60 p-4">
      <div role="dialog" aria-modal="true" aria-label="Parts from the catalog" className="w-full max-w-md space-y-3 rounded-section border border-line bg-panel p-5 text-sm">
        <div className="flex items-start justify-between gap-2">
          <div>
            <h3 className="text-lg font-semibold">Parts from the catalog</h3>
            <p className="text-xs text-muted">Add a part to copy it into your parts. It then shows in the Parts panel, ready to place.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-lg p-1 text-muted hover:bg-soft">
            ✕
          </button>
        </div>
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search parts"
          aria-label="Search the parts catalog"
          className="w-full rounded-lg border border-border bg-soft px-3 py-1.5"
        />
        {items.isLoading && <p className="text-muted">Loading…</p>}
        {items.isError && <p className="text-danger">{(items.error as Error).message}</p>}
        {items.data && items.data.items.length === 0 && <p className="text-muted">No parts in the catalog yet.</p>}
        <ul className="max-h-80 divide-y divide-line overflow-y-auto rounded-lg border border-line">
          {items.data?.items.map((it) => (
            <li key={it.id} className="flex items-center gap-3 px-3 py-2">
              {it.previewUrl ? <img src={it.previewUrl} alt="" loading="lazy" className="size-12 shrink-0 object-contain" /> : <span aria-hidden className="block size-12 shrink-0" />}
              <div className="min-w-0 flex-1">
                <p className="break-words">{it.title}</p>
                <p className="text-xs text-muted">by {it.by} · {it.uses} uses</p>
              </div>
              {added.includes(it.id) ? (
                <span className="text-xs font-semibold text-ok">Added</span>
              ) : (
                <button
                  type="button"
                  disabled={add.isPending}
                  onClick={() => add.mutate(it.id)}
                  aria-label={`Add ${it.title}`}
                  className="rounded-lg bg-accent px-3 py-1 text-xs text-accent-ink hover:bg-accent-hover disabled:opacity-50"
                >
                  Add
                </button>
              )}
            </li>
          ))}
        </ul>
        {error && <p className="text-danger">{error}</p>}
      </div>
    </div>
  );
}

// Venue Library panel — lists saved venues from the server, allows loading
// into the current layout and deleting entries.

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type * as Y from 'yjs';
import { api } from '../api';
import { setVenue } from './mutations';

interface Props {
  doc: Y.Doc;
  isViewer: boolean;
}

export function VenueLibraryPanel({ doc, isViewer }: Props) {
  const qc = useQueryClient();
  const [filter, setFilter] = useState('');

  const list = useQuery({
    queryKey: ['venue-library'],
    queryFn: api.venues.list,
    enabled: !isViewer,
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.venues.remove(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['venue-library'] }),
  });

  async function load(id: string) {
    try {
      const { data } = await api.venues.get(id);
      setVenue(doc, data as import('@cld/bbm').Venue);
    } catch {
      alert('Failed to load venue from library.');
    }
  }

  const venues = list.data?.venues ?? [];
  const filtered = filter
    ? venues.filter((v) => v.name.toLowerCase().includes(filter.toLowerCase()))
    : venues;

  return (
    <div className="flex flex-col h-full text-xs">
      <div className="p-2 border-b border-neutral-800">
        <input
          placeholder="Filter venues…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="w-full rounded border border-neutral-700 bg-neutral-800 px-2 py-1 text-xs"
        />
      </div>

      {isViewer && <p className="p-2 text-neutral-500">Sign in to access the venue library.</p>}
      {!isViewer && list.isLoading && <p className="p-2 text-neutral-500">Loading…</p>}
      {!isViewer && list.isError && <p className="p-2 text-red-400">Failed to load venue library.</p>}

      <div className="flex-1 overflow-y-auto">
        {filtered.length === 0 && !list.isLoading && (
          <p className="p-2 text-neutral-500">
            {filter ? 'No matches.' : 'No saved venues. Use Map → Venue → Save to Library… to add one.'}
          </p>
        )}
        {filtered.map((v) => (
          <div
            key={v.id}
            className="flex items-center justify-between gap-1 border-b border-neutral-800 px-2 py-1.5 hover:bg-neutral-800/40"
          >
            <span className="flex-1 truncate" title={v.name}>
              {v.name}
              {v.ownerOrgId && (
                <span className="ml-1 text-neutral-500">(org)</span>
              )}
            </span>
            {!isViewer && (
              <button
                onClick={() => load(v.id)}
                title="Load into layout"
                className="rounded border border-neutral-700 px-1.5 py-0.5 hover:bg-neutral-700"
              >
                ↓
              </button>
            )}
            <button
              onClick={() => {
                if (!confirm(`Delete "${v.name}" from the library?`)) return;
                remove.mutate(v.id);
              }}
              title="Delete from library"
              className="rounded border border-red-900 px-1.5 py-0.5 text-red-400 hover:bg-red-950"
            >
              ✕
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

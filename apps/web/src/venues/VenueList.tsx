// Saved venues outside the editor: an org's (on its page) or your own (on
// the layouts page). Start a layout from one, download it as a
// .bld-venue file, upload one, and, when you manage the list (your own,
// or an org you admin), rename or delete.

import { useRef, type ChangeEvent } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Venue } from '@cld/bbm';
import { api } from '../api';
import { parseVenueFile, VENUE_FILE_ACCEPT, VENUE_FILE_EXT, writeVenueFile } from '../editor/venueFile';
import { downloadText } from './venueStart';

export function VenueList({ org, canManage }: { org?: { id: string; slug: string }; canManage: boolean }) {
  const qc = useQueryClient();
  const fileInput = useRef<HTMLInputElement>(null);
  const venues = useQuery({ queryKey: ['venues'], queryFn: api.venues.list });
  const refresh = () => qc.invalidateQueries({ queryKey: ['venues'] });
  const fail = (what: string) => (e: Error) => alert(`Could not ${what}: ${e.message}`);

  const upload = useMutation({
    mutationFn: (body: { name: string; data: Venue }) => api.venues.create({ ...body, ...(org ? { orgSlug: org.slug } : {}) }),
    onSuccess: refresh,
    onError: fail('upload the venue'),
  });
  const rename = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => api.venues.rename(id, name),
    onSuccess: refresh,
    onError: fail('rename the venue'),
  });
  const remove = useMutation({ mutationFn: api.venues.remove, onSuccess: refresh, onError: fail('delete the venue') });

  async function pick(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    let venue: Venue;
    try {
      venue = parseVenueFile(await file.text());
    } catch (err) {
      alert(`Could not read ${file.name}: ${(err as Error).message}`);
      return;
    }
    const name = venue.name.trim() || file.name.replace(/\.(bld-venue|cld-venue|json)$/i, '');
    upload.mutate({ name, data: { ...venue, name } });
  }

  async function download(id: string, name: string) {
    try {
      const v = await api.venues.get(id);
      downloadText(`${name}${VENUE_FILE_EXT}`, writeVenueFile(v.data as Venue));
    } catch (err) {
      alert(`Could not download the venue: ${(err as Error).message}`);
    }
  }

  const list = (venues.data?.venues ?? [])
    .filter((v) => v.ownerOrgId === (org?.id ?? null))
    .sort((a, b) => a.name.localeCompare(b.name));
  const startUrl = (id: string) => `/?newLayoutVenue=${encodeURIComponent(id)}${org ? `&owner=${encodeURIComponent(org.slug)}` : ''}`;
  const btn = 'rounded-lg border border-border px-2 py-1 text-xs hover:bg-soft';

  return (
    <div className="space-y-2">
      {venues.isLoading && <p className="text-sm text-muted">Loading…</p>}
      {venues.data &&
        (list.length === 0 ? (
          <p className="rounded-lg border border-dashed border-line p-4 text-sm text-muted">
            No saved venues yet. Upload a .bld-venue file, or save one from the editor's Venue Library.
          </p>
        ) : (
          <ul className="divide-y divide-line rounded-lg border border-line">
            {list.map((v) => (
              <li key={v.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
                <span>{v.name}</span>
                <span className="flex flex-wrap gap-1">
                  <Link to={startUrl(v.id)} className="rounded-lg bg-accent text-accent-ink px-2 py-1 text-xs hover:bg-accent-hover">
                    Start layout
                  </Link>
                  {canManage && (
                    <Link to={`/venues/${encodeURIComponent(v.id)}/design${org ? `?org=${encodeURIComponent(org.slug)}` : ''}`} className={btn}>
                      Design
                    </Link>
                  )}
                  <button type="button" className={btn} onClick={() => void download(v.id, v.name)}>
                    Download
                  </button>
                  {canManage && (
                    <>
                      <button
                        type="button"
                        className={btn}
                        onClick={() => {
                          const next = prompt('New name:', v.name)?.trim();
                          if (next && next !== v.name) rename.mutate({ id: v.id, name: next });
                        }}
                      >
                        Rename
                      </button>
                      <button
                        type="button"
                        className={`${btn} text-danger`}
                        onClick={() => {
                          if (confirm(`Delete "${v.name}"?`)) remove.mutate(v.id);
                        }}
                      >
                        Delete
                      </button>
                    </>
                  )}
                </span>
              </li>
            ))}
          </ul>
        ))}
      <div className="flex gap-2">
        {(canManage || org) && (
          <Link to={`/venues/new${org ? `?org=${encodeURIComponent(org.slug)}` : ''}`} className="rounded-lg bg-accent text-accent-ink px-2 py-1 text-xs hover:bg-accent-hover">
            New venue
          </Link>
        )}
        <button type="button" className={btn} disabled={upload.isPending} onClick={() => fileInput.current?.click()}>
          Upload venue…
        </button>
      </div>
      <input
        ref={fileInput}
        type="file"
        accept={VENUE_FILE_ACCEPT}
        onChange={(e) => void pick(e)}
        className="hidden"
        aria-label="Venue file"
      />
    </div>
  );
}

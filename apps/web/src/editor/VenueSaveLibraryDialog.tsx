// Small dialog for saving a venue to the library — its name (desktop asks
// "Name for this venue:", VenueLibraryPanel.cpp:171-175) and personal
// ownership vs. an org the user belongs to.

import { useState, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, type OrgSummary } from '../api';
import { defaultSaveTo, readOwnerFilter, validOwnerFilter } from '../owners/owners';
import { SaveToPicker } from '../owners/OwnerControls';
import { useEscape } from './useEscape';

interface Props {
  venueName: string;
  orgs: OrgSummary[];
  onSave: (orgSlug: string | undefined, name: string) => void;
  onClose: () => void;
}

export function VenueSaveLibraryDialog({ venueName, orgs, onSave, onClose }: Props) {
  useEscape(onClose);
  // '' = Me, else a club's slug; starts at the club the home page shows.
  const me = useQuery({ queryKey: ['me'], queryFn: api.me });
  const [target, setTarget] = useState(() => defaultSaveTo(validOwnerFilter(readOwnerFilter(me.data?.user?.id), orgs)));
  const [name, setName] = useState(venueName || 'Venue');

  function submit(e: FormEvent) {
    e.preventDefault();
    const n = name.trim();
    if (!n) return;
    onSave(target || undefined, n);
  }

  const inputCls = 'w-full rounded-lg border border-border bg-soft px-2 py-1.5 text-sm';

  return (
    <div role="dialog" aria-label="Save to Venue library" aria-modal="true" className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4">
      <form
        onSubmit={submit}
        className="w-80 space-y-4 rounded-lg border border-line bg-panel p-5 text-sm"
      >
        <h3 className="font-semibold">Save to Venue library</h3>

        <label className="block">
          <span className="mb-1 block text-xs text-muted">Name for this venue</span>
          <input value={name} onChange={(e) => setName(e.target.value)} className={inputCls} autoFocus />
        </label>

        <SaveToPicker value={target} onChange={setTarget} orgs={orgs} />

        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-border px-4 py-1.5 text-sm hover:bg-soft"
          >
            Cancel
          </button>
          <button
            type="submit"
            className="rounded-lg bg-accent text-accent-ink px-4 py-1.5 text-sm hover:bg-accent-hover"
          >
            Save
          </button>
        </div>
      </form>
    </div>
  );
}

// Small dialog for saving a venue to the library — its name (desktop asks
// "Name for this venue:", VenueLibraryPanel.cpp:171-175) and personal
// ownership vs. an org the user belongs to.

import { useState, type FormEvent } from 'react';
import type { OrgSummary } from '../api';

interface Props {
  venueName: string;
  orgs: OrgSummary[];
  onSave: (orgSlug: string | undefined, name: string) => void;
  onClose: () => void;
}

export function VenueSaveLibraryDialog({ venueName, orgs, onSave, onClose }: Props) {
  const [target, setTarget] = useState<'personal' | string>('personal');
  const [name, setName] = useState(venueName || 'Venue');

  function submit(e: FormEvent) {
    e.preventDefault();
    const n = name.trim();
    if (!n) return;
    onSave(target === 'personal' ? undefined : target, n);
  }

  const inputCls = 'w-full rounded-lg border border-border bg-soft px-2 py-1.5 text-sm';

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4">
      <form
        onSubmit={submit}
        className="w-80 space-y-4 rounded-lg border border-line bg-panel p-5 text-sm"
      >
        <h3 className="font-semibold">Save Venue to Library</h3>

        <label className="block">
          <span className="mb-1 block text-xs text-muted">Name for this venue</span>
          <input value={name} onChange={(e) => setName(e.target.value)} className={inputCls} autoFocus />
        </label>

        <div>
          <label className="mb-1 block text-xs text-muted">Save as</label>
          <select
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            className={inputCls}
          >
            <option value="personal">Personal library</option>
            {orgs.map((org) => (
              <option key={org.slug} value={org.slug}>
                {org.name} (org)
              </option>
            ))}
          </select>
        </div>

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

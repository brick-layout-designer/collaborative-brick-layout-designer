// Small dialog for saving a venue to the library — lets the user pick
// personal ownership vs. an org they belong to.

import { useState, type FormEvent } from 'react';
import type { OrgSummary } from '../api';

interface Props {
  venueName: string;
  orgs: OrgSummary[];
  onSave: (orgSlug?: string) => void;
  onClose: () => void;
}

export function VenueSaveLibraryDialog({ venueName, orgs, onSave, onClose }: Props) {
  const [target, setTarget] = useState<'personal' | string>('personal');

  function submit(e: FormEvent) {
    e.preventDefault();
    onSave(target === 'personal' ? undefined : target);
  }

  const inputCls = 'w-full rounded border border-neutral-700 bg-neutral-800 px-2 py-1.5 text-sm';

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4">
      <form
        onSubmit={submit}
        className="w-80 space-y-4 rounded-lg border border-neutral-800 bg-neutral-900 p-5 text-sm"
      >
        <h3 className="font-semibold">Save Venue to Library</h3>

        <div>
          <p className="mb-1 text-xs text-neutral-400">Venue</p>
          <p className="font-mono text-xs text-neutral-200">{venueName || 'Unnamed Venue'}</p>
        </div>

        <div>
          <label className="mb-1 block text-xs text-neutral-400">Save as</label>
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
            className="rounded border border-neutral-700 px-4 py-1.5 text-sm hover:bg-neutral-800"
          >
            Cancel
          </button>
          <button
            type="submit"
            className="rounded bg-blue-600 px-4 py-1.5 text-sm hover:bg-blue-500"
          >
            Save
          </button>
        </div>
      </form>
    </div>
  );
}

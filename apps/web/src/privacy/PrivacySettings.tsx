// Admin › Settings › Privacy: the numbers behind data downloads (and
// account deletion and record keeping as they arrive). Each one shows its
// default; a server env var may force one, and then the page says so.

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type PrivacySettingState } from '../api';

const UNIT: Record<PrivacySettingState['unit'], string> = { hours: 'hours', days: 'days', mb: 'MB' };

function SettingRow({ s, onSave, saving }: { s: PrivacySettingState; onSave: (v: number | null) => void; saving: boolean }) {
  const [draft, setDraft] = useState(String(s.value));
  const n = Number(draft);
  const valid = Number.isInteger(n) && n >= s.min && n <= s.max;
  const changed = valid && n !== s.value;
  const id = `privacy-${s.key}`;
  return (
    <div className="space-y-1" data-testid={`privacy-setting-${s.key}`}>
      <label htmlFor={id} className="block text-sm">
        {s.label}
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <input
          id={id}
          type="number"
          min={s.min}
          max={s.max}
          value={draft}
          disabled={!!s.forcedBy}
          onChange={(e) => setDraft(e.target.value)}
          className="w-28 rounded-lg border border-border bg-panel px-2 py-1.5 text-sm text-ink disabled:opacity-50"
        />
        <span className="text-sm text-muted">{UNIT[s.unit]}</span>
        {changed && !s.forcedBy && (
          <button
            type="button"
            disabled={saving}
            onClick={() => onSave(n)}
            className="tap-target rounded-lg bg-accent px-3 py-1 text-sm font-semibold text-accent-ink hover:bg-accent-hover disabled:opacity-50"
          >
            Save
          </button>
        )}
        {s.setting !== null && !s.forcedBy && (
          <button
            type="button"
            disabled={saving}
            onClick={() => {
              setDraft(String(s.builtIn));
              onSave(null);
            }}
            className="text-xs text-accent-text hover:underline"
          >
            Back to the default ({s.builtIn})
          </button>
        )}
      </div>
      {!valid && <p className="text-xs text-danger">Between {s.min} and {s.max}.</p>}
      <p className="text-xs text-muted">
        {s.help} Default: {s.builtIn} {UNIT[s.unit]}.
      </p>
      {s.forcedBy && (
        <p className="text-xs text-muted">
          Forced by the server setting <code>{s.forcedBy}</code> ({s.value} {UNIT[s.unit]}). Remove it from the server’s settings to change it here.
        </p>
      )}
    </div>
  );
}

export function PrivacySettingsSection() {
  const qc = useQueryClient();
  const settings = useQuery({ queryKey: ['admin-settings'], queryFn: api.admin.settings });
  const save = useMutation({
    mutationFn: (privacy: Record<string, number | null>) => api.admin.patchSettings({ privacy }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['admin-settings'] }),
  });
  const rows = settings.data?.privacy?.settings;
  if (!rows) return null;
  return (
    <section className="space-y-4" aria-labelledby="privacy-settings">
      <div>
        <h2 id="privacy-settings" className="text-sm font-semibold text-neutral-300">
          Privacy
        </h2>
        <p className="text-xs text-muted">
          You run this site, so you look after the personal data on it. People can download everything about them from their Profile; these
          settings say how often and how much.
        </p>
      </div>
      {rows.map((s) => (
        // The key resets the draft when the saved value changes.
        <SettingRow key={`${s.key}:${s.value}`} s={s} saving={save.isPending} onSave={(v) => save.mutate({ [s.key]: v })} />
      ))}
      {save.isError && <p className="text-sm text-danger">{(save.error as Error).message}</p>}
    </section>
  );
}

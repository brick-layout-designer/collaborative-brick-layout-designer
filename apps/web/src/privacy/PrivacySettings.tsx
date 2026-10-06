// Admin › Settings › Privacy: the numbers behind data downloads (and
// account deletion and record keeping as they arrive). Each one shows its
// default; a server env var may force one, and then the page says so.

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type PrivacySettingState } from '../api';
import { useHashScroll } from '../ui/useHashScroll';

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

/** The privacy page's words (markdown) and who to ask. */
function NoticeEditor({ notice, contact }: { notice: string; contact: { value: string | null; setting: string | null; forcedBy: string | null } }) {
  const qc = useQueryClient();
  const [text, setText] = useState(notice);
  const [who, setWho] = useState(contact.setting ?? '');
  const save = useMutation({
    mutationFn: () => api.admin.patchSettings({ privacyNotice: text, ...(contact.forcedBy ? {} : { privacyContact: who.trim() }) }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['admin-settings'] }),
  });
  const changed = text !== notice || (!contact.forcedBy && who.trim() !== (contact.setting ?? ''));
  return (
    <div className="space-y-2" data-testid="privacy-notice-editor">
      <label htmlFor="privacy-contact" className="block text-sm">
        Privacy contact
      </label>
      <input
        id="privacy-contact"
        type="text"
        value={contact.forcedBy ? (contact.value ?? '') : who}
        disabled={!!contact.forcedBy}
        onChange={(e) => setWho(e.target.value)}
        placeholder="privacy@your-club.example or https://…"
        className="w-full rounded-lg border border-border bg-panel px-2 py-1.5 text-sm text-ink disabled:opacity-50"
      />
      <p className="text-xs text-muted">Who people write to about their data: an email address or a web page. It shows on the Privacy page and in data downloads.</p>
      {contact.forcedBy && (
        <p className="text-xs text-muted">
          Forced by the server setting <code>{contact.forcedBy}</code>. Remove it from the server’s settings to change it here.
        </p>
      )}
      <label htmlFor="privacy-notice" className="block text-sm">
        Privacy notice
      </label>
      <textarea
        id="privacy-notice"
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={8}
        placeholder={'# Who we are\n\nThis site is run by …\n\n## What we keep\n\n- your email, to sign you in\n- the layouts you make'}
        className="w-full rounded-lg border border-border bg-panel px-2 py-1.5 font-mono text-sm text-ink"
      />
      <p className="text-xs text-muted">
        Shown on the Privacy page, linked at the bottom of Home and when people sign up. Use # for headings, - for lists, **bold** and [links](https://…).{' '}
        <a href="/privacy" target="_blank" rel="noopener noreferrer" className="text-accent-text hover:underline">
          See the page
        </a>
      </p>
      {changed && (
        <button
          type="button"
          disabled={save.isPending}
          onClick={() => save.mutate()}
          className="tap-target rounded-lg bg-accent px-3 py-1 text-sm font-semibold text-accent-ink hover:bg-accent-hover disabled:opacity-50"
        >
          Save the notice and contact
        </button>
      )}
      {save.isError && <p className="text-sm text-danger">{(save.error as Error).message}</p>}
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
  // The dashboard's nudge links to /admin?tab=settings#privacy-settings.
  useHashScroll(!!rows);
  if (!rows) return null;
  return (
    <section id="privacy-settings" className="scroll-mt-6 space-y-4" aria-labelledby="privacy-settings-title">
      <div>
        <h2 id="privacy-settings-title" className="text-sm font-semibold text-neutral-300">
          Privacy
        </h2>
        <p className="text-xs text-muted">
          You run this site, so you look after the personal data on it. People download their data and delete their accounts from their
          Profile; requests that arrive by email or letter go in Admin › Privacy requests. These settings say how often, how long and how much.
        </p>
      </div>
      <NoticeEditor
        key={`notice:${settings.data?.privacy?.notice ?? ''}:${settings.data?.privacy?.contact?.setting ?? ''}`}
        notice={settings.data?.privacy?.notice ?? ''}
        contact={settings.data?.privacy?.contact ?? { value: null, setting: null, forcedBy: null }}
      />
      {rows.map((s) => (
        // The key resets the draft when the saved value changes.
        <SettingRow key={`${s.key}:${s.value}`} s={s} saving={save.isPending} onSave={(v) => save.mutate({ [s.key]: v })} />
      ))}
      {save.isError && <p className="text-sm text-danger">{(save.error as Error).message}</p>}
    </section>
  );
}

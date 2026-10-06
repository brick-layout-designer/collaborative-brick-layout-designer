// Warnings, as the person (or club) who got one sees them: a banner on
// every page until they say they've read it, and the Notices page with
// all of them. Plus the form and history the senders use (site admins and
// moderators on the admin pages, a club's admins and managers on its
// Manage page).
//
// New warnings arrive without a reload: the live stream's 'warning' hint
// refetches ['notices'] (live/invalidate.ts).

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { SignInFirst } from '../auth/signIn';
import { useMutation, useQuery } from '@tanstack/react-query';
import { api, type WarningInput, type WarningSeverity, type WarningSummary } from '../api';

export const SEVERITY_LABEL: Record<WarningSeverity, string> = {
  note: 'Note',
  warning: 'Warning',
  final: 'Final warning',
};

const SEVERITY_STYLE: Record<WarningSeverity, string> = {
  note: 'border-line',
  warning: 'border-danger',
  final: 'border-danger ring-2 ring-danger',
};

/** "From the site team" / "From Train Club". */
export function fromLabel(w: WarningSummary): string {
  return w.scope === 'club' && w.club ? `From ${w.club.name}` : 'From the site team';
}

/** For a warning to a club: "To your club Train Club". */
export function toLabel(w: WarningSummary): string | null {
  return w.to.kind === 'org' ? `To your club ${w.to.name}` : null;
}

function useNotices(enabled: boolean) {
  return useQuery({ queryKey: ['notices'], queryFn: api.warnings.notices, enabled });
}

function useAcknowledge() {
  // The write refetches ['notices'] everywhere (api.ts reports it).
  return useMutation({ mutationFn: (id: string) => api.warnings.acknowledge(id) });
}

/** The newest warning not yet acknowledged, on every page, until "I understand". */
export function NoticeBanner() {
  const me = useQuery({ queryKey: ['me'], queryFn: api.me });
  const notices = useNotices(!!me.data?.user);
  const ack = useAcknowledge();
  const open = (notices.data?.notices ?? []).filter((n) => n.acknowledgedAt === null);
  const w = open[0];
  if (!w) return null;
  const to = toLabel(w);
  return (
    <div className="pointer-events-none fixed inset-x-0 top-[max(0.5rem,env(safe-area-inset-top))] z-[60] flex justify-center px-4">
      <section
        role="alertdialog"
        aria-labelledby="notice-title"
        aria-describedby="notice-reason"
        data-testid="notice-banner"
        className={`pointer-events-auto w-full max-w-xl rounded-card border-2 bg-panel p-4 text-ink shadow-pop ${SEVERITY_STYLE[w.severity]}`}
      >
        <p id="notice-title" className="text-sm font-semibold">
          {SEVERITY_LABEL[w.severity]} · {fromLabel(w)}
          {open.length > 1 && <span className="font-normal text-muted"> (1 of {open.length})</span>}
        </p>
        {to && <p className="text-xs text-muted">{to}</p>}
        <p id="notice-reason" className="mt-2 whitespace-pre-wrap text-sm">{w.reason}</p>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button
            type="button"
            disabled={ack.isPending}
            onClick={() => ack.mutate(w.id)}
            className="tap-target rounded-lg bg-accent px-3 py-1.5 text-sm font-semibold text-accent-ink hover:bg-accent-hover disabled:opacity-60"
          >
            I understand
          </button>
          {w.link && (
            <Link to={w.link} className="text-sm text-accent-text hover:underline">
              See what it's about
            </Link>
          )}
          <Link to="/notices" className="text-sm text-muted hover:underline">
            All notices
          </Link>
        </div>
        {ack.isError && <p className="mt-2 text-xs text-danger">{(ack.error as Error).message}</p>}
      </section>
    </div>
  );
}

/** /notices: every warning you (or a club you run) received. */
export function NoticesPage() {
  const me = useQuery({ queryKey: ['me'], queryFn: api.me });
  const notices = useNotices(!!me.data?.user);
  const ack = useAcknowledge();
  if (me.isLoading || notices.isLoading) return <p className="p-8 text-muted">Loading…</p>;
  if (!me.data?.user) return <SignInFirst />;
  const list = notices.data?.notices ?? [];
  return (
    <main className="mx-auto max-w-2xl space-y-4 p-4 text-ink sm:p-8">
      <Link to="/" className="text-sm text-accent-text hover:underline">← Home</Link>
      <h1 className="font-display text-xl font-semibold">Notices</h1>
      <p className="text-sm text-muted">Warnings and notes from the site team, or from a club you're in.</p>
      {list.length === 0 ? (
        <p className="rounded-lg border border-dashed border-line p-4 text-sm text-muted">No notices. All good.</p>
      ) : (
        <ul className="space-y-2">
          {list.map((w) => (
            <li key={w.id} data-testid="notice-row" className={`rounded-lg border bg-panel p-3 text-sm ${SEVERITY_STYLE[w.severity]}`}>
              <p className="font-semibold">
                {SEVERITY_LABEL[w.severity]} · {fromLabel(w)}
                <span className="font-normal text-muted"> · {new Date(w.createdAt).toLocaleString()}</span>
              </p>
              {toLabel(w) && <p className="text-xs text-muted">{toLabel(w)}</p>}
              <p className="mt-1 whitespace-pre-wrap">{w.reason}</p>
              <div className="mt-2 flex flex-wrap items-center gap-3">
                {w.link && <Link to={w.link} className="text-accent-text hover:underline">See what it's about</Link>}
                {w.acknowledgedAt ? (
                  <span className="text-xs text-muted">Read {new Date(w.acknowledgedAt).toLocaleDateString()}</span>
                ) : (
                  <button
                    type="button"
                    onClick={() => ack.mutate(w.id)}
                    className="tap-target rounded-lg bg-accent px-3 py-1 font-semibold text-accent-ink hover:bg-accent-hover"
                  >
                    I understand
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}

/** Severity, reason and an optional link: the form every sender uses. */
export function WarnForm({
  label,
  onSend,
  onDone,
}: {
  /** e.g. "Warn Ann" */
  label: string;
  onSend: (input: WarningInput) => Promise<unknown>;
  onDone?: () => void;
}) {
  const [severity, setSeverity] = useState<WarningSeverity>('warning');
  const [reason, setReason] = useState('');
  const [link, setLink] = useState('');
  const send = useMutation({
    mutationFn: () => onSend({ severity, reason: reason.trim(), ...(link.trim() ? { link: link.trim() } : {}) }),
    onSuccess: () => {
      setReason('');
      setLink('');
      onDone?.();
    },
  });
  return (
    <form
      aria-label={label}
      onSubmit={(e) => {
        e.preventDefault();
        if (reason.trim().length >= 3) send.mutate();
      }}
      className="space-y-2 rounded-lg border border-line bg-panel p-3 text-sm"
    >
      <fieldset className="flex flex-wrap gap-3">
        <legend className="mb-1 text-xs font-semibold text-muted">How serious</legend>
        {(Object.keys(SEVERITY_LABEL) as WarningSeverity[]).map((s) => (
          <label key={s} className="flex items-center gap-1">
            <input type="radio" name={`${label}-severity`} checked={severity === s} onChange={() => setSeverity(s)} />
            {SEVERITY_LABEL[s]}
          </label>
        ))}
      </fieldset>
      <label className="block">
        <span className="text-xs font-semibold text-muted">Reason (they will see this)</span>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={3}
          maxLength={2000}
          required
          className="mt-1 w-full rounded-lg border border-border bg-soft px-2 py-1"
        />
      </label>
      <label className="block">
        <span className="text-xs font-semibold text-muted">Link to what it's about (optional, a page on this site)</span>
        <input
          value={link}
          onChange={(e) => setLink(e.target.value)}
          placeholder="/editor/…"
          className="mt-1 w-full rounded-lg border border-border bg-soft px-2 py-1"
        />
      </label>
      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={send.isPending || reason.trim().length < 3}
          className="tap-target rounded-lg bg-accent px-3 py-1.5 font-semibold text-accent-ink hover:bg-accent-hover disabled:opacity-60"
        >
          Send {SEVERITY_LABEL[severity].toLowerCase()}
        </button>
        {send.isSuccess && <span role="status" className="text-xs text-muted">Sent.</span>}
        {send.isError && <span className="text-xs text-danger">{(send.error as Error).message}</span>}
      </div>
    </form>
  );
}

/** The warnings a person or club got (admin pages) or a club sent (Manage page). */
export function WarningHistory({ warnings, showTo = false }: { warnings: WarningSummary[]; showTo?: boolean }) {
  if (warnings.length === 0) return <p className="text-sm text-muted">No warnings.</p>;
  return (
    <ul className="divide-y divide-line rounded-lg border border-line text-sm">
      {warnings.map((w) => (
        <li key={w.id} data-testid="warning-row" className="space-y-1 px-3 py-2">
          <p>
            <span className="font-semibold">{SEVERITY_LABEL[w.severity]}</span>
            <span className="text-muted">
              {' '}· {w.scope === 'club' && w.club ? `from the club ${w.club.name}` : 'site'}
              {showTo ? ` · to ${w.to.name}` : ''}
              {w.issuedBy ? ` · by ${w.issuedBy.name}` : ''} · {new Date(w.createdAt).toLocaleString()}
            </span>
          </p>
          <p className="whitespace-pre-wrap">{w.reason}</p>
          <p className="text-xs">
            {w.link && <Link to={w.link} className="mr-3 text-accent-text hover:underline">{w.link}</Link>}
            <span className={w.acknowledgedAt ? 'text-muted' : 'font-semibold'}>
              {w.acknowledgedAt ? `Acknowledged ${new Date(w.acknowledgedAt).toLocaleString()}` : 'Not acknowledged yet'}
            </span>
          </p>
        </li>
      ))}
    </ul>
  );
}

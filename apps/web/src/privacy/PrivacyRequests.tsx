// Admin › Privacy requests: the requests that arrive by email or letter,
// soonest due first, with an "Overdue" or "Due soon" badge. Opening one
// shows who it's about, its history, and one-click answers: export their
// data, restrict the account (read only), or erase it now. Everything is
// audit-logged on the server.

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, apiGet, apiSend, type AdminUser } from '../api';
import { askConfirm } from '../ui/ConfirmDialog';
import { ExportRow, type DataExport } from './MyDataSection';

export type RequestType = 'access' | 'erasure' | 'rectification' | 'restriction' | 'objection' | 'other';
export type RequestStatus = 'open' | 'waiting' | 'done' | 'refused';

export interface PrivacyRequest {
  id: string;
  type: RequestType;
  subjectUserId: string | null;
  subjectText: string | null;
  subject: { id: string; email: string; displayName: string; restrictedAt: number | null; deletionDueAt: number | null; isGlobalAdmin: boolean } | null;
  receivedVia: 'email' | 'letter' | 'in_person' | 'other';
  receivedAt: number;
  dueAt: number;
  due: 'closed' | 'overdue' | 'soon' | 'ok';
  status: RequestStatus;
  notes: string;
  closedAt: number | null;
}

export interface PrivacySummary {
  open: number;
  overdue: number;
  dueSoon: number;
  noticeMissing: boolean;
  contactMissing: boolean;
}

export const TYPE_LABEL: Record<RequestType, string> = {
  access: 'See their data (access)',
  erasure: 'Delete their data (erasure)',
  rectification: 'Correct their data',
  restriction: 'Stop using their data for now (restriction)',
  objection: 'Object to how it’s used',
  other: 'Something else',
};
const STATUS_LABEL: Record<RequestStatus, string> = { open: 'Open', waiting: 'Waiting for them', done: 'Done', refused: 'Refused' };
const VIA_LABEL = { email: 'Email', letter: 'Letter', in_person: 'In person', other: 'Other' } as const;

export const privacyAdminApi = {
  list: (all: boolean) => apiGet<{ requests: PrivacyRequest[]; summary: PrivacySummary }>(`/api/admin/privacy/requests${all ? '?status=all' : ''}`),
  summary: () => apiGet<PrivacySummary>('/api/admin/privacy/summary'),
  get: (id: string) =>
    apiGet<{ request: PrivacyRequest; history: { id: string; at: number; by: string | null; kind: string; text: string }[]; exports: DataExport[] }>(
      `/api/admin/privacy/requests/${id}`,
    ),
  create: (body: object) => apiSend<{ request: PrivacyRequest }>('POST', '/api/admin/privacy/requests', body),
  update: (id: string, body: object) => apiSend<{ request: PrivacyRequest }>('PATCH', `/api/admin/privacy/requests/${id}`, body),
  exportData: (id: string) => apiSend<{ export: DataExport }>('POST', `/api/admin/privacy/requests/${id}/export`, {}),
  erase: (id: string, confirm: string) => apiSend<{ ok: true; ref: string }>('POST', `/api/admin/privacy/requests/${id}/erase`, { confirm }),
  restrict: (id: string, restricted: boolean) => apiSend<{ ok: true }>('POST', `/api/admin/privacy/requests/${id}/restrict`, { restricted }),
};

const day = (ms: number) => new Date(ms).toLocaleDateString(undefined, { dateStyle: 'medium' });

export function DueBadge({ r }: { r: Pick<PrivacyRequest, 'due' | 'dueAt'> }) {
  if (r.due === 'overdue') return <span className="rounded-full bg-danger px-2 py-0.5 text-xs font-semibold text-panel">Overdue</span>;
  if (r.due === 'soon') return <span className="rounded-full bg-amber-500 px-2 py-0.5 text-xs font-semibold text-black">Due soon</span>;
  return null;
}

const who = (r: PrivacyRequest) => (r.subject ? `${r.subject.displayName} (${r.subject.email})` : (r.subjectText ?? 'Unknown'));

export function PrivacyRequestsTab() {
  const [all, setAll] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [logging, setLogging] = useState(false);
  const list = useQuery({ queryKey: ['admin-privacy', all], queryFn: () => privacyAdminApi.list(all) });
  if (openId) return <RequestDetail id={openId} onBack={() => setOpenId(null)} />;
  return (
    <div className="max-w-3xl space-y-4">
      <div>
        <h2 className="text-base font-semibold">Privacy requests</h2>
        <p className="text-sm text-muted">
          When someone asks about their personal data by email, letter or in person, log it here so it’s answered on time. People can also download
          their data and delete their account themselves, from their Profile.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => setLogging((v) => !v)}
          className="tap-target rounded-lg bg-accent px-3 py-1.5 text-sm font-semibold text-accent-ink hover:bg-accent-hover"
        >
          Log a request
        </button>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} />
          Show closed ones too
        </label>
      </div>
      {logging && <LogForm onDone={(id) => (setLogging(false), setOpenId(id))} />}
      {list.isLoading && <p className="text-sm text-muted">Loading…</p>}
      {list.data && list.data.requests.length === 0 && (
        <p className="rounded-lg border border-dashed border-line p-4 text-sm text-muted">No {all ? '' : 'open '}requests.</p>
      )}
      {list.data && list.data.requests.length > 0 && (
        <ul className="rounded-lg border border-line">
          {list.data.requests.map((r) => (
            <li key={r.id} data-testid="privacy-request-row" className="border-b border-line last:border-b-0">
              <button type="button" onClick={() => setOpenId(r.id)} className="flex w-full flex-wrap items-center gap-2 px-4 py-3 text-left text-sm hover:bg-soft">
                <span className="font-semibold">{TYPE_LABEL[r.type]}</span>
                <DueBadge r={r} />
                <span className="w-full text-muted">
                  {who(r)} · {STATUS_LABEL[r.status]} · due {day(r.dueAt)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function LogForm({ onDone }: { onDone: (id: string) => void }) {
  const qc = useQueryClient();
  const [type, setType] = useState<RequestType>('access');
  const [via, setVia] = useState<PrivacyRequest['receivedVia']>('email');
  const [received, setReceived] = useState(() => new Date().toISOString().slice(0, 10));
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState<AdminUser | null>(null);
  const [text, setText] = useState('');
  const [notes, setNotes] = useState('');
  const users = useQuery({ queryKey: ['admin-users', 'privacy-pick', q], queryFn: () => api.admin.users({ q, limit: 8 }), enabled: q.trim().length >= 2 && !picked });
  const create = useMutation({
    mutationFn: () =>
      privacyAdminApi.create({
        type,
        receivedVia: via,
        receivedAt: new Date(`${received}T12:00:00`).getTime(),
        ...(picked ? { subjectUserId: picked.id } : { subjectText: text }),
        notes,
      }),
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: ['admin-privacy'] });
      void qc.invalidateQueries({ queryKey: ['admin-privacy-summary'] });
      onDone(r.request.id);
    },
  });
  const field = 'w-full rounded-lg border border-border bg-panel px-2 py-1.5 text-sm text-ink';
  return (
    <form
      data-testid="privacy-log-form"
      className="space-y-3 rounded-lg border border-line p-4 text-sm"
      onSubmit={(e) => {
        e.preventDefault();
        create.mutate();
      }}
    >
      <label className="block">
        <span className="mb-1 block text-muted">What they ask</span>
        <select value={type} onChange={(e) => setType(e.target.value as RequestType)} className={field}>
          {(Object.keys(TYPE_LABEL) as RequestType[]).map((t) => (
            <option key={t} value={t}>
              {TYPE_LABEL[t]}
            </option>
          ))}
        </select>
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-muted">How it came</span>
          <select value={via} onChange={(e) => setVia(e.target.value as PrivacyRequest['receivedVia'])} className={field}>
            {(Object.keys(VIA_LABEL) as (keyof typeof VIA_LABEL)[]).map((v) => (
              <option key={v} value={v}>
                {VIA_LABEL[v]}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-muted">Received on</span>
          <input type="date" value={received} onChange={(e) => setReceived(e.target.value)} className={field} />
        </label>
      </div>
      <div className="space-y-1">
        <span className="block text-muted">Who it’s about</span>
        {picked ? (
          <p>
            {picked.displayName} ({picked.email}){' '}
            <button type="button" onClick={() => setPicked(null)} className="text-accent-text hover:underline">
              Change
            </button>
          </p>
        ) : (
          <>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search accounts by name or email" aria-label="Search accounts" className={field} />
            {users.data && users.data.users.length > 0 && (
              <ul className="rounded-lg border border-line">
                {users.data.users.map((u) => (
                  <li key={u.id}>
                    <button type="button" onClick={() => setPicked(u)} className="w-full px-3 py-1.5 text-left hover:bg-soft">
                      {u.displayName} ({u.email})
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="…or, with no account here, who asked (name, how to reach them)"
              aria-label="Who asked, if they have no account"
              className={field}
            />
          </>
        )}
      </div>
      <label className="block">
        <span className="mb-1 block text-muted">Notes (optional)</span>
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className={field} />
      </label>
      {create.isError && <p className="text-danger">{(create.error as Error).message}</p>}
      <button
        type="submit"
        disabled={create.isPending || (!picked && !text.trim())}
        className="tap-target rounded-lg bg-accent px-3 py-1.5 font-semibold text-accent-ink hover:bg-accent-hover disabled:opacity-50"
      >
        Log it
      </button>
    </form>
  );
}

function RequestDetail({ id, onBack }: { id: string; onBack: () => void }) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['admin-privacy-request', id],
    queryFn: () => privacyAdminApi.get(id),
    refetchInterval: (query) => (query.state.data?.exports.some((e) => e.status === 'building') ? 4000 : false),
  });
  const [note, setNote] = useState('');
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['admin-privacy-request', id] });
    void qc.invalidateQueries({ queryKey: ['admin-privacy'] });
    void qc.invalidateQueries({ queryKey: ['admin-privacy-summary'] });
  };
  const update = useMutation({ mutationFn: (body: object) => privacyAdminApi.update(id, body), onSuccess: refresh });
  const exportData = useMutation({ mutationFn: () => privacyAdminApi.exportData(id), onSuccess: refresh });
  const restrict = useMutation({ mutationFn: (on: boolean) => privacyAdminApi.restrict(id, on), onSuccess: refresh });
  const erase = useMutation({ mutationFn: (confirm: string) => privacyAdminApi.erase(id, confirm), onSuccess: refresh });
  if (q.isLoading) return <p className="text-sm text-muted">Loading…</p>;
  if (!q.data) return <p className="text-sm text-danger">{(q.error as Error | null)?.message ?? 'Not found.'}</p>;
  const { request: r, history, exports } = q.data;
  const s = r.subject;
  const err = [update, exportData, restrict, erase].find((m) => m.isError)?.error as Error | undefined;
  const button = 'tap-target rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-soft disabled:opacity-50';
  return (
    <div className="max-w-3xl space-y-4 text-sm" data-testid="privacy-request-detail">
      <button type="button" onClick={onBack} className="text-accent-text hover:underline">
        ← All requests
      </button>
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-base font-semibold">{TYPE_LABEL[r.type]}</h2>
        <DueBadge r={r} />
      </div>
      <p className="text-muted">
        From {who(r)} · by {VIA_LABEL[r.receivedVia].toLowerCase()} on {day(r.receivedAt)} · due {day(r.dueAt)}
      </p>
      {s && (
        <p>
          Account:{' '}
          {s.restrictedAt ? <strong>restricted (read only) since {day(s.restrictedAt)}</strong> : 'active'}
          {s.deletionDueAt ? ` · being deleted on ${day(s.deletionDueAt)} (they asked)` : ''}
        </p>
      )}
      <label className="flex items-center gap-2">
        Status
        <select value={r.status} onChange={(e) => update.mutate({ status: e.target.value })} className="rounded-lg border border-border bg-panel px-2 py-1">
          {(Object.keys(STATUS_LABEL) as RequestStatus[]).map((st) => (
            <option key={st} value={st}>
              {STATUS_LABEL[st]}
            </option>
          ))}
        </select>
      </label>

      {s && (
        <section className="space-y-2 rounded-lg border border-line p-3">
          <h3 className="font-semibold">Answer it</h3>
          <div className="flex flex-wrap gap-2">
            <button type="button" className={button} disabled={exportData.isPending} onClick={() => exportData.mutate()}>
              Export their data
            </button>
            <button
              type="button"
              className={button}
              disabled={restrict.isPending}
              onClick={async () => {
                const on = !s.restrictedAt;
                const ok = await askConfirm(
                  on
                    ? {
                        title: `Restrict ${s.displayName}'s account?`,
                        removes: 'The account becomes read only: they can sign in, look and download their data, but change nothing. What they own alone is frozen too, for everyone.',
                        keeps: 'Nothing is deleted.',
                        undo: 'You can lift it here at any time.',
                        confirmLabel: 'Restrict',
                        danger: false,
                      }
                    : { title: 'Lift the restriction?', removes: 'They can change things again.', confirmLabel: 'Lift it', danger: false },
                );
                if (ok) restrict.mutate(on);
              }}
            >
              {s.restrictedAt ? 'Lift the restriction' : 'Restrict the account'}
            </button>
            <button
              type="button"
              className={`${button} border-danger text-danger`}
              disabled={erase.isPending || s.isGlobalAdmin}
              title={s.isGlobalAdmin ? 'Site admins can’t be erased from here: take away their admin first.' : undefined}
              onClick={async () => {
                const ok = await askConfirm({
                  title: `Erase ${s.email} now?`,
                  removes:
                    'The account and everything it owns alone are erased now, with no waiting time. A club it was the last admin of gets a new admin.',
                  keeps: 'Club things it made stay with the club, credited “Builder #…”. The audit log and this request keep a pseudonym, not the person.',
                  undo: 'This can’t be undone.',
                  confirmLabel: 'Erase now',
                  typeName: s.email,
                });
                if (ok) erase.mutate(s.email);
              }}
            >
              Erase now…
            </button>
          </div>
          {exports.length > 0 && (
            <ul className="rounded-lg border border-line">
              {exports.map((e) => (
                <ExportRow key={e.id} e={e} />
              ))}
            </ul>
          )}
          <p className="text-xs text-muted">The download is for you: send it to them the way they asked.</p>
        </section>
      )}
      {err && <p className="text-danger">{err.message}</p>}

      <section className="space-y-2">
        <h3 className="font-semibold">History</h3>
        <ol className="space-y-1">
          {history.map((h) => (
            <li key={h.id} data-testid="privacy-history">
              <span className="text-muted">
                {new Date(h.at).toLocaleString()} · {h.by ?? 'someone'}:
              </span>{' '}
              {h.text}
            </li>
          ))}
        </ol>
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (note.trim()) update.mutate({ addNote: note.trim() }, { onSuccess: () => setNote('') });
          }}
        >
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Add a note" aria-label="Add a note" className="flex-1 rounded-lg border border-border bg-panel px-2 py-1.5" />
          <button type="submit" className={button} disabled={!note.trim()}>
            Add
          </button>
        </form>
      </section>
    </div>
  );
}

/** The dashboard's privacy card: requests due, and a nudge while the notice is empty. */
export function PrivacyDashboardCard() {
  const q = useQuery({ queryKey: ['admin-privacy-summary'], queryFn: privacyAdminApi.summary, retry: false });
  const s = q.data;
  if (!s || (s.overdue === 0 && s.dueSoon === 0 && !s.noticeMissing && !s.contactMissing)) return null;
  return (
    <section data-testid="privacy-dashboard-card" className="space-y-1 rounded-lg border border-line bg-panel p-4 text-sm">
      <h2 className="font-semibold">Privacy</h2>
      {(s.overdue > 0 || s.dueSoon > 0) && (
        <p>
          {s.overdue > 0 && <strong className="text-danger">{s.overdue} overdue</strong>}
          {s.overdue > 0 && s.dueSoon > 0 && ' · '}
          {s.dueSoon > 0 && <strong>{s.dueSoon} due within a week</strong>}{' '}
          <a href="/admin?tab=privacy" className="text-accent-text hover:underline">
            Open privacy requests
          </a>
        </p>
      )}
      {(s.noticeMissing || s.contactMissing) && (
        <p className="text-muted">
          Tell people how this site looks after their data: add a privacy notice and a contact.{' '}
          <a href="/admin?tab=settings#privacy-settings" className="text-accent-text hover:underline">
            Add them in Settings
          </a>
        </p>
      )}
    </section>
  );
}

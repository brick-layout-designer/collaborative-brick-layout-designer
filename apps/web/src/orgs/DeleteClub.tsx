// Deleting a club, done properly. First, the things to do before: download
// the club's data, and move its layouts and modules to a member or another
// club. Then a confirmation that says in plain words exactly what will
// happen, asks what to do with what the club published in the public
// catalog, and has the club's name typed out. The club is hidden at once
// and deleted for good after the waiting time; its admins or a site admin
// can restore it until then (Clubs › Being deleted).

import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, apiGet, apiSend, type OrgDetail } from '../api';
import { showToast, typedMatches } from '../ui/ConfirmDialog';
import { ExportRow, type DataExport } from '../privacy/MyDataSection';
import { plural } from '../ui/plural';

interface Named {
  id: string;
  name: string;
}

export interface ClubDeletionSummary {
  name: string;
  members: { userId: string; name: string; role: string }[];
  layouts: Named[];
  modules: Named[];
  parts: Named[];
  venues: Named[];
  clubCollections: Named[];
  publicItems: Named[];
  publicCollections: Named[];
  graceDays: number;
}

export interface DeletingClub {
  id: string;
  name: string;
  slug: string;
  deletionRequestedAt: number | null;
  deletionDueAt: number;
  canRestore: boolean;
}

export const clubDeletionApi = {
  summary: (slug: string) => apiGet<ClubDeletionSummary>(`/api/orgs/${slug}/deletion`),
  exports: (slug: string) => apiGet<{ exports: DataExport[]; nextAllowedAt: number | null }>(`/api/orgs/${slug}/exports`),
  startExport: (slug: string) => apiSend<{ export: DataExport }>('POST', `/api/orgs/${slug}/exports`, {}),
  moveAll: (slug: string, body: { kind: 'layouts' | 'modules'; toUserId?: string; toOrgSlug?: string }) =>
    apiSend<{ ok: true; moved: number }>('POST', `/api/orgs/${slug}/move-all`, body),
  deleting: () => apiGet<{ clubs: DeletingClub[] }>('/api/orgs/deleting'),
  restore: (slug: string) => apiSend<{ ok: true; slug: string }>('POST', `/api/orgs/${slug}/restore`, {}),
};

const longDay = (ms: number) => new Date(ms).toLocaleDateString(undefined, { dateStyle: 'long' });
const names = (list: Named[]) => {
  const shown = list.slice(0, 6).map((n) => `“${n.name || 'Untitled'}”`);
  return list.length > 6 ? `${shown.join(', ')} and ${list.length - 6} more` : shown.join(', ');
};

const button = 'tap-target rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-soft disabled:opacity-50';

/** Club settings › Delete the club. */
export function DeleteClubSection({ org, myUserId }: { org: OrgDetail; myUserId: string }) {
  const [step, setStep] = useState<'closed' | 'before' | 'confirm'>('closed');
  return (
    <section className="space-y-3 rounded-section border border-red-900 bg-panel p-4" aria-label="Delete the club" id="delete-club">
      <h2 className="text-lg font-semibold text-danger">Delete the club</h2>
      {step === 'closed' && (
        <>
          <p className="text-sm text-muted">
            Deleting {org.name} takes its layouts, modules, parts and venues with it. Nothing happens straight away: first you can save or move
            things, and see exactly what goes.
          </p>
          <button type="button" className={`${button} border-danger text-danger`} onClick={() => setStep('before')}>
            Delete the club…
          </button>
        </>
      )}
      {step !== 'closed' && <DeletePlan org={org} myUserId={myUserId} step={step} setStep={setStep} />}
    </section>
  );
}

function DeletePlan({
  org,
  myUserId,
  step,
  setStep,
}: {
  org: OrgDetail;
  myUserId: string;
  step: 'before' | 'confirm';
  setStep: (s: 'closed' | 'before' | 'confirm') => void;
}) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const summary = useQuery({ queryKey: ['club-deletion', org.slug], queryFn: () => clubDeletionApi.summary(org.slug) });
  const exports = useQuery({
    queryKey: ['club-exports', org.slug],
    queryFn: () => clubDeletionApi.exports(org.slug),
    refetchInterval: (q) => (q.state.data?.exports.some((e) => e.status === 'building') ? 4000 : false),
  });
  const otherClubs = useQuery({ queryKey: ['orgs'], queryFn: api.orgs.list });
  const startExport = useMutation({
    mutationFn: () => clubDeletionApi.startExport(org.slug),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['club-exports', org.slug] }),
  });
  const [dest, setDest] = useState('');
  const move = useMutation({
    mutationFn: (kind: 'layouts' | 'modules') =>
      clubDeletionApi.moveAll(org.slug, dest.startsWith('user:') ? { kind, toUserId: dest.slice(5) } : { kind, toOrgSlug: dest.slice(4) }),
    onSuccess: (r, kind) => {
      showToast(`Moved ${plural(r.moved, kind === 'layouts' ? 'layout' : 'module')}.`);
      void qc.invalidateQueries({ queryKey: ['club-deletion', org.slug] });
      void qc.invalidateQueries({ queryKey: ['layouts'] });
      void qc.invalidateQueries({ queryKey: ['modules'] });
    },
  });
  const [catalog, setCatalog] = useState<'hand' | 'takedown'>('hand');
  const [heir, setHeir] = useState(myUserId);
  const [typed, setTyped] = useState('');
  const remove = useMutation({
    mutationFn: () => api.orgs.remove(org.slug, typed, { catalog, heirUserId: catalog === 'hand' ? heir : null }),
    onSuccess: async (r) => {
      await qc.invalidateQueries();
      showToast(
        r.dueAt
          ? `${org.name} is hidden and will be deleted on ${longDay(r.dueAt)}. You can restore it from Clubs until then.`
          : `${org.name} was deleted.`,
      );
      navigate('/orgs#being-deleted', { replace: true });
    },
  });
  if (summary.isLoading) return <p className="text-sm text-muted">Working out what would happen…</p>;
  if (!summary.data) return <p className="text-sm text-danger">{(summary.error as Error | null)?.message ?? 'Could not load this.'}</p>;
  const s = summary.data;
  const hasPublic = s.publicItems.length + s.publicCollections.length > 0;
  const due = Date.now() + s.graceDays * 86_400_000;
  const err = [startExport, move, remove].find((m) => m.isError)?.error as Error | undefined;

  if (step === 'before') {
    return (
      <div className="space-y-4 text-sm" data-testid="delete-club-before">
        <div className="space-y-2">
          <h3 className="font-semibold">1. Save a copy (optional)</h3>
          <p className="text-muted">One zip with everything the club holds: its layouts and modules as files, parts, venues, members and history.</p>
          <button
            type="button"
            className={button}
            disabled={startExport.isPending || (exports.data?.nextAllowedAt ?? null) !== null}
            onClick={() => startExport.mutate()}
          >
            Download the club’s data
          </button>
          {exports.data && exports.data.exports.length > 0 && (
            <ul className="rounded-lg border border-line">
              {exports.data.exports.map((e) => (
                <ExportRow key={e.id} e={e} />
              ))}
            </ul>
          )}
        </div>
        <div className="space-y-2">
          <h3 className="font-semibold">2. Keep layouts and modules (optional)</h3>
          <p className="text-muted">Move them to one of the members, or to another club you’re in, so they aren’t deleted.</p>
          <label className="block">
            <span className="mb-1 block text-muted">Move them to</span>
            <select value={dest} onChange={(e) => setDest(e.target.value)} aria-label="Move them to" className="w-full rounded-lg border border-border bg-soft px-3 py-2">
              <option value="">Pick a member or a club…</option>
              <optgroup label="Members">
                {s.members.map((m) => (
                  <option key={m.userId} value={`user:${m.userId}`}>
                    {m.name}
                    {m.userId === myUserId ? ' (you)' : ''}
                  </option>
                ))}
              </optgroup>
              <optgroup label="Your other clubs">
                {(otherClubs.data?.orgs ?? [])
                  .filter((o) => o.slug !== org.slug)
                  .map((o) => (
                    <option key={o.id} value={`org:${o.slug}`}>
                      {o.name}
                    </option>
                  ))}
              </optgroup>
            </select>
          </label>
          <div className="flex flex-wrap gap-2">
            <button type="button" className={button} disabled={!dest || s.layouts.length === 0 || move.isPending} onClick={() => move.mutate('layouts')}>
              Move all {plural(s.layouts.length, 'layout')}
            </button>
            <button type="button" className={button} disabled={!dest || s.modules.length === 0 || move.isPending} onClick={() => move.mutate('modules')}>
              Move all {plural(s.modules.length, 'module')}
            </button>
          </div>
        </div>
        {err && <p className="text-danger">{err.message}</p>}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button type="button" className={button} onClick={() => setStep('closed')}>
            Keep the club
          </button>
          <button type="button" className="tap-target rounded-lg bg-danger px-4 py-2 font-semibold text-panel hover:opacity-90" onClick={() => setStep('confirm')}>
            Continue to delete…
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4 text-sm" data-testid="delete-club-confirm">
      <h3 className="font-semibold">What happens when you delete {s.name}</h3>
      <ul className="list-disc space-y-1 pl-5">
        <li>
          It’s <strong>hidden straight away</strong> from all {plural(s.members.length, 'member')}, who each get a notice saying you deleted it.
        </li>
        <li>
          It’s <strong>deleted for good on {longDay(due)}</strong> ({s.graceDays} days). Until then you, any other admin of the club, or a site admin
          can restore it with one click, with everything in it.
        </li>
        <li>
          Then these go with it:{' '}
          {[
            s.layouts.length ? `${plural(s.layouts.length, 'layout')} (${names(s.layouts)})` : null,
            s.modules.length ? `${plural(s.modules.length, 'module')} (${names(s.modules)})` : null,
            s.parts.length ? plural(s.parts.length, 'custom part') : null,
            s.venues.length ? plural(s.venues.length, 'venue') : null,
            s.clubCollections.length ? `${plural(s.clubCollections.length, 'members-only collection')} (${names(s.clubCollections)})` : null,
          ]
            .filter(Boolean)
            .join(', ') || 'nothing else: the club holds nothing yet'}
          .
        </li>
        <li>Members’ own layouts and modules stay theirs.</li>
      </ul>

      {hasPublic && (
        <fieldset className="space-y-2 rounded-lg border border-line p-3">
          <legend className="px-1 font-semibold">In the public catalog under the club’s name</legend>
          <p className="text-muted">
            {[s.publicItems.length ? `${plural(s.publicItems.length, 'item')} (${names(s.publicItems)})` : null, s.publicCollections.length ? `${plural(s.publicCollections.length, 'collection')} (${names(s.publicCollections)})` : null]
              .filter(Boolean)
              .join(' and ')}
            . When the club is deleted for good:
          </p>
          <label className="flex items-start gap-2">
            <input type="radio" name="catalog" checked={catalog === 'hand'} onChange={() => setCatalog('hand')} />
            <span>
              Hand them to a member, who becomes their owner. They stay up.
              {catalog === 'hand' && (
                <select value={heir} onChange={(e) => setHeir(e.target.value)} aria-label="Member who looks after them" className="mt-1 block w-full rounded-lg border border-border bg-soft px-3 py-2">
                  {s.members.map((m) => (
                    <option key={m.userId} value={m.userId}>
                      {m.name}
                      {m.userId === myUserId ? ' (you)' : ''}
                    </option>
                  ))}
                </select>
              )}
            </span>
          </label>
          <label className="flex items-start gap-2">
            <input type="radio" name="catalog" checked={catalog === 'takedown'} onChange={() => setCatalog('takedown')} />
            <span>Take them down.</span>
          </label>
          <p className="text-muted">Copies people already added to their own things are theirs, and stay either way.</p>
        </fieldset>
      )}

      <label className="block">
        <span className="mb-1 block text-muted">
          Type the club’s name, <strong className="text-ink">{org.name}</strong>, to confirm
        </span>
        <input
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          autoComplete="off"
          aria-label="Type the club’s name to confirm"
          className="w-full rounded-lg border border-border bg-soft px-3 py-2"
        />
      </label>
      {err && <p className="text-danger">{err.message}</p>}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <button type="button" className={button} onClick={() => setStep('before')}>
          Back
        </button>
        <button
          type="button"
          disabled={!typedMatches(typed, org.name) || remove.isPending}
          onClick={() => remove.mutate()}
          className="tap-target rounded-lg bg-danger px-4 py-2 font-semibold text-panel hover:opacity-90 disabled:opacity-50"
        >
          Delete the club
        </button>
      </div>
    </div>
  );
}

/** Clubs › Being deleted: restore one with a click (its admins), or see when it goes. */
export function BeingDeletedSection() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['clubs-deleting'], queryFn: clubDeletionApi.deleting });
  const restore = useMutation({
    mutationFn: (slug: string) => clubDeletionApi.restore(slug),
    onSuccess: async (_r, slug) => {
      await qc.invalidateQueries();
      const c = q.data?.clubs.find((x) => x.slug === slug);
      showToast(`${c?.name ?? 'The club'} is back.`);
    },
  });
  const clubs = q.data?.clubs ?? [];
  if (clubs.length === 0) return null;
  return (
    <section id="being-deleted" className="scroll-mt-6 space-y-2" data-testid="being-deleted">
      <h2 className="text-lg font-semibold">Being deleted</h2>
      <ul className="divide-y divide-line rounded-lg border border-line">
        {clubs.map((c) => (
          <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
            <span>
              <strong>{c.name}</strong>
              <span className="block text-xs text-muted">Hidden; deleted for good on {longDay(c.deletionDueAt)}.</span>
            </span>
            {c.canRestore ? (
              <button
                type="button"
                disabled={restore.isPending}
                onClick={() => restore.mutate(c.slug)}
                className="tap-target rounded-lg bg-accent px-3 py-1.5 font-semibold text-accent-ink hover:bg-accent-hover disabled:opacity-50"
              >
                Restore
              </button>
            ) : (
              <span className="text-xs text-muted">Ask one of its admins to restore it.</span>
            )}
          </li>
        ))}
      </ul>
      {restore.isError && <p className="text-sm text-danger">{(restore.error as Error).message}</p>}
      <p className="text-xs text-muted">
        Gone too soon? A site admin can restore it too. <Link to="/privacy" className="text-accent-text hover:underline">How this site looks after your data</Link>
      </p>
    </section>
  );
}

// Profile › Delete my account. Before anything happens it says, in plain
// words, what happens to each thing the person has: what they own alone
// goes (unless they move it first), club things stay with the club
// credited "Builder #…", their edits to other people's layouts stay. A
// club they're the last admin of is a guided step (hand it over), not a
// dead end. Then they type their email (or name). The account waits
// (14 days by default) and signing back in keeps it.

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { apiGet, apiSend } from '../api';
import { typedMatches } from '../ui/ConfirmDialog';

interface Named {
  id: string;
  name: string;
}

export interface DeletionSummary {
  ownedAlone: { layouts: Named[]; modules: Named[]; parts: Named[]; venues: Named[]; collections: Named[]; catalogItems: Named[] };
  madeForClubs: number;
  sharedWithThem: number;
  clubs: { id: string; name: string; slug: string; role: string; onlyMember: boolean; lastAdmin: boolean }[];
  blockers: { kind: 'last_club_admin' | 'last_site_admin'; text: string; club?: { name: string; slug: string } }[];
  graceDays: number;
  pending: { requestedAt: number; dueAt: number } | null;
  erasedAs: string;
}

export const deletionApi = {
  summary: () => apiGet<DeletionSummary>('/api/me/deletion'),
  request: (confirm: string) => apiSend<{ ok: true; dueAt: number }>('POST', '/api/me/deletion', { confirm }),
};

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function Names({ list }: { list: Named[] }) {
  const shown = list.slice(0, 8);
  return (
    <span className="text-muted">
      {' '}
      ({shown.map((n) => `“${n.name || 'Untitled'}”`).join(', ')}
      {list.length > shown.length ? ` and ${list.length - shown.length} more` : ''})
    </span>
  );
}

/** One line of "what happens", with a link to move things first. */
function Owned({ list, one, many, move }: { list: Named[]; one: string; many?: string; move?: { to: string; text: string } }) {
  if (list.length === 0) return null;
  return (
    <li>
      {plural(list.length, one, many)}
      <Names list={list} />
      {move && (
        <>
          {' '}
          <Link to={move.to} className="text-accent-text hover:underline">
            {move.text}
          </Link>
        </>
      )}
    </li>
  );
}

export function DeleteAccountSection({ email, name }: { email: string; name: string }) {
  const [open, setOpen] = useState(false);
  return (
    <section id="delete-account" className="scroll-mt-6 space-y-2">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Delete my account</h2>
      {!open ? (
        <>
          <p className="text-sm text-muted">
            Deleting your account takes away everything that is yours alone. Nothing happens straight away: first you see exactly what goes and what
            stays.
          </p>
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="tap-target rounded-lg border border-danger px-3 py-1.5 text-sm font-semibold text-danger hover:bg-soft"
          >
            Delete my account…
          </button>
        </>
      ) : (
        <DeletePlan email={email} name={name} onCancel={() => setOpen(false)} />
      )}
    </section>
  );
}

export function DeletePlan({ email, name, onCancel }: { email: string; name: string; onCancel: () => void }) {
  const q = useQuery({ queryKey: ['my-deletion'], queryFn: deletionApi.summary });
  const [typed, setTyped] = useState('');
  const go = useMutation({
    mutationFn: () => deletionApi.request(typed),
    onSuccess: (r) => {
      // Signed out: the sign-in page says when it will go, and how to keep it.
      window.location.assign(`/login?deleting=${r.dueAt}`);
    },
  });
  if (q.isLoading) return <p className="text-sm text-muted">Working out what would happen…</p>;
  if (q.isError || !q.data) return <p className="text-sm text-danger">{(q.error as Error | null)?.message ?? 'Could not load this.'}</p>;
  const s = q.data;
  const o = s.ownedAlone;
  const ownsAnything = o.layouts.length + o.modules.length + o.parts.length + o.venues.length + o.collections.length + o.catalogItems.length > 0;
  const soloClubs = s.clubs.filter((c) => c.onlyMember);
  const ready = typedMatches(typed, email) || (!!name.trim() && typedMatches(typed, name));
  const blocked = s.blockers.length > 0;

  return (
    <div data-testid="delete-plan" className="space-y-4 rounded-lg border border-danger p-4 text-sm">
      <div className="space-y-1">
        <h3 className="font-semibold">Deleted with your account</h3>
        {ownsAnything || soloClubs.length ? (
          <ul className="list-disc space-y-1 pl-5">
            <Owned list={o.layouts} one="layout" move={{ to: '/', text: 'Move or hand them over first' }} />
            <Owned list={o.modules} one="module" move={{ to: '/', text: 'Move them to a club first' }} />
            <Owned list={o.parts} one="custom part" move={{ to: '/#parts', text: 'Move them to a club first' }} />
            <Owned list={o.venues} one="venue" />
            <Owned list={o.collections} one="collection" />
            <Owned list={o.catalogItems} one="public catalog item" />
            {soloClubs.map((c) => (
              <li key={c.id}>
                The club “{c.name}”: you’re its only member.{' '}
                <Link to={`/orgs/${c.slug}/admin`} className="text-accent-text hover:underline">
                  Invite someone and hand it over to keep it
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-muted">Nothing: you don’t own anything on your own.</p>
        )}
        {o.catalogItems.length > 0 && <p className="text-muted">Copies people already added from the catalog are theirs, and stay.</p>}
      </div>

      <div className="space-y-1">
        <h3 className="font-semibold">Stays</h3>
        <ul className="list-disc space-y-1 pl-5 text-muted">
          {s.madeForClubs > 0 && (
            <li>
              {plural(s.madeForClubs, 'thing')} you made for your clubs stay with the club, credited to “{s.erasedAs.replace('Deleted user', 'Builder')}”.
            </li>
          )}
          {s.sharedWithThem > 0 && (
            <li>
              Your work on {plural(s.sharedWithThem, 'layout, module or part', 'layouts, modules and parts')} other people shared with you stays with
              them; you leave their share lists.
            </li>
          )}
          <li>The site’s record of what you did stays, as “{s.erasedAs}”: without your name or email.</li>
        </ul>
      </div>

      {blocked && (
        <div className="space-y-2 rounded-lg border border-line bg-soft p-3" data-testid="delete-steps">
          <h3 className="font-semibold">First, please</h3>
          <ol className="list-decimal space-y-1 pl-5">
            {s.blockers.map((b) => (
              <li key={b.club?.slug ?? b.kind}>
                {b.text}{' '}
                {b.club && (
                  <Link to={`/orgs/${b.club.slug}/admin?tab=settings#hand-over`} className="font-semibold text-accent-text hover:underline">
                    Hand over {b.club.name}
                  </Link>
                )}
              </li>
            ))}
          </ol>
          <p className="text-xs text-muted">Come back here when that’s done.</p>
        </div>
      )}

      <p>
        Your account waits <strong>{s.graceDays} days</strong> before it is deleted. You’ll be signed out, and we’ll email you. Changed your mind? Just
        sign in before then and everything is kept.
      </p>

      {!blocked && (
        <label className="block">
          <span className="mb-1 block text-muted">
            Type your email <strong className="text-ink">{email}</strong>
            {name.trim() ? (
              <>
                {' '}
                or your name <strong className="text-ink">{name}</strong>
              </>
            ) : null}{' '}
            to confirm
          </span>
          <input
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            autoComplete="off"
            spellCheck={false}
            aria-label="Type your email or name to confirm"
            className="w-full rounded-lg border border-border bg-soft px-3 py-2"
          />
        </label>
      )}
      {go.isError && <p className="text-danger">{(go.error as Error).message}</p>}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <button type="button" onClick={onCancel} className="tap-target rounded-lg border border-border px-4 py-2 hover:bg-soft">
          Keep my account
        </button>
        {!blocked && (
          <button
            type="button"
            disabled={!ready || go.isPending}
            onClick={() => go.mutate()}
            className="tap-target rounded-lg bg-danger px-4 py-2 font-semibold text-panel hover:opacity-90 disabled:opacity-50"
          >
            Delete my account
          </button>
        )}
      </div>
    </div>
  );
}

/** The sign-in page after deleting: when it goes, and how to keep it. */
export function DeletingNotice({ dueAt }: { dueAt: number }) {
  if (!Number.isFinite(dueAt) || dueAt <= 0) return null;
  return (
    <div role="status" data-testid="deleting-notice" className="rounded-lg border border-line bg-soft p-4 text-sm">
      <p className="font-semibold">Your account will be deleted on {new Date(dueAt).toLocaleDateString(undefined, { dateStyle: 'long' })}.</p>
      <p className="mt-1 text-muted">We’ve signed you out and sent you an email. Changed your mind? Sign in before then and everything is kept.</p>
    </div>
  );
}

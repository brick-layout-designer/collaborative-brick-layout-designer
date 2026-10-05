// Finding a club: the directory of listed clubs, the join button (join,
// ask to join with a note, take the request back, or "Invite only"), and
// what someone outside a listed club sees on its page.

import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type ClubSummary } from '../api';
import { HelpButton } from '../help/HelpButton';
import { confirmDelete } from '../ui/ConfirmDialog';

const btn = 'tap-target inline-flex items-center justify-center rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-soft disabled:opacity-50';
const primary = 'tap-target inline-flex items-center justify-center rounded-lg bg-accent px-3 py-1.5 text-sm font-semibold text-accent-ink hover:bg-accent-hover disabled:opacity-50';
const field = 'min-h-11 w-full rounded-lg border border-border bg-soft px-3 py-2 text-ink';

const members = (n: number) => `${n} ${n === 1 ? 'member' : 'members'}`;

/** Join, Ask to join (with an optional note), Request sent + Cancel, Invite only, or Open for members. */
export function JoinControls({ club }: { club: ClubSummary }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [asking, setAsking] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState<string | null>(null);
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['club-directory'] });
    void qc.invalidateQueries({ queryKey: ['club-summary', club.slug] });
  };
  const join = useMutation({
    mutationFn: () => api.orgs.join(club.slug, message.trim() || undefined),
    onSuccess: async (res) => {
      setAsking(false);
      setMessage('');
      refresh();
      if (res.status === 'member') {
        await qc.invalidateQueries({ queryKey: ['orgs'] });
        await qc.invalidateQueries({ queryKey: ['org', club.slug] });
        navigate(`/orgs/${club.slug}`);
      }
    },
    onError: (e: Error) => setError(e.message),
  });
  const cancel = useMutation({
    mutationFn: () => api.orgs.cancelJoin(club.slug),
    onSuccess: refresh,
    onError: (e: Error) => setError(e.message),
  });

  let controls;
  if (club.myStatus !== null && club.myStatus !== 'requested') {
    controls = (
      <Link to={`/orgs/${club.slug}`} className={btn}>
        Open
      </Link>
    );
  } else if (club.myStatus === 'requested') {
    controls = (
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-full bg-accent-soft px-2 py-0.5 text-xs font-semibold text-accent-text" role="status">
          Request sent
        </span>
        <button type="button" className={btn} disabled={cancel.isPending} onClick={async () => {
          const ok = await confirmDelete(club.name, {
            title: `Cancel your request to join ${club.name}?`,
            verb: 'Cancel',
            confirmLabel: 'Cancel request',
            removes: 'The club’s admins no longer see your request.',
            undoable: 'You can ask again any time.',
          });
          if (ok) cancel.mutate();
        }}>
          Cancel request
        </button>
      </div>
    );
  } else if (club.joinPolicy === 'open') {
    controls = (
      <button type="button" className={primary} disabled={join.isPending} onClick={() => join.mutate()}>
        Join
      </button>
    );
  } else if (club.joinPolicy === 'request') {
    controls = asking ? null : (
      <button type="button" className={primary} onClick={() => setAsking(true)}>
        Ask to join
      </button>
    );
  } else {
    controls = (
      <span className="rounded-full bg-soft px-2 py-1 text-xs font-semibold text-muted" title="Ask one of the club’s admins for an invite.">
        Invite only
      </span>
    );
  }

  return (
    <div className="space-y-2">
      {controls}
      {asking && (
        <form
          className="space-y-2 text-sm"
          onSubmit={(e) => {
            e.preventDefault();
            setError(null);
            join.mutate();
          }}
        >
          <label className="block">
            <span className="mb-1 block text-muted">A note to the admins (optional)</span>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              maxLength={300}
              rows={2}
              className={field}
              placeholder="Who you are, what you build."
            />
          </label>
          <div className="flex flex-wrap gap-2">
            <button type="submit" className={primary} disabled={join.isPending}>
              Send request
            </button>
            <button type="button" className={btn} onClick={() => setAsking(false)}>
              Cancel
            </button>
          </div>
        </form>
      )}
      {error && (
        <p className="text-sm text-danger" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

/** "Find a club": listed clubs, with search. */
export function FindClubSection() {
  const [text, setText] = useState('');
  const [q, setQ] = useState('');
  useEffect(() => {
    const id = setTimeout(() => setQ(text.trim()), 250);
    return () => clearTimeout(id);
  }, [text]);
  const list = useQuery({ queryKey: ['club-directory', q], queryFn: () => api.orgs.directory(q) });
  return (
    <section id="find" aria-labelledby="find-a-club" className="space-y-3">
      <h2 id="find-a-club" className="flex items-center gap-2 text-lg font-semibold">
        Find a club
        <HelpButton helpKey="club.find" />
      </h2>
      <label className="block text-sm">
        <span className="sr-only">Search clubs</span>
        <input
          type="search"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Search clubs by name or description"
          className={field}
        />
      </label>
      {list.isLoading && <p className="text-sm text-muted">Loading…</p>}
      {list.isError && <p className="text-sm text-danger">Couldn’t load the club list.</p>}
      {list.data &&
        (list.data.clubs.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted">
            {q ? 'No listed club matches that.' : 'No clubs are listed yet. A club’s admins can list it from its Manage page.'}
          </p>
        ) : (
          <ul className="divide-y divide-line rounded-lg border border-line" aria-label="Listed clubs">
            {list.data.clubs.map((c) => (
              <li key={c.id} className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <p className="break-words font-medium">{c.name}</p>
                  <p className="text-xs text-muted">{members(c.memberCount)}</p>
                  {c.description && <p className="mt-1 line-clamp-3 whitespace-pre-line break-words text-sm">{c.description}</p>}
                </div>
                <div className="shrink-0 sm:max-w-xs">
                  <JoinControls club={c} />
                </div>
              </li>
            ))}
          </ul>
        ))}
    </section>
  );
}

/** A listed club seen from outside: its name, description, size and the join button. */
export function ClubPublicView({ club }: { club: ClubSummary }) {
  return (
    <section aria-label={club.name} className="space-y-3 rounded-section border border-line bg-panel p-4">
      <div>
        <h1 className="break-words text-2xl font-semibold">{club.name}</h1>
        <p className="text-sm text-muted">{members(club.memberCount)} · you’re not in this club</p>
        {club.description && <p className="mt-2 whitespace-pre-line text-sm">{club.description}</p>}
      </div>
      <JoinControls club={club} />
    </section>
  );
}

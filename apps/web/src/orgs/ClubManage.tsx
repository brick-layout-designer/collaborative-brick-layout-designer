// Running a club, in plain words for a club admin who isn't technical:
// the people in it (roles, removing, inviting by email or link, pending
// invites), its settings, handing it over, deleting it, and what happened
// lately. Every action is checked again on the server.

import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type AuditEventSummary, type OrgDetail, type OrgInviteSummary, type OrgMemberSummary } from '../api';

const card = 'space-y-3 rounded-section border border-line bg-panel p-4';
const btn = 'tap-target inline-flex items-center justify-center rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-soft disabled:opacity-50';
const primary = 'tap-target inline-flex items-center justify-center rounded-lg bg-accent px-3 py-1.5 text-sm font-semibold text-accent-ink hover:bg-accent-hover disabled:opacity-50';
const danger = 'tap-target inline-flex items-center justify-center rounded-lg border border-red-900 px-3 py-1.5 text-sm text-danger hover:bg-red-950 disabled:opacity-50';
const field = 'min-h-11 w-full rounded-lg border border-border bg-soft px-3 py-2 text-ink';

export const EXPIRY_CHOICES = [1, 7, 14, 30] as const;

export function Section({ title, children, hint }: { title: string; hint?: string | undefined; children: ReactNode }) {
  return (
    <section className={card} aria-label={title}>
      <div>
        <h2 className="text-lg font-semibold">{title}</h2>
        {hint && <p className="text-sm text-muted">{hint}</p>}
      </div>
      {children}
    </section>
  );
}

function daysLeft(at: number): string {
  const d = Math.ceil((at - Date.now()) / 86_400_000);
  if (d <= 0) return 'expired';
  return d === 1 ? 'expires tomorrow' : `expires in ${d} days`;
}

async function copy(text: string, done: (msg: string) => void) {
  try {
    await navigator.clipboard.writeText(text);
    done('Link copied.');
  } catch {
    done('Could not copy; select the link and copy it.');
  }
}

/** Members with their role and when they joined; admins change roles and remove people. */
export function MembersSection({
  slug,
  myUserId,
  isAdmin,
  members,
}: {
  slug: string;
  myUserId: string;
  isAdmin: boolean;
  members: OrgMemberSummary[];
}) {
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['org-members', slug] });
    void qc.invalidateQueries({ queryKey: ['org', slug] });
  };
  const change = useMutation({
    mutationFn: (v: { userId: string; role: 'admin' | 'member' }) => api.orgs.changeMemberRole(slug, v.userId, v.role),
    onSuccess: refresh,
    onError: (e: Error) => setError(e.message),
  });
  const remove = useMutation({
    mutationFn: (userId: string) => api.orgs.removeMember(slug, userId),
    onSuccess: refresh,
    onError: (e: Error) => setError(e.message),
  });
  const sorted = [...members].sort((a, b) => (a.role === b.role ? a.displayName.localeCompare(b.displayName) : a.role === 'admin' ? -1 : 1));
  return (
    <Section
      title={`Members (${members.length})`}
      hint={isAdmin ? 'Admins can change the club and its people. Members can use and add the club’s things.' : undefined}
    >
      {error && <p className="text-sm text-danger" role="alert">{error}</p>}
      <ul className="divide-y divide-line rounded-lg border border-line">
        {sorted.map((m) => {
          const self = m.userId === myUserId;
          return (
            <li key={m.userId} className="flex flex-col gap-2 px-3 py-3 text-sm sm:flex-row sm:items-center sm:justify-between">
              <div className="flex min-w-0 items-center gap-3">
                {m.avatarUrl ? (
                  <img src={m.avatarUrl} alt="" className="h-9 w-9 shrink-0 rounded-full" />
                ) : (
                  <span aria-hidden className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-soft font-semibold text-muted">
                    {m.displayName.slice(0, 1).toUpperCase()}
                  </span>
                )}
                <div className="min-w-0">
                  <p className="break-words font-medium">
                    {m.displayName} {self && <span className="text-xs text-muted">(you)</span>}
                  </p>
                  <p className="break-all text-xs text-muted">
                    {m.email} · joined {new Date(m.joinedAt).toLocaleDateString()}
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {isAdmin && !self ? (
                  <label className="flex items-center gap-2">
                    <span className="sr-only">Role for {m.displayName}</span>
                    <select
                      value={m.role}
                      onChange={(e) => {
                        setError(null);
                        change.mutate({ userId: m.userId, role: e.target.value as 'admin' | 'member' });
                      }}
                      className="min-h-11 rounded-lg border border-border bg-soft px-2 py-1 text-sm"
                    >
                      <option value="member">Member</option>
                      <option value="admin">Admin</option>
                    </select>
                  </label>
                ) : (
                  <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${m.role === 'admin' ? 'bg-accent-soft text-accent-text' : 'bg-soft text-muted'}`}>
                    {m.role === 'admin' ? 'Admin' : 'Member'}
                  </span>
                )}
                {isAdmin && !self && (
                  <button
                    type="button"
                    className={danger}
                    onClick={() => {
                      setError(null);
                      if (confirm(`Remove ${m.displayName} from the club? They keep their own things.`)) remove.mutate(m.userId);
                    }}
                  >
                    Remove
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </Section>
  );
}

/** Invite by email (or by picking an account), with an expiry; the link can be copied and sent by hand. */
export function InviteSection({ slug }: { slug: string }) {
  const qc = useQueryClient();
  const [email, setEmail] = useState('');
  const [pickedUserId, setPickedUserId] = useState<string | null>(null);
  const [role, setRole] = useState<'admin' | 'member'>('member');
  const [days, setDays] = useState<number>(14);
  const [made, setMade] = useState<{ url: string; emailed: boolean } | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Suggestions from real accounts (club-admin-only search that never shows emails).
  const [query, setQuery] = useState('');
  const [suggest, setSuggest] = useState(false);
  useEffect(() => {
    const id = setTimeout(() => setQuery(email.trim()), 250);
    return () => clearTimeout(id);
  }, [email]);
  const suggestions = useQuery({
    queryKey: ['org-user-search', slug, query],
    queryFn: () => api.orgs.searchUsers(slug, query),
    enabled: query.length >= 2 && suggest && pickedUserId === null && !query.includes('@'),
  });

  const invite = useMutation({
    mutationFn: () => api.orgs.invite(slug, pickedUserId ? { userId: pickedUserId } : { email: email.trim() }, role, days),
    onSuccess: (res) => {
      setMade({ url: res.inviteUrl, emailed: res.emailDelivered });
      setEmail('');
      setPickedUserId(null);
      setSuggest(false);
      void qc.invalidateQueries({ queryKey: ['org-members', slug] });
    },
    onError: (e: Error) => setError(e.message),
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setNote(null);
    setMade(null);
    invite.mutate();
  }

  return (
    <Section title="Invite people" hint="They get a link to join. It works once, for the person you invite.">
      <form onSubmit={submit} className="space-y-3 text-sm">
        <label className="relative block">
          <span className="mb-1 block text-muted">Name or email</span>
          <input
            type="text"
            required
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              setPickedUserId(null);
              setSuggest(true);
            }}
            onFocus={() => setSuggest(true)}
            onBlur={() => setTimeout(() => setSuggest(false), 150)}
            className={field}
            placeholder="Search by name, or type an email"
            autoComplete="off"
          />
          {suggest && pickedUserId === null && query.length >= 2 && !query.includes('@') && (
            <ul className="absolute left-0 right-0 top-full z-10 mt-1 max-h-48 overflow-y-auto rounded-lg border border-border bg-panel shadow-lg">
              {suggestions.isLoading && <li className="px-3 py-2 text-muted">Searching…</li>}
              {suggestions.data && suggestions.data.users.length === 0 && (
                <li className="px-3 py-2 text-muted">No account with that name. You can still invite by email.</li>
              )}
              {suggestions.data?.users.map((u) => (
                <li key={u.id}>
                  <button
                    type="button"
                    disabled={u.alreadyMember}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      setEmail(u.displayName);
                      setPickedUserId(u.id);
                      setSuggest(false);
                    }}
                    className="flex min-h-11 w-full items-center gap-2 px-3 py-2 text-left hover:bg-soft disabled:opacity-40"
                  >
                    {u.avatarUrl && <img src={u.avatarUrl} alt="" className="h-6 w-6 rounded-full" />}
                    <span className="flex-1 truncate">{u.displayName}</span>
                    {u.alreadyMember && <span className="text-xs text-muted">already in the club</span>}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </label>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1 block text-muted">Joins as</span>
            <select value={role} onChange={(e) => setRole(e.target.value as 'admin' | 'member')} className={field}>
              <option value="member">Member</option>
              <option value="admin">Admin</option>
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-muted">Link works for</span>
            <select value={days} onChange={(e) => setDays(Number(e.target.value))} className={field}>
              {EXPIRY_CHOICES.map((d) => (
                <option key={d} value={d}>
                  {d === 1 ? '1 day' : `${d} days`}
                </option>
              ))}
            </select>
          </label>
        </div>
        <button type="submit" disabled={invite.isPending} className={primary}>
          Send invite
        </button>
        {error && <p className="text-danger" role="alert">{error}</p>}
        {made && (
          <div className="space-y-2 rounded-lg border border-line bg-ok-soft p-3" role="status">
            <p className="text-ok">
              {made.emailed ? 'Invite sent by email. You can also send this link yourself:' : 'Invite made. Send them this link:'}
            </p>
            <code className="block break-all rounded-lg bg-panel p-2 text-xs">{made.url}</code>
            <button type="button" className={btn} onClick={() => void copy(made.url, setNote)}>
              Copy link
            </button>
            {note && <p className="text-xs text-muted">{note}</p>}
          </div>
        )}
      </form>
    </Section>
  );
}

/** Invites not yet accepted: copy the link, send again with a fresh expiry, or cancel. */
export function PendingInvitesSection({ slug, invites }: { slug: string; invites: OrgInviteSummary[] }) {
  const qc = useQueryClient();
  const [note, setNote] = useState<string | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ['org-members', slug] });
  const resend = useMutation({
    mutationFn: (id: string) => api.orgs.resendInvite(slug, id),
    onSuccess: (res) => {
      setNote(res.emailDelivered ? 'Sent again. The link works for 14 more days.' : 'The link works for 14 more days. Email isn’t set up here, so copy the link and send it.');
      void refresh();
    },
    onError: (e: Error) => setNote(e.message),
  });
  const cancel = useMutation({ mutationFn: (id: string) => api.orgs.revokeInvite(slug, id), onSuccess: refresh });
  return (
    <Section title={`Waiting to join (${invites.length})`}>
      {invites.length === 0 ? (
        <p className="text-sm text-muted">No invites waiting.</p>
      ) : (
        <ul className="divide-y divide-line rounded-lg border border-line">
          {invites.map((i) => (
            <li key={i.id} className="flex flex-col gap-2 px-3 py-3 text-sm sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="break-all font-medium">{i.invitedEmail}</p>
                <p className="text-xs text-muted">
                  {i.role === 'admin' ? 'Admin' : 'Member'} · {daysLeft(i.expiresAt)}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {i.inviteUrl && (
                  <button type="button" className={btn} onClick={() => void copy(i.inviteUrl!, setNote)}>
                    Copy link
                  </button>
                )}
                <button type="button" className={btn} disabled={resend.isPending} onClick={() => resend.mutate(i.id)}>
                  Send again
                </button>
                <button
                  type="button"
                  className={danger}
                  onClick={() => {
                    if (confirm(`Cancel the invite for ${i.invitedEmail}? The link stops working.`)) cancel.mutate(i.id);
                  }}
                >
                  Cancel invite
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {note && <p className="text-sm text-muted" role="status">{note}</p>}
    </Section>
  );
}

/** Name, address, description, and who may add things. */
export function SettingsSection({ org }: { org: OrgDetail }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [name, setName] = useState(org.name);
  const [slug, setSlug] = useState(org.slug);
  const [description, setDescription] = useState(org.description ?? '');
  const [membersCanCreate, setMembersCanCreate] = useState(org.membersCanCreate ?? true);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const save = useMutation({
    mutationFn: () =>
      api.orgs.update(org.slug, {
        ...(name.trim() !== org.name ? { name: name.trim() } : {}),
        ...(slug.trim() !== org.slug ? { slug: slug.trim() } : {}),
        ...(description.trim() !== (org.description ?? '') ? { description: description.trim() } : {}),
        ...(membersCanCreate !== (org.membersCanCreate ?? true) ? { membersCanCreate } : {}),
      }),
    onSuccess: async (res) => {
      setMsg({ ok: true, text: 'Saved.' });
      await qc.invalidateQueries({ queryKey: ['orgs'] });
      await qc.invalidateQueries({ queryKey: ['org', org.slug] });
      if (res.slug !== org.slug) navigate(`/orgs/${res.slug}/admin`, { replace: true });
    },
    onError: (e: Error) => setMsg({ ok: false, text: e.message }),
  });
  const changed =
    name.trim() !== org.name ||
    slug.trim() !== org.slug ||
    description.trim() !== (org.description ?? '') ||
    membersCanCreate !== (org.membersCanCreate ?? true);
  return (
    <Section title="Club settings">
      <form
        className="space-y-4 text-sm"
        onSubmit={(e) => {
          e.preventDefault();
          setMsg(null);
          save.mutate();
        }}
      >
        <label className="block">
          <span className="mb-1 block text-muted">Name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} required maxLength={80} className={field} />
        </label>
        <label className="block">
          <span className="mb-1 block text-muted">Web address</span>
          <input
            value={slug}
            onChange={(e) => setSlug(e.target.value.toLowerCase())}
            required
            maxLength={40}
            pattern="[a-z0-9](?:[a-z0-9\-]*[a-z0-9])?"
            className={field}
          />
          <span className="mt-1 block text-xs text-muted">
            The club’s page is at /orgs/{slug || '…'}. Changing it breaks old links to the club page.
          </span>
        </label>
        <label className="block">
          <span className="mb-1 block text-muted">About the club</span>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={500}
            rows={3}
            className={field}
            placeholder="Where you meet, what you build, how to join."
          />
        </label>
        <label className="flex min-h-11 items-start gap-3 rounded-lg border border-line p-3">
          <input
            type="checkbox"
            checked={membersCanCreate}
            onChange={(e) => setMembersCanCreate(e.target.checked)}
            className="mt-1"
          />
          <span>
            <span className="font-semibold">Members can add layouts, venues and modules</span>
            <span className="block text-xs text-muted">
              Turn this off if only admins should add things to the club. Everyone in the club can still open and use them.
            </span>
          </span>
        </label>
        <div className="flex flex-wrap items-center gap-3">
          <button type="submit" disabled={!changed || save.isPending} className={primary}>
            Save settings
          </button>
          {msg && (
            <p className={msg.ok ? 'text-ok' : 'text-danger'} role={msg.ok ? 'status' : 'alert'}>
              {msg.text}
            </p>
          )}
        </div>
      </form>
    </Section>
  );
}

/** Make another member an admin and step down, so the club is never left without one. */
export function HandOverSection({ slug, myUserId, members }: { slug: string; myUserId: string; members: OrgMemberSummary[] }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const others = members.filter((m) => m.userId !== myUserId);
  const [to, setTo] = useState(others[0]?.userId ?? '');
  const [error, setError] = useState<string | null>(null);
  const hand = useMutation({
    mutationFn: () => api.orgs.handOver(slug, to),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['org', slug] });
      await qc.invalidateQueries({ queryKey: ['orgs'] });
      navigate(`/orgs/${slug}`);
    },
    onError: (e: Error) => setError(e.message),
  });
  return (
    <Section
      title="Hand over the club"
      hint="Make someone else an admin and become a member yourself. Use this when you step down."
    >
      {others.length === 0 ? (
        <p className="text-sm text-muted">Invite someone first: there’s nobody else in the club to hand it to.</p>
      ) : (
        <form
          className="flex flex-col gap-3 text-sm sm:flex-row sm:items-end"
          onSubmit={(e) => {
            e.preventDefault();
            setError(null);
            const who = others.find((m) => m.userId === to)?.displayName ?? 'them';
            if (confirm(`Make ${who} an admin and step down to member? You can’t undo this yourself.`)) hand.mutate();
          }}
        >
          <label className="block flex-1">
            <span className="mb-1 block text-muted">New admin</span>
            <select value={to} onChange={(e) => setTo(e.target.value)} className={field}>
              {others.map((m) => (
                <option key={m.userId} value={m.userId}>
                  {m.displayName}
                  {m.role === 'admin' ? ' (already an admin)' : ''}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" disabled={!to || hand.isPending} className={primary}>
            Hand over
          </button>
        </form>
      )}
      {error && <p className="text-sm text-danger" role="alert">{error}</p>}
    </Section>
  );
}

/** Delete the club and everything it owns, after typing its name. */
export function DeleteClubSection({ org, counts }: { org: OrgDetail; counts: string }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [typed, setTyped] = useState('');
  const [error, setError] = useState<string | null>(null);
  const remove = useMutation({
    mutationFn: () => api.orgs.remove(org.slug, typed),
    onSuccess: async () => {
      await qc.invalidateQueries();
      navigate('/orgs', { replace: true });
    },
    onError: (e: Error) => setError(e.message),
  });
  const ok = typed.trim().toLowerCase() === org.name.trim().toLowerCase();
  return (
    <section className="space-y-3 rounded-section border border-red-900 bg-panel p-4" aria-label="Delete the club">
      <h2 className="text-lg font-semibold text-danger">Delete the club</h2>
      <p className="text-sm text-muted">
        This deletes {org.name} for everyone, with {counts}. People keep their own things. It can’t be undone.
      </p>
      <form
        className="flex flex-col gap-3 text-sm sm:flex-row sm:items-end"
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          remove.mutate();
        }}
      >
        <label className="block flex-1">
          <span className="mb-1 block text-muted">Type the club’s name, {org.name}, to confirm</span>
          <input value={typed} onChange={(e) => setTyped(e.target.value)} className={field} autoComplete="off" />
        </label>
        <button type="submit" disabled={!ok || remove.isPending} className={danger}>
          Delete club
        </button>
      </form>
      {error && <p className="text-sm text-danger" role="alert">{error}</p>}
    </section>
  );
}

/** "Leave the club", with the last-admin rule explained up front. */
export function LeaveClubButton({ org, myUserId }: { org: OrgDetail; myUserId: string }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const lastAdmin = org.myRole === 'admin' && (org.adminCount ?? 1) <= 1;
  const leave = useMutation({
    mutationFn: () => api.orgs.removeMember(org.slug, myUserId),
    onSuccess: async () => {
      await qc.invalidateQueries();
      navigate('/orgs', { replace: true });
    },
    onError: (e: Error) => setError(e.message),
  });
  return (
    <div className="space-y-2">
      <button
        type="button"
        className={danger}
        disabled={leave.isPending}
        onClick={() => {
          setError(null);
          if (lastAdmin) {
            setError('You’re the club’s only admin. Hand the club over (or make someone else an admin) before you leave.');
            return;
          }
          if (confirm(`Leave ${org.name}? You keep your own things; the club keeps its things.`)) leave.mutate();
        }}
      >
        Leave the club
      </button>
      {error && <p className="text-sm text-danger" role="alert">{error}</p>}
    </div>
  );
}

/** What an audit event means, in a short sentence. */
export function describeEvent(e: AuditEventSummary, memberName: (id: string) => string | undefined): string {
  const who = e.userName ?? 'Someone';
  const p = (e.payload ?? {}) as Record<string, unknown>;
  const target = typeof p.targetUserId === 'string' ? (memberName(p.targetUserId) ?? 'a member') : 'a member';
  switch (e.eventType) {
    case 'create':
      return e.resourceKind === 'org' ? `${who} started the club` : `${who} added ${typeof p.title === 'string' ? `“${p.title}”` : 'something'}`;
    case 'share':
      return `${who} invited ${typeof p.invitedEmail === 'string' ? p.invitedEmail : 'someone'}`;
    case 'unshare':
      return p.selfRemoved ? `${who} left the club` : `${who} removed ${target}`;
    case 'role_change':
      return `${who} made ${target} ${p.toRole === 'admin' ? 'an admin' : 'a member'}`;
    case 'hand_over':
      return `${who} handed the club to ${typeof p.toUserId === 'string' ? (memberName(p.toUserId) ?? 'a member') : 'a member'}`;
    case 'settings':
      return `${who} changed the club’s settings`;
    case 'transfer':
      return `${who} moved a layout into the club`;
    case 'rename':
      return `${who} renamed a layout`;
    case 'delete':
      return `${who} deleted something`;
    case 'edit':
      return `${who} edited a layout`;
    case 'open':
      return `${who} opened a layout`;
    case 'export':
      return `${who} downloaded a layout`;
    default:
      return `${who}: ${e.eventType.replace(/_/g, ' ')}`;
  }
}

/** The last few things that happened in the club (admins). */
export function ActivitySection({ slug, members }: { slug: string; members: OrgMemberSummary[] }) {
  const log = useQuery({ queryKey: ['org-audit', slug], queryFn: () => api.audit.forOrg(slug, 20) });
  const nameOf = (id: string) => members.find((m) => m.userId === id)?.displayName;
  return (
    <Section title="Recent activity">
      {log.isLoading && <p className="text-sm text-muted">Loading…</p>}
      {log.isError && <p className="text-sm text-danger">Couldn’t load the activity.</p>}
      {log.data &&
        (log.data.events.length === 0 ? (
          <p className="text-sm text-muted">Nothing yet.</p>
        ) : (
          <ol className="space-y-2 text-sm">
            {log.data.events.map((e) => (
              <li key={e.id} className="flex flex-col border-l-2 border-line pl-3 sm:flex-row sm:justify-between sm:gap-4">
                <span>{describeEvent(e, nameOf)}</span>
                <time className="shrink-0 text-xs text-muted" dateTime={new Date(e.createdAt).toISOString()}>
                  {new Date(e.createdAt).toLocaleString()}
                </time>
              </li>
            ))}
          </ol>
        ))}
    </Section>
  );
}

import { useState, type FormEvent } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type OrgMemberSummary, type OrgInviteSummary } from '../api';

export function OrgDetailPage() {
  const params = useParams<{ slug: string }>();
  if (!params.slug) return <Navigate to="/orgs" replace />;
  return <OrgDetail slug={params.slug} />;
}

function OrgDetail({ slug }: { slug: string }) {
  const me = useQuery({ queryKey: ['me'], queryFn: api.me });
  const detail = useQuery({ queryKey: ['org', slug], queryFn: () => api.orgs.get(slug) });
  const members = useQuery({
    queryKey: ['org-members', slug],
    queryFn: () => api.orgs.members(slug),
  });
  const layouts = useQuery({
    queryKey: ['org-layouts', slug],
    queryFn: () => api.orgs.layouts(slug),
  });

  if (detail.isLoading) return <Loading />;
  if (detail.isError) return <NotFound />;
  const org = detail.data!;
  const isAdmin = org.myRole === 'admin';

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6">
      <div>
        <Link to="/orgs" className="text-sm text-neutral-400 hover:underline">
          ← Organisations
        </Link>
        <h1 className="mt-1 text-2xl font-semibold">{org.name}</h1>
        <p className="text-sm text-neutral-500">
          /{org.slug} · you are {org.myRole}
        </p>
      </div>

      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-neutral-400">
          Members
        </h2>
        {members.isLoading ? (
          <p className="text-sm text-neutral-500">Loading…</p>
        ) : (
          <MembersList
            slug={slug}
            myUserId={me.data?.user?.id ?? ''}
            isAdmin={isAdmin}
            members={members.data?.members ?? []}
            invites={members.data?.invites ?? []}
          />
        )}
        {isAdmin && <InviteForm slug={slug} />}
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-neutral-400">
          Org-owned layouts
        </h2>
        {layouts.isLoading && <p className="text-sm text-neutral-500">Loading…</p>}
        {layouts.data &&
          (layouts.data.layouts.length === 0 ? (
            <p className="rounded border border-dashed border-neutral-800 p-4 text-sm text-neutral-500">
              No layouts owned by this org yet. Open a personal layout and use{' '}
              <em>Transfer</em> to move it here.
            </p>
          ) : (
            <ul className="divide-y divide-neutral-800 rounded border border-neutral-800">
              {layouts.data.layouts.map((l) => (
                <li key={l.id} className="flex items-center justify-between px-3 py-2 text-sm">
                  <div>
                    <p>{l.title}</p>
                    <p className="text-xs text-neutral-500">
                      updated {new Date(l.updatedAt).toLocaleString()}
                    </p>
                  </div>
                  <Link
                    to={`/editor/${l.id}`}
                    className="rounded bg-blue-600 px-3 py-1 hover:bg-blue-500"
                  >
                    Open
                  </Link>
                </li>
              ))}
            </ul>
          ))}
      </section>
    </div>
  );
}

function MembersList({
  slug,
  myUserId,
  isAdmin,
  members,
  invites,
}: {
  slug: string;
  myUserId: string;
  isAdmin: boolean;
  members: OrgMemberSummary[];
  invites: OrgInviteSummary[];
}) {
  const qc = useQueryClient();
  const change = useMutation({
    mutationFn: (vars: { userId: string; role: 'admin' | 'member' }) =>
      api.orgs.changeMemberRole(slug, vars.userId, vars.role),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['org-members', slug] }),
  });
  const remove = useMutation({
    mutationFn: (userId: string) => api.orgs.removeMember(slug, userId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['org-members', slug] }),
  });
  const revoke = useMutation({
    mutationFn: (inviteId: string) => api.orgs.revokeInvite(slug, inviteId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['org-members', slug] }),
  });

  return (
    <div className="space-y-3">
      <ul className="divide-y divide-neutral-800 rounded border border-neutral-800">
        {members.map((m) => {
          const isSelf = m.userId === myUserId;
          return (
            <li key={m.userId} className="flex items-center justify-between px-3 py-2 text-sm">
              <div>
                <p>
                  {m.displayName} {isSelf && <span className="text-xs text-neutral-500">(you)</span>}
                </p>
                <p className="text-xs text-neutral-500">{m.email}</p>
              </div>
              <div className="flex items-center gap-2">
                {isAdmin ? (
                  <select
                    value={m.role}
                    onChange={(e) =>
                      change.mutate({ userId: m.userId, role: e.target.value as 'admin' | 'member' })
                    }
                    className="rounded border border-neutral-700 bg-neutral-800 px-2 py-1 text-xs"
                  >
                    <option value="member">Member</option>
                    <option value="admin">Admin</option>
                  </select>
                ) : (
                  <span className="rounded bg-neutral-800 px-2 py-1 text-xs text-neutral-300">
                    {m.role}
                  </span>
                )}
                {(isAdmin || isSelf) && (
                  <button
                    onClick={() => {
                      if (
                        confirm(
                          isSelf ? 'Leave this organisation?' : `Remove ${m.displayName}?`,
                        )
                      )
                        remove.mutate(m.userId);
                    }}
                    className="rounded border border-red-900 px-2 py-1 text-xs text-red-400 hover:bg-red-950"
                  >
                    {isSelf ? 'Leave' : 'Remove'}
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      {invites.length > 0 && (
        <div>
          <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-neutral-400">
            Pending invites
          </h3>
          <ul className="divide-y divide-neutral-800 rounded border border-neutral-800">
            {invites.map((i) => (
              <li
                key={i.id}
                className="flex items-center justify-between px-3 py-2 text-sm"
              >
                <div>
                  <p>{i.invitedEmail}</p>
                  <p className="text-xs text-neutral-500">
                    {i.role} · expires {new Date(i.expiresAt).toLocaleDateString()}
                  </p>
                </div>
                {isAdmin && (
                  <button
                    onClick={() => revoke.mutate(i.id)}
                    className="rounded border border-neutral-700 px-2 py-1 text-xs hover:bg-neutral-800"
                  >
                    Revoke
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function InviteForm({ slug }: { slug: string }) {
  const qc = useQueryClient();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'admin' | 'member'>('member');
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const invite = useMutation({
    mutationFn: () => api.orgs.invite(slug, email, role),
    onSuccess: (res) => {
      setShareUrl(res.inviteUrl);
      setEmail('');
      qc.invalidateQueries({ queryKey: ['org-members', slug] });
    },
    onError: (e: Error) => setError(e.message),
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setShareUrl(null);
    invite.mutate();
  }

  return (
    <form
      onSubmit={submit}
      className="mt-3 rounded border border-neutral-800 p-3 text-sm"
    >
      <div className="flex items-end gap-2">
        <label className="flex-1">
          <span className="mb-1 block text-xs text-neutral-400">Invite by email</span>
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded border border-neutral-700 bg-neutral-800 px-2 py-1.5"
            placeholder="bob@example.com"
          />
        </label>
        <label>
          <span className="mb-1 block text-xs text-neutral-400">Role</span>
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as 'admin' | 'member')}
            className="rounded border border-neutral-700 bg-neutral-800 px-2 py-1.5"
          >
            <option value="member">Member</option>
            <option value="admin">Admin</option>
          </select>
        </label>
        <button
          type="submit"
          disabled={invite.isPending}
          className="rounded bg-blue-600 px-3 py-1.5 hover:bg-blue-500 disabled:opacity-50"
        >
          Invite
        </button>
      </div>
      {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
      {shareUrl && (
        <div className="mt-3 rounded border border-emerald-900 bg-emerald-950/30 p-2 text-xs">
          <p className="text-emerald-400">Invite created.</p>
          <code className="mt-1 block break-all rounded bg-neutral-950 p-1 text-[11px]">
            {shareUrl}
          </code>
          <button
            type="button"
            onClick={() => navigator.clipboard.writeText(shareUrl)}
            className="mt-1 text-xs text-blue-400 hover:underline"
          >
            Copy link
          </button>
        </div>
      )}
    </form>
  );
}

function Loading() {
  return <div className="grid h-screen place-items-center text-neutral-500">Loading…</div>;
}

function NotFound() {
  return (
    <div className="grid h-screen place-items-center">
      <div className="rounded border border-red-900 bg-red-950/30 p-4 text-sm">
        <p className="font-semibold text-red-400">Organisation not found.</p>
        <Link to="/orgs" className="mt-2 inline-block text-blue-400 hover:underline">
          ← back
        </Link>
      </div>
    </div>
  );
}

import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type CollaboratorSummary, type InviteSummary } from '../api';

interface Props {
  layoutId: string;
  layoutTitle: string;
  /** Caller's role on this layout — gates owner-only controls. */
  myRole: 'owner' | 'editor' | 'viewer';
  /** Caller's user id — used to mark "you" in the list. */
  myUserId: string;
  onClose: () => void;
}

/**
 * Modal sharing dialog. Owner sees the full UI: invite, role-change,
 * remove. Editors and viewers see a read-only collaborator list (so they
 * know who else has access). The dialog is mounted by `LayoutsPage` and
 * by the editor's header — same component, same shape.
 */
export function ShareDialog({
  layoutId,
  layoutTitle,
  myRole,
  myUserId,
  onClose,
}: Props) {
  const qc = useQueryClient();
  const list = useQuery({
    queryKey: ['collaborators', layoutId],
    queryFn: () => api.collaborators.list(layoutId),
  });

  const isOwner = myRole === 'owner';

  return (
    <div className="fixed inset-0 grid place-items-center bg-black/60 p-4">
      <div className="w-full max-w-lg space-y-4 rounded-lg border border-neutral-800 bg-neutral-900 p-6">
        <div className="flex items-start justify-between">
          <div>
            <h3 className="text-lg font-semibold">Share "{layoutTitle}"</h3>
            <p className="text-xs text-neutral-500">
              {isOwner
                ? 'Invite people by email or manage existing access.'
                : `You have ${myRole} access. Only the owner can change sharing.`}
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded p-1 text-neutral-400 hover:bg-neutral-800"
          >
            ✕
          </button>
        </div>

        {isOwner && (
          <InviteForm
            layoutId={layoutId}
            onInvited={() => qc.invalidateQueries({ queryKey: ['collaborators', layoutId] })}
          />
        )}

        {isOwner && <TransferSection layoutId={layoutId} />}

        {isOwner && <PublicShareSection layoutId={layoutId} />}

        <AuditPanel layoutId={layoutId} />

        {list.isLoading && <p className="text-sm text-neutral-500">Loading…</p>}
        {list.data && (
          <div className="space-y-3">
            <CollaboratorList
              layoutId={layoutId}
              myUserId={myUserId}
              isOwner={isOwner}
              collaborators={list.data.collaborators}
              onChange={() =>
                qc.invalidateQueries({ queryKey: ['collaborators', layoutId] })
              }
            />
            {list.data.invites.length > 0 && (
              <PendingInvites
                layoutId={layoutId}
                invites={list.data.invites}
                isOwner={isOwner}
                onChange={() =>
                  qc.invalidateQueries({ queryKey: ['collaborators', layoutId] })
                }
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function InviteForm({
  layoutId,
  onInvited,
}: {
  layoutId: string;
  onInvited: () => void;
}) {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'viewer' | 'editor'>('editor');
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [delivered, setDelivered] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const invite = useMutation({
    mutationFn: () => api.collaborators.invite(layoutId, email, role),
    onSuccess: (res) => {
      setShareUrl(res.inviteUrl);
      setDelivered(res.emailDelivered);
      setEmail('');
      onInvited();
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
    <form onSubmit={submit} className="rounded border border-neutral-800 p-3 text-sm">
      <div className="flex items-end gap-2">
        <label className="flex-1">
          <span className="mb-1 block text-xs text-neutral-400">Email</span>
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded border border-neutral-700 bg-neutral-800 px-2 py-1.5"
            placeholder="alice@example.com"
          />
        </label>
        <label>
          <span className="mb-1 block text-xs text-neutral-400">Role</span>
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as 'viewer' | 'editor')}
            className="rounded border border-neutral-700 bg-neutral-800 px-2 py-1.5"
          >
            <option value="viewer">Viewer</option>
            <option value="editor">Editor</option>
          </select>
        </label>
        <button
          type="submit"
          disabled={invite.isPending}
          className="rounded bg-blue-600 px-3 py-1.5 text-sm hover:bg-blue-500 disabled:opacity-50"
        >
          Invite
        </button>
      </div>

      {error && <p className="mt-2 text-xs text-red-400">{error}</p>}

      {shareUrl && (
        <div className="mt-3 rounded border border-emerald-900 bg-emerald-950/30 p-2 text-xs">
          <p className="text-emerald-400">
            {delivered ? 'Email sent.' : 'Email delivery skipped (no SMTP configured).'}
          </p>
          <p className="mt-1 text-neutral-300">
            Share this link with the recipient (the email-match check
            still applies on accept):
          </p>
          <code
            className="mt-1 block break-all rounded bg-neutral-950 p-1 text-[11px]"
          >
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

function CollaboratorList({
  layoutId,
  myUserId,
  isOwner,
  collaborators,
  onChange,
}: {
  layoutId: string;
  myUserId: string;
  isOwner: boolean;
  collaborators: CollaboratorSummary[];
  onChange: () => void;
}) {
  return (
    <div>
      <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-neutral-400">
        Collaborators
      </h4>
      <ul className="divide-y divide-neutral-800 rounded border border-neutral-800">
        {collaborators.length === 0 && (
          <li className="px-3 py-2 text-xs text-neutral-500">No collaborators yet.</li>
        )}
        {collaborators.map((c) => (
          <CollaboratorRow
            key={c.userId}
            layoutId={layoutId}
            collaborator={c}
            isSelf={c.userId === myUserId}
            isOwner={isOwner}
            onChange={onChange}
          />
        ))}
      </ul>
    </div>
  );
}

function CollaboratorRow({
  layoutId,
  collaborator,
  isSelf,
  isOwner,
  onChange,
}: {
  layoutId: string;
  collaborator: CollaboratorSummary;
  isSelf: boolean;
  isOwner: boolean;
  onChange: () => void;
}) {
  const change = useMutation({
    mutationFn: (role: 'viewer' | 'editor') =>
      api.collaborators.changeRole(layoutId, collaborator.userId, role),
    onSuccess: onChange,
  });
  const remove = useMutation({
    mutationFn: () => api.collaborators.remove(layoutId, collaborator.userId),
    onSuccess: onChange,
  });

  return (
    <li className="flex items-center justify-between px-3 py-2 text-sm">
      <div>
        <p>
          {collaborator.displayName}{' '}
          {isSelf && <span className="text-xs text-neutral-500">(you)</span>}
        </p>
        <p className="text-xs text-neutral-500">{collaborator.email}</p>
      </div>
      <div className="flex items-center gap-2">
        {isOwner && collaborator.role !== 'owner' ? (
          <select
            value={collaborator.role}
            onChange={(e) => change.mutate(e.target.value as 'viewer' | 'editor')}
            className="rounded border border-neutral-700 bg-neutral-800 px-2 py-1 text-xs"
          >
            <option value="viewer">Viewer</option>
            <option value="editor">Editor</option>
          </select>
        ) : (
          <span className="rounded bg-neutral-800 px-2 py-1 text-xs text-neutral-300">
            {collaborator.role}
          </span>
        )}
        {(isOwner || isSelf) && collaborator.role !== 'owner' && (
          <button
            onClick={() => {
              if (
                confirm(
                  isSelf
                    ? 'Remove yourself from this layout?'
                    : `Remove ${collaborator.displayName}?`,
                )
              )
                remove.mutate();
            }}
            className="rounded border border-red-900 px-2 py-1 text-xs text-red-400 hover:bg-red-950"
          >
            {isSelf ? 'Leave' : 'Remove'}
          </button>
        )}
      </div>
    </li>
  );
}

function PendingInvites({
  layoutId,
  invites,
  isOwner,
  onChange,
}: {
  layoutId: string;
  invites: InviteSummary[];
  isOwner: boolean;
  onChange: () => void;
}) {
  const revoke = useMutation({
    mutationFn: (inviteId: string) => api.collaborators.revokeInvite(layoutId, inviteId),
    onSuccess: onChange,
  });
  return (
    <div>
      <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-neutral-400">
        Pending invites
      </h4>
      <ul className="divide-y divide-neutral-800 rounded border border-neutral-800">
        {invites.map((i) => (
          <li key={i.id} className="flex items-center justify-between px-3 py-2 text-sm">
            <div>
              <p>{i.invitedEmail}</p>
              <p className="text-xs text-neutral-500">
                {i.role} · expires {new Date(i.expiresAt).toLocaleDateString()}
              </p>
            </div>
            {isOwner && (
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
  );
}

function TransferSection({ layoutId }: { layoutId: string }) {
  const orgs = useQuery({ queryKey: ['orgs'], queryFn: api.orgs.list });
  const [mode, setMode] = useState<'closed' | 'user' | 'org'>('closed');
  const [email, setEmail] = useState('');
  const [orgSlug, setOrgSlug] = useState('');
  const [linkResult, setLinkResult] = useState<{ url: string; emailDelivered: boolean } | null>(
    null,
  );
  const [orgResult, setOrgResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const initiate = useMutation({
    mutationFn: () =>
      mode === 'user'
        ? api.transfers.initiate(layoutId, { email })
        : api.transfers.initiate(layoutId, { orgSlug }),
    onSuccess: (res) => {
      setError(null);
      if ('transferred' in res) {
        setOrgResult(res.ownerSlug);
        setLinkResult(null);
      } else {
        setLinkResult({ url: res.transferUrl, emailDelivered: res.emailDelivered });
        setOrgResult(null);
      }
    },
    onError: (e: Error) => setError(e.message),
  });

  return (
    <div className="rounded border border-neutral-800 p-3 text-sm">
      <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-400">
        Transfer ownership
      </h4>
      {mode === 'closed' && (
        <div className="flex gap-2">
          <button
            onClick={() => setMode('user')}
            className="rounded border border-neutral-700 px-3 py-1 text-xs hover:bg-neutral-800"
          >
            Transfer to a user
          </button>
          {orgs.data && orgs.data.orgs.length > 0 && (
            <button
              onClick={() => setMode('org')}
              className="rounded border border-neutral-700 px-3 py-1 text-xs hover:bg-neutral-800"
            >
              Transfer to an org
            </button>
          )}
        </div>
      )}

      {mode === 'user' && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            initiate.mutate();
          }}
          className="space-y-2"
        >
          <p className="text-xs text-neutral-500">
            The recipient must accept via the link before ownership flips. You'll
            stay on the layout as an editor.
          </p>
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="recipient@example.com"
            className="w-full rounded border border-neutral-700 bg-neutral-800 px-2 py-1.5"
          />
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={initiate.isPending}
              className="rounded bg-blue-600 px-3 py-1.5 text-xs hover:bg-blue-500 disabled:opacity-50"
            >
              Initiate transfer
            </button>
            <button
              type="button"
              onClick={() => setMode('closed')}
              className="rounded border border-neutral-700 px-3 py-1.5 text-xs hover:bg-neutral-800"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {mode === 'org' && orgs.data && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            initiate.mutate();
          }}
          className="space-y-2"
        >
          <p className="text-xs text-neutral-500">
            Transfer commits immediately. You'll lose owner-level access unless
            you're an admin of the destination org.
          </p>
          <select
            value={orgSlug}
            onChange={(e) => setOrgSlug(e.target.value)}
            required
            className="w-full rounded border border-neutral-700 bg-neutral-800 px-2 py-1.5"
          >
            <option value="">Choose an organization…</option>
            {orgs.data.orgs.map((o) => (
              <option key={o.slug} value={o.slug}>
                {o.name} ({o.myRole})
              </option>
            ))}
          </select>
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={initiate.isPending || !orgSlug}
              className="rounded bg-blue-600 px-3 py-1.5 text-xs hover:bg-blue-500 disabled:opacity-50"
            >
              Transfer to org
            </button>
            <button
              type="button"
              onClick={() => setMode('closed')}
              className="rounded border border-neutral-700 px-3 py-1.5 text-xs hover:bg-neutral-800"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {error && <p className="mt-2 text-xs text-red-400">{error}</p>}

      {linkResult && (
        <div className="mt-3 rounded border border-emerald-900 bg-emerald-950/30 p-2 text-xs">
          <p className="text-emerald-400">
            {linkResult.emailDelivered
              ? 'Email sent. The transfer is pending until the recipient accepts.'
              : 'Email delivery skipped (no SMTP configured). Share this link:'}
          </p>
          <code className="mt-1 block break-all rounded bg-neutral-950 p-1 text-[11px]">
            {linkResult.url}
          </code>
          <button
            type="button"
            onClick={() => navigator.clipboard.writeText(linkResult.url)}
            className="mt-1 text-xs text-blue-400 hover:underline"
          >
            Copy link
          </button>
        </div>
      )}

      {orgResult && (
        <div className="mt-3 rounded border border-emerald-900 bg-emerald-950/30 p-2 text-xs text-emerald-400">
          Layout transferred to <strong>/{orgResult}</strong>.
        </div>
      )}
    </div>
  );
}

/** Per-layout audit log panel — collapsed by default. */
export function AuditPanel({ layoutId }: { layoutId: string }) {
  const events = useQuery({
    queryKey: ['audit', 'layout', layoutId],
    queryFn: () => api.audit.forLayout(layoutId),
    // Audit log isn't reactive — re-fetch on dialog open is enough.
    staleTime: 30_000,
  });

  return (
    <details className="rounded border border-neutral-800 p-3 text-sm">
      <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wide text-neutral-400">
        History
      </summary>
      <div className="mt-2 max-h-60 overflow-y-auto">
        {events.isLoading && <p className="text-xs text-neutral-500">Loading…</p>}
        {events.data && events.data.events.length === 0 && (
          <p className="text-xs text-neutral-500">No events recorded yet.</p>
        )}
        {events.data && events.data.events.length > 0 && (
          <ul className="space-y-1 text-xs">
            {events.data.events.map((e) => (
              <li
                key={e.id}
                className="grid grid-cols-[auto_1fr] gap-x-2 text-neutral-300"
              >
                <span className="font-mono text-neutral-500">
                  {new Date(e.createdAt).toLocaleString()}
                </span>
                <span>
                  <strong>{e.eventType}</strong>
                  <span className="ml-1 text-neutral-500">
                    {summarisePayload(e.payload)}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </details>
  );
}

/**
 * Public-share toggle. Owner-only. When enabled, anyone with the
 * `/p/<token>` URL can view the layout read-only without signing in.
 * Disable rotates the link (re-enabling mints a fresh token).
 */
function PublicShareSection({ layoutId }: { layoutId: string }) {
  const qc = useQueryClient();
  // Pull the latest token from the layout summary cached by editor /
  // layouts list. We refetch this layout's row directly so the dialog
  // always shows the current state regardless of which page mounted it.
  const layout = useQuery({
    queryKey: ['layout', layoutId],
    queryFn: () => api.layouts.get(layoutId),
  });
  const [copied, setCopied] = useState(false);

  const enable = useMutation({
    mutationFn: () => api.layouts.enablePublicShare(layoutId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['layout', layoutId] });
      qc.invalidateQueries({ queryKey: ['layouts'] });
    },
  });
  const disable = useMutation({
    mutationFn: () => api.layouts.disablePublicShare(layoutId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['layout', layoutId] });
      qc.invalidateQueries({ queryKey: ['layouts'] });
    },
  });

  const token = layout.data?.layout.publicShareToken ?? null;
  const url = token ? `${window.location.origin}/p/${token}` : null;

  return (
    <div className="rounded border border-neutral-800 p-3 text-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h4 className="text-xs font-semibold uppercase tracking-wide text-neutral-400">
            Public link
          </h4>
          <p className="mt-1 text-xs text-neutral-500">
            {token
              ? 'Anyone with this link can view (read-only) without signing in.'
              : 'Off — only invited collaborators can see this layout.'}
          </p>
        </div>
        {token ? (
          <button
            onClick={() => {
              if (confirm('Disable the public link? The current URL will stop working.')) {
                disable.mutate();
              }
            }}
            disabled={disable.isPending}
            className="rounded border border-red-900 px-2 py-1 text-xs text-red-400 hover:bg-red-950 disabled:opacity-50"
          >
            Disable
          </button>
        ) : (
          <button
            onClick={() => enable.mutate()}
            disabled={enable.isPending}
            className="rounded bg-blue-600 px-3 py-1 text-xs hover:bg-blue-500 disabled:opacity-50"
          >
            Enable
          </button>
        )}
      </div>
      {url && (
        <div className="mt-2">
          <code className="block break-all rounded bg-neutral-950 p-1 text-[11px]">
            {url}
          </code>
          <button
            type="button"
            onClick={() => {
              navigator.clipboard.writeText(url);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }}
            className="mt-1 text-xs text-blue-400 hover:underline"
          >
            {copied ? 'Copied!' : 'Copy link'}
          </button>
        </div>
      )}
    </div>
  );
}

function summarisePayload(payload: unknown): string {
  if (!payload || typeof payload !== 'object') return '';
  // Cheap human-readable rendering. Full payload is in the response if
  // a power user wants the JSON; the UI is intentionally summary-only.
  const p = payload as Record<string, unknown>;
  const parts: string[] = [];
  if (typeof p.invitedEmail === 'string') parts.push(`→ ${p.invitedEmail}`);
  if (typeof p.role === 'string') parts.push(`(${p.role})`);
  if (typeof p.toRole === 'string' && typeof p.fromRole === 'string') {
    parts.push(`${p.fromRole} → ${p.toRole}`);
  }
  if (p.to && typeof p.to === 'object') {
    const to = p.to as Record<string, unknown>;
    if (to.kind === 'org' && typeof to.slug === 'string') parts.push(`→ /${to.slug}`);
  }
  if (typeof p.partNumber === 'string') parts.push(`[${p.partNumber}]`);
  return parts.join(' ');
}

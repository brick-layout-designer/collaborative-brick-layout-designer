// Sharing a module with people: its owners invite by email (the person
// gets a link to accept, like a layout invite), see who has it and the
// invites still waiting, cancel an invite or take someone off. Everyone
// else sees who has it, and can leave it themselves.

import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type CollaboratorSummary, type InviteSummary, type ModuleSummary } from '../api';
import { HelpButton } from '../help/HelpButton';
import { useIsDemo } from '../catalog/ShareToCatalog';
import { askConfirm, confirmDelete } from '../ui/ConfirmDialog';
import { CopyLinkButton } from '../layouts/ShareDialog';

interface Props {
  module: Pick<ModuleSummary, 'id' | 'title' | 'role'>;
  myUserId: string | undefined;
  onClose: () => void;
}

export function ModuleShareDialog({ module, myUserId, onClose }: Props) {
  const qc = useQueryClient();
  const key = ['module-collaborators', module.id];
  const list = useQuery({ queryKey: key, queryFn: () => api.modules.collaborators(module.id) });
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: key });
    void qc.invalidateQueries({ queryKey: ['modules'] });
  };
  // A module in your own list without a role is yours.
  const isOwner = module.role === undefined || module.role === 'owner';
  const demo = useIsDemo();
  const canShare = isOwner && !demo;
  const invites = list.data?.invites ?? [];

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-3 sm:p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Share ${module.title}`}
        className="max-h-full w-full max-w-lg space-y-4 overflow-y-auto overscroll-contain rounded-lg border border-line bg-panel p-4 sm:p-6"
      >
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="break-words text-lg font-semibold">Share “{module.title}”</h3>
            <p className="text-xs text-muted">
              {demo
                ? 'The demo account can’t invite people. Make your own account to share modules.'
                : isOwner
                  ? 'Invite people by email. They get a link, and have the module once they accept.'
                  : `You can ${module.role === 'editor' ? 'edit' : 'look at'} this module. Only its owners change who has it.`}
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="shrink-0 rounded-lg p-1 text-muted hover:bg-soft">
            ✕
          </button>
        </div>

        {canShare && <InviteForm moduleId={module.id} onInvited={refresh} />}

        {list.isLoading && <p className="text-sm text-muted">Loading…</p>}
        {list.isError && <p className="text-sm text-danger">{(list.error as Error).message}</p>}
        {list.data && (
          <div className="space-y-3">
            <People moduleId={module.id} people={list.data.collaborators} myUserId={myUserId} isOwner={isOwner} onChange={refresh} onLeft={onClose} />
            {invites.length > 0 && <PendingInvites moduleId={module.id} invites={invites} isOwner={isOwner} onChange={refresh} />}
          </div>
        )}
      </div>
    </div>
  );
}

function InviteForm({ moduleId, onInvited }: { moduleId: string; onInvited: () => void }) {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'viewer' | 'editor'>('viewer');
  const [sent, setSent] = useState<{ url: string; delivered: boolean; to: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const invite = useMutation({
    mutationFn: () => api.modules.invite(moduleId, email, role),
    onSuccess: (res) => {
      setSent({ url: res.inviteUrl, delivered: res.emailDelivered, to: email });
      setEmail('');
      onInvited();
    },
    onError: (e: Error) => setError(e.message),
  });
  function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSent(null);
    invite.mutate();
  }
  return (
    <form onSubmit={submit} className="rounded-lg border border-line p-3 text-sm" aria-label="Invite someone">
      <div className="flex flex-wrap items-end gap-2">
        <label className="min-w-[12rem] flex-1">
          <span className="mb-1 block text-xs text-muted">Email</span>
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-lg border border-border bg-soft px-2 py-1.5"
            placeholder="alice@example.com"
          />
        </label>
        <label>
          <span className="mb-1 block text-xs text-muted">Role</span>
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as 'viewer' | 'editor')}
            className="rounded-lg border border-border bg-soft px-2 py-1.5"
          >
            <option value="viewer">Viewer (can use it)</option>
            <option value="editor">Editor (can change it)</option>
          </select>
        </label>
        <button
          type="submit"
          disabled={invite.isPending}
          className="rounded-lg bg-accent px-3 py-1.5 text-sm text-accent-ink hover:bg-accent-hover disabled:opacity-50"
        >
          Invite
        </button>
      </div>
      {error && <p className="mt-2 text-xs text-danger">{error}</p>}
      {sent && (
        <div role="status" className="mt-3 rounded-lg border border-emerald-900 bg-emerald-950/30 p-2 text-xs">
          <p className="text-emerald-400">
            {sent.delivered ? `Invite sent to ${sent.to}.` : `Invite made for ${sent.to}. This site can’t send email, so send them the link yourself.`}
          </p>
          <p className="mt-1 text-neutral-300">They open the link and sign in with that address to accept:</p>
          <code className="mt-1 block break-all rounded-lg bg-bg p-1 text-[11px]">{sent.url}</code>
          <CopyLinkButton url={sent.url} />
        </div>
      )}
    </form>
  );
}

function People({
  moduleId,
  people,
  myUserId,
  isOwner,
  onChange,
  onLeft,
}: {
  moduleId: string;
  people: CollaboratorSummary[];
  myUserId: string | undefined;
  isOwner: boolean;
  onChange: () => void;
  onLeft: () => void;
}) {
  const remove = useMutation({
    mutationFn: (userId: string) => api.modules.removeCollaborator(moduleId, userId),
    onSuccess: (_r, userId) => {
      onChange();
      if (userId === myUserId) onLeft();
    },
  });
  return (
    <div>
      <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">People with access</h4>
      <ul className="divide-y divide-line rounded-lg border border-line" data-testid="module-people">
        {people.length === 0 && <li className="px-3 py-2 text-xs text-muted">Not shared with anyone yet.</li>}
        {people.map((p) => {
          const isSelf = p.userId === myUserId;
          return (
            <li key={p.userId} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
              <div className="min-w-0">
                <p className="break-words">
                  {p.displayName} {isSelf && <span className="text-xs text-muted">(you)</span>}
                </p>
                {p.email && <p className="break-all text-xs text-muted">{p.email}</p>}
              </div>
              <div className="flex items-center gap-2">
                <span className="rounded-lg bg-soft px-2 py-1 text-xs text-neutral-300">{p.role}</span>
                {(isOwner || isSelf) && p.role !== 'owner' && (
                  <button
                    type="button"
                    onClick={async () => {
                      const ok = isSelf
                        ? await askConfirm({
                            title: 'Leave this module?',
                            removes: 'You lose access to it and it leaves your list.',
                            keeps: 'The module itself doesn’t change. Its owner can invite you again.',
                            confirmLabel: 'Leave',
                          })
                        : await confirmDelete(p.displayName, {
                            verb: 'Remove',
                            removes: `${p.displayName} can’t open this module any more.`,
                            keeps: 'The module doesn’t change. You can invite them again.',
                          });
                      if (ok) remove.mutate(p.userId);
                    }}
                    className="rounded-lg border border-red-900 px-2 py-1 text-xs text-danger hover:bg-red-950"
                  >
                    {isSelf ? 'Leave' : 'Remove'}
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function PendingInvites({ moduleId, invites, isOwner, onChange }: { moduleId: string; invites: InviteSummary[]; isOwner: boolean; onChange: () => void }) {
  const revoke = useMutation({ mutationFn: (inviteId: string) => api.modules.revokeInvite(moduleId, inviteId), onSuccess: onChange });
  return (
    <div>
      <div className="mb-1 flex items-center gap-1.5">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-muted">Pending invites</h4>
        <HelpButton helpKey="share.pending" />
      </div>
      <ul className="divide-y divide-line rounded-lg border border-line" data-testid="module-invites">
        {invites.map((i) => (
          <li key={i.id} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
            <div className="min-w-0">
              <p className="break-all">{i.invitedEmail}</p>
              <p className="text-xs text-muted">
                {i.role} · expires {new Date(i.expiresAt).toLocaleDateString()}
              </p>
            </div>
            {isOwner && (
              <button
                type="button"
                onClick={async () => {
                  const ok = await confirmDelete(i.invitedEmail, {
                    title: `Cancel the invite for ${i.invitedEmail}?`,
                    verb: 'Cancel',
                    confirmLabel: 'Cancel invite',
                    removes: 'The invite link stops working.',
                    keeps: 'You can invite them again.',
                  });
                  if (ok) revoke.mutate(i.id);
                }}
                className="rounded-lg border border-border px-2 py-1 text-xs hover:bg-soft"
              >
                Cancel invite
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

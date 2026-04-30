import { useState, type ChangeEvent, type FormEvent } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type OrgMemberSummary, type OrgInviteSummary, type AuditEventSummary, type OrgPartLibrary, type CustomPartSummary, type ModuleSummary } from '../api';
import { CategoryPicker } from '../library/LibraryPage';
import { AppHeader } from '../AppHeader';

export function OrgAdminPage() {
  const params = useParams<{ slug: string }>();
  if (!params.slug) return <Navigate to="/orgs" replace />;
  return <OrgAdmin slug={params.slug} />;
}

type Tab = 'members' | 'libraries' | 'parts' | 'modules' | 'audit';

function OrgAdmin({ slug }: { slug: string }) {
  const [tab, setTab] = useState<Tab>('members');
  const me = useQuery({ queryKey: ['me'], queryFn: api.me });
  const detail = useQuery({ queryKey: ['org', slug], queryFn: () => api.orgs.get(slug) });

  if (me.isLoading || detail.isLoading) {
    return <div className="grid h-screen place-items-center text-neutral-500">Loading…</div>;
  }
  if (!me.data?.user) return <Navigate to="/login" replace />;
  if (detail.isError) {
    return (
      <div className="grid h-screen place-items-center">
        <div className="rounded border border-red-900 bg-red-950/30 p-4 text-sm">
          <p className="font-semibold text-red-400">Organization not found.</p>
          <Link to="/orgs" className="mt-2 inline-block text-blue-400 hover:underline">← back</Link>
        </div>
      </div>
    );
  }

  const org = detail.data!;
  if (org.myRole !== 'admin') return <Navigate to={`/orgs/${slug}`} replace />;

  const TABS: { id: Tab; label: string }[] = [
    { id: 'members', label: 'Members' },
    { id: 'libraries', label: 'Part Libraries' },
    { id: 'parts', label: 'Custom Parts' },
    { id: 'modules', label: 'Modules' },
    { id: 'audit', label: 'Audit Log' },
  ];

  return (
    <div className="h-full overflow-y-auto p-8">
      <AppHeader user={me.data.user} />
      <main className="mx-auto mt-8 max-w-4xl space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold">{org.name} — Settings</h1>
            <p className="text-sm text-neutral-500">
              <Link to={`/orgs/${slug}`} className="text-blue-400 hover:underline">
                ← back to org
              </Link>
            </p>
          </div>
        </div>

        <nav className="flex gap-1 border-b border-neutral-800 pb-0">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`rounded-t px-4 py-2 text-sm font-medium transition-colors ${
                tab === t.id
                  ? 'border-b-2 border-blue-500 text-blue-400'
                  : 'text-neutral-400 hover:text-neutral-200'
              }`}
            >
              {t.label}
            </button>
          ))}
        </nav>

        {tab === 'members' && <MembersTab slug={slug} myUserId={me.data.user.id} />}
        {tab === 'libraries' && <LibrariesTab slug={slug} />}
        {tab === 'parts' && <OrgCustomPartsTab slug={slug} orgId={org.id} />}
        {tab === 'modules' && <OrgModulesTab slug={slug} orgId={org.id} />}
        {tab === 'audit' && <AuditTab slug={slug} />}
      </main>
    </div>
  );
}

function MembersTab({ slug, myUserId }: { slug: string; myUserId: string }) {
  const members = useQuery({
    queryKey: ['org-members', slug],
    queryFn: () => api.orgs.members(slug),
  });

  if (members.isLoading) return <p className="text-sm text-neutral-500">Loading…</p>;

  return (
    <div className="space-y-4">
      <MembersList
        slug={slug}
        myUserId={myUserId}
        members={members.data?.members ?? []}
        invites={members.data?.invites ?? []}
      />
      <InviteForm slug={slug} />
    </div>
  );
}

function MembersList({
  slug,
  myUserId,
  members,
  invites,
}: {
  slug: string;
  myUserId: string;
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
                <button
                  onClick={() => {
                    if (confirm(isSelf ? 'Leave this organization?' : `Remove ${m.displayName}?`))
                      remove.mutate(m.userId);
                  }}
                  className="rounded border border-red-900 px-2 py-1 text-xs text-red-400 hover:bg-red-950"
                >
                  {isSelf ? 'Leave' : 'Remove'}
                </button>
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
              <li key={i.id} className="flex items-center justify-between px-3 py-2 text-sm">
                <div>
                  <p>{i.invitedEmail}</p>
                  <p className="text-xs text-neutral-500">
                    {i.role} · expires {new Date(i.expiresAt).toLocaleDateString()}
                  </p>
                </div>
                <button
                  onClick={() => revoke.mutate(i.id)}
                  className="rounded border border-neutral-700 px-2 py-1 text-xs hover:bg-neutral-800"
                >
                  Revoke
                </button>
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
    <form onSubmit={submit} className="rounded border border-neutral-800 p-3 text-sm">
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-400">
        Invite member
      </h3>
      <div className="flex items-end gap-2">
        <label className="flex-1">
          <span className="mb-1 block text-xs text-neutral-400">Email</span>
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
          <code className="mt-1 block break-all rounded bg-neutral-950 p-1 text-[11px]">{shareUrl}</code>
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

function LibrariesTab({ slug }: { slug: string }) {
  const qc = useQueryClient();
  const libs = useQuery({
    queryKey: ['org-part-libraries', slug],
    queryFn: () => api.orgLibraries.list(slug),
  });
  const toggle = useMutation({
    mutationFn: ({ libraryId, enabled }: { libraryId: string; enabled: boolean }) =>
      api.orgLibraries.set(slug, libraryId, enabled),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['org-part-libraries', slug] }),
  });
  const reset = useMutation({
    mutationFn: (libraryId: string) => api.orgLibraries.reset(slug, libraryId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['org-part-libraries', slug] }),
  });

  if (libs.isLoading) return <p className="text-sm text-neutral-500">Loading…</p>;
  if (!libs.data || libs.data.libraries.length === 0) {
    return (
      <p className="text-sm text-neutral-500">
        No part libraries installed. Ask a platform admin to install libraries.
      </p>
    );
  }

  return (
    <div className="overflow-auto rounded border border-neutral-800">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-neutral-800 text-left text-xs text-neutral-500">
            <th className="px-3 py-2">Library</th>
            <th className="px-3 py-2">Parts</th>
            <th className="px-3 py-2">Enabled</th>
            <th className="px-3 py-2">Override</th>
          </tr>
        </thead>
        <tbody>
          {libs.data.libraries.map((lib: OrgPartLibrary) => (
            <tr key={lib.id} className="border-b border-neutral-900 hover:bg-neutral-900/30">
              <td className="px-3 py-2">
                <span className="font-medium">{lib.name}</span>
                <span className="ml-2 font-mono text-xs text-neutral-500">{lib.slug}</span>
                {lib.locked && (
                  <span className="ml-2 rounded bg-neutral-800 px-1.5 py-0.5 text-[10px] text-neutral-400" title="This library is always enabled and cannot be disabled">
                    locked
                  </span>
                )}
              </td>
              <td className="px-3 py-2 text-neutral-400">{lib.partCount.toLocaleString()}</td>
              <td className="px-3 py-2">
                <input
                  type="checkbox"
                  checked={lib.enabled}
                  disabled={lib.locked}
                  onChange={(e) => !lib.locked && toggle.mutate({ libraryId: lib.id, enabled: e.target.checked })}
                  className="accent-blue-500 disabled:opacity-40"
                  title={lib.locked ? 'This library is always enabled' : undefined}
                />
              </td>
              <td className="px-3 py-2">
                {lib.locked ? (
                  <span className="text-xs text-neutral-600">always on</span>
                ) : lib.explicitOverride ? (
                  <button
                    onClick={() => reset.mutate(lib.id)}
                    className="text-xs text-neutral-400 hover:underline"
                    title={`Revert to default (${lib.defaultEnabled ? 'enabled' : 'disabled'})`}
                  >
                    Reset to default
                  </button>
                ) : (
                  <span className="text-xs text-neutral-600">
                    default ({lib.defaultEnabled ? 'on' : 'off'})
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function OrgCustomPartsTab({ slug, orgId }: { slug: string; orgId: string }) {
  const qc = useQueryClient();
  const [showUpload, setShowUpload] = useState(false);
  const all = useQuery({ queryKey: ['custom-parts'], queryFn: api.customParts.list });
  const parts = (all.data?.parts ?? []).filter((p) => p.ownerOrgId === orgId);

  const remove = useMutation({
    mutationFn: api.customParts.remove,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['custom-parts'] });
      qc.invalidateQueries({ queryKey: ['parts-catalog'] });
    },
  });

  if (all.isLoading) return <p className="text-sm text-neutral-500">Loading…</p>;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-neutral-500">
          Parts owned by this organisation are visible to all members in the parts panel.
        </p>
        <button
          onClick={() => setShowUpload(true)}
          className="rounded border border-neutral-700 px-3 py-1 text-sm hover:bg-neutral-800"
        >
          Upload part
        </button>
      </div>
      {parts.length === 0 ? (
        <p className="rounded border border-dashed border-neutral-800 p-4 text-sm text-neutral-500">
          No custom parts yet.
        </p>
      ) : (
        <ul className="grid grid-cols-2 gap-2 md:grid-cols-3">
          {parts.map((p) => (
            <li
              key={p.id}
              className="flex flex-col items-center rounded border border-neutral-800 p-2 text-xs"
            >
              <img
                src={api.customParts.spriteUrl(p.id)}
                alt=""
                className="h-16 w-16 object-contain"
                loading="lazy"
              />
              <p className="mt-1 line-clamp-1 font-mono">{p.partNumber}</p>
              <p className="line-clamp-1 text-neutral-500">{p.displayName}</p>
              <button
                onClick={() => {
                  if (confirm(`Delete "${p.partNumber}"?`)) remove.mutate(p.id);
                }}
                className="mt-1 text-[10px] text-red-400 hover:underline"
              >
                delete
              </button>
            </li>
          ))}
        </ul>
      )}
      {showUpload && (
        <OrgUploadPartDialog
          slug={slug}
          onClose={() => { setShowUpload(false); qc.invalidateQueries({ queryKey: ['custom-parts'] }); }}
        />
      )}
    </div>
  );
}

function OrgUploadPartDialog({ slug, onClose }: { slug: string; onClose: () => void }) {
  const catalog = useQuery({ queryKey: ['parts-catalog'], queryFn: api.parts.catalog, staleTime: 5 * 60 * 1000 });
  const [partNumber, setPartNumber] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [category, setCategory] = useState('Custom');
  const [xmlText, setXmlText] = useState('');
  const [spriteFile, setSpriteFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const qc = useQueryClient();

  const existingCategories = Array.from(
    new Set((catalog.data?.parts ?? []).map((p) => p.category || 'Custom').filter(Boolean))
  ).sort();

  const create = useMutation({
    mutationFn: api.customParts.create,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['custom-parts'] });
      qc.invalidateQueries({ queryKey: ['parts-catalog'] });
      onClose();
    },
    onError: (e: Error) => setError(e.message),
  });

  async function pickXml(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setXmlText(await file.text());
    if (!partNumber) setPartNumber(file.name.replace(/\.xml$/i, ''));
  }

  function pickSprite(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setSpriteFile(file);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!xmlText) return setError('XML payload required');
    if (!spriteFile) return setError('Sprite required');
    const mime: 'image/gif' | 'image/png' =
      spriteFile.type === 'image/png' ? 'image/png' : 'image/gif';
    const xmlBase64 = btoa(xmlText);
    const buf = await spriteFile.arrayBuffer();
    const bytes = new Uint8Array(buf);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]!);
    const spriteBase64 = btoa(binary);
    create.mutate({
      partNumber: partNumber.trim(),
      displayName: displayName.trim(),
      category: category.trim() || 'Custom',
      xmlBase64,
      spriteBase64,
      spriteMime: mime,
      orgSlug: slug,
    });
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4">
      <form
        onSubmit={submit}
        className="w-full max-w-md space-y-3 rounded-lg border border-neutral-800 bg-neutral-900 p-6 text-sm"
      >
        <h3 className="text-lg font-semibold">Upload org custom part</h3>

        <label className="block">
          <span className="mb-1 block text-neutral-400">Part number</span>
          <input
            value={partNumber}
            onChange={(e) => setPartNumber(e.target.value)}
            required
            className="w-full rounded border border-neutral-700 bg-neutral-800 px-3 py-2"
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-neutral-400">Display name</span>
          <input
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            required
            className="w-full rounded border border-neutral-700 bg-neutral-800 px-3 py-2"
          />
        </label>

        <CategoryPicker
          categories={existingCategories}
          value={category}
          onChange={setCategory}
        />

        <label className="block">
          <span className="mb-1 block text-neutral-400">Part XML</span>
          <input type="file" accept=".xml,application/xml,text/xml" onChange={pickXml} required />
        </label>

        <label className="block">
          <span className="mb-1 block text-neutral-400">Sprite (gif or png)</span>
          <input type="file" accept="image/gif,image/png" onChange={pickSprite} required />
        </label>

        {error && <p className="text-xs text-red-400">{error}</p>}

        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-neutral-700 px-4 py-2 hover:bg-neutral-800"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={create.isPending}
            className="rounded bg-blue-600 px-4 py-2 hover:bg-blue-500 disabled:opacity-50"
          >
            Upload
          </button>
        </div>
      </form>
    </div>
  );
}

function OrgModulesTab({ slug, orgId }: { slug: string; orgId: string }) {
  const qc = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const all = useQuery({ queryKey: ['modules'], queryFn: api.modules.list });
  const modules = (all.data?.modules ?? []).filter((m) => m.ownerOrgId === orgId);

  const remove = useMutation({
    mutationFn: api.modules.remove,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['modules'] }),
  });

  if (all.isLoading) return <p className="text-sm text-neutral-500">Loading…</p>;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-neutral-500">
          Modules owned by this organisation are shared with all members.
        </p>
        <button
          onClick={() => setShowCreate(true)}
          className="rounded border border-neutral-700 px-3 py-1 text-sm hover:bg-neutral-800"
        >
          New module
        </button>
      </div>
      {modules.length === 0 ? (
        <p className="rounded border border-dashed border-neutral-800 p-4 text-sm text-neutral-500">
          No modules yet.
        </p>
      ) : (
        <ul className="divide-y divide-neutral-800 rounded border border-neutral-800">
          {modules.map((m) => (
            <li key={m.id} className="flex items-center justify-between px-3 py-2 text-sm">
              <div>
                <p>{m.title}</p>
                <p className="text-xs text-neutral-500">
                  v{m.docVersion} · updated {new Date(m.updatedAt).toLocaleString()}
                </p>
              </div>
              <button
                onClick={() => {
                  if (confirm(`Delete "${m.title}"?`)) remove.mutate(m.id);
                }}
                className="rounded border border-red-900 px-2 py-1 text-xs text-red-400 hover:bg-red-950"
              >
                Delete
              </button>
            </li>
          ))}
        </ul>
      )}
      {showCreate && (
        <OrgNewModuleDialog
          slug={slug}
          onClose={() => { setShowCreate(false); qc.invalidateQueries({ queryKey: ['modules'] }); }}
        />
      )}
    </div>
  );
}

function OrgNewModuleDialog({ slug, onClose }: { slug: string; onClose: () => void }) {
  const qc = useQueryClient();
  const [title, setTitle] = useState('');
  const [error, setError] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: api.modules.create,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['modules'] });
      onClose();
    },
    onError: (e: Error) => setError(e.message),
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    create.mutate({
      ...(title.trim() ? { title: title.trim() } : {}),
      orgSlug: slug,
    });
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4">
      <form
        onSubmit={submit}
        className="w-full max-w-md space-y-3 rounded-lg border border-neutral-800 bg-neutral-900 p-6 text-sm"
      >
        <h3 className="text-lg font-semibold">New org module</h3>
        <label className="block">
          <span className="mb-1 block text-neutral-400">Title</span>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Untitled Module"
            className="w-full rounded border border-neutral-700 bg-neutral-800 px-3 py-2"
          />
        </label>
        {error && <p className="text-xs text-red-400">{error}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-neutral-700 px-4 py-2 hover:bg-neutral-800"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={create.isPending}
            className="rounded bg-blue-600 px-4 py-2 hover:bg-blue-500 disabled:opacity-50"
          >
            Create
          </button>
        </div>
      </form>
    </div>
  );
}

function AuditTab({ slug }: { slug: string }) {
  const log = useQuery({
    queryKey: ['org-audit', slug],
    queryFn: () => api.audit.forOrg(slug),
  });
  if (log.isLoading) return <p className="text-sm text-neutral-500">Loading…</p>;
  if (log.error) return <p className="text-sm text-red-400">Failed to load audit log.</p>;
  if (!log.data || log.data.events.length === 0) {
    return <p className="text-sm text-neutral-500">No audit events yet.</p>;
  }
  return (
    <div className="overflow-auto rounded border border-neutral-800">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-neutral-800 text-left text-neutral-500">
            <th className="px-3 py-2">Time</th>
            <th className="px-3 py-2">Event</th>
            <th className="px-3 py-2">User</th>
            <th className="px-3 py-2">Layout</th>
            <th className="px-3 py-2">Details</th>
          </tr>
        </thead>
        <tbody>
          {log.data.events.map((e: AuditEventSummary) => (
            <tr key={e.id} className="border-b border-neutral-900 hover:bg-neutral-900/40">
              <td className="px-3 py-1.5 text-neutral-400">{new Date(e.createdAt).toLocaleString()}</td>
              <td className="px-3 py-1.5">{e.eventType}</td>
              <td className="px-3 py-1.5 text-neutral-400">{e.userName ?? e.userId ?? '—'}</td>
              <td className="px-3 py-1.5 font-mono text-neutral-400">{e.layoutId ?? '—'}</td>
              <td className="px-3 py-1.5">
                <details>
                  <summary className="cursor-pointer text-neutral-500">view</summary>
                  <pre className="mt-1 max-w-xs overflow-auto whitespace-pre-wrap text-neutral-300">
                    {JSON.stringify(e.payload, null, 2)}
                  </pre>
                </details>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

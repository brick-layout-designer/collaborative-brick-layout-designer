// Platform-admin page — only mounted when `me.user.isGlobalAdmin === true`.
// Tabs:
//   - Dashboard: aggregate counts
//   - Users:     list + search + grant/revoke admin + revoke-sessions + delete
//   - Orgs:      list + search + delete
//   - Layouts:   list + search + delete (works across users)
//   - Parts:     manage global parts library (visible to all users)
//   - Audit:     full platform audit log (paginated)
//   - Settings:  email verification requirement + SMTP config
//
// Every mutation routes through `/api/admin/*` and is audited server-side.

import { useRef, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { AppHeader } from '../AppHeader';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type AdminGlobalPart, type AdminAuditEvent, type AdminSettings, type PartLibrary, type RemotePackage, type OrgSummary } from '../api';
import { CategoryPicker } from '../library/LibraryPage';

type Tab = 'dashboard' | 'users' | 'orgs' | 'layouts' | 'parts' | 'libraries' | 'audit' | 'settings';

export function AdminPage() {
  const me = useQuery({ queryKey: ['me'], queryFn: api.me });
  const [tab, setTab] = useState<Tab>('dashboard');

  if (me.isLoading) return <Loading />;
  if (!me.data?.user) return <Navigate to="/login" replace />;
  if (!me.data.user.isGlobalAdmin) return <Forbidden />;

  return (
    <div className="h-full overflow-y-auto bg-neutral-950 p-8 text-neutral-100">
      <AppHeader user={me.data.user} />
      <div className="mt-6">
        <h1 className="text-base font-semibold">
          Platform admin
          <span className="ml-2 rounded bg-amber-900/40 px-2 py-0.5 text-xs text-amber-300">
            Restricted
          </span>
        </h1>
      </div>
      <nav className="mt-2 flex border-b border-neutral-800 text-sm">
        {(['dashboard', 'users', 'orgs', 'layouts', 'parts', 'libraries', 'audit', 'settings'] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={
              'border-b-2 px-3 py-2 capitalize ' +
              (tab === t
                ? 'border-blue-500 text-white'
                : 'border-transparent text-neutral-400 hover:text-neutral-200')
            }
          >
            {t}
          </button>
        ))}
      </nav>
      <main className="mt-6">
        {tab === 'dashboard' && <Dashboard />}
        {tab === 'users' && <UsersTab selfId={me.data.user.id} />}
        {tab === 'orgs' && <OrgsTab />}
        {tab === 'layouts' && <LayoutsTab />}
        {tab === 'parts' && <GlobalPartsTab />}
        {tab === 'libraries' && <PartLibrariesTab />}
        {tab === 'audit' && <AuditTab />}
        {tab === 'settings' && <SettingsTab />}
      </main>
    </div>
  );
}

function Dashboard() {
  const stats = useQuery({ queryKey: ['admin-stats'], queryFn: api.admin.stats });
  if (stats.isLoading) return <Loading />;
  if (!stats.data) return <p className="text-sm text-neutral-500">No stats available.</p>;
  const tiles: { label: string; value: number; sub?: string }[] = [
    { label: 'Users', value: stats.data.users, sub: `${stats.data.demoUsers} demo · ${stats.data.globalAdmins} admin` },
    { label: 'Active sessions', value: stats.data.activeSessions },
    { label: 'Organizations', value: stats.data.orgs },
    { label: 'Layouts', value: stats.data.layouts },
    { label: 'Custom parts', value: stats.data.customParts },
    { label: 'Saved modules', value: stats.data.modules },
  ];
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {tiles.map((t) => (
        <div
          key={t.label}
          className="rounded-lg border border-neutral-800 bg-neutral-900 p-4"
        >
          <p className="text-xs uppercase tracking-wider text-neutral-500">{t.label}</p>
          <p className="mt-1 text-3xl font-semibold tabular-nums">{t.value.toLocaleString()}</p>
          {t.sub && <p className="mt-1 text-xs text-neutral-500">{t.sub}</p>}
        </div>
      ))}
    </div>
  );
}

function UsersTab({ selfId }: { selfId: string }) {
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const [offset, setOffset] = useState(0);
  const limit = 50;
  const list = useQuery({
    queryKey: ['admin-users', q, offset, limit],
    queryFn: () => api.admin.users({ q, offset, limit }),
  });

  const patchAdmin = useMutation({
    mutationFn: ({ id, isGlobalAdmin }: { id: string; isGlobalAdmin: boolean }) =>
      api.admin.patchUser(id, { isGlobalAdmin }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-users'] }),
  });
  const patchDemo = useMutation({
    mutationFn: ({ id, isDemoAccount }: { id: string; isDemoAccount: boolean }) =>
      api.admin.patchUser(id, { isDemoAccount }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-users'] }),
  });
  const revokeSessions = useMutation({
    mutationFn: (id: string) => api.admin.revokeUserSessions(id),
  });
  const removeUser = useMutation({
    mutationFn: (id: string) => api.admin.deleteUser(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-users'] }),
  });

  return (
    <section>
      <Toolbar
        q={q}
        setQ={(v) => {
          setQ(v);
          setOffset(0);
        }}
        total={list.data?.total ?? 0}
        offset={offset}
        limit={limit}
        setOffset={setOffset}
        placeholder="Search by email or name…"
      />
      {list.isLoading ? (
        <Loading />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-neutral-800">
          <table className="w-full text-sm">
            <thead className="bg-neutral-900 text-left text-xs uppercase tracking-wider text-neutral-500">
              <tr>
                <Th>Email</Th>
                <Th>Name</Th>
                <Th>Created</Th>
                <Th>Demo</Th>
                <Th>Admin</Th>
                <Th align="right">Actions</Th>
              </tr>
            </thead>
            <tbody>
              {list.data?.users.map((u) => {
                const isSelf = u.id === selfId;
                return (
                  <tr key={u.id} className="border-t border-neutral-800">
                    <Td>{u.email}</Td>
                    <Td>{u.displayName}</Td>
                    <Td>{new Date(u.createdAt).toLocaleDateString()}</Td>
                    <Td>
                      <input
                        type="checkbox"
                        checked={u.isDemoAccount}
                        onChange={(e) =>
                          patchDemo.mutate({ id: u.id, isDemoAccount: e.target.checked })
                        }
                      />
                    </Td>
                    <Td>
                      <input
                        type="checkbox"
                        checked={u.isGlobalAdmin}
                        disabled={isSelf}
                        title={isSelf ? "You can't demote yourself" : ''}
                        onChange={(e) =>
                          patchAdmin.mutate({ id: u.id, isGlobalAdmin: e.target.checked })
                        }
                      />
                    </Td>
                    <Td align="right">
                      <div className="flex justify-end gap-1 text-xs">
                        <button
                          onClick={() => {
                            if (confirm(`Revoke ALL sessions for ${u.email}?`)) {
                              revokeSessions.mutate(u.id);
                            }
                          }}
                          className="rounded border border-neutral-700 px-2 py-0.5 hover:bg-neutral-800"
                        >
                          Sign out
                        </button>
                        <button
                          disabled={isSelf}
                          onClick={() => {
                            if (
                              confirm(
                                `Delete ${u.email}? This cascades to their layouts/parts/modules and CANNOT be undone.`,
                              )
                            ) {
                              removeUser.mutate(u.id);
                            }
                          }}
                          className="rounded border border-red-900 px-2 py-0.5 text-red-300 hover:bg-red-900/40 disabled:opacity-30"
                        >
                          Delete
                        </button>
                      </div>
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function OrgsTab() {
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const [offset, setOffset] = useState(0);
  const limit = 50;
  const list = useQuery({
    queryKey: ['admin-orgs', q, offset, limit],
    queryFn: () => api.admin.orgs({ q, offset, limit }),
  });
  const removeOrg = useMutation({
    mutationFn: (id: string) => api.admin.deleteOrg(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-orgs'] }),
  });
  return (
    <section>
      <Toolbar
        q={q}
        setQ={(v) => {
          setQ(v);
          setOffset(0);
        }}
        total={list.data?.total ?? 0}
        offset={offset}
        limit={limit}
        setOffset={setOffset}
        placeholder="Search by name or slug…"
      />
      {list.isLoading ? (
        <Loading />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-neutral-800">
          <table className="w-full text-sm">
            <thead className="bg-neutral-900 text-left text-xs uppercase tracking-wider text-neutral-500">
              <tr>
                <Th>Name</Th>
                <Th>Slug</Th>
                <Th>Members</Th>
                <Th>Created</Th>
                <Th align="right">Actions</Th>
              </tr>
            </thead>
            <tbody>
              {list.data?.orgs.map((o) => (
                <tr key={o.id} className="border-t border-neutral-800">
                  <Td>{o.name}</Td>
                  <Td>{o.slug}</Td>
                  <Td>{o.memberCount}</Td>
                  <Td>{new Date(o.createdAt).toLocaleDateString()}</Td>
                  <Td align="right">
                    <button
                      onClick={() => {
                        if (
                          confirm(
                            `Delete org "${o.name}"? Cascades to layouts/parts/modules owned by the org.`,
                          )
                        ) {
                          removeOrg.mutate(o.id);
                        }
                      }}
                      className="rounded border border-red-900 px-2 py-0.5 text-xs text-red-300 hover:bg-red-900/40"
                    >
                      Delete
                    </button>
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function LayoutsTab() {
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const [offset, setOffset] = useState(0);
  const limit = 50;
  const list = useQuery({
    queryKey: ['admin-layouts', q, offset, limit],
    queryFn: () => api.admin.layouts({ q, offset, limit }),
  });
  const removeLayout = useMutation({
    mutationFn: (id: string) => api.admin.deleteLayout(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-layouts'] }),
  });
  return (
    <section>
      <Toolbar
        q={q}
        setQ={(v) => {
          setQ(v);
          setOffset(0);
        }}
        total={list.data?.total ?? 0}
        offset={offset}
        limit={limit}
        setOffset={setOffset}
        placeholder="Search by title…"
      />
      {list.isLoading ? (
        <Loading />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-neutral-800">
          <table className="w-full text-sm">
            <thead className="bg-neutral-900 text-left text-xs uppercase tracking-wider text-neutral-500">
              <tr>
                <Th>Title</Th>
                <Th>Owner</Th>
                <Th>Updated</Th>
                <Th>Doc v</Th>
                <Th>Expires</Th>
                <Th align="right">Actions</Th>
              </tr>
            </thead>
            <tbody>
              {list.data?.layouts.map((l) => (
                <tr key={l.id} className="border-t border-neutral-800">
                  <Td>
                    <Link to={`/edit/${l.id}`} className="text-blue-400 hover:underline">
                      {l.title}
                    </Link>
                  </Td>
                  <Td className="font-mono text-xs text-neutral-500">
                    {l.ownerOrgId ? `org:${l.ownerOrgId.slice(0, 8)}` : `user:${(l.ownerUserId ?? 'demo').slice(0, 8)}`}
                  </Td>
                  <Td>{new Date(l.updatedAt).toLocaleString()}</Td>
                  <Td>{l.docVersion}</Td>
                  <Td>{l.expiresAt ? new Date(l.expiresAt).toLocaleDateString() : '—'}</Td>
                  <Td align="right">
                    <button
                      onClick={() => {
                        if (confirm(`Delete layout "${l.title}"?`)) {
                          removeLayout.mutate(l.id);
                        }
                      }}
                      className="rounded border border-red-900 px-2 py-0.5 text-xs text-red-300 hover:bg-red-900/40"
                    >
                      Delete
                    </button>
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function Toolbar({
  q,
  setQ,
  total,
  offset,
  limit,
  setOffset,
  placeholder,
}: {
  q: string;
  setQ: (v: string) => void;
  total: number;
  offset: number;
  limit: number;
  setOffset: (n: number) => void;
  placeholder: string;
}) {
  const start = total === 0 ? 0 : offset + 1;
  const end = Math.min(offset + limit, total);
  return (
    <div className="mb-3 flex items-center gap-3">
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={placeholder}
        className="w-72 rounded border border-neutral-700 bg-neutral-900 px-3 py-1.5 text-sm"
      />
      <span className="text-xs text-neutral-500">
        {start}–{end} of {total.toLocaleString()}
      </span>
      <div className="ml-auto flex items-center gap-1">
        <button
          onClick={() => setOffset(Math.max(0, offset - limit))}
          disabled={offset === 0}
          className="rounded border border-neutral-700 px-2 py-1 text-xs hover:bg-neutral-800 disabled:opacity-30"
        >
          Prev
        </button>
        <button
          onClick={() => setOffset(offset + limit)}
          disabled={end >= total}
          className="rounded border border-neutral-700 px-2 py-1 text-xs hover:bg-neutral-800 disabled:opacity-30"
        >
          Next
        </button>
      </div>
    </div>
  );
}

function Th({ children, align }: { children: React.ReactNode; align?: 'right' }) {
  return (
    <th className={'px-3 py-2 ' + (align === 'right' ? 'text-right' : '')}>{children}</th>
  );
}

function Td({ children, align, className }: { children: React.ReactNode; align?: 'right'; className?: string }) {
  return (
    <td
      className={
        'px-3 py-2 ' + (align === 'right' ? 'text-right ' : '') + (className ?? '')
      }
    >
      {children}
    </td>
  );
}

// ---------------------------------------------------------------------------
// Global Parts tab
// ---------------------------------------------------------------------------

function GlobalPartsTab() {
  const qc = useQueryClient();
  const parts = useQuery({ queryKey: ['admin-global-parts'], queryFn: api.admin.globalParts });
  const catalog = useQuery({ queryKey: ['parts-catalog'], queryFn: api.parts.catalog, staleTime: 5 * 60 * 1000 });
  const orgs = useQuery({ queryKey: ['orgs'], queryFn: api.orgs.list });
  const existingCategories = Array.from(
    new Set((catalog.data?.parts ?? []).map((p) => p.category || 'Custom').filter(Boolean))
  ).sort();

  // Upload form state
  const [form, setForm] = useState({
    partNumber: '',
    displayName: '',
    category: 'Custom',
    orgSlug: '',
  });
  const xmlRef = useRef<HTMLInputElement>(null);
  const spriteRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadErr, setUploadErr] = useState('');

  function invalidateAll() {
    qc.invalidateQueries({ queryKey: ['admin-global-parts'] });
    qc.invalidateQueries({ queryKey: ['parts-catalog'] });
    qc.invalidateQueries({ queryKey: ['custom-parts'] });
  }

  const deletePart = useMutation({
    mutationFn: (id: string) => api.admin.deleteGlobalPart(id),
    onSuccess: invalidateAll,
  });

  async function handleUpload(e: React.FormEvent) {
    e.preventDefault();
    setUploadErr('');
    const xmlFile = xmlRef.current?.files?.[0];
    if (!xmlFile) { setUploadErr('XML file required'); return; }
    const spriteFile = spriteRef.current?.files?.[0];
    if (!spriteFile) { setUploadErr('Sprite file required'); return; }
    if (!['image/gif', 'image/png'].includes(spriteFile.type)) {
      setUploadErr('Sprite must be a GIF or PNG'); return;
    }
    const spriteBytes = await spriteFile.arrayBuffer();
    const spriteBase64 = btoa(String.fromCharCode(...new Uint8Array(spriteBytes)));
    const xmlText = await xmlFile.text();
    const xmlBase64 = btoa(unescape(encodeURIComponent(xmlText)));
    setUploading(true);
    try {
      if (form.orgSlug) {
        // Route to org-owned custom part
        await api.customParts.create({
          partNumber: form.partNumber.trim(),
          displayName: form.displayName.trim(),
          category: form.category.trim() || 'Custom',
          xmlBase64,
          spriteBase64,
          spriteMime: spriteFile.type as 'image/gif' | 'image/png',
          orgSlug: form.orgSlug,
        });
      } else {
        await api.admin.createGlobalPart({
          partNumber: form.partNumber.trim(),
          displayName: form.displayName.trim(),
          category: form.category.trim() || 'Custom',
          xmlBase64,
          spriteBase64,
          spriteMime: spriteFile.type as 'image/gif' | 'image/png',
        });
      }
      setForm({ partNumber: '', displayName: '', category: 'Custom', orgSlug: '' });
      if (xmlRef.current) xmlRef.current.value = '';
      if (spriteRef.current) spriteRef.current.value = '';
      invalidateAll();
    } catch (err: unknown) {
      setUploadErr(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="space-y-8">
      <section>
        <h2 className="mb-3 text-sm font-semibold text-neutral-300">Upload global part</h2>
        <form onSubmit={handleUpload} className="space-y-3 rounded border border-neutral-800 p-4">
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1 text-xs text-neutral-400">
              Part number
              <input
                value={form.partNumber}
                onChange={(e) => setForm((f) => ({ ...f, partNumber: e.target.value }))}
                className="rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-neutral-100"
                required
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-neutral-400">
              Display name
              <input
                value={form.displayName}
                onChange={(e) => setForm((f) => ({ ...f, displayName: e.target.value }))}
                className="rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-neutral-100"
                required
              />
            </label>
            <div className="flex flex-col gap-1 text-xs text-neutral-400">
              <CategoryPicker
                categories={existingCategories}
                value={form.category}
                onChange={(v) => setForm((f) => ({ ...f, category: v }))}
              />
            </div>
            <label className="flex flex-col gap-1 text-xs text-neutral-400">
              Owner org (optional)
              <select
                value={form.orgSlug}
                onChange={(e) => setForm((f) => ({ ...f, orgSlug: e.target.value }))}
                className="rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-neutral-100"
              >
                <option value="">Global (all users)</option>
                {(orgs.data?.orgs ?? []).map((o: OrgSummary) => (
                  <option key={o.slug} value={o.slug}>{o.name}</option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs text-neutral-400">
              Part XML (.xml)
              <input ref={xmlRef} type="file" accept=".xml,application/xml,text/xml" required
                className="text-neutral-300" />
            </label>
            <label className="flex flex-col gap-1 text-xs text-neutral-400">
              Sprite file (.gif / .png)
              <input ref={spriteRef} type="file" accept="image/gif,image/png" required
                className="text-neutral-300" />
            </label>
          </div>
          {uploadErr && <p className="text-xs text-red-400">{uploadErr}</p>}
          <button
            type="submit"
            disabled={uploading}
            className="rounded bg-blue-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-600 disabled:opacity-50"
          >
            {uploading ? 'Uploading…' : 'Upload global part'}
          </button>
        </form>
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold text-neutral-300">
          Global parts ({parts.data?.parts.length ?? '…'})
        </h2>
        {parts.isLoading && <Loading />}
        {parts.data && parts.data.parts.length === 0 && (
          <p className="text-xs text-neutral-500">No global parts yet.</p>
        )}
        {parts.data && parts.data.parts.length > 0 && (
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-neutral-800 text-left text-neutral-500">
                <Th>Part #</Th><Th>Name</Th><Th>Category</Th><Th>Sprite</Th><Th>Added</Th><Th>{''}</Th>
              </tr>
            </thead>
            <tbody>
              {parts.data.parts.map((p: AdminGlobalPart) => (
                <tr key={p.id} className="border-b border-neutral-900 hover:bg-neutral-900/40">
                  <Td>{p.partNumber}</Td>
                  <Td>{p.displayName}</Td>
                  <Td>{p.category}</Td>
                  <Td>{p.spriteMime.split('/')[1]?.toUpperCase()}</Td>
                  <Td>{new Date(p.createdAt).toLocaleDateString()}</Td>
                  <Td>
                    <button
                      onClick={() => {
                        if (confirm(`Delete global part "${p.displayName}"?`)) {
                          deletePart.mutate(p.id);
                        }
                      }}
                      className="text-red-400 hover:underline"
                    >
                      Delete
                    </button>
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Part Libraries tab — mirrors desktop Download Center + Library Paths dialog.
// Three install paths:
//   1. Base library  — register the bundled BlueBrickParts (already on disk)
//   2. Download Center — search official/non-LEGO BlueBrick sources, checkbox
//                        list, one-click download + install (server-side proxy)
//   3. Manual        — upload a local zip, or paste a direct zip URL
// ---------------------------------------------------------------------------

const KNOWN_SOURCES = [
  {
    id: 'official',
    label: 'Official LEGO parts (bluebrick.lswproject.com)',
    hint: 'Lego, Baseplate, Train, Town, …',
  },
  {
    id: 'nonlego',
    label: 'Non-LEGO parts (BrickTracks, 4DBrix, TrixBrix, …)',
    hint: 'Community packs from the same BlueBrick host',
  },
] as const;

function PartLibrariesTab() {
  const qc = useQueryClient();
  const libs = useQuery({
    queryKey: ['admin-part-libraries'],
    queryFn: api.admin.partLibraries,
  });

  const installedSlugs = new Set(libs.data?.libraries.map((l) => l.slug) ?? []);

  // ── Base library ──────────────────────────────────────────────────────────
  const [baseStatus, setBaseStatus] = useState<'idle' | 'installing' | 'done' | 'err'>('idle');
  const [baseErr, setBaseErr] = useState('');
  const baseInstalled = installedSlugs.has('bluebrickparts');
  const baseDownloaded = installedSlugs.has('bluebrickparts-default');

  const [dlBaseStatus, setDlBaseStatus] = useState<'idle' | 'downloading' | 'done' | 'err'>('idle');
  const [dlBaseErr, setDlBaseErr] = useState('');

  async function installBase() {
    setBaseStatus('installing');
    setBaseErr('');
    try {
      await api.admin.installBaseLibrary();
      invalidateLibraries();
      setBaseStatus('done');
    } catch (e) {
      setBaseErr(e instanceof Error ? e.message : 'failed');
      setBaseStatus('err');
    }
  }

  async function downloadDefaultLibrary() {
    setDlBaseStatus('downloading');
    setDlBaseErr('');
    try {
      await api.admin.downloadPartLibrary({
        name: 'BlueBrickParts (default)',
        slug: 'bluebrickparts-default',
        sourceUrl: 'https://github.com/Lswbanban/BlueBrickParts/archive/refs/heads/master.zip',
        defaultEnabled: true,
      });
      invalidateLibraries();
      setDlBaseStatus('done');
    } catch (e) {
      setDlBaseErr(e instanceof Error ? e.message : 'download failed');
      setDlBaseStatus('err');
    }
  }

  // ── Download Center ───────────────────────────────────────────────────────
  type SourceId = typeof KNOWN_SOURCES[number]['id'] | 'custom';
  const [selectedSources, setSelectedSources] = useState<Set<SourceId>>(new Set(['official']));
  const [customUrl, setCustomUrl] = useState('');
  const [searchStatus, setSearchStatus] = useState<'idle' | 'searching' | 'done' | 'err'>('idle');
  const [searchErr, setSearchErr] = useState('');
  const [candidates, setCandidates] = useState<(RemotePackage & { checked: boolean; installing: boolean; installed: boolean; err: string })[]>([]);
  const [defaultEnabled, setDefaultEnabled] = useState(false);

  function toggleSource(id: SourceId) {
    setSelectedSources((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  async function handleSearch() {
    setSearchStatus('searching');
    setSearchErr('');
    setCandidates([]);

    const sources: string[] = [];
    if (selectedSources.has('official')) sources.push('official');
    if (selectedSources.has('nonlego')) sources.push('nonlego');
    if (selectedSources.has('custom') && customUrl.trim()) sources.push(customUrl.trim());

    if (sources.length === 0) {
      setSearchErr('Select at least one source.');
      setSearchStatus('err');
      return;
    }

    const all: (RemotePackage & { checked: boolean; installing: boolean; installed: boolean; err: string })[] = [];
    for (const src of sources) {
      try {
        const res = await api.admin.searchPartLibraries(src);
        for (const pkg of res.packages) {
          const slug = pkg.name.toLowerCase().replace(/[^a-z0-9-]/g, '-');
          all.push({ ...pkg, checked: false, installing: false, installed: installedSlugs.has(slug), err: '' });
        }
      } catch (e) {
        setSearchErr((prev) => (prev ? prev + '; ' : '') + (e instanceof Error ? e.message : `${src} failed`));
      }
    }

    setCandidates(all);
    setSearchStatus('done');
  }

  function toggleCandidate(idx: number) {
    setCandidates((prev) => prev.map((c, i) => i === idx ? { ...c, checked: !c.checked } : c));
  }

  async function handleDownloadSelected() {
    const toInstall = candidates.filter((c) => c.checked && !c.installed);
    if (toInstall.length === 0) return;

    for (const pkg of toInstall) {
      const slug = pkg.name.toLowerCase().replace(/[^a-z0-9-]/g, '-');
      setCandidates((prev) =>
        prev.map((c) => c.sourceUrl === pkg.sourceUrl ? { ...c, installing: true, err: '' } : c),
      );
      try {
        await api.admin.downloadPartLibrary({
          name: pkg.version ? `${pkg.name} (v${pkg.version})` : pkg.name,
          slug,
          sourceUrl: pkg.sourceUrl,
          defaultEnabled,
        });
        setCandidates((prev) =>
          prev.map((c) =>
            c.sourceUrl === pkg.sourceUrl
              ? { ...c, installing: false, installed: true, checked: false }
              : c,
          ),
        );
        invalidateLibraries();
      } catch (e) {
        setCandidates((prev) =>
          prev.map((c) =>
            c.sourceUrl === pkg.sourceUrl
              ? { ...c, installing: false, err: e instanceof Error ? e.message : 'failed' }
              : c,
          ),
        );
      }
    }
  }

  const anyDownloading = candidates.some((c) => c.installing);
  const anyChecked = candidates.some((c) => c.checked && !c.installed);

  // ── Manual install ────────────────────────────────────────────────────────
  const [manualForm, setManualForm] = useState({ name: '', slug: '', sourceUrl: '', defaultEnabled: false });
  const zipRef = useRef<HTMLInputElement>(null);
  const [manualMode, setManualMode] = useState<'url' | 'upload'>('url');
  const [manualInstalling, setManualInstalling] = useState(false);
  const [manualErr, setManualErr] = useState('');

  async function handleManualInstall(e: React.FormEvent) {
    e.preventDefault();
    setManualErr('');
    const name = manualForm.name.trim();
    const slug = manualForm.slug.trim();
    if (!name || !slug) { setManualErr('Name and slug are required'); return; }
    setManualInstalling(true);
    try {
      if (manualMode === 'url') {
        if (!manualForm.sourceUrl.trim()) { setManualErr('Source URL required'); return; }
        await api.admin.installPartLibrary({ name, slug, sourceUrl: manualForm.sourceUrl.trim(), defaultEnabled: manualForm.defaultEnabled });
      } else {
        const zipFile = zipRef.current?.files?.[0];
        if (!zipFile) { setManualErr('Zip file required'); return; }
        const zipBase64 = btoa(String.fromCharCode(...new Uint8Array(await zipFile.arrayBuffer())));
        await api.admin.installPartLibrary({ name, slug, zipBase64, defaultEnabled: manualForm.defaultEnabled });
      }
      setManualForm({ name: '', slug: '', sourceUrl: '', defaultEnabled: false });
      if (zipRef.current) zipRef.current.value = '';
      invalidateLibraries();
    } catch (err: unknown) {
      setManualErr(err instanceof Error ? err.message : 'Install failed');
    } finally {
      setManualInstalling(false);
    }
  }

  // ── Reload parts cache ───────────────────────────────────────────────────
  function invalidateLibraries() {
    qc.invalidateQueries({ queryKey: ['admin-part-libraries'] });
    qc.invalidateQueries({ queryKey: ['parts-catalog'] });
    qc.invalidateQueries({ queryKey: ['custom-parts'] });
    qc.invalidateQueries({ queryKey: ['org-part-libraries'] });
  }

  const reloadParts = useMutation({
    mutationFn: api.admin.reloadParts,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['parts-catalog'] });
      qc.invalidateQueries({ queryKey: ['custom-parts'] });
    },
  });

  // ── Installed list actions ────────────────────────────────────────────────
  const patchLib = useMutation({
    mutationFn: ({ id, body }: { id: string; body: { name?: string; defaultEnabled?: boolean; locked?: boolean } }) =>
      api.admin.patchPartLibrary(id, body),
    onSuccess: invalidateLibraries,
  });
  const updateLib = useMutation({
    mutationFn: (id: string) => api.admin.updatePartLibrary(id),
    onSuccess: invalidateLibraries,
  });
  const deleteLib = useMutation({
    mutationFn: (id: string) => api.admin.deletePartLibrary(id),
    onSuccess: invalidateLibraries,
  });

  return (
    <div className="space-y-8">

      {/* ── Base library ── */}
      <section className="rounded border border-neutral-800 p-4 space-y-4">

        {/* Register on-disk library */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-sm font-semibold text-neutral-300">BlueBrickParts base library</h2>
            <p className="mt-1 text-xs text-neutral-500">
              If the parts submodule is already on disk at <code className="text-neutral-400">PARTS_DIR</code>,
              this registers it so orgs can enable/disable it. No download needed.
            </p>
          </div>
          {baseInstalled ? (
            <span className="shrink-0 rounded bg-emerald-900/30 px-2 py-1 text-xs text-emerald-400">
              Installed
            </span>
          ) : (
            <button
              onClick={installBase}
              disabled={baseStatus === 'installing'}
              className="shrink-0 rounded bg-neutral-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-neutral-600 disabled:opacity-50"
            >
              {baseStatus === 'installing' ? 'Registering…' : 'Register on-disk library'}
            </button>
          )}
        </div>
        {baseStatus === 'err' && <p className="text-xs text-red-400">{baseErr}</p>}

        {/* Download from GitHub — only shown when the on-disk submodule isn't already registered */}
        {!baseInstalled && (
          <>
            <div className="flex items-start justify-between gap-4 border-t border-neutral-800 pt-4">
              <div>
                <h2 className="text-sm font-semibold text-neutral-300">Download BlueBrickParts from GitHub</h2>
                <p className="mt-1 text-xs text-neutral-500">
                  Downloads the latest{' '}
                  <span className="text-neutral-400">Lswbanban/BlueBrickParts</span> archive (~27 MB),
                  extracts it to <code className="text-neutral-400">PARTS_DIR/libraries/bluebrickparts-default/</code>,
                  and enables it for all orgs by default.
                </p>
              </div>
              {baseDownloaded ? (
                <span className="shrink-0 rounded bg-emerald-900/30 px-2 py-1 text-xs text-emerald-400">
                  Downloaded
                </span>
              ) : (
                <button
                  onClick={downloadDefaultLibrary}
                  disabled={dlBaseStatus === 'downloading'}
                  className="shrink-0 rounded bg-blue-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-600 disabled:opacity-50"
                >
                  {dlBaseStatus === 'downloading' ? 'Downloading…' : 'Download default library'}
                </button>
              )}
            </div>
            {dlBaseStatus === 'err' && <p className="text-xs text-red-400">{dlBaseErr}</p>}
            {dlBaseStatus === 'done' && <p className="text-xs text-emerald-400">Downloaded and installed successfully.</p>}
          </>
        )}

      </section>

      {/* ── Download Center ── */}
      <section>
        <h2 className="mb-1 text-sm font-semibold text-neutral-300">Download Center</h2>
        <p className="mb-3 text-xs text-neutral-500">
          Search the BlueBrick community package servers for additional part libraries (same sources as
          the desktop app). The server downloads and extracts the zip — no browser upload needed.
        </p>

        <div className="space-y-2 rounded border border-neutral-800 p-4">
          {/* Source selection */}
          <div className="space-y-1">
            {KNOWN_SOURCES.map((src) => (
              <label key={src.id} className="flex items-center gap-2 text-xs text-neutral-300">
                <input
                  type="checkbox"
                  checked={selectedSources.has(src.id)}
                  onChange={() => toggleSource(src.id)}
                  className="accent-blue-500"
                />
                <span>{src.label}</span>
                <span className="text-neutral-600">— {src.hint}</span>
              </label>
            ))}
            <label className="flex items-center gap-2 text-xs text-neutral-300">
              <input
                type="checkbox"
                checked={selectedSources.has('custom')}
                onChange={() => toggleSource('custom')}
                className="accent-blue-500"
              />
              <span>Custom URL</span>
              <input
                value={customUrl}
                onChange={(e) => setCustomUrl(e.target.value)}
                disabled={!selectedSources.has('custom')}
                placeholder="https://example.com/parts/"
                className="ml-1 flex-1 rounded border border-neutral-700 bg-neutral-900 px-2 py-0.5 text-xs disabled:opacity-40"
              />
            </label>
          </div>

          <div className="flex items-center gap-3 pt-1">
            <button
              onClick={handleSearch}
              disabled={searchStatus === 'searching'}
              className="rounded bg-neutral-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-neutral-600 disabled:opacity-50"
            >
              {searchStatus === 'searching' ? 'Searching…' : 'Search'}
            </button>
            {searchStatus === 'done' && (
              <span className="text-xs text-neutral-500">
                {candidates.length} package(s) found
                {candidates.filter((c) => c.installed).length > 0 &&
                  ` · ${candidates.filter((c) => c.installed).length} already installed`}
              </span>
            )}
            {searchErr && <span className="text-xs text-red-400">{searchErr}</span>}
          </div>

          {candidates.length > 0 && (
            <div className="mt-3 space-y-2">
              <div className="max-h-64 overflow-y-auto rounded border border-neutral-700">
                {candidates.map((pkg, idx) => (
                  <label
                    key={pkg.sourceUrl}
                    className={`flex items-center gap-2 border-b border-neutral-800 px-3 py-1.5 text-xs last:border-0 ${pkg.installed ? 'opacity-50' : 'cursor-pointer hover:bg-neutral-900/40'}`}
                  >
                    <input
                      type="checkbox"
                      checked={pkg.checked}
                      disabled={pkg.installed || pkg.installing}
                      onChange={() => toggleCandidate(idx)}
                      className="accent-blue-500"
                    />
                    <span className="flex-1 font-medium text-neutral-200">
                      {pkg.name}
                      {pkg.version && <span className="ml-1 text-neutral-500">v{pkg.version}</span>}
                    </span>
                    {pkg.installing && <span className="text-blue-400">Installing…</span>}
                    {pkg.installed && <span className="text-emerald-400">✓ installed</span>}
                    {pkg.err && <span className="text-red-400">{pkg.err}</span>}
                  </label>
                ))}
              </div>
              <div className="flex items-center gap-3">
                <label className="flex items-center gap-2 text-xs text-neutral-400">
                  <input
                    type="checkbox"
                    checked={defaultEnabled}
                    onChange={(e) => setDefaultEnabled(e.target.checked)}
                    className="accent-blue-500"
                  />
                  Enable for all orgs by default
                </label>
                <button
                  onClick={handleDownloadSelected}
                  disabled={!anyChecked || anyDownloading}
                  className="rounded bg-blue-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-600 disabled:opacity-50"
                >
                  {anyDownloading ? 'Installing…' : 'Download & Install selected'}
                </button>
              </div>
            </div>
          )}
        </div>
      </section>

      {/* ── Manual install ── */}
      <section>
        <h2 className="mb-1 text-sm font-semibold text-neutral-300">Manual install</h2>
        <p className="mb-3 text-xs text-neutral-500">
          Install from a direct zip URL or upload a local file. Use this for private or unlisted library zips.
        </p>
        <div className="mb-3 flex gap-2">
          {(['url', 'upload'] as const).map((mode) => (
            <button
              key={mode}
              onClick={() => setManualMode(mode)}
              className={`rounded px-3 py-1 text-xs ${manualMode === mode ? 'bg-blue-700 text-white' : 'border border-neutral-700 text-neutral-400 hover:bg-neutral-800'}`}
            >
              {mode === 'url' ? 'From URL' : 'Upload zip'}
            </button>
          ))}
        </div>
        <form onSubmit={handleManualInstall} className="space-y-3 rounded border border-neutral-800 p-4">
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1 text-xs text-neutral-400">
              Library name
              <input
                value={manualForm.name}
                onChange={(e) => setManualForm((f) => ({ ...f, name: e.target.value }))}
                className="rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-neutral-100"
                placeholder="My Parts Pack"
                required
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-neutral-400">
              Slug (unique, URL-safe)
              <input
                value={manualForm.slug}
                onChange={(e) => setManualForm((f) => ({ ...f, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-') }))}
                className="rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-neutral-100"
                placeholder="my-parts-pack"
                required
              />
            </label>
            {manualMode === 'url' ? (
              <label className="col-span-2 flex flex-col gap-1 text-xs text-neutral-400">
                Direct zip URL
                <input
                  value={manualForm.sourceUrl}
                  onChange={(e) => setManualForm((f) => ({ ...f, sourceUrl: e.target.value }))}
                  className="rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-neutral-100"
                  placeholder="https://example.com/MyParts.zip"
                />
              </label>
            ) : (
              <label className="col-span-2 flex flex-col gap-1 text-xs text-neutral-400">
                Zip file
                <input ref={zipRef} type="file" accept=".zip,application/zip" required className="text-neutral-300" />
              </label>
            )}
            <label className="col-span-2 flex items-center gap-2 text-xs text-neutral-400">
              <input
                type="checkbox"
                checked={manualForm.defaultEnabled}
                onChange={(e) => setManualForm((f) => ({ ...f, defaultEnabled: e.target.checked }))}
                className="accent-blue-500"
              />
              Enable for all orgs by default
            </label>
          </div>
          {manualErr && <p className="text-xs text-red-400">{manualErr}</p>}
          <button
            type="submit"
            disabled={manualInstalling}
            className="rounded bg-blue-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-600 disabled:opacity-50"
          >
            {manualInstalling ? 'Installing…' : 'Install'}
          </button>
        </form>
      </section>

      {/* ── Installed list ── */}
      <section>
        <div className="mb-3 flex items-center justify-between gap-4">
          <h2 className="text-sm font-semibold text-neutral-300">
            Installed libraries ({libs.data?.libraries.length ?? '…'})
          </h2>
          <button
            onClick={() => reloadParts.mutate()}
            disabled={reloadParts.isPending}
            title="Rescan all part library directories without restarting the server"
            className="rounded border border-neutral-700 px-2 py-1 text-xs text-neutral-300 hover:bg-neutral-800 disabled:opacity-50"
          >
            {reloadParts.isPending ? 'Reloading…' : 'Reload parts'}
          </button>
        </div>
        {libs.isLoading && <Loading />}
        {libs.data && libs.data.libraries.length === 0 && (
          <p className="text-xs text-neutral-500">No part libraries installed yet.</p>
        )}
        {libs.data && libs.data.libraries.length > 0 && (
          <div className="overflow-x-auto rounded-lg border border-neutral-800">
            <table className="w-full text-xs">
              <thead className="bg-neutral-900 text-left text-neutral-500">
                <tr>
                  <Th>Name</Th><Th>Slug</Th><Th>Parts</Th><Th>Default on</Th><Th>Source</Th><Th>Path on disk</Th><Th>Installed</Th><Th align="right">Actions</Th>
                </tr>
              </thead>
              <tbody>
                {libs.data.libraries.map((lib: PartLibrary) => (
                  <tr key={lib.id} className="border-t border-neutral-800 hover:bg-neutral-900/40">
                    <Td>
                      {lib.name}
                      {lib.locked && (
                        <span className="ml-2 rounded bg-neutral-800 px-1.5 py-0.5 text-[10px] text-neutral-400" title="Always enabled for everyone — cannot be disabled by org admins">
                          locked
                        </span>
                      )}
                    </Td>
                    <Td className="font-mono text-neutral-400">{lib.slug}</Td>
                    <Td>{lib.partCount.toLocaleString()}</Td>
                    <Td>
                      <input
                        type="checkbox"
                        checked={lib.defaultEnabled}
                        disabled={lib.locked}
                        onChange={(e) => !lib.locked && patchLib.mutate({ id: lib.id, body: { defaultEnabled: e.target.checked } })}
                        className="accent-blue-500 disabled:opacity-40"
                        title={lib.locked ? 'Always enabled — cannot be changed' : 'Enable for all orgs by default'}
                      />
                    </Td>
                    <Td className="max-w-[16rem] truncate text-neutral-500">
                      {lib.sourceUrl ? (
                        <span title={lib.sourceUrl}>{lib.sourceUrl}</span>
                      ) : (
                        <span className="italic text-neutral-600">upload</span>
                      )}
                    </Td>
                    <Td className="max-w-[20rem] truncate font-mono text-[11px] text-neutral-500">
                      <span title={lib.diskPath}>{lib.diskPath}</span>
                    </Td>
                    <Td>{new Date(lib.installedAt).toLocaleDateString()}</Td>
                    <Td align="right">
                      <div className="flex items-center justify-end gap-3">
                        {lib.sourceUrl && (
                          <button
                            onClick={() => updateLib.mutate(lib.id)}
                            disabled={updateLib.isPending}
                            className="text-blue-400 hover:underline disabled:opacity-50"
                            title={`Re-download from ${lib.sourceUrl}`}
                          >
                            {updateLib.isPending ? 'Updating…' : 'Update'}
                          </button>
                        )}
                        <button
                          onClick={() => patchLib.mutate({ id: lib.id, body: { locked: !lib.locked } })}
                          className="text-neutral-400 hover:underline"
                          title={lib.locked ? 'Unlock — allow org admins to disable this library' : 'Lock — force this library on for all orgs'}
                        >
                          {lib.locked ? 'Unlock' : 'Lock'}
                        </button>
                        {!lib.locked && (
                          <button
                            onClick={() => {
                              if (confirm(`Delete library "${lib.name}"?\n\nThis removes the parts folder from disk and cannot be undone.`)) {
                                deleteLib.mutate(lib.id);
                              }
                            }}
                            className="text-red-400 hover:underline"
                          >
                            Delete
                          </button>
                        )}
                      </div>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Global Audit Log tab
// ---------------------------------------------------------------------------

const AUDIT_PAGE = 50;

function AuditTab() {
  const [offset, setOffset] = useState(0);
  const log = useQuery({
    queryKey: ['admin-audit', offset],
    queryFn: () => api.admin.auditLog({ limit: AUDIT_PAGE, offset }),
  });

  return (
    <div className="space-y-4">
      <h2 className="text-sm font-semibold text-neutral-300">Platform audit log</h2>
      {log.isLoading && <Loading />}
      {log.data && (
        <>
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-neutral-800 text-left text-neutral-500">
                <Th>Time</Th><Th>Event</Th><Th>User</Th><Th>Resource</Th><Th>Payload</Th>
              </tr>
            </thead>
            <tbody>
              {log.data.events.map((e: AdminAuditEvent) => (
                <tr key={e.id} className="border-b border-neutral-900 hover:bg-neutral-900/40">
                  <Td>{new Date(e.createdAt).toLocaleString()}</Td>
                  <Td>{e.eventType}</Td>
                  <Td>{e.userName ?? e.userId ?? '—'}</Td>
                  <Td className="font-mono text-[10px] text-neutral-500">{e.layoutId ?? (e.resourceKind ? `${e.resourceKind}:${e.resourceId}` : '—')}</Td>
                  <Td>
                    <details>
                      <summary className="cursor-pointer text-neutral-500">view</summary>
                      <pre className="mt-1 max-w-xs overflow-auto whitespace-pre-wrap text-neutral-300">
                        {JSON.stringify(e.payload, null, 2)}
                      </pre>
                    </details>
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="flex gap-3 text-xs text-neutral-400">
            <button
              disabled={offset === 0}
              onClick={() => setOffset(Math.max(0, offset - AUDIT_PAGE))}
              className="rounded border border-neutral-700 px-2 py-1 hover:bg-neutral-800 disabled:opacity-40"
            >
              ← Prev
            </button>
            <span className="py-1">
              {offset + 1}–{offset + (log.data.events.length)} of {log.data.total}
            </span>
            <button
              disabled={offset + AUDIT_PAGE >= log.data.total}
              onClick={() => setOffset(offset + AUDIT_PAGE)}
              className="rounded border border-neutral-700 px-2 py-1 hover:bg-neutral-800 disabled:opacity-40"
            >
              Next →
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function SettingsTab() {
  const qc = useQueryClient();
  const settings = useQuery({ queryKey: ['admin-settings'], queryFn: api.admin.settings });

  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'err'>('idle');
  const [saveErr, setSaveErr] = useState('');

  // Local draft state, seeded from the loaded settings and re-seeded
  // whenever a fresh fetch comes in (but not while the user is mid-edit
  // — `seeded` tracks whether we've initialised from this query result
  // yet, same "don't clobber an in-progress edit" concern as elsewhere
  // in this codebase, e.g. LayersPanel's layer-rename draft).
  const [seeded, setSeeded] = useState(false);
  const [requireVerification, setRequireVerification] = useState(true);
  const [smtpHost, setSmtpHost] = useState('');
  const [smtpPort, setSmtpPort] = useState('');
  const [smtpUser, setSmtpUser] = useState('');
  const [smtpFrom, setSmtpFrom] = useState('');
  const [smtpPass, setSmtpPass] = useState(''); // always starts blank — never echoed by the server
  const [smtpPassTouched, setSmtpPassTouched] = useState(false);

  if (settings.data && !seeded) {
    setSeeded(true);
    setRequireVerification(settings.data.requireEmailVerification);
    setSmtpHost(settings.data.smtp.host ?? '');
    setSmtpPort(settings.data.smtp.port?.toString() ?? '');
    setSmtpUser(settings.data.smtp.user ?? '');
    setSmtpFrom(settings.data.smtp.from ?? '');
  }

  const save = useMutation({
    mutationFn: () => {
      const port = smtpPort.trim() === '' ? null : Number.parseInt(smtpPort, 10);
      return api.admin.patchSettings({
        requireEmailVerification: requireVerification,
        smtpHost: smtpHost.trim() === '' ? null : smtpHost.trim(),
        smtpPort: Number.isNaN(port) ? null : port,
        smtpUser: smtpUser.trim() === '' ? null : smtpUser.trim(),
        smtpFrom: smtpFrom.trim() === '' ? null : smtpFrom.trim(),
        // Omit entirely if untouched — leaves the saved password as-is.
        // "" means the user cleared the field on purpose.
        ...(smtpPassTouched ? { smtpPass } : {}),
      });
    },
    onSuccess: () => {
      setSaveStatus('saved');
      setSmtpPass('');
      setSmtpPassTouched(false);
      qc.invalidateQueries({ queryKey: ['admin-settings'] });
      setTimeout(() => setSaveStatus('idle'), 2000);
    },
    onError: (e: Error) => {
      setSaveStatus('err');
      setSaveErr(e.message);
    },
  });

  if (settings.isLoading) return <Loading />;
  if (!settings.data) return <p className="text-sm text-neutral-500">Couldn't load settings.</p>;

  const usingDbSmtp = smtpHost.trim() !== '';

  return (
    <div className="max-w-xl space-y-8">
      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-neutral-300">Email verification</h2>
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={requireVerification}
            onChange={(e) => setRequireVerification(e.target.checked)}
          />
          <span>
            Require new email/password accounts to verify their email before signing in
            <span className="block text-xs text-neutral-500">
              Off: registration logs the user in immediately, matching pre-verification
              behaviour. Existing unverified accounts aren't retroactively marked verified —
              turning this off just stops enforcing the check.
            </span>
          </span>
        </label>
        {requireVerification && !settings.data.smtp.active && (
          <p className="rounded border border-amber-900 bg-amber-950/30 p-2 text-xs text-amber-300">
            No SMTP server is configured below (or in the environment) — verification links
            will only be written to the server log, not emailed.
          </p>
        )}
      </section>

      <section className="space-y-3">
        <div>
          <h2 className="text-sm font-semibold text-neutral-300">SMTP server</h2>
          <p className="text-xs text-neutral-500">
            Used for signup verification links and org/layout invite emails.{' '}
            {settings.data.smtp.source === 'database' && (
              <span className="text-emerald-400">Using the configuration below.</span>
            )}
            {settings.data.smtp.source === 'env' && (
              <span className="text-neutral-400">
                Using the deployment's environment variables — fill in a host below to override.
              </span>
            )}
            {settings.data.smtp.source === null && (
              <span className="text-amber-400">Not configured — links are logged, not emailed.</span>
            )}
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <label className="col-span-2 space-y-1 text-xs text-neutral-400">
            Host
            <input
              type="text"
              value={smtpHost}
              onChange={(e) => setSmtpHost(e.target.value)}
              placeholder="smtp.example.com"
              className="block w-full rounded border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-sm text-neutral-100"
            />
          </label>
          <label className="space-y-1 text-xs text-neutral-400">
            Port
            <input
              type="number"
              value={smtpPort}
              onChange={(e) => setSmtpPort(e.target.value)}
              placeholder="587"
              disabled={!usingDbSmtp}
              className="block w-full rounded border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-sm text-neutral-100 disabled:opacity-40"
            />
          </label>
          <label className="space-y-1 text-xs text-neutral-400">
            From address
            <input
              type="email"
              value={smtpFrom}
              onChange={(e) => setSmtpFrom(e.target.value)}
              placeholder="noreply@example.com"
              disabled={!usingDbSmtp}
              className="block w-full rounded border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-sm text-neutral-100 disabled:opacity-40"
            />
          </label>
          <label className="space-y-1 text-xs text-neutral-400">
            Username
            <input
              type="text"
              value={smtpUser}
              onChange={(e) => setSmtpUser(e.target.value)}
              disabled={!usingDbSmtp}
              className="block w-full rounded border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-sm text-neutral-100 disabled:opacity-40"
            />
          </label>
          <label className="space-y-1 text-xs text-neutral-400">
            Password
            <input
              type="password"
              value={smtpPass}
              onChange={(e) => { setSmtpPass(e.target.value); setSmtpPassTouched(true); }}
              disabled={!usingDbSmtp}
              placeholder={settings.data.smtp.passSet ? '•••••••• (set — leave blank to keep)' : '(not set)'}
              className="block w-full rounded border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-sm text-neutral-100 disabled:opacity-40"
            />
          </label>
        </div>
        {!usingDbSmtp && (
          <p className="text-xs text-neutral-500">Enter a host above to set a database-backed SMTP config.</p>
        )}
      </section>

      <div className="flex items-center gap-3">
        <button
          onClick={() => { setSaveStatus('saving'); setSaveErr(''); save.mutate(); }}
          disabled={save.isPending}
          className="rounded bg-blue-600 px-4 py-2 text-sm hover:bg-blue-500 disabled:opacity-50"
        >
          {save.isPending ? 'Saving…' : 'Save settings'}
        </button>
        {saveStatus === 'saved' && <span className="text-sm text-emerald-400">Saved.</span>}
        {saveStatus === 'err' && <span className="text-sm text-red-400">{saveErr}</span>}
      </div>
    </div>
  );
}

function Loading() {
  return <p className="text-sm text-neutral-500">Loading…</p>;
}

function Forbidden() {
  return (
    <div className="grid min-h-screen place-items-center text-neutral-400">
      <div className="rounded border border-red-900 bg-red-950/30 p-6 text-center">
        <p className="font-semibold text-red-300">Forbidden</p>
        <p className="mt-1 text-sm">This page is restricted to platform admins.</p>
        <Link to="/" className="mt-3 inline-block text-sm text-blue-400 hover:underline">
          ← Back to app
        </Link>
      </div>
    </div>
  );
}

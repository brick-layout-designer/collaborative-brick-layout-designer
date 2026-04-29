import { useState, type ChangeEvent, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type CustomPartSummary, type ModuleSummary } from '../api';

/**
 * /library page — combined view of custom parts (uploaded XML + sprite)
 * and saved modules. Both share the same ownership / sharing model so a
 * single page is simpler than two separate routes for v1.
 */
export function LibraryPage() {
  const me = useQuery({ queryKey: ['me'], queryFn: api.me });
  const parts = useQuery({ queryKey: ['custom-parts'], queryFn: api.customParts.list });
  const modules = useQuery({ queryKey: ['modules'], queryFn: api.modules.list });
  const [showPart, setShowPart] = useState(false);
  const [showModule, setShowModule] = useState(false);

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6">
      <div>
        <Link to="/" className="text-sm text-neutral-400 hover:underline">
          ← Layouts
        </Link>
        <h1 className="mt-1 text-xl font-semibold">Library</h1>
        <p className="text-sm text-neutral-500">
          Custom parts and saved modules. Same sharing rules as layouts.
        </p>
      </div>

      <section>
        <header className="flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-400">
            Custom parts
          </h2>
          {me.data?.user && !me.data.user.isDemoAccount && (
            <button
              onClick={() => setShowPart(true)}
              className="rounded border border-neutral-700 px-3 py-1 text-sm hover:bg-neutral-800"
            >
              Upload part
            </button>
          )}
        </header>
        <CustomPartsList parts={parts.data?.parts ?? []} loading={parts.isLoading} />
      </section>

      <section>
        <header className="flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-400">
            Saved modules
          </h2>
          {me.data?.user && (
            <button
              onClick={() => setShowModule(true)}
              className="rounded border border-neutral-700 px-3 py-1 text-sm hover:bg-neutral-800"
            >
              New module
            </button>
          )}
        </header>
        <ModulesList modules={modules.data?.modules ?? []} loading={modules.isLoading} />
      </section>

      {showPart && <UploadPartDialog onClose={() => setShowPart(false)} />}
      {showModule && <NewModuleDialog onClose={() => setShowModule(false)} />}
    </div>
  );
}

function CustomPartsList({
  parts,
  loading,
}: {
  parts: CustomPartSummary[];
  loading: boolean;
}) {
  const qc = useQueryClient();
  const remove = useMutation({
    mutationFn: api.customParts.remove,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['custom-parts'] }),
  });
  if (loading) return <p className="mt-2 text-sm text-neutral-500">Loading…</p>;
  if (parts.length === 0)
    return (
      <p className="mt-2 rounded border border-dashed border-neutral-800 p-4 text-sm text-neutral-500">
        No custom parts yet.
      </p>
    );
  return (
    <ul className="mt-2 grid grid-cols-2 gap-2 md:grid-cols-3">
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
  );
}

function ModulesList({
  modules,
  loading,
}: {
  modules: ModuleSummary[];
  loading: boolean;
}) {
  const qc = useQueryClient();
  const remove = useMutation({
    mutationFn: api.modules.remove,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['modules'] }),
  });
  if (loading) return <p className="mt-2 text-sm text-neutral-500">Loading…</p>;
  if (modules.length === 0)
    return (
      <p className="mt-2 rounded border border-dashed border-neutral-800 p-4 text-sm text-neutral-500">
        No saved modules yet.
      </p>
    );
  return (
    <ul className="mt-2 divide-y divide-neutral-800 rounded border border-neutral-800">
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
  );
}

function UploadPartDialog({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const orgs = useQuery({ queryKey: ['orgs'], queryFn: api.orgs.list });
  const [partNumber, setPartNumber] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [xmlText, setXmlText] = useState('');
  const [spriteFile, setSpriteFile] = useState<File | null>(null);
  const [ownerSlug, setOwnerSlug] = useState('');
  const [error, setError] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: api.customParts.create,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['custom-parts'] });
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
    const spriteBase64 = arrayBufferToBase64(buf);
    create.mutate({
      partNumber: partNumber.trim(),
      displayName: displayName.trim(),
      xmlBase64,
      spriteBase64,
      spriteMime: mime,
      ...(ownerSlug ? { orgSlug: ownerSlug } : {}),
    });
  }

  return (
    <div className="fixed inset-0 grid place-items-center bg-black/60 p-4">
      <form
        onSubmit={submit}
        className="w-full max-w-md space-y-3 rounded-lg border border-neutral-800 bg-neutral-900 p-6 text-sm"
      >
        <h3 className="text-lg font-semibold">Upload custom part</h3>

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

        {orgs.data && orgs.data.orgs.length > 0 && (
          <label className="block">
            <span className="mb-1 block text-neutral-400">Owner</span>
            <select
              value={ownerSlug}
              onChange={(e) => setOwnerSlug(e.target.value)}
              className="w-full rounded border border-neutral-700 bg-neutral-800 px-3 py-2"
            >
              <option value="">Personal (you)</option>
              {orgs.data.orgs.map((o) => (
                <option key={o.slug} value={o.slug}>
                  Org: {o.name}
                </option>
              ))}
            </select>
          </label>
        )}

        <label className="block">
          <span className="mb-1 block text-neutral-400">Part XML</span>
          <input
            type="file"
            accept=".xml,application/xml,text/xml"
            onChange={pickXml}
            required
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-neutral-400">Sprite (gif or png)</span>
          <input
            type="file"
            accept="image/gif,image/png"
            onChange={pickSprite}
            required
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
            Upload
          </button>
        </div>
      </form>
    </div>
  );
}

function NewModuleDialog({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const orgs = useQuery({ queryKey: ['orgs'], queryFn: api.orgs.list });
  const [title, setTitle] = useState('');
  const [ownerSlug, setOwnerSlug] = useState('');
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
      ...(ownerSlug ? { orgSlug: ownerSlug } : {}),
    });
  }

  return (
    <div className="fixed inset-0 grid place-items-center bg-black/60 p-4">
      <form
        onSubmit={submit}
        className="w-full max-w-md space-y-3 rounded-lg border border-neutral-800 bg-neutral-900 p-6 text-sm"
      >
        <h3 className="text-lg font-semibold">New module</h3>
        <label className="block">
          <span className="mb-1 block text-neutral-400">Title</span>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Untitled Module"
            className="w-full rounded border border-neutral-700 bg-neutral-800 px-3 py-2"
          />
        </label>
        {orgs.data && orgs.data.orgs.length > 0 && (
          <label className="block">
            <span className="mb-1 block text-neutral-400">Owner</span>
            <select
              value={ownerSlug}
              onChange={(e) => setOwnerSlug(e.target.value)}
              className="w-full rounded border border-neutral-700 bg-neutral-800 px-3 py-2"
            >
              <option value="">Personal (you)</option>
              {orgs.data.orgs.map((o) => (
                <option key={o.slug} value={o.slug}>
                  Org: {o.name}
                </option>
              ))}
            </select>
          </label>
        )}
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

function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]!);
  return btoa(binary);
}

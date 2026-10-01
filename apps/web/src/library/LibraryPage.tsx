import { useEffect, useState, type ChangeEvent, type FormEvent } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type CustomPartSummary } from '../api';
import { defaultSaveTo, readOwnerFilter } from '../owners/owners';
import { SaveToPicker } from '../owners/OwnerControls';
import { AppHeader } from '../AppHeader';
import { useEditorStore } from '../editor/editorStore';

/**
 * /library page — combined view of layouts, custom parts (uploaded XML + sprite)
 * and saved modules. All share the same ownership / sharing model.
 */
export function LibraryPage() {
  const me = useQuery({ queryKey: ['me'], queryFn: api.me });
  const parts = useQuery({ queryKey: ['custom-parts'], queryFn: api.customParts.list });
  const [showPart, setShowPart] = useState(false);
  const navigate = useNavigate();
  const reopenLastFile = useEditorStore((s) => s.reopenLastFile);

  // Reopen last layout on mount when the preference is enabled.
  useEffect(() => {
    if (!reopenLastFile) return;
    const lastId = localStorage.getItem('cld:lastLayoutId');
    if (lastId) navigate(`/editor/${lastId}`, { replace: true });
  // Only run once on mount — intentional empty-ish deps.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (me.isLoading) return <div className="p-8 text-muted">Loading…</div>;
  if (!me.data?.user) return <Navigate to="/login" replace />;

  return (
    <div className="h-full overflow-y-auto p-8">
      <AppHeader user={me.data.user} />
      <main className="mx-auto mt-8 max-w-4xl space-y-8">
        <div>
          <h1 className="text-xl font-semibold">Library</h1>
          <p className="text-sm text-muted">
            Custom parts you and your clubs have added. Your layouts, rooms and modules are on the{' '}
            <Link to="/" className="font-semibold text-accent-text hover:underline">home page</Link>.
          </p>
        </div>

      <section>
        <header className="flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">
            Custom parts
          </h2>
          {me.data?.user && !me.data.user.isDemoAccount && (
            <button
              onClick={() => setShowPart(true)}
              className="tap-target inline-flex items-center rounded-lg border border-border px-3 py-1 text-sm hover:bg-soft"
            >
              Upload part
            </button>
          )}
        </header>
        <CustomPartsList parts={parts.data?.parts ?? []} loading={parts.isLoading} />
      </section>

        {showPart && <UploadPartDialog onClose={() => setShowPart(false)} />}
      </main>
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
  if (loading) return <p className="mt-2 text-sm text-muted">Loading…</p>;
  if (parts.length === 0)
    return (
      <p className="mt-2 rounded-lg border border-dashed border-line p-4 text-sm text-muted">
        No custom parts yet.
      </p>
    );
  return (
    <ul className="mt-2 grid grid-cols-2 gap-2 md:grid-cols-3">
      {parts.map((p) => (
        <li
          key={p.id}
          className="flex flex-col items-center rounded-lg border border-line p-2 text-xs"
        >
          <img
            src={api.customParts.spriteUrl(p.id)}
            alt=""
            className="h-16 w-16 object-contain"
            loading="lazy"
          />
          <p className="mt-1 line-clamp-1 font-mono">{p.partNumber}</p>
          <p className="line-clamp-1 text-muted">{p.displayName}</p>
          <button
            onClick={() => {
              if (confirm(`Delete "${p.partNumber}"?`)) remove.mutate(p.id);
            }}
            className="mt-1 text-[10px] text-danger hover:underline"
          >
            delete
          </button>
        </li>
      ))}
    </ul>
  );
}

function UploadPartDialog({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const orgs = useQuery({ queryKey: ['orgs'], queryFn: api.orgs.list });
  const catalog = useQuery({ queryKey: ['parts-catalog'], queryFn: api.parts.catalog, staleTime: 5 * 60 * 1000 });
  const [partNumber, setPartNumber] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [category, setCategory] = useState('Custom');
  const [xmlText, setXmlText] = useState('');
  const [spriteFile, setSpriteFile] = useState<File | null>(null);
  const [ownerSlug, setOwnerSlug] = useState(() => defaultSaveTo(readOwnerFilter()));
  // A remembered club you've since left: save to Me.
  useEffect(() => {
    if (ownerSlug && orgs.data && !orgs.data.orgs.some((o) => o.slug === ownerSlug)) setOwnerSlug('');
  }, [orgs.data, ownerSlug]);
  const [error, setError] = useState<string | null>(null);

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
    const spriteBase64 = arrayBufferToBase64(buf);
    create.mutate({
      partNumber: partNumber.trim(),
      displayName: displayName.trim(),
      category: category.trim() || 'Custom',
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
        className="w-full max-w-md space-y-3 rounded-lg border border-line bg-panel p-6 text-sm"
      >
        <h3 className="text-lg font-semibold">Upload custom part</h3>

        <label className="block">
          <span className="mb-1 block text-muted">Part number</span>
          <input
            value={partNumber}
            onChange={(e) => setPartNumber(e.target.value)}
            required
            className="w-full rounded-lg border border-border bg-soft px-3 py-2"
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-muted">Display name</span>
          <input
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            required
            className="w-full rounded-lg border border-border bg-soft px-3 py-2"
          />
        </label>

        <CategoryPicker
          categories={existingCategories}
          value={category}
          onChange={setCategory}
        />

        <SaveToPicker value={ownerSlug} onChange={setOwnerSlug} orgs={orgs.data?.orgs} />

        <label className="block">
          <span className="mb-1 block text-muted">Part XML</span>
          <input
            type="file"
            accept=".xml,application/xml,text/xml"
            onChange={pickXml}
            required
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-muted">Sprite (gif or png)</span>
          <input
            type="file"
            accept="image/gif,image/png"
            onChange={pickSprite}
            required
          />
        </label>

        {error && <p className="text-xs text-danger">{error}</p>}

        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-border px-4 py-2 hover:bg-soft"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={create.isPending}
            className="rounded-lg bg-accent text-accent-ink px-4 py-2 hover:bg-accent-hover disabled:opacity-50"
          >
            Upload
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

export function CategoryPicker({
  categories,
  value,
  onChange,
}: {
  categories: string[];
  value: string;
  onChange: (v: string) => void;
}) {
  // Track whether the user has explicitly chosen "type your own" mode.
  // We can't infer this from value alone: an empty string or an unrecognised
  // value both look like "custom" but the initial render should show the
  // select, not the text input.
  const [customMode, setCustomMode] = useState(false);

  function onSelect(e: React.ChangeEvent<HTMLSelectElement>) {
    const v = e.target.value;
    if (v === '__custom__') {
      setCustomMode(true);
      onChange('');
    } else {
      setCustomMode(false);
      onChange(v);
    }
  }

  return (
    <div className="block space-y-1">
      <span className="block text-muted">Category</span>
      {!customMode ? (
        <select
          value={categories.includes(value) ? value : (categories[0] ?? '')}
          onChange={onSelect}
          className="w-full rounded-lg border border-border bg-soft px-3 py-2 text-sm"
        >
          {categories.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
          <option value="__custom__">— type your own —</option>
        </select>
      ) : (
        <div className="flex gap-2">
          <input
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder="My Category"
            autoFocus
            className="flex-1 rounded-lg border border-border bg-soft px-3 py-2 text-sm"
          />
          <button
            type="button"
            onClick={() => { setCustomMode(false); onChange(categories[0] ?? 'Custom'); }}
            className="rounded-lg border border-border px-2 py-1 text-xs hover:bg-soft"
            title="Pick from list"
          >
            ↩
          </button>
        </div>
      )}
    </div>
  );
}

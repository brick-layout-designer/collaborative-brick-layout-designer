import { useState, type ChangeEvent, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type LayoutSummary } from '../api';
import { ShareDialog } from './ShareDialog';

export function LayoutsPage() {
  const qc = useQueryClient();
  const me = useQuery({ queryKey: ['me'], queryFn: api.me });
  const list = useQuery({ queryKey: ['layouts'], queryFn: api.layouts.list });
  const [showCreate, setShowCreate] = useState(false);
  const [shareLayout, setShareLayout] = useState<LayoutSummary | null>(null);

  const remove = useMutation({
    mutationFn: api.layouts.remove,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['layouts'] }),
  });

  if (list.isLoading) return <p className="text-neutral-500">Loading layouts…</p>;

  const layouts = list.data?.layouts ?? [];

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Layouts</h2>
        <button
          onClick={() => setShowCreate(true)}
          className="rounded bg-blue-600 px-3 py-1.5 text-sm hover:bg-blue-500"
        >
          New layout
        </button>
      </div>

      {layouts.length === 0 ? (
        <p className="rounded border border-dashed border-neutral-700 p-8 text-center text-neutral-500">
          No layouts yet. Click <em>New layout</em> to create or import one.
        </p>
      ) : (
        <ul className="divide-y divide-neutral-800 rounded border border-neutral-800">
          {layouts.map((l) => (
            <LayoutRow
              key={l.id}
              layout={l}
              onDelete={() => {
                if (confirm(`Delete "${l.title}"? This cannot be undone.`)) remove.mutate(l.id);
              }}
              onShare={() => setShareLayout(l)}
            />
          ))}
        </ul>
      )}

      {showCreate && (
        <CreateLayoutDialog
          onClose={() => setShowCreate(false)}
          onCreated={() => {
            qc.invalidateQueries({ queryKey: ['layouts'] });
            setShowCreate(false);
          }}
        />
      )}

      {shareLayout && me.data?.user && (
        <ShareDialogLoader
          layout={shareLayout}
          myUserId={me.data.user.id}
          onClose={() => setShareLayout(null)}
        />
      )}
    </section>
  );
}

/**
 * Resolves the user's role on the layout before opening ShareDialog. The
 * layouts list response doesn't include the role; we fetch it here and
 * mount the dialog with the right `myRole` to gate owner-only controls.
 */
function ShareDialogLoader({
  layout,
  myUserId,
  onClose,
}: {
  layout: LayoutSummary;
  myUserId: string;
  onClose: () => void;
}) {
  const detail = useQuery({
    queryKey: ['layout', layout.id],
    queryFn: () => api.layouts.get(layout.id),
  });
  if (detail.isLoading || !detail.data) return null;
  return (
    <ShareDialog
      layoutId={layout.id}
      layoutTitle={layout.title}
      myRole={detail.data.role}
      myUserId={myUserId}
      onClose={onClose}
    />
  );
}

function LayoutRow({
  layout,
  onDelete,
  onShare,
}: {
  layout: LayoutSummary;
  onDelete: () => void;
  onShare: () => void;
}) {
  return (
    <li className="flex items-center justify-between px-4 py-3">
      <div>
        <p className="font-medium">{layout.title}</p>
        <p className="text-xs text-neutral-500">
          updated {new Date(layout.updatedAt).toLocaleString()}
          {layout.expiresAt && (
            <>
              {' · '}
              <span className="text-amber-400">
                expires {new Date(layout.expiresAt).toLocaleDateString()}
              </span>
            </>
          )}
        </p>
      </div>
      <div className="flex items-center gap-2 text-sm">
        <Link
          to={`/editor/${layout.id}`}
          className="rounded bg-blue-600 px-3 py-1 text-white hover:bg-blue-500"
        >
          Open
        </Link>
        <button
          onClick={onShare}
          className="rounded border border-neutral-700 px-3 py-1 hover:bg-neutral-800"
        >
          Share
        </button>
        <a
          href={api.layouts.exportBbmUrl(layout.id)}
          className="rounded border border-neutral-700 px-3 py-1 hover:bg-neutral-800"
        >
          Export .bbm
        </a>
        {layout.hasSidecar && (
          <a
            href={api.layouts.exportSidecarUrl(layout.id)}
            className="rounded border border-neutral-700 px-3 py-1 hover:bg-neutral-800"
          >
            .bbm.cld
          </a>
        )}
        <button
          onClick={onDelete}
          className="rounded border border-red-900 px-3 py-1 text-red-400 hover:bg-red-950"
        >
          Delete
        </button>
      </div>
    </li>
  );
}

function CreateLayoutDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void;
}) {
  const [title, setTitle] = useState('');
  const [bbm, setBbm] = useState<string | null>(null);
  const [sidecar, setSidecar] = useState<string | null>(null);
  const [bbmFilename, setBbmFilename] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: api.layouts.create,
    onSuccess: () => onCreated(),
    onError: (e: Error) => setError(e.message),
  });

  async function pickBbm(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    setBbm(text);
    setBbmFilename(file.name);
    if (!title) setTitle(file.name.replace(/\.bbm$/i, ''));
  }

  async function pickSidecar(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setSidecar(await file.text());
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const body: { title?: string; bbm?: string; sidecar?: string } = {};
    const t = title.trim();
    if (t) body.title = t;
    if (bbm) body.bbm = bbm;
    if (sidecar) body.sidecar = sidecar;
    create.mutate(body);
  }

  return (
    <div className="fixed inset-0 grid place-items-center bg-black/60 p-4">
      <form
        onSubmit={submit}
        className="w-full max-w-md space-y-4 rounded-lg border border-neutral-800 bg-neutral-900 p-6"
      >
        <h3 className="text-lg font-semibold">New layout</h3>

        <label className="block text-sm">
          <span className="mb-1 block text-neutral-400">Title</span>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Untitled Layout"
            className="w-full rounded border border-neutral-700 bg-neutral-800 px-3 py-2"
          />
        </label>

        <label className="block text-sm">
          <span className="mb-1 block text-neutral-400">
            Optional: import from .bbm
          </span>
          <input type="file" accept=".bbm" onChange={pickBbm} className="text-sm" />
          {bbmFilename && <p className="mt-1 text-xs text-neutral-500">{bbmFilename}</p>}
        </label>

        <label className="block text-sm">
          <span className="mb-1 block text-neutral-400">Optional: sidecar (.bbm.cld)</span>
          <input
            type="file"
            accept=".cld,.bbm.cld,application/json"
            onChange={pickSidecar}
            className="text-sm"
          />
        </label>

        {error && <p className="text-sm text-red-400">{error}</p>}

        <div className="flex justify-end gap-2">
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

import { lazy, Suspense, useEffect, useState, type ChangeEvent, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type LayoutSummary } from '../api';
import { getNewLayoutTemplate, setNewLayoutTemplate, templateContent } from './newLayoutTemplate';
import { LAYOUT_ACCEPT, mapFileToBbm, mapFormatOf } from '../mapFormats';
const ShareDialog = lazy(() => import('./ShareDialog').then((m) => ({ default: m.ShareDialog })));

export function LayoutsPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const me = useQuery({ queryKey: ['me'], queryFn: api.me });
  const list = useQuery({ queryKey: ['layouts'], queryFn: api.layouts.list });
  const [showCreate, setShowCreate] = useState(false);
  const [shareLayout, setShareLayout] = useState<LayoutSummary | null>(null);

  const remove = useMutation({
    mutationFn: api.layouts.remove,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['layouts'] }),
  });

  if (list.isLoading) return <p className="text-neutral-500">Loading layouts…</p>;

  const allLayouts = list.data?.layouts ?? [];
  // Personal layouts only — org-owned layouts live on the org's page.
  const layouts = allLayouts.filter((l) => l.ownerOrgId === null);
  // Collect distinct orgs that own at least one layout this user can see.
  const orgLayouts = allLayouts.filter((l) => l.ownerOrgId !== null);
  const orgGroups = orgLayouts.reduce<Record<string, { name: string; slug: string }>>((acc, l) => {
    if (l.ownerOrgSlug && !acc[l.ownerOrgSlug]) {
      acc[l.ownerOrgSlug] = { name: l.ownerOrgName ?? l.ownerOrgSlug, slug: l.ownerOrgSlug };
    }
    return acc;
  }, {});

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Layouts</h2>
        <button
          onClick={() => setShowCreate(true)}
          className="rounded-sm bg-blue-600 px-3 py-1.5 text-sm hover:bg-blue-500"
        >
          New layout
        </button>
      </div>

      {Object.values(orgGroups).length > 0 && (
        <div className="rounded-sm border border-neutral-700 bg-neutral-800/40 px-4 py-3 text-sm text-neutral-400">
          Some layouts are owned by your orgs and are not shown here.{' '}
          {Object.values(orgGroups).map((org) => (
            <Link
              key={org.slug}
              to={`/orgs/${org.slug}`}
              className="text-blue-400 hover:underline"
            >
              View {org.name}
            </Link>
          ))}
        </div>
      )}

      {layouts.length === 0 ? (
        <p className="rounded-sm border border-dashed border-neutral-700 p-8 text-center text-neutral-500">
          No layouts yet. Click <em>New layout</em> to create or import one.
        </p>
      ) : (
        <ul className="divide-y divide-neutral-800 rounded-sm border border-neutral-800">
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
          onCreated={(id, openWarnings) => {
            qc.invalidateQueries({ queryKey: ['layouts'] });
            setShowCreate(false);
            // Open the new layout straight away, like the desktop editor's
            // File > New and the global .bbm drop handler in main.tsx do.
            navigate(`/editor/${id}`, openWarnings?.length ? { state: { openWarnings } } : undefined);
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
    <Suspense fallback={null}>
      <ShareDialog
        layoutId={layout.id}
        layoutTitle={layout.title}
        myRole={detail.data.role}
        myUserId={myUserId}
        onClose={onClose}
      />
    </Suspense>
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
  // New layouts can start as a copy of this one (desktop's File > New template).
  const [isTemplate, setIsTemplate] = useState(() => getNewLayoutTemplate()?.id === layout.id);
  useEffect(() => {
    const sync = () => setIsTemplate(getNewLayoutTemplate()?.id === layout.id);
    window.addEventListener('cld:template-changed', sync);
    return () => window.removeEventListener('cld:template-changed', sync);
  }, [layout.id]);
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
          className="rounded-sm bg-blue-600 px-3 py-1 text-white hover:bg-blue-500"
        >
          Open
        </Link>
        <button
          onClick={onShare}
          className="rounded-sm border border-neutral-700 px-3 py-1 hover:bg-neutral-800"
        >
          Share
        </button>
        <a
          href={api.layouts.exportZipUrl(layout.id)}
          className="rounded-sm border border-neutral-700 px-3 py-1 hover:bg-neutral-800"
          title={layout.hasSidecar ? 'Download .bbm + .bbm.bld sidecar as a .zip' : 'Download .bbm'}
        >
          Export .zip
        </a>
        <label className="flex items-center gap-1 text-xs text-neutral-400" title="New layouts start as a copy of this one">
          <input
            type="checkbox"
            checked={isTemplate}
            onChange={(e) => {
              setNewLayoutTemplate(e.target.checked ? { id: layout.id, title: layout.title } : null);
              window.dispatchEvent(new Event('cld:template-changed'));
            }}
          />
          Template for new layouts
        </label>
        <button
          onClick={onDelete}
          className="rounded-sm border border-red-900 px-3 py-1 text-red-400 hover:bg-red-950"
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
  onCreated: (id: string, openWarnings?: string[]) => void;
}) {
  const [title, setTitle] = useState('');
  const [bbm, setBbm] = useState<string | null>(null);
  // What converting a picked LDraw / TrackDesigner / 4DBrix file skipped.
  const [openWarnings, setOpenWarnings] = useState<string[]>([]);
  const qc = useQueryClient();
  const [sidecar, setSidecar] = useState<string | null>(null);
  const [bbmFilename, setBbmFilename] = useState<string | null>(null);
  // Owner: empty string = personal; otherwise the org slug.
  const [ownerSlug, setOwnerSlug] = useState('');
  const [error, setError] = useState<string | null>(null);
  // Start from the template layout, when one is set (desktop onNew).
  const [template] = useState(getNewLayoutTemplate);
  const [fromTemplate, setFromTemplate] = useState(template !== null);

  // Fetch the user's orgs so the dialog can offer them as owner options.
  // Cheap; cached by react-query so this almost never hits the network.
  const orgs = useQuery({ queryKey: ['orgs'], queryFn: api.orgs.list });

  const create = useMutation({
    mutationFn: api.layouts.create,
    onSuccess: (res) => onCreated(res.id, openWarnings),
    onError: (e: Error) => setError(e.message),
  });

  async function pickBbm(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    let text: string;
    let warnings: string[] = [];
    if (mapFormatOf(file.name)) {
      // Other map formats are converted with the parts' remaps.
      try {
        const catalog = await qc.fetchQuery({ queryKey: ['parts-catalog'], queryFn: api.parts.catalog, staleTime: 5 * 60 * 1000 });
        ({ bbm: text, warnings } = await mapFileToBbm(file.name, new Uint8Array(await file.arrayBuffer()), catalog.parts));
      } catch (err) {
        setError(`Could not open ${file.name}: ${(err as Error).message}`);
        return;
      }
    } else {
      text = await file.text();
    }
    setBbm(text);
    setOpenWarnings(warnings);
    setBbmFilename(file.name);
    if (!title) setTitle(file.name.replace(/\.(bbm|ldr|mpd|tdl|ncp)$/i, ''));
  }

  async function pickSidecar(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setSidecar(await file.text());
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const body: { title?: string; bbm?: string; sidecar?: string; orgSlug?: string } = {};
    const t = title.trim();
    if (t) body.title = t;
    if (bbm) body.bbm = bbm;
    if (sidecar) body.sidecar = sidecar;
    // A picked .bbm wins over the template.
    if (!bbm && fromTemplate && template) {
      try {
        const c = await templateContent(template.id);
        body.bbm = c.bbm;
        if (c.sidecar !== undefined) body.sidecar = c.sidecar;
      } catch (err) {
        setError((err as Error).message);
        return;
      }
    }
    if (ownerSlug) body.orgSlug = ownerSlug;
    create.mutate(body);
  }

  return (
    <div className="fixed inset-0 grid place-items-center bg-black/60 p-4">
      <form
        onSubmit={(e) => void submit(e)}
        className="w-full max-w-md space-y-4 rounded-lg border border-neutral-800 bg-neutral-900 p-6"
      >
        <h3 className="text-lg font-semibold">New layout</h3>

        {template && !bbm && (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={fromTemplate} onChange={(e) => setFromTemplate(e.target.checked)} />
            Start from template “{template.title}”
          </label>
        )}

        <label className="block text-sm">
          <span className="mb-1 block text-neutral-400">Title</span>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Untitled Layout"
            className="w-full rounded-sm border border-neutral-700 bg-neutral-800 px-3 py-2"
          />
        </label>

        {orgs.data && orgs.data.orgs.length > 0 && (
          <label className="block text-sm">
            <span className="mb-1 block text-neutral-400">Owner</span>
            <select
              value={ownerSlug}
              onChange={(e) => setOwnerSlug(e.target.value)}
              className="w-full rounded-sm border border-neutral-700 bg-neutral-800 px-3 py-2"
            >
              <option value="">Personal (you)</option>
              {orgs.data.orgs.map((o) => (
                <option key={o.slug} value={o.slug}>
                  Org: {o.name} ({o.myRole})
                </option>
              ))}
            </select>
          </label>
        )}

        <label className="block text-sm">
          <span className="mb-1 block text-neutral-400">
            Optional: import from .bbm, LDraw, TrackDesigner or 4DBrix
          </span>
          <input type="file" accept={LAYOUT_ACCEPT} onChange={pickBbm} className="text-sm" />
          {bbmFilename && <p className="mt-1 text-xs text-neutral-500">{bbmFilename}</p>}
          {openWarnings.map((w) => (
            <p key={w} className="mt-1 text-xs text-amber-400">{w}</p>
          ))}
        </label>

        <label className="block text-sm">
          <span className="mb-1 block text-neutral-400">Optional: sidecar (.bbm.cld / desktop .bbm.bld)</span>
          <input
            type="file"
            accept=".cld,.bbm.cld,.bld,.bbm.bld,application/json"
            onChange={pickSidecar}
            className="text-sm"
          />
        </label>

        {error && <p className="text-sm text-red-400">{error}</p>}

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-sm border border-neutral-700 px-4 py-2 hover:bg-neutral-800"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={create.isPending}
            className="rounded-sm bg-blue-600 px-4 py-2 hover:bg-blue-500 disabled:opacity-50"
          >
            Create
          </button>
        </div>
      </form>
    </div>
  );
}

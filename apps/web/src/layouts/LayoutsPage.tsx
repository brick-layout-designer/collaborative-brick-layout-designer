import { lazy, Suspense, useEffect, useState, type ChangeEvent, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type LayoutSummary } from '../api';
import { getNewLayoutTemplate, setNewLayoutTemplate, templateContent } from './newLayoutTemplate';
import { LAYOUT_ACCEPT, mapFileToBbm, mapFormatOf } from '../mapFormats';
import { LAYOUT_FILE, readLayoutFile, type LayoutImage } from '../layoutFile';
import { takeLayoutParts, type PartChoice, type PartDifference } from '../layoutParts';
import { PartDifferencesDialog } from './PartDifferencesDialog';
import type { Venue } from '@cld/bbm';
import { VenueList } from '../venues/VenueList';
import { orderVenuesForOwner, sidecarWithVenue } from '../venues/venueStart';
const ShareDialog = lazy(() => import('./ShareDialog').then((m) => ({ default: m.ShareDialog })));

export function LayoutsPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const me = useQuery({ queryKey: ['me'], queryFn: api.me });
  const list = useQuery({ queryKey: ['layouts'], queryFn: api.layouts.list });
  // "Start layout" on a venue list links here with ?newLayoutVenue=<id>[&owner=<org slug>].
  const [params, setParams] = useSearchParams();
  const startVenue = params.get('newLayoutVenue');
  const [showCreate, setShowCreate] = useState(startVenue !== null);
  const [shareLayout, setShareLayout] = useState<LayoutSummary | null>(null);

  const remove = useMutation({
    mutationFn: api.layouts.remove,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['layouts'] }),
  });

  if (list.isLoading) return <p className="text-muted">Loading layouts…</p>;

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
        <h2 className="text-2xl font-bold">Layouts</h2>
        <button
          onClick={() => setShowCreate(true)}
          className="rounded-lg bg-accent text-accent-ink px-3 py-1.5 text-sm hover:bg-accent-hover"
        >
          New layout
        </button>
      </div>

      {Object.values(orgGroups).length > 0 && (
        <div className="rounded-lg border border-border bg-soft/40 px-4 py-3 text-sm text-muted">
          Some layouts are owned by your orgs and are not shown here.{' '}
          {Object.values(orgGroups).map((org) => (
            <Link
              key={org.slug}
              to={`/orgs/${org.slug}`}
              className="text-accent-text hover:underline"
            >
              View {org.name}
            </Link>
          ))}
        </div>
      )}

      {layouts.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border p-8 text-center text-muted">
          No layouts yet. Click <em>New layout</em> to create or import one.
        </p>
      ) : (
        <ul className="divide-y divide-line rounded-lg border border-line">
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
          initialVenueId={startVenue ?? ''}
          initialOwnerSlug={params.get('owner') ?? ''}
          onClose={() => {
            setShowCreate(false);
            if (startVenue !== null) setParams({}, { replace: true });
          }}
          onCreated={(id, openWarnings) => {
            qc.invalidateQueries({ queryKey: ['layouts'] });
            setShowCreate(false);
            // Open the new layout straight away, like the desktop editor's
            // File > New and the global .bbm drop handler in main.tsx do.
            navigate(`/editor/${id}`, openWarnings?.length ? { state: { openWarnings } } : undefined);
          }}
        />
      )}

      <div className="space-y-2 pt-4">
        <h2 className="text-2xl font-bold">My rooms</h2>
        <VenueList canManage />
      </div>

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
        <p className="text-xs text-muted">
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
          className="rounded-lg bg-accent px-3 py-1 text-accent-ink hover:bg-accent-hover"
        >
          Open
        </Link>
        <button
          onClick={onShare}
          className="rounded-lg border border-border px-3 py-1 hover:bg-soft"
        >
          Share
        </button>
        <a
          href={api.layouts.exportZipUrl(layout.id)}
          className="rounded-lg border border-border px-3 py-1 hover:bg-soft"
          title={layout.hasSidecar ? 'Download .bbm + .bbm.bld sidecar as a .zip' : 'Download .bbm'}
        >
          Export .zip
        </a>
        <label className="flex items-center gap-1 text-xs text-muted" title="New layouts start as a copy of this one">
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
          className="rounded-lg border border-red-900 px-3 py-1 text-danger hover:bg-red-950"
        >
          Delete
        </button>
      </div>
    </li>
  );
}

function CreateLayoutDialog({
  initialVenueId = '',
  initialOwnerSlug = '',
  onClose,
  onCreated,
}: {
  initialVenueId?: string;
  initialOwnerSlug?: string;
  onClose: () => void;
  onCreated: (id: string, openWarnings?: string[]) => void;
}) {
  const [title, setTitle] = useState('');
  const [bbm, setBbm] = useState<string | null>(null);
  // What converting a picked LDraw / TrackDesigner / 4DBrix file skipped.
  const [openWarnings, setOpenWarnings] = useState<string[]>([]);
  const qc = useQueryClient();
  const [sidecar, setSidecar] = useState<string | null>(null);
  // A picked .bld-layout's background image.
  const [background, setBackground] = useState<LayoutImage | null>(null);
  // …and its parts, the missing ones uploaded as custom parts on Create.
  const [layoutParts, setLayoutParts] = useState<Record<string, Uint8Array> | null>(null);
  // Parts the picked layout defines differently from the server, asked about on Create.
  const [asking, setAsking] = useState<{ differing: PartDifference[]; answer: (c: PartChoice[] | null) => void } | null>(null);
  const [bbmFilename, setBbmFilename] = useState<string | null>(null);
  // Owner: empty string = personal; otherwise the org slug.
  const [ownerSlug, setOwnerSlug] = useState(initialOwnerSlug);
  // Start from a saved venue: its outline goes into the new layout's sidecar.
  const [venueId, setVenueId] = useState(initialVenueId);
  const venues = useQuery({ queryKey: ['venues'], queryFn: api.venues.list });
  const [error, setError] = useState<string | null>(null);
  // Start from the template layout, when one is set (desktop onNew).
  const [template] = useState(getNewLayoutTemplate);
  const [fromTemplate, setFromTemplate] = useState(template !== null);

  // Fetch the user's orgs so the dialog can offer them as owner options.
  // Cheap; cached by react-query so this almost never hits the network.
  const orgs = useQuery({ queryKey: ['orgs'], queryFn: api.orgs.list });

  const create = useMutation({
    mutationFn: api.layouts.create,
    onError: (e: Error) => setError(e.message),
  });

  async function pickBbm(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    let text: string;
    let warnings: string[] = [];
    setBackground(null);
    setLayoutParts(null);
    if (LAYOUT_FILE.test(file.name)) {
      // The whole layout: labels, modules, venue and background come with it.
      try {
        const l = await readLayoutFile(new Uint8Array(await file.arrayBuffer()));
        text = l.bbm;
        warnings = l.warnings;
        setSidecar(l.sidecar ?? null);
        setBackground(l.background ?? null);
        setLayoutParts(l.parts ?? null);
      } catch (err) {
        setError(`Could not open ${file.name}: ${(err as Error).message}`);
        return;
      }
    } else if (mapFormatOf(file.name)) {
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
    if (!title) setTitle(file.name.replace(/\.(bld-layout|bbm|ldr|mpd|tdl|ncp)$/i, ''));
  }

  async function pickSidecar(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setSidecar(await file.text());
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const body: { title?: string; bbm?: string; sidecar?: string; orgSlug?: string; backgroundImage?: LayoutImage } = {};
    const t = title.trim();
    if (t) body.title = t;
    if (bbm) body.bbm = bbm;
    if (sidecar) body.sidecar = sidecar;
    if (bbm && background) body.backgroundImage = background;
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
    if (venueId) {
      try {
        const v = await api.venues.get(venueId);
        body.sidecar = sidecarWithVenue(body.sidecar, v.data as Venue);
      } catch (err) {
        setError(`Could not load the venue: ${(err as Error).message}`);
        return;
      }
    }
    if (ownerSlug) body.orgSlug = ownerSlug;
    // The file's parts this server lacks go up first, so the layout opens with them;
    // the ones it defines differently are asked about first.
    let partNotes: string[] = [];
    if (bbm && layoutParts) {
      try {
        const parts = await takeLayoutParts(
          layoutParts,
          bbm,
          async () => (await qc.fetchQuery({ queryKey: ['parts-catalog'], queryFn: api.parts.catalog, staleTime: 5 * 60 * 1000 })).parts,
          (differing) => new Promise((answer) => setAsking({ differing, answer })),
          ownerSlug || undefined,
        );
        body.bbm = parts.bbm;
        partNotes = parts.notes;
        // The browser keeps the catalog for 60 s: fetch past that so the editor sees the new parts.
        if (parts.changed) await qc.fetchQuery({ queryKey: ['parts-catalog'], queryFn: api.parts.catalogFresh, staleTime: 0 });
      } catch (err) {
        partNotes = [`the layout's parts could not be added: ${(err as Error).message}`];
      }
    }
    create.mutate(body, { onSuccess: (res) => onCreated(res.id, [...openWarnings, ...partNotes]) });
  }

  return (
    <div className="fixed inset-0 grid place-items-center bg-black/60 p-4">
      {asking && (
        <PartDifferencesDialog
          differences={asking.differing}
          onDone={(choices) => {
            setAsking(null);
            asking.answer(choices);
          }}
        />
      )}
      <form
        onSubmit={(e) => void submit(e)}
        className="w-full max-w-md space-y-4 rounded-lg border border-line bg-panel p-6"
      >
        <h3 className="text-lg font-semibold">New layout</h3>

        {template && !bbm && (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={fromTemplate} onChange={(e) => setFromTemplate(e.target.checked)} />
            Start from template “{template.title}”
          </label>
        )}

        <label className="block text-sm">
          <span className="mb-1 block text-muted">Title</span>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Untitled Layout"
            className="w-full rounded-lg border border-border bg-soft px-3 py-2"
          />
        </label>

        {orgs.data && orgs.data.orgs.length > 0 && (
          <label className="block text-sm">
            <span className="mb-1 block text-muted">Owner</span>
            <select
              value={ownerSlug}
              onChange={(e) => setOwnerSlug(e.target.value)}
              className="w-full rounded-lg border border-border bg-soft px-3 py-2"
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

        {venues.data && venues.data.venues.length > 0 && (
          <label className="block text-sm">
            <span className="mb-1 block text-muted">Start from venue</span>
            <select
              value={venueId}
              onChange={(e) => setVenueId(e.target.value)}
              className="w-full rounded-lg border border-border bg-soft px-3 py-2"
            >
              <option value="">No venue</option>
              {orderVenuesForOwner(
                venues.data.venues,
                orgs.data?.orgs.find((o) => o.slug === ownerSlug)?.id ?? null,
              ).map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                  {v.ownerOrgId ? ` (${orgs.data?.orgs.find((o) => o.id === v.ownerOrgId)?.name ?? 'org'})` : ''}
                </option>
              ))}
            </select>
          </label>
        )}

        <label className="block text-sm">
          <span className="mb-1 block text-muted">
            Optional: open a layout file (.bld-layout), .bbm, LDraw, TrackDesigner or 4DBrix
          </span>
          <input type="file" accept={LAYOUT_ACCEPT} onChange={pickBbm} className="text-sm" />
          {bbmFilename && <p className="mt-1 text-xs text-muted">{bbmFilename}</p>}
          {openWarnings.map((w) => (
            <p key={w} className="mt-1 text-xs text-amber-400">{w}</p>
          ))}
        </label>

        <label className="block text-sm">
          <span className="mb-1 block text-muted">Optional: sidecar (.bbm.cld / desktop .bbm.bld)</span>
          <input
            type="file"
            accept=".cld,.bbm.cld,.bld,.bbm.bld,application/json"
            onChange={pickSidecar}
            className="text-sm"
          />
        </label>

        {error && <p className="text-sm text-danger">{error}</p>}

        <div className="flex justify-end gap-2">
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
            Create
          </button>
        </div>
      </form>
    </div>
  );
}

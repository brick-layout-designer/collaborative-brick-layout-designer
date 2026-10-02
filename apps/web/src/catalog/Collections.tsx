// Catalog collections: named, ordered sets of public modules and parts
// ("Starter town", "Train yard basics"). The Catalog page lists them
// (featured first) and the caller's own with how they stand; a collection's
// page shows its items with "Add all" and per-item Add. Anyone signed in
// can make one: moderators' are published at once, other people's are
// reviewed like catalog items (and so is every change).

import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  api,
  type CatalogItem,
  type CatalogKind,
  type CollectionAddResult,
  type CollectionDetail,
  type CollectionSummary,
  type MyCollection,
} from '../api';
import { AppHeader } from '../AppHeader';
import { SaveToPicker } from '../owners/OwnerControls';
import { invalidateFor } from '../live/invalidate';
import { AddDialog, CatalogPreview } from './CatalogPage';

/** How one of my collections stands, in a few words. */
export function collectionStatus(c: Pick<MyCollection, 'status' | 'reason' | 'pending' | 'itemCount'>): { label: string; tone: 'ok' | 'wait' | 'bad' } {
  if (c.status === 'in_review') return { label: 'In review', tone: 'wait' };
  if (c.status === 'declined') return { label: c.reason ? `Declined: ${c.reason}` : 'Declined', tone: 'bad' };
  if (c.status === 'unpublished') return { label: c.reason ? `Unpublished: ${c.reason}` : 'Unpublished', tone: 'bad' };
  if (c.status === 'withdrawn') return { label: 'Withdrawn', tone: 'bad' };
  if (c.pending) return { label: 'Public · your change is in review', tone: 'wait' };
  if (c.itemCount === 0) return { label: 'Hidden: no items left', tone: 'bad' };
  if (c.reason) return { label: `Public · your change was declined: ${c.reason}`, tone: 'bad' };
  return { label: 'Public', tone: 'ok' };
}

/** "Added 2 · you already had 1 · 1 couldn't be added". */
export function addAllSummary(r: CollectionAddResult): string {
  const parts: string[] = [];
  parts.push(r.added.length === 0 ? 'Nothing new to add' : `Added ${r.added.length} ${r.added.length === 1 ? 'item' : 'items'}`);
  if (r.skipped.length) parts.push(`already had ${r.skipped.length}`);
  if (r.failed.length) parts.push(`${r.failed.length} couldn’t be added`);
  return parts.join(' · ') + '.';
}

/** Move the entry at `from` to `to`, leaving the list as it was if either is out of range. */
export function moveItem<T>(list: readonly T[], from: number, to: number): T[] {
  if (from < 0 || from >= list.length || to < 0 || to >= list.length) return [...list];
  const out = [...list];
  const [x] = out.splice(from, 1);
  out.splice(to, 0, x as T);
  return out;
}

function Cover({ url, className = '' }: { url: string | null; className?: string }) {
  const [failed, setFailed] = useState(false);
  return url && !failed ? (
    <img src={url} alt="" loading="lazy" onError={() => setFailed(true)} className={`rounded-lg border border-line bg-soft object-contain ${className}`} />
  ) : (
    <span aria-hidden className={`block rounded-lg border border-line bg-soft ${className}`} />
  );
}

function counts(c: Pick<CollectionSummary, 'modules' | 'parts'>): string {
  const out: string[] = [];
  if (c.modules) out.push(`${c.modules} ${c.modules === 1 ? 'module' : 'modules'}`);
  if (c.parts) out.push(`${c.parts} ${c.parts === 1 ? 'part' : 'parts'}`);
  return out.join(', ') || 'empty';
}

/** The Catalog page's Collections: featured ones first (the server orders them). */
export function CollectionsSection() {
  const list = useQuery({ queryKey: ['catalog-collections'], queryFn: api.catalog.collections });
  const rows = list.data?.collections ?? [];
  if (!rows.length) return null;
  const featured = rows.filter((c) => c.featured);
  const rest = rows.filter((c) => !c.featured);
  return (
    <section aria-labelledby="collections-heading" className="space-y-3">
      <h2 id="collections-heading" className="text-lg font-semibold">Collections</h2>
      {featured.length > 0 && <CollectionGrid rows={featured} label="Featured collections" />}
      {rest.length > 0 && <CollectionGrid rows={rest} label="More collections" />}
    </section>
  );
}

function CollectionGrid({ rows, label }: { rows: CollectionSummary[]; label: string }) {
  return (
    <ul aria-label={label} className="grid grid-cols-[repeat(auto-fill,minmax(14rem,1fr))] gap-3">
      {rows.map((c) => (
        <li key={c.id} data-testid="collection-card">
          <Link
            to={`/catalog/collections/${c.id}`}
            className={`flex h-full flex-col gap-2 rounded-section border bg-panel p-3 hover:bg-soft ${c.featured ? 'border-accent' : 'border-line'}`}
          >
            <Cover url={c.coverUrl} className="aspect-[4/3] w-full" />
            <span className="font-semibold">{c.title}</span>
            <span className="text-xs text-muted">
              {c.featured ? 'Featured · ' : ''}
              {counts(c)} · by {c.by}
            </span>
            {c.description && <span className="line-clamp-2 text-sm">{c.description}</span>}
          </Link>
        </li>
      ))}
    </ul>
  );
}

/** "Mine": the caller's collections, how each stands, and a way to make one. */
export function MyCollections() {
  const qc = useQueryClient();
  const mine = useQuery({ queryKey: ['catalog-collections-mine'], queryFn: api.catalog.myCollections });
  const [editing, setEditing] = useState<{ id: string | null } | null>(null);
  const dismiss = useMutation({
    mutationFn: api.catalog.dismissCollectionNote,
    onSuccess: () => invalidateFor(qc, 'catalog'),
  });
  const rows = mine.data?.collections ?? [];
  return (
    <section aria-labelledby="mine-heading" className="space-y-3 rounded-section border border-line bg-panel p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 id="mine-heading" className="text-lg font-semibold">Mine</h2>
          <p className="text-sm text-muted">Put catalog items together for others, like “Starter town”.</p>
        </div>
        <button
          type="button"
          onClick={() => setEditing({ id: null })}
          className="tap-target rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-accent-ink hover:bg-accent-hover"
        >
          New collection
        </button>
      </div>
      {rows.length > 0 && (
        <ul className="divide-y divide-line">
          {rows.map((c) => {
            const st = collectionStatus(c);
            return (
              <li key={c.id} data-testid="my-collection" className="flex flex-wrap items-center gap-3 py-2 text-sm">
                <Cover url={c.coverUrl} className="size-12 shrink-0" />
                <div className="min-w-[10rem] flex-1">
                  <Link to={`/catalog/collections/${c.id}`} className="font-medium hover:underline">
                    {c.title}
                  </Link>
                  <p className="text-xs text-muted">{counts(c)}</p>
                  {c.curatorNote && (
                    <p role="note" className="mt-1 whitespace-pre-line rounded-md bg-soft px-2 py-1 text-xs">
                      {c.curatorNote}{' '}
                      <button type="button" onClick={() => dismiss.mutate(c.id)} className="font-semibold text-accent-text hover:underline">
                        OK
                      </button>
                    </p>
                  )}
                </div>
                <span
                  data-testid="collection-status"
                  className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                    st.tone === 'ok' ? 'bg-accent/15 text-accent-text' : st.tone === 'wait' ? 'bg-soft text-ink' : 'bg-danger/15 text-danger'
                  }`}
                >
                  {st.label}
                </span>
                {c.status !== 'withdrawn' && (
                  <button
                    type="button"
                    onClick={() => setEditing({ id: c.id })}
                    aria-label={`Edit ${c.title}`}
                    className="tap-target rounded-lg border border-border px-3 py-1.5 hover:bg-soft"
                  >
                    Edit
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {editing && <CollectionEditor id={editing.id} onClose={() => setEditing(null)} />}
    </section>
  );
}

interface Picked {
  id: string;
  kind: CatalogKind;
  title: string;
  previewUrl: string;
}

/** Make or change a collection: title, description, items in order, and the cover. */
export function CollectionEditor({ id, onClose }: { id: string | null; onClose: () => void }) {
  const qc = useQueryClient();
  const settings = useQuery({ queryKey: ['catalog-settings'], queryFn: api.catalog.settings });
  const existing = useQuery({ queryKey: ['catalog-collection', id], queryFn: () => api.catalog.collection(id!), enabled: !!id });
  const [loadedFrom, setLoadedFrom] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [items, setItems] = useState<Picked[]>([]);
  const [cover, setCover] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [error, setError] = useState<string | null>(null);

  // Start from the change waiting for review, if any, else what's public.
  const d = existing.data;
  if (id && d && loadedFrom !== id) {
    const base = d.collection.pending ?? {
      title: d.collection.title,
      description: d.collection.description,
      coverItemId: d.collection.coverItemId,
      items: d.items.map((i) => ({ id: i.id, kind: i.kind, title: i.title, previewUrl: i.previewUrl })),
    };
    setLoadedFrom(id);
    setTitle(base.title);
    setDescription(base.description);
    setItems(base.items);
    setCover(base.coverItemId);
  }

  const kinds: CatalogKind[] = [...(settings.data?.modules ? (['module'] as const) : []), ...(settings.data?.parts ? (['part'] as const) : [])];
  const found = useQuery({
    queryKey: ['catalog-items', 'picker', kinds.join(','), q],
    queryFn: async () => (await Promise.all(kinds.map((k) => api.catalog.items(k, { q })))).flatMap((r) => r.items),
    enabled: kinds.length > 0,
  });

  const save = useMutation({
    mutationFn: () => {
      const body = { title: title.trim(), description: description.trim(), itemIds: items.map((i) => i.id), coverItemId: cover };
      // Either way: is it waiting for a moderator now?
      return id
        ? api.catalog.updateCollection(id, body).then((r) => ({ inReview: r.pending || r.status === 'in_review' }))
        : api.catalog.createCollection(body).then((r) => ({ inReview: r.status === 'in_review' }));
    },
    onSuccess: () => invalidateFor(qc, 'catalog'),
    onError: (e: Error) => setError(e.message),
  });

  const has = new Set(items.map((i) => i.id));
  const result = save.data;
  return (
    <div className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-black/60 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={id ? 'Edit collection' : 'New collection'}
        className="w-full max-w-2xl space-y-4 rounded-section border border-line bg-panel p-5 text-sm"
      >
        <h3 className="text-lg font-semibold">{id ? 'Edit collection' : 'New collection'}</h3>
        {result ? (
          <>
            <p role="status">
              {result.inReview
                ? 'Sent for review. A moderator looks at it before everyone sees it; you can follow it under Mine.'
                : 'It’s in the catalog now for everyone.'}
            </p>
            <div className="flex justify-end">
              <button type="button" onClick={onClose} className="tap-target rounded-lg border border-border px-4 py-2 hover:bg-soft">
                Done
              </button>
            </div>
          </>
        ) : (
          <>
            <label className="block">
              <span className="mb-1 block text-muted">Title</span>
              <input value={title} maxLength={80} onChange={(e) => setTitle(e.target.value)} className="min-h-10 w-full rounded-lg border border-border bg-soft px-3" />
            </label>
            <label className="block">
              <span className="mb-1 block text-muted">Description (optional)</span>
              <textarea
                value={description}
                maxLength={1000}
                rows={2}
                onChange={(e) => setDescription(e.target.value)}
                className="w-full rounded-lg border border-border bg-soft px-3 py-2"
              />
            </label>
            <div className="space-y-2">
              <p className="text-muted">In this collection ({items.length}), in this order</p>
              {items.length === 0 ? (
                <p className="rounded-lg border border-dashed border-line p-3 text-muted">Nothing yet. Find items below and add them.</p>
              ) : (
                <ol aria-label="Items in the collection" className="divide-y divide-line rounded-lg border border-line">
                  {items.map((it, n) => (
                    <li key={it.id} className="flex flex-wrap items-center gap-2 px-2 py-1.5">
                      <Cover url={it.previewUrl} className="size-10 shrink-0" />
                      <span className="min-w-[8rem] flex-1">{it.title}</span>
                      <label className="flex items-center gap-1 text-xs">
                        <input type="radio" name="cover" checked={cover === it.id} onChange={() => setCover(it.id)} aria-label={`Use ${it.title} as the cover`} />
                        Cover
                      </label>
                      <button type="button" aria-label={`Move ${it.title} up`} disabled={n === 0} onClick={() => setItems(moveItem(items, n, n - 1))} className="rounded px-2 hover:bg-soft disabled:opacity-40">
                        ↑
                      </button>
                      <button
                        type="button"
                        aria-label={`Move ${it.title} down`}
                        disabled={n === items.length - 1}
                        onClick={() => setItems(moveItem(items, n, n + 1))}
                        className="rounded px-2 hover:bg-soft disabled:opacity-40"
                      >
                        ↓
                      </button>
                      <button
                        type="button"
                        aria-label={`Take ${it.title} out`}
                        onClick={() => {
                          setItems(items.filter((x) => x.id !== it.id));
                          if (cover === it.id) setCover(null);
                        }}
                        className="rounded px-2 text-danger hover:bg-soft"
                      >
                        ✕
                      </button>
                    </li>
                  ))}
                </ol>
              )}
              <p className="text-xs text-muted">Without a chosen cover, the first module’s picture is used.</p>
            </div>
            <div className="space-y-2">
              <input
                type="search"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Find catalog items"
                aria-label="Find catalog items"
                className="min-h-10 w-full rounded-lg border border-border bg-soft px-3"
              />
              <ul aria-label="Catalog items to add" className="max-h-56 divide-y divide-line overflow-y-auto rounded-lg border border-line">
                {(found.data ?? []).map((it) => (
                  <li key={it.id} className="flex items-center gap-2 px-2 py-1.5">
                    <span className="flex-1">
                      {it.title} <span className="text-xs text-muted">({it.kind === 'module' ? 'module' : 'part'}, by {it.by})</span>
                    </span>
                    <button
                      type="button"
                      disabled={has.has(it.id)}
                      aria-label={`Put ${it.title} in the collection`}
                      onClick={() => setItems([...items, { id: it.id, kind: it.kind, title: it.title, previewUrl: it.previewUrl }])}
                      className="rounded-lg border border-border px-2 py-1 hover:bg-soft disabled:opacity-40"
                    >
                      {has.has(it.id) ? 'In it' : 'Add'}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
            {error && <p className="text-danger">{error}</p>}
            <div className="flex justify-end gap-2">
              <button type="button" onClick={onClose} className="tap-target rounded-lg border border-border px-4 py-2 hover:bg-soft">
                Cancel
              </button>
              <button
                type="button"
                disabled={save.isPending || !title.trim() || items.length === 0}
                onClick={() => {
                  setError(null);
                  save.mutate();
                }}
                className="tap-target rounded-lg bg-accent px-4 py-2 font-semibold text-accent-ink hover:bg-accent-hover disabled:opacity-50"
              >
                {id ? 'Save changes' : 'Submit'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/** "Add all": every item to me or a club; what's already there is skipped. */
function AddAllDialog({ c, onClose }: { c: CollectionDetail; onClose: () => void }) {
  const qc = useQueryClient();
  const orgs = useQuery({ queryKey: ['orgs'], queryFn: api.orgs.list });
  const [owner, setOwner] = useState('');
  const [error, setError] = useState<string | null>(null);
  const add = useMutation({
    mutationFn: () => api.catalog.addCollection(c.id, owner || undefined),
    onSuccess: (r) => {
      void invalidateFor(qc, 'catalog');
      if (r.added.some((a) => a.kind === 'part')) void qc.fetchQuery({ queryKey: ['parts-catalog'], queryFn: api.parts.catalogFresh, staleTime: 0 }).catch(() => undefined);
    },
    onError: (e: Error) => setError(e.message),
  });
  return (
    <div className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-black/60 p-4">
      <div role="dialog" aria-modal="true" aria-label={`Add all of ${c.title}`} className="w-full max-w-md space-y-4 rounded-section border border-line bg-panel p-5 text-sm">
        <h3 className="text-lg font-semibold">Add all</h3>
        {add.data ? (
          <>
            <p role="status">{addAllSummary(add.data)} They’re your own copies: change them as you like.</p>
            <div className="flex justify-end">
              <button type="button" onClick={onClose} className="tap-target rounded-lg border border-border px-4 py-2 hover:bg-soft">
                Done
              </button>
            </div>
          </>
        ) : (
          <>
            <p>
              A copy of each of the {c.itemCount} items in “{c.title}” goes to the place below. Ones already there are skipped.
            </p>
            <SaveToPicker value={owner} onChange={setOwner} orgs={orgs.data?.orgs} />
            {error && <p className="text-danger">{error}</p>}
            <div className="flex justify-end gap-2">
              <button type="button" onClick={onClose} className="tap-target rounded-lg border border-border px-4 py-2 hover:bg-soft">
                Cancel
              </button>
              <button
                type="button"
                disabled={add.isPending}
                onClick={() => {
                  setError(null);
                  add.mutate();
                }}
                className="tap-target rounded-lg bg-accent px-4 py-2 font-semibold text-accent-ink hover:bg-accent-hover disabled:opacity-50"
              >
                Add all
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/** /catalog/collections/:id */
export function CollectionPage() {
  const { id = '' } = useParams();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const me = useQuery({ queryKey: ['me'], queryFn: api.me });
  const data = useQuery({ queryKey: ['catalog-collection', id], queryFn: () => api.catalog.collection(id), retry: false });
  const [adding, setAdding] = useState<CatalogItem | null>(null);
  const [addAll, setAddAll] = useState(false);
  const [editing, setEditing] = useState(false);
  const withdraw = useMutation({
    mutationFn: () => api.catalog.withdrawCollection(id),
    onSuccess: () => {
      void invalidateFor(qc, 'catalog');
      navigate('/catalog');
    },
  });
  const user = me.data?.user ?? null;
  const c = data.data?.collection;
  const items = data.data?.items ?? [];
  return (
    <div className="h-full overflow-y-auto bg-bg p-4 text-ink sm:p-8">
      {user ? (
        <AppHeader user={user} />
      ) : (
        <header className="flex items-center justify-between gap-3">
          <Link to="/" className="font-display text-lg font-bold">Brick Layout Designer</Link>
          <Link to="/login" className="tap-target rounded-lg bg-accent px-4 py-2 font-semibold text-accent-ink hover:bg-accent-hover">
            Sign in
          </Link>
        </header>
      )}
      <main className="mx-auto mt-6 max-w-5xl space-y-5">
        <Link to="/catalog" className="text-sm text-accent-text hover:underline">‹ Catalog</Link>
        {data.isLoading ? (
          <p className="text-muted">Loading…</p>
        ) : !c ? (
          <p className="rounded-lg border border-dashed border-line p-6 text-center text-muted">This collection isn’t in the catalog.</p>
        ) : (
          <>
            <div className="flex flex-wrap items-start gap-4">
              <Cover url={c.coverUrl} className="aspect-[4/3] w-48" />
              <div className="min-w-[14rem] flex-1 space-y-1">
                <h1 className="text-2xl font-bold">{c.title}</h1>
                <p className="text-sm text-muted">
                  {c.featured ? 'Featured · ' : ''}
                  {counts(c)} · by {c.by}
                </p>
                {c.description && <p>{c.description}</p>}
                {c.canEdit && (
                  <p data-testid="collection-status" className="text-sm font-semibold">
                    {collectionStatus({ ...c, pending: !!c.pending }).label}
                  </p>
                )}
                {c.curatorNote && <p className="whitespace-pre-line rounded-md bg-soft px-2 py-1 text-xs">{c.curatorNote}</p>}
              </div>
              <div className="flex flex-wrap gap-2">
                {user ? (
                  c.status === 'public' &&
                  items.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setAddAll(true)}
                      className="tap-target rounded-lg bg-accent px-4 py-2 font-semibold text-accent-ink hover:bg-accent-hover"
                    >
                      Add all
                    </button>
                  )
                ) : (
                  <Link to="/login" className="tap-target rounded-lg border border-border px-4 py-2 font-semibold hover:bg-soft">
                    Sign in to add
                  </Link>
                )}
                {c.canEdit && c.status !== 'withdrawn' && (
                  <>
                    <button type="button" onClick={() => setEditing(true)} className="tap-target rounded-lg border border-border px-4 py-2 hover:bg-soft">
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if (confirm(`Take “${c.title}” out of the catalog? Copies people already added keep working.`)) withdraw.mutate();
                      }}
                      className="tap-target rounded-lg border border-border px-4 py-2 text-danger hover:bg-soft"
                    >
                      Withdraw
                    </button>
                  </>
                )}
              </div>
            </div>
            <ul aria-label="Items in this collection" className="grid grid-cols-[repeat(auto-fill,minmax(14rem,1fr))] gap-3">
              {items.map((it) => (
                <li key={it.id} data-testid="collection-item" className="flex flex-col gap-2 rounded-section border border-line bg-panel p-3">
                  <CatalogPreview item={it} />
                  <div className="min-w-0 flex-1 space-y-1">
                    <h2 className="break-words font-semibold">{it.title}</h2>
                    <p className="text-xs text-muted">
                      {it.kind === 'module' ? 'Module' : 'Part'} by {it.by} · version {it.version}
                    </p>
                    {it.description && <p className="line-clamp-3 text-sm">{it.description}</p>}
                  </div>
                  {user && (
                    <button
                      type="button"
                      onClick={() => setAdding(it)}
                      aria-label={`Add ${it.title}`}
                      className="tap-target rounded-lg border border-border px-3 py-1.5 text-sm font-semibold hover:bg-soft"
                    >
                      Add
                    </button>
                  )}
                </li>
              ))}
            </ul>
            {addAll && <AddAllDialog c={c} onClose={() => setAddAll(false)} />}
            {editing && <CollectionEditor id={c.id} onClose={() => setEditing(false)} />}
          </>
        )}
      </main>
      {adding && <AddDialog item={adding} onClose={() => setAdding(null)} />}
    </div>
  );
}

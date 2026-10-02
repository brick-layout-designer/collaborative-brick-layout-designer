// The public catalogs: modules and parts people shared for everyone. Search,
// tags, newest or popular, and "Add to my modules / my parts", which copies
// the item to you or a club you can add to. Signed-out visitors may browse
// when the site allows it; adding always needs an account.

import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type CatalogItem, type CatalogKind } from '../api';
import { AppHeader } from '../AppHeader';
import { SaveToPicker } from '../owners/OwnerControls';
import { CollectionsSection } from './Collections';
import { AddToCollectionDialog, type CollectionTarget } from './AddToCollection';

export function CatalogPage() {
  const me = useQuery({ queryKey: ['me'], queryFn: api.me });
  const settings = useQuery({ queryKey: ['catalog-settings'], queryFn: api.catalog.settings });
  const [params, setParams] = useSearchParams();
  const user = me.data?.user ?? null;
  const s = settings.data;
  const kinds: CatalogKind[] = [...(s?.modules ? (['module'] as const) : []), ...(s?.parts ? (['part'] as const) : [])];
  const wanted = params.get('kind') === 'part' ? 'part' : 'module';
  const kind: CatalogKind = kinds.includes(wanted) ? wanted : (kinds[0] ?? 'module');
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<'newest' | 'popular'>('newest');
  const tag = params.get('tag') ?? '';
  const items = useQuery({
    queryKey: ['catalog-items', kind, q, tag, sort],
    queryFn: () => api.catalog.items(kind, { q, tag, sort }),
    enabled: kinds.length > 0 && (!!user || !!s?.anonymousBrowse),
  });
  const [adding, setAdding] = useState<CatalogItem | null>(null);
  const [toCollection, setToCollection] = useState<CollectionTarget | null>(null);

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
        <div>
          <h1 className="text-2xl font-bold">Catalog</h1>
          <p className="text-muted">Modules and parts people have shared for everyone. Add one to copy it into your own modules or parts.</p>
        </div>
        {settings.isLoading || me.isLoading ? (
          <p className="text-muted">Loading…</p>
        ) : kinds.length === 0 ? (
          <p className="rounded-lg border border-dashed border-line p-6 text-center text-muted">
            The public catalog isn’t open on this site.
            {user?.isGlobalAdmin && (
              <>
                {' '}You can open it in <Link to="/admin" className="font-semibold text-accent-text hover:underline">Admin › Settings</Link>.
              </>
            )}
          </p>
        ) : !user && !s?.anonymousBrowse ? (
          <p className="rounded-lg border border-dashed border-line p-6 text-center text-muted">
            <Link to="/login" className="font-semibold text-accent-text hover:underline">Sign in</Link> to browse the catalog.
          </p>
        ) : (
          <>
            <CollectionsSection signedIn={!!user} />
            <div className="flex flex-wrap items-center gap-2">
              {kinds.length > 1 && (
                <div role="tablist" aria-label="Catalog" className="flex rounded-lg border border-line p-0.5">
                  {kinds.map((k) => (
                    <button
                      key={k}
                      role="tab"
                      type="button"
                      aria-selected={kind === k}
                      onClick={() => setParams(k === 'part' ? { kind: 'part' } : {})}
                      className={`tap-target rounded-md px-4 py-1.5 text-sm font-semibold ${kind === k ? 'bg-accent text-accent-ink' : 'hover:bg-soft'}`}
                    >
                      {k === 'module' ? 'Modules' : 'Parts'}
                    </button>
                  ))}
                </div>
              )}
              <input
                type="search"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder={kind === 'module' ? 'Search modules' : 'Search parts'}
                aria-label="Search the catalog"
                className="min-h-11 min-w-[12rem] flex-1 basis-full rounded-lg border border-border bg-soft px-3 sm:basis-auto"
              />
              <select
                value={sort}
                onChange={(e) => setSort(e.target.value as 'newest' | 'popular')}
                aria-label="Order"
                className="min-h-10 rounded-lg border border-border bg-soft px-2"
              >
                <option value="newest">Newest</option>
                <option value="popular">Most used</option>
              </select>
            </div>
            {tag && (
              <p className="text-sm">
                Tagged <b>{tag}</b>{' '}
                <button type="button" onClick={() => setParams(kind === 'part' ? { kind: 'part' } : {})} className="text-accent-text hover:underline">
                  Show all
                </button>
              </p>
            )}
            {items.isLoading && <p className="text-muted">Loading…</p>}
            {items.isError && <p className="text-danger">{(items.error as Error).message}</p>}
            {items.data && items.data.items.length === 0 && (
              <p className="rounded-lg border border-dashed border-line p-6 text-center text-muted">
                Nothing here yet. Share a module or part from its ⋯ menu on Home.
              </p>
            )}
            <ul className="grid grid-cols-[repeat(auto-fill,minmax(14rem,1fr))] gap-3">
              {items.data?.items.map((it) => (
                <li key={it.id} data-testid="catalog-item" className="flex flex-col gap-2 rounded-section border border-line bg-panel p-3">
                  <CatalogPreview item={it} />
                  <div className="min-w-0 flex-1 space-y-1">
                    <h2 className="break-words font-semibold">{it.title}</h2>
                    <p className="text-xs text-muted">
                      by {it.by} · version {it.version} · {it.uses} {it.uses === 1 ? 'use' : 'uses'}
                    </p>
                    {it.description && <p className="line-clamp-3 text-sm">{it.description}</p>}
                    {it.tags.length > 0 && (
                      <p className="flex flex-wrap gap-1">
                        {it.tags.map((t) => (
                          <button
                            key={t}
                            type="button"
                            onClick={() => setParams({ ...(kind === 'part' ? { kind: 'part' } : {}), tag: t })}
                            className="rounded-full bg-soft px-2 py-0.5 text-xs hover:bg-line"
                          >
                            {t}
                          </button>
                        ))}
                      </p>
                    )}
                  </div>
                  {user ? (
                    <div className="flex flex-col gap-2">
                      <button
                        type="button"
                        onClick={() => setAdding(it)}
                        aria-label={`Add ${it.title}`}
                        className="tap-target rounded-lg bg-accent px-3 py-1.5 text-sm font-semibold text-accent-ink hover:bg-accent-hover"
                      >
                        {kind === 'module' ? 'Add to my modules' : 'Add to my parts'}
                      </button>
                      <button
                        type="button"
                        onClick={() => setToCollection({ kind: 'catalog', item: it })}
                        aria-label={`${it.title}: add to a collection`}
                        className="tap-target rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-soft"
                      >
                        Add to a collection…
                      </button>
                    </div>
                  ) : (
                    <Link to="/login" className="tap-target rounded-lg border border-border px-3 py-1.5 text-center text-sm font-semibold hover:bg-soft">
                      Sign in to add
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          </>
        )}
      </main>
      {adding && <AddDialog item={adding} onClose={() => setAdding(null)} />}
      {toCollection && <AddToCollectionDialog target={toCollection} onClose={() => setToCollection(null)} />}
    </div>
  );
}

export function CatalogPreview({ item }: { item: Pick<CatalogItem, 'previewUrl' | 'title'> }) {
  const [failed, setFailed] = useState(false);
  return failed ? (
    <span aria-hidden className="block aspect-[4/3] w-full rounded-lg border border-line bg-soft" />
  ) : (
    <img
      src={item.previewUrl}
      alt=""
      loading="lazy"
      data-testid="catalog-preview"
      onError={() => setFailed(true)}
      className="aspect-[4/3] w-full rounded-lg border border-line bg-soft object-contain"
    />
  );
}

/** "Add to my modules / parts": where the copy goes, then where to find it. */
export function AddDialog({ item, onClose, onAdded }: { item: CatalogItem; onClose: () => void; onAdded?: (id: string) => void }) {
  const qc = useQueryClient();
  const orgs = useQuery({ queryKey: ['orgs'], queryFn: api.orgs.list });
  const [owner, setOwner] = useState('');
  const [error, setError] = useState<string | null>(null);
  const add = useMutation({
    mutationFn: () => api.catalog.add(item.id, owner || undefined),
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: [r.kind === 'module' ? 'modules' : 'custom-parts'] });
      if (r.kind === 'part') void qc.fetchQuery({ queryKey: ['parts-catalog'], queryFn: api.parts.catalogFresh, staleTime: 0 }).catch(() => undefined);
      void qc.invalidateQueries({ queryKey: ['catalog-items'] });
      onAdded?.(r.id);
    },
    onError: (e: Error) => setError(e.message),
  });
  const isModule = item.kind === 'module';
  return (
    <div className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-black/60 p-4">
      <div role="dialog" aria-modal="true" aria-label={`Add ${item.title}`} className="w-full max-w-md space-y-4 rounded-section border border-line bg-panel p-5 text-sm">
        <h3 className="text-lg font-semibold">{isModule ? 'Add to my modules' : 'Add to my parts'}</h3>
        {add.data ? (
          <>
            <p role="status">
              “{item.title}” is now in your {isModule ? 'modules' : 'parts'}. It’s your own copy: change it as you like.
            </p>
            <div className="flex justify-end gap-2">
              {isModule && (
                <Link to={`/modules/${add.data.id}`} className="tap-target rounded-lg bg-accent px-4 py-2 font-semibold text-accent-ink hover:bg-accent-hover">
                  Open it
                </Link>
              )}
              <button type="button" onClick={onClose} className="tap-target rounded-lg border border-border px-4 py-2 hover:bg-soft">
                Done
              </button>
            </div>
          </>
        ) : (
          <>
            <p>A copy of “{item.title}” goes to:</p>
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
                Add
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// The public catalogs: modules and parts people shared for everyone. Search,
// tags, newest or popular, and "Add to my modules / my parts", which copies
// the item to you or a club you can add to. Signed-out visitors may browse
// when the site allows it; adding always needs an account.

import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { SignInLink } from '../auth/signIn';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type CatalogItem, type CatalogKind, type CatalogSummary } from '../api';
import { AppHeader } from '../AppHeader';
import { SaveToPicker } from '../owners/OwnerControls';
import { CollectionsSection } from './Collections';
import { TrustedBadge } from './TrustedBadge';
import { AddToCollectionDialog, type CollectionTarget } from './AddToCollection';
import { ItemCoverDialog } from './ItemCover';

export function CatalogPage() {
  const me = useQuery({ queryKey: ['me'], queryFn: api.me });
  const demo = !!me.data?.user?.isDemoAccount;
  const settings = useQuery({ queryKey: ['catalog-settings'], queryFn: api.catalog.settings });
  const [params, setParams] = useSearchParams();
  const user = me.data?.user ?? null;
  const s = settings.data;
  const kinds = kindsOn(s);
  // Collections (of modules and parts) are a tab like the kinds, as in the
  // desktop app: on a phone the list you asked for comes first, not a
  // screenful of collection cards.
  const tabs: CatalogTab[] = [...kinds, ...(s?.modules || s?.parts ? (['collections'] as const) : [])];
  const wantedTab = (params.get('kind') ?? 'module') as CatalogTab;
  const tab: CatalogTab = tabs.includes(wantedTab) ? wantedTab : (tabs[0] ?? 'module');
  const showingCollections = tab === 'collections';
  const kind: CatalogKind = tab === 'collections' ? (kinds[0] ?? 'module') : tab;
  const kindParam = (k: CatalogTab): Record<string, string> => (k === 'module' ? {} : { kind: k });
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<'newest' | 'popular'>('newest');
  const tag = params.get('tag') ?? '';
  const items = useQuery({
    queryKey: ['catalog-items', kind, q, tag, sort],
    queryFn: () => api.catalog.items(kind, { q, tag, sort }),
    enabled: kinds.length > 0 && !showingCollections && (!!user || !!s?.anonymousBrowse),
  });
  const [adding, setAdding] = useState<CatalogItem | null>(null);
  // What I (or my clubs) shared: those cards offer "Cover picture…".
  const mine = useQuery({ queryKey: ['catalog-mine'], queryFn: api.catalog.mine, enabled: !!user && kinds.length > 0 });
  const mineIds = new Set((mine.data?.items ?? []).map((i) => i.id));
  const [coverFor, setCoverFor] = useState<string | null>(null);
  const [toCollection, setToCollection] = useState<CollectionTarget | null>(null);

  return (
    <div className="h-full overflow-y-auto bg-bg p-4 text-ink sm:p-8">
      {user ? (
        <AppHeader user={user} />
      ) : (
        <header className="flex items-center justify-between gap-3">
          <Link to="/" className="tap-target inline-flex items-center font-display text-lg font-bold">Brick Layout Designer</Link>
          <SignInLink className="tap-target rounded-lg bg-accent px-4 py-2 font-semibold text-accent-ink hover:bg-accent-hover">
            Sign in
          </SignInLink>
        </header>
      )}
      <main className="mx-auto mt-6 max-w-5xl space-y-5">
        <div>
          <h1 className="text-2xl font-bold">Catalog</h1>
          <p className="text-muted">What people have shared for everyone. Add one to copy it into your own things.</p>
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
            <SignInLink className="font-semibold text-accent-text hover:underline">Sign in</SignInLink> to browse the catalog.
          </p>
        ) : (
          <>
            {tabs.length > 1 && (
              <div role="tablist" aria-label="Catalog" className="flex w-fit max-w-full flex-wrap rounded-lg border border-line p-0.5">
                {tabs.map((k) => (
                  <button
                    key={k}
                    role="tab"
                    type="button"
                    aria-selected={tab === k}
                    onClick={() => setParams(kindParam(k))}
                    className={`tap-target rounded-md px-4 py-1.5 text-sm font-semibold ${tab === k ? 'bg-accent text-accent-ink' : 'hover:bg-soft'}`}
                  >
                    {k === 'collections' ? 'Collections' : KIND_LABEL[k].tab}
                  </button>
                ))}
              </div>
            )}
            {showingCollections ? (
              <CollectionsSection signedIn={!!user} />
            ) : (
            <>
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="search"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder={`Search ${KIND_LABEL[kind].tab.toLowerCase()}`}
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
                <button type="button" onClick={() => setParams(kindParam(kind))} className="text-accent-text hover:underline">
                  Show all
                </button>
              </p>
            )}
            {items.isLoading && <p className="text-muted">Loading…</p>}
            {items.isError && <p className="text-danger">{(items.error as Error).message}</p>}
            {items.data && items.data.items.length === 0 && (
              <p className="rounded-lg border border-dashed border-line p-6 text-center text-muted">
                {!me.data?.user
                  ? 'Nothing here yet. Check back later, or sign in to share your own.'
                  : kind === 'layout'
                    ? 'Nothing here yet. Share a layout from the editor’s menu, or its ⋯ menu on Home.'
                    : kind === 'venue'
                      ? 'Nothing here yet. Share a venue from its ⋯ menu in your venues.'
                      : `Nothing here yet. Share a ${kind} from its ⋯ menu on Home.`}
              </p>
            )}
            <ul className="grid grid-cols-[repeat(auto-fill,minmax(14rem,1fr))] gap-3">
              {items.data?.items.map((it) => (
                <li key={it.id} data-testid="catalog-item" className="flex flex-col gap-2 rounded-section border border-line bg-panel p-3">
                  {hasPage(it.kind) ? (
                    <Link to={`/catalog/items/${it.id}`} aria-label={`Open ${it.title}`}>
                      <CatalogPreview item={it} />
                    </Link>
                  ) : (
                    <CatalogPreview item={it} />
                  )}
                  <div className="min-w-0 flex-1 space-y-1">
                    <h2 className="break-words font-semibold">
                      {hasPage(it.kind) ? (
                        <Link to={`/catalog/items/${it.id}`} className="hover:underline">
                          {it.title}
                        </Link>
                      ) : (
                        it.title
                      )}
                    </h2>
                    {it.summary && <p className="text-xs text-muted">{summaryText(it.summary)}</p>}
                    <p className="text-xs text-muted">
                      by {it.by}
                      {it.trustedClub && <TrustedBadge />} · version {it.version} · {it.uses} {it.uses === 1 ? 'use' : 'uses'}
                    </p>
                    {it.description && <p className="line-clamp-3 text-sm">{it.description}</p>}
                    {it.tags.length > 0 && (
                      <p className="flex flex-wrap gap-1">
                        {it.tags.map((t) => (
                          <button
                            key={t}
                            type="button"
                            onClick={() => setParams({ ...kindParam(kind), tag: t })}
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
                        {KIND_LABEL[kind].add}
                      </button>
                      {!demo && (
                        <button
                          type="button"
                          onClick={() => setToCollection({ kind: 'catalog', item: it })}
                          aria-label={`${it.title}: add to a collection`}
                          className="tap-target rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-soft"
                        >
                          Add to a collection…
                        </button>
                      )}
                      {mineIds.has(it.id) && (
                        <button
                          type="button"
                          onClick={() => setCoverFor(it.id)}
                          aria-label={`${it.title}: cover picture`}
                          className="tap-target rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-soft"
                        >
                          Cover picture…
                        </button>
                      )}
                    </div>
                  ) : (
                    <SignInLink className="tap-target rounded-lg border border-border px-3 py-1.5 text-center text-sm font-semibold hover:bg-soft">
                      Sign in to add
                    </SignInLink>
                  )}
                </li>
              ))}
            </ul>
            </>
            )}
          </>
        )}
      </main>
      {adding && <AddDialog item={adding} onClose={() => setAdding(null)} />}
      {toCollection && <AddToCollectionDialog target={toCollection} onClose={() => setToCollection(null)} />}
      {coverFor && <ItemCoverDialog itemId={coverFor} onClose={() => setCoverFor(null)} />}
    </div>
  );
}

/** The card's picture: its owner's own fills the card (it was cropped to it); the drawn one fits inside. */
/** The Catalog page's tabs: each kind that's on, and Collections. */
export type CatalogTab = CatalogKind | 'collections';

/** What each kind is called on tabs and buttons. */
export const KIND_LABEL: Record<CatalogKind, { tab: string; add: string; mine: string }> = {
  module: { tab: 'Modules', add: 'Add to my modules', mine: 'modules' },
  part: { tab: 'Parts', add: 'Add to my parts', mine: 'parts' },
  layout: { tab: 'Layouts', add: 'Copy to my layouts', mine: 'layouts' },
  venue: { tab: 'Venues', add: 'Copy to my venues', mine: 'venues' },
};

/** The catalogs that are on, in tab order. */
export function kindsOn(s: { modules?: boolean; parts?: boolean; layouts?: boolean; venues?: boolean } | undefined): CatalogKind[] {
  if (!s) return [];
  return (['module', 'part', 'layout', 'venue'] as const).filter((k) => (k === 'module' ? s.modules : k === 'part' ? s.parts : k === 'layout' ? s.layouts : s.venues));
}

/** Layouts and venues have their own page (a viewer). */
export const hasPage = (k: CatalogKind) => k === 'layout' || k === 'venue';

/** "960 × 480 studs (7.7 × 3.8 m) · 1,204 parts". */
export function summaryText(s: CatalogSummary): string {
  const m = (studs: number) => (studs * 0.008).toFixed(1);
  const size = s.widthStuds && s.heightStuds ? `${s.widthStuds} × ${s.heightStuds} studs (${m(s.widthStuds)} × ${m(s.heightStuds)} m)` : '';
  const parts = s.partCount !== undefined ? `${s.partCount.toLocaleString()} ${s.partCount === 1 ? 'part' : 'parts'}` : '';
  return [size, parts].filter(Boolean).join(' · ');
}

export function CatalogPreview({ item }: { item: Pick<CatalogItem, 'previewUrl' | 'title' | 'coverUrl' | 'customCover'> }) {
  const [failed, setFailed] = useState(false);
  const custom = !!item.customCover && !!item.coverUrl;
  return failed ? (
    <span aria-hidden className="block aspect-[4/3] w-full rounded-lg border border-line bg-soft" />
  ) : (
    <img
      src={custom ? item.coverUrl : item.previewUrl}
      alt=""
      loading="lazy"
      data-testid="catalog-preview"
      onError={() => setFailed(true)}
      className={`aspect-[4/3] w-full rounded-lg border border-line bg-soft ${custom ? 'object-cover' : 'object-contain'}`}
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
      void qc.invalidateQueries({ queryKey: [r.kind === 'module' ? 'modules' : r.kind === 'part' ? 'custom-parts' : r.kind === 'layout' ? 'layouts' : 'venues'] });
      if (r.kind === 'part') void qc.fetchQuery({ queryKey: ['parts-catalog'], queryFn: api.parts.catalogFresh, staleTime: 0 }).catch(() => undefined);
      void qc.invalidateQueries({ queryKey: ['catalog-items'] });
      onAdded?.(r.id);
    },
    onError: (e: Error) => setError(e.message),
  });
  const isModule = item.kind === 'module';
  const label = KIND_LABEL[item.kind];
  return (
    <div className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-black/60 p-4">
      <div role="dialog" aria-modal="true" aria-label={`Add ${item.title}`} className="w-full max-w-md space-y-4 rounded-section border border-line bg-panel p-5 text-sm">
        <h3 className="text-lg font-semibold">{label.add}</h3>
        {add.data ? (
          <>
            <p role="status">
              “{item.title}” is now in your {label.mine}. It’s your own copy: change it as you like.
            </p>
            <div className="flex justify-end gap-2">
              {(isModule || item.kind === 'layout') && (
                <Link
                  to={isModule ? `/modules/${add.data.id}` : `/editor/${add.data.id}`}
                  className="tap-target rounded-lg bg-accent px-4 py-2 font-semibold text-accent-ink hover:bg-accent-hover"
                >
                  Open it
                </Link>
              )}
              {item.kind === 'venue' && (
                <Link to={`/?newLayoutVenue=${encodeURIComponent(add.data.id)}`} className="tap-target rounded-lg bg-accent px-4 py-2 font-semibold text-accent-ink hover:bg-accent-hover">
                  Start a layout in it
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

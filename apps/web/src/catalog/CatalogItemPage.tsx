// A layout's or venue's page in the public catalog: the published copy in
// the read-only viewer (the editor's renderer: pan, zoom, saved views,
// module names), and beside it who shared it, its size, a layout's parts
// list, a share link, and "Copy to my layouts / venues" (or a club's),
// "Download .bld-layout / .bbm" and "Start a layout in this venue".
// Signed-out visitors see it when the site lets them browse.

import { useMemo, useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import { SignInLink } from '../auth/signIn';
import { useMutation, useQuery } from '@tanstack/react-query';
import { createDefaultLayoutDoc, decodeDoc } from '@cld/ydoc';
import type * as Y from 'yjs';
import { api, type CatalogItem, type CatalogSummary } from '../api';
import { LayoutViewer } from '../layouts/PublicLayoutPage';
import { AddDialog, KIND_LABEL, summaryText } from './CatalogPage';
import { AddToCollectionDialog, type CollectionTarget } from './AddToCollection';
import { ItemCoverDialog } from './ItemCover';
import { TrustedBadge } from './TrustedBadge';
import { useIsDemo } from './ShareToCatalog';

const btn = 'tap-target rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-soft';
const primary = 'tap-target rounded-lg bg-accent px-3 py-1.5 text-sm font-semibold text-accent-ink hover:bg-accent-hover';

export function CatalogItemPage() {
  const { id } = useParams<{ id: string }>();
  if (!id) return <Navigate to="/catalog" replace />;
  return <ItemPage id={id} />;
}

function ItemPage({ id }: { id: string }) {
  const me = useQuery({ queryKey: ['me'], queryFn: api.me });
  const detail = useQuery({ queryKey: ['catalog-item', id], queryFn: () => api.catalog.item(id), retry: false });
  const item = detail.data?.item;
  const isLayout = item?.kind === 'layout';
  const snapshot = useQuery({ queryKey: ['catalog-item-snapshot', id, item?.version], queryFn: () => api.catalog.itemSnapshot(id), enabled: isLayout, retry: false });
  const venue = useQuery({ queryKey: ['catalog-item-venue', id, item?.version], queryFn: () => api.catalog.itemVenue(id), enabled: item?.kind === 'venue', retry: false });

  const doc = useMemo<Y.Doc | null>(() => {
    if (isLayout) {
      if (!snapshot.data) return null;
      try {
        return decodeDoc(snapshot.data.bytes);
      } catch {
        return null;
      }
    }
    if (!venue.data) return null;
    // A venue shows on an empty map, the way a layout in it starts.
    const d = createDefaultLayoutDoc();
    d.getMap('meta').set('cache', { schemaVersion: 1, bbmHashSha256: '', venue: { ...venue.data.venue, enabled: true } });
    return d;
  }, [isLayout, snapshot.data, venue.data]);

  if (detail.isError || snapshot.isError || venue.isError) {
    return (
      <div className="grid min-h-screen place-items-center p-8 text-center">
        <div>
          <h1 className="text-xl font-semibold">Not in the catalog</h1>
          <p className="mt-2 text-sm text-muted">It may have been taken down, or you need to sign in to browse.</p>
          <Link to="/catalog" className="mt-4 inline-block text-sm text-accent-text hover:underline">
            Back to the catalog
          </Link>
        </div>
      </div>
    );
  }
  // Modules and parts have no page of their own: their list instead (before
  // waiting for a picture that never comes for them).
  if (item && item.kind !== 'layout' && item.kind !== 'venue') return <Navigate to={`/catalog?kind=${item.kind}`} replace />;
  if (!item || !doc) return <div className="grid min-h-screen place-items-center text-muted">Loading…</div>;
  const v = venue.data?.venue;
  return (
    <LayoutViewer
      doc={doc}
      title={item.title}
      badge={item.kind === 'layout' ? 'Catalog layout · view only' : 'Catalog venue · view only'}
      fitBounds={v?.bounds ? { x: v.bounds.x, y: v.bounds.y, width: v.bounds.w, height: v.bounds.h } : null}
      topRight={
        <Link to={`/catalog?kind=${item.kind}`} className="tap-target inline-flex items-center rounded-lg border border-border bg-panel/95 px-3 py-1.5 text-sm shadow hover:bg-soft">
          Catalog
        </Link>
      }
      side={<InfoPanel item={item} signedIn={!!me.data?.user} />}
    />
  );
}

/** The details card: who, how big, what's in it, and what you can do. */
function InfoPanel({ item, signedIn }: { item: CatalogItem & { club?: { slug: string; name: string } | null }; signedIn: boolean }) {
  const navigate = useNavigate();
  const demo = useIsDemo();
  const [open, setOpen] = useState(() => typeof window === 'undefined' || window.innerWidth >= 640);
  const [adding, setAdding] = useState(false);
  const [toCollection, setToCollection] = useState<CollectionTarget | null>(null);
  const [cover, setCover] = useState(false);
  const [copied, setCopied] = useState(false);
  const mine = useQuery({ queryKey: ['catalog-mine'], queryFn: api.catalog.mine, enabled: signedIn });
  const isMine = !!mine.data?.items.some((i) => i.id === item.id);
  const start = useMutation({
    mutationFn: () => api.catalog.add(item.id),
    onSuccess: (r) => navigate(`/?newLayoutVenue=${encodeURIComponent(r.id)}`),
  });
  const shareUrl = `${window.location.origin}/catalog/items/${item.id}`;
  const label = KIND_LABEL[item.kind];
  return (
    <>
      <div
        // On a phone it sits above the zoom buttons, which share the bottom row.
        className="absolute z-10 w-[min(22rem,calc(100%-1.5rem))] rounded-section border border-line bg-panel/95 text-sm shadow [--zoom-row:3.5rem] sm:[--zoom-row:0px]"
        style={{ left: 'max(0.75rem, env(safe-area-inset-left))', bottom: 'calc(max(0.75rem, env(safe-area-inset-bottom)) + var(--zoom-row))' }}
        data-testid="catalog-item-panel"
      >
        <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="flex w-full items-center justify-between px-3 py-2 font-semibold">
          {open ? 'Details' : `Details · ${label.add}`}
          <span aria-hidden>{open ? '▾' : '▴'}</span>
        </button>
        {open && (
          <div className="max-h-[60dvh] space-y-3 overflow-y-auto px-3 pb-3">
            <p className="text-muted">
              by {item.by}
              {item.trustedClub && <TrustedBadge />}
              {item.club && (
                <>
                  {' · '}
                  <Link to={`/orgs/${item.club.slug}`} className="text-accent-text hover:underline">
                    {item.club.name}
                  </Link>
                </>
              )}
            </p>
            <p className="text-xs text-muted">
              Version {item.version} · {item.uses} {item.uses === 1 ? 'copy' : 'copies'}
            </p>
            {item.summary && <Summary s={item.summary} kind={item.kind} />}
            {item.description && <p className="whitespace-pre-line">{item.description}</p>}
            <div className="flex flex-wrap gap-2">
              {signedIn ? (
                <>
                  <button type="button" className={primary} onClick={() => setAdding(true)}>
                    {label.add}…
                  </button>
                  {item.kind === 'venue' && (
                    <button type="button" className={btn} disabled={start.isPending} onClick={() => start.mutate()}>
                      Start a layout in this venue
                    </button>
                  )}
                  {!demo && (
                    <button type="button" className={btn} onClick={() => setToCollection({ kind: 'catalog', item })}>
                      Add to a collection…
                    </button>
                  )}
                  {isMine && (
                    <button type="button" className={btn} onClick={() => setCover(true)}>
                      Cover picture…
                    </button>
                  )}
                </>
              ) : (
                <SignInLink className={primary}>
                  Sign in to copy it
                </SignInLink>
              )}
            </div>
            {start.isError && <p className="text-danger">{(start.error as Error).message}</p>}
            {item.kind === 'layout' && (
              <p className="flex flex-wrap gap-x-3 gap-y-1">
                <a href={api.catalog.downloadUrl(item.id, 'bld-layout')} className="text-accent-text hover:underline">
                  Download .bld-layout
                </a>
                <a href={api.catalog.downloadUrl(item.id, 'bbm')} className="text-accent-text hover:underline">
                  Download .bbm (BlueBrick)
                </a>
              </p>
            )}
            <div className="flex items-center gap-2">
              <input readOnly value={shareUrl} aria-label="Share link" className="min-h-9 min-w-0 flex-1 rounded-lg border border-border bg-soft px-2 text-xs" onFocus={(e) => e.target.select()} />
              <button
                type="button"
                className={btn}
                onClick={() => {
                  void navigator.clipboard?.writeText(shareUrl).then(() => setCopied(true));
                }}
              >
                {copied ? 'Copied' : 'Copy link'}
              </button>
            </div>
          </div>
        )}
      </div>
      {adding && <AddDialog item={item} onClose={() => setAdding(false)} />}
      {toCollection && <AddToCollectionDialog target={toCollection} onClose={() => setToCollection(null)} />}
      {cover && <ItemCoverDialog itemId={item.id} onClose={() => setCover(false)} />}
    </>
  );
}

function Summary({ s, kind }: { s: CatalogSummary; kind: CatalogItem['kind'] }) {
  const parts = s.parts ?? [];
  return (
    <div className="space-y-1">
      <p>{summaryText(s)}</p>
      {kind === 'layout' && s.venue && <p className="text-xs text-muted">Planned in the venue “{s.venue}”.</p>}
      {parts.length > 0 && (
        <details>
          <summary className="cursor-pointer text-accent-text">Parts list ({parts.length} kinds)</summary>
          <table className="mt-1 w-full text-xs" data-testid="catalog-bom">
            <thead>
              <tr className="text-left text-muted">
                <th className="py-0.5 font-normal">Part</th>
                <th className="py-0.5 text-right font-normal">How many</th>
              </tr>
            </thead>
            <tbody>
              {parts.map((p) => (
                <tr key={p.partNumber} className="border-t border-line">
                  <td className="py-0.5 font-mono">{p.partNumber}</td>
                  <td className="py-0.5 text-right">{p.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}
    </div>
  );
}

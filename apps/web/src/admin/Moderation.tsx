// Moderation (moderators and global admins), built for thousands of
// entries: a few views (To review, Trusted clubs' queues, In the catalog,
// Collections, Trusted clubs) with counts; each list is a page at a time
// from the server, with search, kind, dates and order; compact rows you
// can tick to approve, decline or unpublish several at once; and a panel
// with everything about one. The view is in the address
// (/admin?tab=moderation&view=published). Plus the catalog settings
// (global admins only, in Settings).

import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  api,
  type AdminJobSetting,
  type CatalogKind,
  type CatalogReview,
  type CollectionReviewEntry,
  type CoverReviewEntry,
  type ModeratedCollection,
  type ModeratedItem,
  type ModerationClub,
  type ModerationEntry,
  type ModerationFilter,
  type ModerationView,
  type WarningSubject,
} from '../api';
import { HelpButton } from '../help/HelpButton';
import { WarnForm } from '../notices/Notices';
import { invalidateFor } from '../live/invalidate';
import { TrustedBadge } from '../catalog/TrustedBadge';
import { askConfirm, askReason, deleteOptions, showToast, toastDeleted } from '../ui/ConfirmDialog';

/** What a catalog entry is, in a sentence. */
const KIND_WORD: Record<CatalogKind, string> = { module: 'module', part: 'part', layout: 'layout', venue: 'venue' };
const PAGE = 50;

/** An entry's picture, or a plain tile when it has none (or it can't load). */
function Thumb({ src, className }: { src: string; className: string }) {
  const [failed, setFailed] = useState(false);
  return failed || !src ? (
    <span aria-hidden className={`${className} block`} />
  ) : (
    <img src={src} alt="" loading="lazy" onError={() => setFailed(true)} className={className} />
  );
}

type View = 'review' | 'trusted' | 'published' | 'collections' | 'clubs';
const VIEWS: { id: View; label: string }[] = [
  { id: 'review', label: 'To review' },
  { id: 'trusted', label: 'Trusted clubs’ queues' },
  { id: 'published', label: 'In the catalog' },
  { id: 'collections', label: 'Collections' },
  { id: 'clubs', label: 'Trusted clubs' },
];

export function ModerationTab() {
  const [params, setParams] = useSearchParams();
  const wanted = params.get('view') as View | null;
  const view: View = VIEWS.some((v) => v.id === wanted) ? wanted! : 'review';
  const counts = useQuery({ queryKey: ['moderation', 'counts'], queryFn: api.moderation.counts, staleTime: 10_000 });
  const c = counts.data;
  const badge: Partial<Record<View, number>> = c
    ? { review: c.waiting + c.covers + c.collections, trusted: c.trusted + c.trustedCovers, published: c.public + c.unpublished }
    : {};
  const go = (v: View) => {
    const p = new URLSearchParams(params);
    p.set('tab', 'moderation');
    if (v === 'review') p.delete('view');
    else p.set('view', v);
    setParams(p);
  };
  return (
    <div className="space-y-5">
      <div role="tablist" aria-label="Moderation" className="flex flex-wrap gap-1">
        {VIEWS.map((v) => (
          <button
            key={v.id}
            type="button"
            role="tab"
            aria-selected={view === v.id}
            onClick={() => go(v.id)}
            className={`tap-target inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-semibold ${view === v.id ? 'bg-accent text-accent-ink' : 'bg-soft hover:bg-line'}`}
          >
            {v.label}
            {badge[v.id] !== undefined && badge[v.id]! > 0 && (
              <span className={`rounded-full px-1.5 text-xs tabular-nums ${view === v.id ? 'bg-accent-ink/20' : 'bg-panel'}`}>{badge[v.id]!.toLocaleString()}</span>
            )}
          </button>
        ))}
      </div>
      {view === 'review' && (
        <>
          <ModerationList view="waiting" title="Catalog items" total={c?.waiting} />
          <CoverQueue trusted={false} />
          <CollectionModeration part="queue" />
        </>
      )}
      {view === 'trusted' && (
        <>
          <p className="text-sm text-muted">Each trusted club’s admins and managers review these. You can still approve or decline one.</p>
          <ModerationList view="trusted" title="Catalog items" total={c?.trusted} />
          <CoverQueue trusted />
          <CollectionModeration part="trusted" />
        </>
      )}
      {view === 'published' && <PublishedView counts={c ? { public: c.public, unpublished: c.unpublished } : undefined} />}
      {view === 'collections' && <CollectionModeration part="listed" />}
      {view === 'clubs' && <TrustedClubsSection />}
    </div>
  );
}

/** In the catalog: what's public, or what was unpublished. */
function PublishedView({ counts }: { counts?: { public: number; unpublished: number } | undefined }) {
  const [status, setStatus] = useState<'public' | 'unpublished'>('public');
  return (
    <div className="space-y-3">
      <div role="radiogroup" aria-label="Show" className="flex flex-wrap gap-1 text-sm">
        {(['public', 'unpublished'] as const).map((s) => (
          <label key={s} className={`tap-target inline-flex cursor-pointer items-center gap-1.5 rounded-lg border px-3 py-1 ${status === s ? 'border-accent bg-accent/10 font-semibold' : 'border-border'}`}>
            <input type="radio" name="mod-status" className="sr-only" checked={status === s} onChange={() => setStatus(s)} />
            {s === 'public' ? 'Public' : 'Unpublished'}
            {counts && <span className="text-xs tabular-nums text-muted">{counts[s].toLocaleString()}</span>}
          </label>
        ))}
      </div>
      <ModerationList key={status} view={status} title={status === 'public' ? 'Public items' : 'Unpublished items'} total={counts?.[status]} />
    </div>
  );
}

type Row = ModerationEntry | ModeratedItem;
const isEntry = (r: Row): r is ModerationEntry => 'versionId' in r;
const rowId = (r: Row) => (isEntry(r) ? r.versionId : r.id);

/** Search, kind, dates and order for a list; the search waits for a pause in typing. */
function Filters({ f, set, waiting, kinds = true }: { f: ModerationFilter; set: (f: ModerationFilter) => void; waiting: boolean; kinds?: boolean }) {
  const [q, setQ] = useState(f.q ?? '');
  useEffect(() => {
    const t = setTimeout(() => q !== (f.q ?? '') && set({ ...f, q }), 300);
    return () => clearTimeout(t);
  }, [q, f, set]);
  const day = (ms?: number) => (ms ? new Date(ms).toISOString().slice(0, 10) : '');
  const ms = (s: string, end: boolean) => (s ? new Date(`${s}T${end ? '23:59:59' : '00:00:00'}`).getTime() : undefined);
  const field = 'min-h-11 rounded-lg border border-border bg-soft px-2 text-sm';
  return (
    <div className="flex flex-wrap items-end gap-2">
      <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search title, description, tags or reason" aria-label="Search" className={`${field} min-w-0 flex-1 basis-full px-3 sm:basis-60`} />
      {kinds && (
      <select value={f.kind ?? ''} onChange={(e) => set({ ...f, kind: e.target.value as CatalogKind | '' })} aria-label="Kind" className={field}>
        <option value="">All kinds</option>
        <option value="module">Modules</option>
        <option value="part">Parts</option>
        <option value="layout">Layouts</option>
        <option value="venue">Venues</option>
      </select>
      )}
      <label className="flex flex-col text-xs text-muted">
        {waiting ? 'Sent from' : 'Changed from'}
        <input type="date" value={day(f.from)} onChange={(e) => set({ ...f, from: ms(e.target.value, false) })} className={field} />
      </label>
      <label className="flex flex-col text-xs text-muted">
        to
        <input type="date" value={day(f.to)} onChange={(e) => set({ ...f, to: ms(e.target.value, true) })} className={field} />
      </label>
      <select
        value={f.sort ?? (waiting ? 'oldest' : 'newest')}
        onChange={(e) => set({ ...f, sort: e.target.value as 'oldest' | 'newest' })}
        aria-label="Order"
        className={field}
      >
        <option value="oldest">Oldest first</option>
        <option value="newest">Newest first</option>
      </select>
    </div>
  );
}

/**
 * One list, a page at a time: compact rows to tick for doing several at
 * once, each with its own buttons, and a panel with the whole entry.
 */
function ModerationList({ view, title, total }: { view: ModerationView; title: string; total?: number | undefined }) {
  const qc = useQueryClient();
  const waiting = view === 'waiting' || view === 'trusted';
  const [f, setF] = useState<ModerationFilter>({});
  const [offset, setOffset] = useState(0);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<Row | null>(null);
  const list = useQuery({
    queryKey: ['moderation', 'list', view, f, offset],
    queryFn: () => api.moderation.list(view, { ...f, limit: PAGE, offset }),
    placeholderData: (prev) => prev,
  });
  const rows: Row[] = list.data?.rows ?? [];
  const count = list.data?.total ?? 0;
  const setFilter = (n: ModerationFilter) => {
    setF(n);
    setOffset(0);
    setPicked(new Set());
  };
  // Ticks only count what's on this page.
  useEffect(() => {
    setPicked((p) => {
      const here = new Set(rows.map(rowId));
      const kept = [...p].filter((id) => here.has(id));
      return kept.length === p.size ? p : new Set(kept);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list.data]);
  const done = () => {
    void qc.invalidateQueries({ queryKey: ['moderation'] });
    void qc.invalidateQueries({ queryKey: ['catalog-items'] });
  };
  const fail = (e: Error) => showToast(e.message);
  const one = useMutation({
    mutationFn: (a: { action: 'approve' | 'decline' | 'unpublish'; id: string; reason?: string }) =>
      a.action === 'approve' ? api.moderation.approve(a.id) : a.action === 'decline' ? api.moderation.decline(a.id, a.reason ?? '') : api.moderation.unpublish(a.id, a.reason ?? ''),
    onSuccess: () => {
      setOpen(null);
      done();
    },
    onError: fail,
  });
  const many = useMutation({
    mutationFn: (a: { action: 'approve' | 'decline' | 'unpublish'; reason?: string }) => api.moderation.bulk(a.action, [...picked], a.reason ?? ''),
    onSuccess: (r) => {
      setPicked(new Set());
      showToast(r.failed.length ? `${r.done} done; ${r.failed.length} couldn’t be (already decided?).` : `${r.done} done.`);
      done();
    },
    onError: fail,
  });
  const ask = async (action: 'decline' | 'unpublish', what: string) =>
    askReason(
      action === 'decline'
        ? {
            title: `Decline ${what}?`,
            removes: 'It doesn’t go into the catalog.',
            keeps: 'Nothing is deleted; they can change it and send it again.',
            confirmLabel: 'Decline',
            reason: { label: 'Why? (optional; the owner sees this)' },
          }
        : {
            title: `Unpublish ${what}?`,
            removes: 'It leaves the public catalog, so nobody new can add it.',
            keeps: 'Copies people already added keep working.',
            confirmLabel: 'Unpublish',
            reason: { label: 'Reason (optional)' },
          },
    );
  const act = async (action: 'approve' | 'decline' | 'unpublish', r: Row) => {
    if (action === 'approve') return one.mutate({ action, id: rowId(r) });
    const reason = await ask(action, `“${r.title}”`);
    if (reason !== null) one.mutate({ action, id: rowId(r), reason });
  };
  const actMany = async (action: 'approve' | 'decline' | 'unpublish') => {
    const what = `${picked.size} ${picked.size === 1 ? 'item' : 'items'}`;
    if (action === 'approve') {
      if (await askConfirm({ title: `Approve ${what}?`, removes: 'They go into the public catalog.', keeps: 'You can unpublish any of them later.', confirmLabel: 'Approve' })) many.mutate({ action });
      return;
    }
    const reason = await ask(action, what);
    if (reason !== null) many.mutate({ action, reason });
  };
  const allPicked = rows.length > 0 && rows.every((r) => picked.has(rowId(r)));
  const id = `mod-list-${view}`;
  return (
    <section className="space-y-3" aria-labelledby={id}>
      <h2 id={id} className="text-sm font-semibold">
        {title} {total !== undefined && <span className="font-normal text-muted">({total.toLocaleString()})</span>}
      </h2>
      {(total ?? count) > 0 || Object.values(f).some(Boolean) ? <Filters f={f} set={setFilter} waiting={waiting} /> : null}
      {list.isLoading && <p className="text-sm text-muted">Loading…</p>}
      {list.isError && <p className="text-danger">{(list.error as Error).message}</p>}
      {list.isSuccess && rows.length === 0 && (
        <p className="rounded-lg border border-dashed border-line p-4 text-sm text-muted">{Object.values(f).some(Boolean) ? 'Nothing matches.' : waiting ? 'Nothing waiting.' : 'Nothing yet.'}</p>
      )}
      {rows.length > 0 && (
        <>
          <div className="flex min-h-11 flex-wrap items-center gap-2 rounded-lg bg-soft px-3 py-1 text-sm" data-testid="moderation-bulk">
            <label className="inline-flex min-h-11 items-center gap-2">
              <input
                type="checkbox"
                checked={allPicked}
                onChange={() => setPicked(allPicked ? new Set() : new Set(rows.map(rowId)))}
                aria-label="Tick everything on this page"
              />
              {picked.size > 0 ? `${picked.size} ticked` : 'Tick to do several at once'}
            </label>
            {picked.size > 0 && (
              <span className="ml-auto flex flex-wrap gap-2">
                {waiting ? (
                  <>
                    <button type="button" disabled={many.isPending} onClick={() => void actMany('approve')} className="tap-target rounded-lg bg-accent px-3 py-1 font-semibold text-accent-ink hover:bg-accent-hover disabled:opacity-50">
                      Approve {picked.size}
                    </button>
                    <button type="button" disabled={many.isPending} onClick={() => void actMany('decline')} className="tap-target rounded-lg border border-border bg-panel px-3 py-1 hover:bg-line disabled:opacity-50">
                      Decline {picked.size}…
                    </button>
                  </>
                ) : (
                  view === 'public' && (
                    <button type="button" disabled={many.isPending} onClick={() => void actMany('unpublish')} className="tap-target rounded-lg border border-border bg-panel px-3 py-1 text-danger hover:bg-line disabled:opacity-50">
                      Unpublish {picked.size}…
                    </button>
                  )
                )}
              </span>
            )}
          </div>
          <ul className="divide-y divide-line rounded-lg border border-line bg-panel">
            {rows.map((r) => (
              <li key={rowId(r)} data-testid="moderation-entry" className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm">
                <label className="-my-1 inline-flex size-11 shrink-0 items-center justify-center">
                  <input
                    type="checkbox"
                    checked={picked.has(rowId(r))}
                    onChange={() =>
                      setPicked((p) => {
                        const n = new Set(p);
                        if (n.has(rowId(r))) n.delete(rowId(r));
                        else n.add(rowId(r));
                        return n;
                      })
                    }
                    aria-label={`Tick ${r.title}`}
                  />
                </label>
                <Thumb src={r.previewUrl} className="size-10 shrink-0 rounded border border-line bg-soft object-contain" />
                <button type="button" onClick={() => setOpen(r)} className="min-h-11 min-w-0 flex-1 basis-40 text-left" aria-label={`Details of ${r.title}`}>
                  <span className="flex flex-wrap items-center gap-x-2 font-medium">
                    <span className="break-words">{r.title}</span>
                    <span className="text-xs font-normal text-muted">
                      {KIND_WORD[r.kind]}
                      {isEntry(r) ? (r.isUpdate ? `, update, version ${r.version}` : ', new') : ''}
                    </span>
                    {!isEntry(r) && r.trustedClub && <TrustedBadge />}
                  </span>
                  <span className="block text-xs text-muted">
                    {isEntry(r)
                      ? `From ${r.by}${r.submitter ? `, sent by ${r.submitter.name}${r.submitter.email ? ` (${r.submitter.email})` : ''}` : ''} · ${new Date(r.createdAt).toLocaleString()}`
                      : `By ${r.by} · ${r.uses} uses · ${r.status === 'public' ? 'Public' : `Unpublished${r.reason ? `: ${r.reason}` : ''}`} · ${new Date(r.updatedAt).toLocaleDateString()}`}
                  </span>
                </button>
                <RowActions r={r} act={act} busy={one.isPending} />
              </li>
            ))}
          </ul>
          <Pager offset={offset} count={count} rows={rows.length} setOffset={(o) => { setOffset(o); setPicked(new Set()); }} />
        </>
      )}
      {open && <EntryPanel r={open} onClose={() => setOpen(null)} act={act} busy={one.isPending} />}
    </section>
  );
}

function RowActions({ r, act, busy }: { r: Row; act: (a: 'approve' | 'decline' | 'unpublish', r: Row) => void; busy: boolean }) {
  if (isEntry(r))
    return (
      <span className="flex gap-2">
        <button type="button" disabled={busy} onClick={() => act('approve', r)} aria-label={`Approve ${r.title}`} className="tap-target rounded-lg bg-accent px-3 py-1 font-semibold text-accent-ink hover:bg-accent-hover disabled:opacity-50">
          Approve
        </button>
        <button type="button" disabled={busy} onClick={() => act('decline', r)} aria-label={`Decline ${r.title}`} className="tap-target rounded-lg border border-border px-3 py-1 hover:bg-soft disabled:opacity-50">
          Decline…
        </button>
      </span>
    );
  return r.status === 'public' ? (
    <button type="button" disabled={busy} onClick={() => act('unpublish', r)} aria-label={`Unpublish ${r.title}`} className="tap-target rounded-lg border border-border px-3 py-1 text-danger hover:bg-soft disabled:opacity-50">
      Unpublish…
    </button>
  ) : null;
}

/** "1–50 of 1,234" with Previous and Next. */
function Pager({ offset, count, rows, setOffset }: { offset: number; count: number; rows: number; setOffset: (o: number) => void }) {
  if (count <= PAGE) return null;
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
      <span className="text-muted tabular-nums">
        {(offset + 1).toLocaleString()}–{(offset + rows).toLocaleString()} of {count.toLocaleString()}
      </span>
      <span className="flex gap-2">
        <button type="button" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))} className="tap-target rounded-lg border border-border px-3 py-1 hover:bg-soft disabled:opacity-40">
          ← Previous
        </button>
        <button type="button" disabled={offset + rows >= count} onClick={() => setOffset(offset + PAGE)} className="tap-target rounded-lg border border-border px-3 py-1 hover:bg-soft disabled:opacity-40">
          Next →
        </button>
      </span>
    </div>
  );
}

/** Everything about one entry, in a panel at the side (the whole screen on a phone). */
function EntryPanel({ r, onClose, act, busy }: { r: Row; onClose: () => void; act: (a: 'approve' | 'decline' | 'unpublish', r: Row) => void; busy: boolean }) {
  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [onClose]);
  const itemId = isEntry(r) ? r.itemId : r.id;
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40" onClick={onClose}>
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={r.title}
        onClick={(e) => e.stopPropagation()}
        className="h-full w-full max-w-md space-y-4 overflow-y-auto border-l border-line bg-panel p-5 text-sm shadow-xl"
      >
        <div className="flex items-start justify-between gap-3">
          <h3 className="text-lg font-semibold break-words">{r.title}</h3>
          <button type="button" onClick={onClose} aria-label="Close" className="tap-target rounded-lg px-2 text-lg hover:bg-soft">
            ✕
          </button>
        </div>
        <Thumb src={r.previewUrl} className="aspect-[4/3] w-full rounded-lg border border-line bg-soft object-contain" />
        {isEntry(r) && r.coverUrl && <img src={r.coverUrl} alt="Its cover picture" className="aspect-[4/3] w-full rounded-lg border border-line bg-soft object-cover" />}
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
          <dt className="text-muted">Kind</dt>
          <dd>{KIND_WORD[r.kind]}</dd>
          <dt className="text-muted">From</dt>
          <dd>{r.by}</dd>
          {isEntry(r) ? (
            <>
              {r.submitter && (
                <>
                  <dt className="text-muted">Sent by</dt>
                  <dd className="wrap-anywhere">
                    {r.submitter.name}
                    {r.submitter.email ? ` (${r.submitter.email})` : ''}
                  </dd>
                </>
              )}
              <dt className="text-muted">Sent</dt>
              <dd>{new Date(r.createdAt).toLocaleString()}</dd>
              <dt className="text-muted">Version</dt>
              <dd>{r.isUpdate ? `${r.version} (an update)` : 'new'}</dd>
            </>
          ) : (
            <>
              <dt className="text-muted">Status</dt>
              <dd>{r.status === 'public' ? 'Public' : `Unpublished${r.reason ? `: ${r.reason}` : ''}`}</dd>
              <dt className="text-muted">Uses</dt>
              <dd>{r.uses}</dd>
            </>
          )}
          {r.tags.length > 0 && (
            <>
              <dt className="text-muted">Tags</dt>
              <dd>{r.tags.join(', ')}</dd>
            </>
          )}
        </dl>
        {r.description && <p className="whitespace-pre-line">{r.description}</p>}
        {isEntry(r) && r.note && <p className="rounded-lg bg-soft p-2 text-xs">What changed: {r.note}</p>}
        {(r.kind === 'layout' || r.kind === 'venue') && (
          <Link to={`/catalog/items/${itemId}`} className="text-accent-text hover:underline">
            Open its page
          </Link>
        )}
        <div className="flex flex-wrap gap-2">
          <RowActions r={r} act={act} busy={busy} />
        </div>
        {r.owner && <WarnOwner owner={r.owner} title={r.title} by={r.by} link="/catalog" />}
      </aside>
    </div>
  );
}

/** New pictures for public items (the site's, or trusted clubs'). */
function CoverQueue({ trusted }: { trusted: boolean }) {
  const qc = useQueryClient();
  const data = useQuery({ queryKey: ['moderation', 'covers'], queryFn: api.moderation.covers });
  const cover = useMutation({
    mutationFn: (a: { id: string; ok: boolean; reason?: string }) => api.moderation.decideCover(a.id, a.ok, a.reason),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['moderation'] });
      void qc.invalidateQueries({ queryKey: ['catalog-items'] });
    },
    onError: (e: Error) => showToast(e.message),
  });
  const list = (trusted ? data.data?.trustedCovers : data.data?.covers) ?? [];
  if (!list.length) return null;
  return (
    <section className="space-y-3" aria-labelledby={`mod-covers-${trusted}`}>
      <h2 id={`mod-covers-${trusted}`} className="text-sm font-semibold">
        New cover pictures <span className="font-normal text-muted">({list.length})</span>
      </h2>
      <CoverReviewList list={list} decide={(id, ok, reason) => cover.mutate({ id, ok, ...(reason !== undefined ? { reason } : {}) })} />
    </section>
  );
}

/**
 * Trusted clubs: their own admins and managers review what's published
 * under their name. Trust one (find it by name), or stop trusting it.
 */
export function TrustedClubsSection() {
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const [offset, setOffset] = useState(0);
  const [foundAt, setFoundAt] = useState(0);
  const trusted = useQuery({ queryKey: ['moderation-clubs', '', offset], queryFn: () => api.moderation.clubs('', offset), placeholderData: (prev) => prev });
  const found = useQuery({ queryKey: ['moderation-clubs', q.trim(), foundAt], queryFn: () => api.moderation.clubs(q.trim(), foundAt), enabled: q.trim().length >= 2, placeholderData: (prev) => prev });
  const [error, setError] = useState<string | null>(null);
  const set = useMutation({
    mutationFn: (a: { slug: string; trusted: boolean }) => api.moderation.trustClub(a.slug, a.trusted),
    onSuccess: () => {
      setError(null);
      void qc.invalidateQueries({ queryKey: ['moderation-clubs'] });
      void invalidateFor(qc, 'catalog');
      void invalidateFor(qc, 'club');
    },
    onError: (e: Error) => setError(e.message),
  });
  const row = (c: ModerationClub) => (
    <li key={c.id} data-testid="trusted-club" className="flex flex-wrap items-center gap-3 px-3 py-2 text-sm">
      <span className="min-w-[10rem] flex-1">
        <span className="font-medium">{c.name}</span> <span className="text-xs text-muted">/{c.slug}</span>
        {c.trusted && <TrustedBadge />}
      </span>
      <button
        type="button"
        onClick={async () => {
          if (c.trusted && !(await askConfirm({
              title: `Stop trusting ${c.name}?`,
              removes: 'Its new shares wait for review again.',
              keeps: `What’s public stays public; what’s waiting in its queue moves to yours.`,
              undo: 'You can trust it again later.',
              confirmLabel: 'Stop trusting',
            }))) return;
          set.mutate({ slug: c.slug, trusted: !c.trusted });
        }}
        aria-label={`${c.trusted ? 'Stop trusting' : 'Trust'} ${c.name}`}
        className="tap-target rounded-lg border border-border px-3 py-1.5 hover:bg-soft"
      >
        {c.trusted ? 'Stop trusting' : 'Trust'}
      </button>
    </li>
  );
  // Searching shows every club that matches (trusted or not); otherwise the trusted ones. Both a page at a time.
  const searching = q.trim().length >= 2;
  const shown = searching ? found : trusted;
  const at = searching ? foundAt : offset;
  const clubs = shown.data?.clubs ?? [];
  const total = shown.data?.total ?? clubs.length;
  return (
    <section className="space-y-3" aria-labelledby="mod-trusted">
      <h2 id="mod-trusted" className="flex items-center gap-2 text-sm font-semibold">
        Trusted clubs {trusted.data?.total !== undefined && <span className="font-normal text-muted">({trusted.data.total.toLocaleString()})</span>}
        <HelpButton helpKey="club.trusted" />
      </h2>
      <p className="text-xs text-muted">
        A trusted club’s admins and managers review what’s published under its name, instead of you. You can still see, decline or unpublish anything.
      </p>
      <input
        type="search"
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setFoundAt(0);
        }}
        placeholder="Find a club by name, to trust it or stop"
        aria-label="Find a club to trust"
        className="min-h-11 w-full rounded-lg border border-border bg-soft px-3"
      />
      {clubs.length > 0 ? (
        <ul aria-label={searching ? 'Clubs found' : 'Trusted clubs'} className="divide-y divide-line rounded-lg border border-line bg-panel">
          {clubs.map(row)}
        </ul>
      ) : (
        shown.isSuccess && <p className="rounded-lg border border-dashed border-line p-4 text-sm text-muted">{searching ? 'No club matches.' : 'No trusted clubs yet. Find one above.'}</p>
      )}
      <Pager offset={at} count={total} rows={clubs.length} setOffset={searching ? setFoundAt : setOffset} />
      {error && <p className="text-danger">{error}</p>}
    </section>
  );
}

/** New pictures for public catalog items: what shows now beside the new one, approve or decline. */
export function CoverReviewList({ list, decide, warn = true }: { list: CoverReviewEntry[]; decide: (itemId: string, ok: boolean, reason?: string) => void; warn?: boolean }) {
  return (
    <ul className="space-y-2">
      {list.map((q) => (
        <li key={q.itemId} data-testid="cover-review" className="flex flex-wrap gap-3 rounded-lg border border-line bg-panel p-3 text-sm">
          <div className="min-w-[12rem] flex-1 space-y-2">
            <p className="font-semibold">
              {q.title} <span className="font-normal text-muted">({q.kind}, a new cover picture)</span>
            </p>
            <p className="text-xs text-muted">
              From {q.by}
              {q.submitter ? `, sent by ${q.submitter}` : ''} · {new Date(q.createdAt).toLocaleString()}
            </p>
            <div className="flex flex-wrap gap-3">
              <figure data-testid="review-old" className="min-w-[8rem] flex-1 space-y-1">
                <figcaption className="text-xs font-semibold uppercase tracking-wide text-muted">Now</figcaption>
                {q.oldUrl ? (
                  <img src={q.oldUrl} alt="Cover now" className="aspect-[4/3] w-full max-w-48 rounded-lg border border-line bg-soft object-contain" />
                ) : (
                  <span aria-label="No picture now" role="img" className="block aspect-[4/3] w-full max-w-48 rounded-lg border border-line bg-soft" />
                )}
              </figure>
              <figure data-testid="review-new" className="min-w-[8rem] flex-1 space-y-1">
                <figcaption className="text-xs font-semibold uppercase tracking-wide text-muted">Proposed</figcaption>
                <img src={q.newUrl} alt="Proposed cover" className="aspect-[4/3] w-full max-w-48 rounded-lg border border-line bg-soft object-cover" />
              </figure>
            </div>
          </div>
          <div className="flex basis-full flex-wrap justify-end gap-2 sm:basis-auto sm:flex-col">
            <button
              type="button"
              onClick={() => decide(q.itemId, true)}
              aria-label={`Approve the new picture for ${q.title}`}
              className="tap-target rounded-lg bg-accent px-3 py-1.5 font-semibold text-accent-ink hover:bg-accent-hover"
            >
              Approve
            </button>
            <button
              type="button"
              onClick={async () => {
                const reason = await askReason({
                  title: `Decline the new picture for “${q.title}”?`,
                  removes: 'The new picture is deleted.',
                  keeps: 'The picture showing now stays; they can send another.',
                  confirmLabel: 'Decline',
                  reason: { label: 'Why? (optional; the owner sees this)' },
                });
                if (reason !== null) decide(q.itemId, false, reason);
              }}
              aria-label={`Decline the new picture for ${q.title}`}
              className="tap-target rounded-lg border border-border px-3 py-1.5 hover:bg-soft"
            >
              Decline…
            </button>
          </div>
          {warn && q.owner && <WarnOwner owner={q.owner} title={q.title} by={q.by} link="/catalog" />}
        </li>
      ))}
    </ul>
  );
}

/** A collection's text for review: the new one, and (for a change) what's public now beside it. */
export function TextReview({ q }: { q: CollectionReviewEntry }) {
  const side = (label: string, t: { title: string; description: string; coverUrl: string | null }, testId: string) => (
    <div data-testid={testId} className="min-w-[10rem] flex-1 space-y-1">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted">{label}</p>
      {t.coverUrl ? (
        <img src={t.coverUrl} alt={`${label} cover`} className="aspect-[4/3] w-full max-w-40 rounded-lg border border-line bg-soft object-contain" />
      ) : (
        <span aria-hidden className="block aspect-[4/3] w-full max-w-40 rounded-lg border border-line bg-soft" />
      )}
      <p className="font-semibold">{t.title}</p>
      {t.description && <p className="whitespace-pre-line">{t.description}</p>}
    </div>
  );
  const changed = (a: string | null, b: string | null) => a !== b;
  return (
    <div className="flex flex-wrap gap-3">
      {q.old && side('Now', q.old, 'review-old')}
      {side(q.old ? 'Proposed' : 'Submitted', q, 'review-new')}
      {q.old && (
        <p className="basis-full text-xs text-muted">
          Changed:{' '}
          {[
            changed(q.old.title, q.title) && 'title',
            changed(q.old.description, q.description) && 'description',
            changed(q.old.coverUrl, q.coverUrl) && 'cover',
          ]
            .filter(Boolean)
            .join(', ') || 'nothing visible'}
          . Items are checked on their own, in the queue above.
        </p>
      )}
    </div>
  );
}

type CollView = 'queue' | 'trusted' | 'listed' | 'club';
type CollRow = CollectionReviewEntry | ModeratedCollection;

/**
 * Collections, a page at a time: the text waiting for review (the site's,
 * or trusted clubs'), the ones in the catalog, or clubs' private ones;
 * searchable, with a tick box on each to act on several at once.
 */
function CollectionModeration({ part }: { part: 'queue' | 'trusted' | 'listed' }) {
  if (part === 'listed')
    return (
      <>
        <CollectionList view="listed" title="Collections in the catalog" />
        <CollectionList view="club" title="Clubs’ private collections" note="Only each club’s members see these, and they’re never reviewed. Remove one only for abuse; it’s logged." />
      </>
    );
  return <CollectionList view={part} title="Collections" />;
}

function CollectionList({ view, title, note }: { view: CollView; title: string; note?: string }) {
  const qc = useQueryClient();
  const waiting = view === 'queue' || view === 'trusted';
  const [f, setF] = useState<ModerationFilter>({});
  const [offset, setOffset] = useState(0);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const list = useQuery({
    queryKey: ['moderation', 'collections', view, f, offset],
    queryFn: () => api.moderation.collectionList(view, { ...f, limit: PAGE, offset }),
    placeholderData: (prev) => prev,
  });
  const rows: CollRow[] = list.data?.rows ?? [];
  const count = list.data?.total ?? 0;
  const filtered = Object.values(f).some(Boolean);
  useEffect(() => {
    setPicked((p) => {
      const here = new Set(rows.map((r) => r.id));
      const kept = [...p].filter((id) => here.has(id));
      return kept.length === p.size ? p : new Set(kept);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list.data]);
  const done = () => {
    void qc.invalidateQueries({ queryKey: ['moderation'] });
    void invalidateFor(qc, 'catalog');
  };
  const fail = (e: Error) => showToast(e.message);
  type Action = 'approve' | 'decline' | 'unpublish' | 'remove';
  const run = useMutation({
    mutationFn: (a: { action: Action; ids: string[]; reason?: string }) => api.moderation.collectionBulk(a.action, a.ids, a.reason ?? ''),
    onSuccess: (r, a) => {
      setPicked(new Set());
      if (a.ids.length > 1) showToast(r.failed.length ? `${r.done} done; ${r.failed.length} couldn’t be (already decided?).` : `${r.done} done.`);
      else if (r.failed.length) showToast('That couldn’t be done (already decided?).');
      done();
    },
    onError: fail,
  });
  const feature = useMutation({ mutationFn: (a: { id: string; featured: boolean }) => api.moderation.featureCollection(a.id, a.featured), onSuccess: done, onError: fail });
  const ask = async (action: Action, what: string): Promise<string | null> => {
    if (action === 'approve') return 'ok';
    if (action === 'remove')
      return askReason({
        ...deleteOptions(what, { verb: 'Remove', removes: 'Deleted for good from its club.', keeps: 'Its modules and parts aren’t deleted.' }),
        reason: { label: 'Reason (logged)' },
      });
    return askReason(
      action === 'decline'
        ? {
            title: `Decline ${what}?`,
            removes: 'It doesn’t go into the catalog.',
            keeps: 'Nothing is deleted; they can change it and send it again.',
            confirmLabel: 'Decline',
            reason: { label: 'Why? (optional; the curator sees this)' },
          }
        : {
            title: `Unpublish ${what}?`,
            removes: 'It leaves the public catalog, so nobody new can add it.',
            keeps: 'Copies people already added keep working.',
            confirmLabel: 'Unpublish',
            reason: { label: 'Reason (optional; the curator sees this)' },
          },
    );
  };
  const act = async (action: Action, r: CollRow) => {
    const reason = await ask(action, `“${r.title}”`);
    if (reason === null) return;
    run.mutate({ action, ids: [r.id], ...(action === 'approve' ? {} : { reason }) }, { onSuccess: (x) => action === 'remove' && x.done && toastDeleted(r.title) });
  };
  const actMany = async (action: Action) => {
    const what = `${picked.size} ${picked.size === 1 ? 'collection' : 'collections'}`;
    if (action === 'approve') {
      if (await askConfirm({ title: `Approve ${what}?`, removes: 'Their text goes into the public catalog.', keeps: 'You can unpublish any of them later.', confirmLabel: 'Approve' })) run.mutate({ action, ids: [...picked] });
      return;
    }
    const reason = await ask(action, what);
    if (reason !== null) run.mutate({ action, ids: [...picked], reason });
  };
  const bulkActions: Action[] = waiting ? ['approve', 'decline'] : view === 'listed' ? ['unpublish'] : ['remove'];
  const label: Record<Action, string> = { approve: 'Approve', decline: 'Decline', unpublish: 'Unpublish', remove: 'Remove' };
  const allPicked = rows.length > 0 && rows.every((r) => picked.has(r.id));
  const tick = (r: CollRow) => (
    <label className="-my-1 inline-flex size-11 shrink-0 items-center justify-center">
      <input
        type="checkbox"
        checked={picked.has(r.id)}
        onChange={() =>
          setPicked((p) => {
            const n = new Set(p);
            if (n.has(r.id)) n.delete(r.id);
            else n.add(r.id);
            return n;
          })
        }
        aria-label={`Tick ${r.title}`}
      />
    </label>
  );
  const btn = 'tap-target rounded-lg border border-border px-3 py-1 hover:bg-soft disabled:opacity-50';
  const id = `mod-coll-${view}`;
  if (view === 'trusted' && list.isSuccess && count === 0 && !filtered) return null;
  return (
    <section className="space-y-3" aria-labelledby={id}>
      <h2 id={id} className="text-sm font-semibold">
        {title} {list.data && <span className="font-normal text-muted">({count.toLocaleString()})</span>}
      </h2>
      {note && <p className="text-xs text-muted">{note}</p>}
      {(count > 0 || filtered) && <Filters f={f} set={(n) => { setF(n); setOffset(0); setPicked(new Set()); }} waiting={waiting} kinds={false} />}
      {list.isLoading && <p className="text-sm text-muted">Loading…</p>}
      {list.isError && <p className="text-danger">{(list.error as Error).message}</p>}
      {list.isSuccess && rows.length === 0 && (
        <p className="rounded-lg border border-dashed border-line p-4 text-sm text-muted">
          {filtered ? 'Nothing matches.' : waiting ? 'Nothing waiting.' : view === 'listed' ? 'Nothing yet. Make one from the Catalog page (Your collections › New collection).' : 'None.'}
        </p>
      )}
      {rows.length > 0 && (
        <>
          <div className="flex min-h-11 flex-wrap items-center gap-2 rounded-lg bg-soft px-3 py-1 text-sm">
            <label className="inline-flex min-h-11 items-center gap-2">
              <input type="checkbox" checked={allPicked} onChange={() => setPicked(allPicked ? new Set() : new Set(rows.map((r) => r.id)))} aria-label="Tick every collection on this page" />
              {picked.size > 0 ? `${picked.size} ticked` : 'Tick to do several at once'}
            </label>
            {picked.size > 0 && (
              <span className="ml-auto flex flex-wrap gap-2">
                {bulkActions.map((a) => (
                  <button
                    key={a}
                    type="button"
                    disabled={run.isPending}
                    onClick={() => void actMany(a)}
                    className={a === 'approve' ? 'tap-target rounded-lg bg-accent px-3 py-1 font-semibold text-accent-ink hover:bg-accent-hover disabled:opacity-50' : `${btn} bg-panel ${a === 'decline' ? '' : 'text-danger'}`}
                  >
                    {label[a]} {picked.size}
                    {a === 'approve' ? '' : '…'}
                  </button>
                ))}
              </span>
            )}
          </div>
          <ul className={waiting ? 'space-y-2' : 'divide-y divide-line rounded-lg border border-line bg-panel'}>
            {rows.map((r) =>
              waiting ? (
                <li key={r.id} data-testid="moderation-collection" className="flex flex-wrap gap-3 rounded-lg border border-line bg-panel p-3 text-sm">
                  {tick(r)}
                  <div className="min-w-[12rem] flex-1 space-y-2">
                    <p className="font-semibold">
                      {r.title} <span className="font-normal text-muted">(collection {(r as CollectionReviewEntry).isUpdate ? 'text, a change' : 'text, new'})</span>
                    </p>
                    <p className="text-xs text-muted">
                      From {r.by}
                      {(r as CollectionReviewEntry).email ? ` (${(r as CollectionReviewEntry).email})` : ''} · {new Date((r as CollectionReviewEntry).createdAt).toLocaleString()} ·{' '}
                      <a href={`/catalog/collections/${r.id}`} target="_blank" rel="noreferrer" className="hover:underline">
                        {r.itemCount} {r.itemCount === 1 ? 'item' : 'items'}
                      </a>
                    </p>
                    <TextReview q={r as CollectionReviewEntry} />
                  </div>
                  <div className="flex basis-full flex-wrap justify-end gap-2 sm:basis-auto sm:flex-col">
                    <button type="button" disabled={run.isPending} onClick={() => void act('approve', r)} aria-label={`Approve collection ${r.title}`} className="tap-target rounded-lg bg-accent px-3 py-1.5 font-semibold text-accent-ink hover:bg-accent-hover disabled:opacity-50">
                      Approve
                    </button>
                    <button type="button" disabled={run.isPending} onClick={() => void act('decline', r)} aria-label={`Decline collection ${r.title}`} className={btn}>
                      Decline…
                    </button>
                  </div>
                  {r.owner && <WarnOwner owner={r.owner} title={r.title} by={r.by} link={`/catalog/collections/${r.id}`} />}
                </li>
              ) : (
                <li key={r.id} data-testid={view === 'listed' ? 'moderated-collection' : 'moderated-club-collection'} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm">
                  {tick(r)}
                  <div className="min-w-[10rem] flex-1">
                    <a href={`/catalog/collections/${r.id}`} className="font-medium hover:underline">
                      {r.title}
                    </a>
                    <p className="text-xs text-muted">
                      {view === 'listed'
                        ? `${(r as ModeratedCollection).official ? 'Official' : `By ${r.by}`} · ${r.itemCount} items · ${(r as ModeratedCollection).status === 'public' ? ((r as ModeratedCollection).featured ? 'Featured' : 'Public') : `Unpublished${(r as ModeratedCollection).reason ? `: ${(r as ModeratedCollection).reason}` : ''}`}`
                        : `${r.by} · ${r.itemCount} items`}
                    </p>
                  </div>
                  {view === 'listed' && (r as ModeratedCollection).status === 'public' && (r as ModeratedCollection).official && (
                    <label className="flex min-h-11 items-center gap-1 text-xs">
                      <input type="checkbox" checked={!!(r as ModeratedCollection).featured} onChange={(e) => feature.mutate({ id: r.id, featured: e.target.checked })} aria-label={`Feature ${r.title}`} />
                      Featured
                    </label>
                  )}
                  {view === 'listed' && (r as ModeratedCollection).status === 'public' && (
                    <button type="button" disabled={run.isPending} onClick={() => void act('unpublish', r)} aria-label={`Unpublish collection ${r.title}`} className={`${btn} text-danger`}>
                      Unpublish
                    </button>
                  )}
                  {view === 'club' && (
                    <button type="button" disabled={run.isPending} onClick={() => void act('remove', r)} aria-label={`Remove collection ${r.title}`} className={`${btn} text-danger`}>
                      Remove
                    </button>
                  )}
                  {r.owner && !(view === 'listed' && (r as ModeratedCollection).official) && <WarnOwner owner={r.owner} title={r.title} by={r.by} link={`/catalog/collections/${r.id}`} />}
                </li>
              ),
            )}
          </ul>
          <Pager offset={offset} count={count} rows={rows.length} setOffset={(o) => { setOffset(o); setPicked(new Set()); }} />
        </>
      )}
    </section>
  );
}

/** "Warn the owner…" under a catalog entry: a warning to whoever shared it, linked to it. */
function WarnOwner({ owner, title, by, link }: { owner: WarningSubject; title: string; by: string; link: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="basis-full">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        aria-label={`Warn the owner of ${title}`}
        className="text-xs text-muted hover:text-ink hover:underline"
      >
        Warn the owner ({by})…
      </button>
      {open && (
        <div className="mt-2">
          <WarnForm label={`Warn ${by}`} onSend={(input) => api.warnings.send(owner, { ...input, link: input.link ?? link })} onDone={() => setOpen(false)} />
        </div>
      )}
    </div>
  );
}

/** Admin › Settings: the public catalogs (both off until turned on) and their review step. */
export function CatalogSettingsSection() {
  const qc = useQueryClient();
  const settings = useQuery({ queryKey: ['admin-settings'], queryFn: api.admin.settings });
  const save = useMutation({
    mutationFn: api.admin.patchSettings,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['admin-settings'] });
      void qc.invalidateQueries({ queryKey: ['catalog-settings'] });
    },
  });
  const c = settings.data?.catalog;
  if (!c) return null;
  return (
    <section className="space-y-3" aria-labelledby="catalog-settings">
      <h2 id="catalog-settings" className="text-sm font-semibold text-neutral-300">Public catalogs</h2>
      <p className="text-xs text-muted">
        People can share modules, custom parts, layouts and venues for everyone, and add what others shared to their own. Each is off until you turn it on.
      </p>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={c.modules} onChange={(e) => save.mutate({ moduleCatalogEnabled: e.target.checked })} />
        Public module catalog
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={c.parts} onChange={(e) => save.mutate({ partsCatalogEnabled: e.target.checked })} />
        Public parts catalog
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={!!c.layouts} onChange={(e) => save.mutate({ layoutCatalogEnabled: e.target.checked })} />
        Public layouts (people share a copy of a whole layout; it opens read-only, and others can copy it)
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={!!c.venues} onChange={(e) => save.mutate({ venueCatalogEnabled: e.target.checked })} />
        Public venues (floor plans others can copy and start a layout in)
      </label>
      <fieldset className="space-y-1 text-sm">
        <legend className="mb-1 text-xs text-muted">Review before publishing</legend>
        {(
          [
            ['moderators', 'Moderators approve each one'],
            ['none', 'Publish straight away'],
          ] as [CatalogReview, string][]
        ).map(([v, label]) => (
          <label key={v} className="flex items-center gap-2">
            <input type="radio" name="catalog-review" checked={c.review === v} onChange={() => save.mutate({ catalogReview: v })} />
            {label}
          </label>
        ))}
        <p className="text-xs text-muted">Moderators (Users › Moderator) and site admins can unpublish anything either way.</p>
      </fieldset>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={c.anonymousBrowse} onChange={(e) => save.mutate({ catalogAnonymousBrowse: e.target.checked })} />
        People who aren’t signed in can browse (adding always needs an account)
      </label>
      {c.coverMaxBytes && <CoverMaxSetting key={c.coverMaxBytes.setting} cover={c.coverMaxBytes} save={(n) => save.mutate({ collectionCoverMaxBytes: n })} />}
    </section>
  );
}

const MB = 1024 * 1024;

/** The biggest collection cover upload, in MB (an env var may force it). */
function CoverMaxSetting({ cover, save }: { cover: AdminJobSetting<number>; save: (bytes: number) => void }) {
  const [mb, setMb] = useState(String(Math.round((cover.setting / MB) * 10) / 10));
  const n = Math.round(Number(mb) * MB);
  const ok = Number.isFinite(n) && n >= 100 * 1024 && n <= 7 * MB;
  return (
    <div className="space-y-1">
      <label className="flex flex-wrap items-center gap-2 text-sm">
        Biggest collection cover picture
        <input
          type="number"
          inputMode="decimal"
          min={0.1}
          max={7}
          step={0.5}
          value={mb}
          disabled={!!cover.forcedBy}
          onChange={(e) => setMb(e.target.value)}
          onBlur={() => ok && n !== cover.setting && save(n)}
          aria-label="Biggest collection cover picture, in MB"
          className="min-h-9 w-24 rounded-lg border border-border bg-soft px-2"
        />
        MB
      </label>
      <p className="text-xs text-muted">Curators can upload their own photo as a collection’s cover. It’s made smaller before it’s kept. Between 0.1 and 7 MB.</p>
      {!ok && <p className="text-xs text-danger">Enter a size between 0.1 and 7 MB.</p>}
      {cover.forcedBy && (
        <p className="text-xs text-muted">
          Forced by the server setting <code>{cover.forcedBy}</code> ({Math.round((cover.value / MB) * 10) / 10} MB). Remove it from the server’s settings to use this.
        </p>
      )}
    </div>
  );
}

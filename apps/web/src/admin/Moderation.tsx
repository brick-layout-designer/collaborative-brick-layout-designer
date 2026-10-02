// Moderation (moderators and global admins): the queue of catalog
// submissions to approve or decline, and what's in the catalogs, which can
// be unpublished at once. Plus the catalog settings (global admins only).

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type CatalogReview, type CollectionReviewEntry, type ModerationClub, type WarningSubject } from '../api';
import { HelpButton } from '../help/HelpButton';
import { WarnForm } from '../notices/Notices';
import { invalidateFor } from '../live/invalidate';
import { TrustedBadge } from '../catalog/TrustedBadge';

export function ModerationTab() {
  const qc = useQueryClient();
  const data = useQuery({ queryKey: ['moderation'], queryFn: api.moderation.items });
  const [error, setError] = useState<string | null>(null);
  const done = () => {
    setError(null);
    void qc.invalidateQueries({ queryKey: ['moderation'] });
    void qc.invalidateQueries({ queryKey: ['catalog-items'] });
  };
  const fail = (e: Error) => setError(e.message);
  const approve = useMutation({ mutationFn: api.moderation.approve, onSuccess: done, onError: fail });
  const decline = useMutation({ mutationFn: (a: { id: string; reason: string }) => api.moderation.decline(a.id, a.reason), onSuccess: done, onError: fail });
  const unpublish = useMutation({ mutationFn: (a: { id: string; reason: string }) => api.moderation.unpublish(a.id, a.reason), onSuccess: done, onError: fail });

  if (data.isLoading) return <p className="text-muted">Loading…</p>;
  if (data.isError) return <p className="text-danger">{(data.error as Error).message}</p>;
  const queue = data.data?.queue ?? [];
  const trustedQueue = data.data?.trustedQueue ?? [];
  const items = data.data?.items ?? [];
  const renderQueue = (list: typeof queue) => (
          <ul className="space-y-2">
              {list.map((q) => (
                <li key={q.versionId} data-testid="moderation-entry" className="flex flex-wrap gap-3 rounded-lg border border-line bg-panel p-3 text-sm">
                  <img src={q.previewUrl} alt="" className="size-24 shrink-0 rounded-lg border border-line bg-soft object-contain" />
                  <div className="min-w-[12rem] flex-1 space-y-1">
                    <p className="font-semibold">
                      {q.title} <span className="font-normal text-muted">({q.kind === 'module' ? 'module' : 'part'}, {q.isUpdate ? `update, version ${q.version}` : 'new'})</span>
                    </p>
                    <p className="text-xs text-muted">
                      From {q.by}
                      {q.submitter ? `, sent by ${q.submitter.name} (${q.submitter.email})` : ''} · {new Date(q.createdAt).toLocaleString()}
                    </p>
                    {q.description && <p>{q.description}</p>}
                    {q.note && <p className="text-xs">What changed: {q.note}</p>}
                    {q.tags.length > 0 && <p className="text-xs text-muted">Tags: {q.tags.join(', ')}</p>}
                  </div>
                  <div className="flex basis-full flex-wrap justify-end gap-2 sm:basis-auto sm:flex-col">
                    <button
                      type="button"
                      onClick={() => approve.mutate(q.versionId)}
                      aria-label={`Approve ${q.title}`}
                      className="tap-target rounded-lg bg-accent px-3 py-1.5 font-semibold text-accent-ink hover:bg-accent-hover"
                    >
                      Approve
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        const reason = prompt(`Why is "${q.title}" declined? (optional; the owner sees this)`);
                        if (reason !== null) decline.mutate({ id: q.versionId, reason });
                      }}
                      aria-label={`Decline ${q.title}`}
                      className="tap-target rounded-lg border border-border px-3 py-1.5 hover:bg-soft"
                    >
                      Decline…
                    </button>
                  </div>
                  {q.owner && <WarnOwner owner={q.owner} title={q.title} by={q.by} link="/catalog" />}
                </li>
              ))}
            </ul>
  );
  return (
    <div className="max-w-3xl space-y-8">
      <section className="space-y-3" aria-labelledby="mod-queue">
        <h2 id="mod-queue" className="text-sm font-semibold">Waiting for review ({queue.length})</h2>
        {queue.length === 0 ? (
          <p className="rounded-lg border border-dashed border-line p-4 text-sm text-muted">Nothing waiting.</p>
        ) : (
          renderQueue(queue)
        )}
      </section>
      {trustedQueue.length > 0 && (
        <section className="space-y-3" aria-labelledby="mod-trusted-queue">
          <h2 id="mod-trusted-queue" className="text-sm font-semibold">Waiting in trusted clubs’ own queues ({trustedQueue.length})</h2>
          <p className="text-xs text-muted">Each club’s admins and managers review these. You can still approve or decline one.</p>
          {renderQueue(trustedQueue)}
        </section>
      )}
      <section className="space-y-3" aria-labelledby="mod-items">
        <h2 id="mod-items" className="text-sm font-semibold">In the catalogs</h2>
        {items.length === 0 ? (
          <p className="rounded-lg border border-dashed border-line p-4 text-sm text-muted">Nothing yet.</p>
        ) : (
          <ul className="divide-y divide-line rounded-lg border border-line bg-panel">
            {items.map((i) => (
              <li key={i.id} className="flex flex-wrap items-center gap-3 px-3 py-2 text-sm">
                <img src={i.previewUrl} alt="" loading="lazy" className="size-12 shrink-0 rounded-lg border border-line bg-soft object-contain" />
                <div className="min-w-[10rem] flex-1">
                  <p className="flex flex-wrap items-center gap-2 font-medium">
                    {i.title}
                    {i.trustedClub && <TrustedBadge />}
                  </p>
                  <p className="text-xs text-muted">
                    {i.kind === 'module' ? 'Module' : 'Part'} by {i.by} · {i.uses} uses ·{' '}
                    {i.status === 'public' ? 'Public' : `Unpublished${i.reason ? `: ${i.reason}` : ''}`}
                  </p>
                </div>
                {i.status === 'public' && (
                  <button
                    type="button"
                    onClick={() => {
                      const reason = prompt(`Unpublish "${i.title}"? Copies people already have keep working. Reason (optional):`);
                      if (reason !== null) unpublish.mutate({ id: i.id, reason });
                    }}
                    aria-label={`Unpublish ${i.title}`}
                    className="tap-target rounded-lg border border-border px-3 py-1.5 text-danger hover:bg-soft"
                  >
                    Unpublish
                  </button>
                )}
                {i.owner && <WarnOwner owner={i.owner} title={i.title} by={i.by} link="/catalog" />}
              </li>
            ))}
          </ul>
        )}
      </section>
      {error && <p className="text-danger">{error}</p>}
      <TrustedClubsSection />
      <CollectionModeration />
    </div>
  );
}

/**
 * Trusted clubs: their own admins and managers review what's published
 * under their name. Trust one (find it by name), or stop trusting it.
 */
export function TrustedClubsSection() {
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const trusted = useQuery({ queryKey: ['moderation-clubs', ''], queryFn: () => api.moderation.clubs() });
  const found = useQuery({ queryKey: ['moderation-clubs', q.trim()], queryFn: () => api.moderation.clubs(q.trim()), enabled: q.trim().length >= 2 });
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
        onClick={() => {
          if (c.trusted && !confirm(`Stop trusting ${c.name}? What's public stays public; what's waiting in its queue moves to yours.`)) return;
          set.mutate({ slug: c.slug, trusted: !c.trusted });
        }}
        aria-label={`${c.trusted ? 'Stop trusting' : 'Trust'} ${c.name}`}
        className="tap-target rounded-lg border border-border px-3 py-1.5 hover:bg-soft"
      >
        {c.trusted ? 'Stop trusting' : 'Trust'}
      </button>
    </li>
  );
  const list = trusted.data?.clubs ?? [];
  const more = (found.data?.clubs ?? []).filter((c) => !c.trusted);
  return (
    <section className="space-y-3" aria-labelledby="mod-trusted">
      <h2 id="mod-trusted" className="flex items-center gap-2 text-sm font-semibold">
        Trusted clubs
        <HelpButton helpKey="club.trusted" />
      </h2>
      <p className="text-xs text-muted">
        A trusted club’s admins and managers review what’s published under its name, instead of you. You can still see, decline or unpublish anything.
      </p>
      {list.length > 0 && <ul className="divide-y divide-line rounded-lg border border-line bg-panel">{list.map(row)}</ul>}
      <input
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Find a club to trust"
        aria-label="Find a club to trust"
        className="min-h-11 w-full rounded-lg border border-border bg-soft px-3"
      />
      {more.length > 0 && <ul aria-label="Clubs found" className="divide-y divide-line rounded-lg border border-line bg-panel">{more.map(row)}</ul>}
      {error && <p className="text-danger">{error}</p>}
    </section>
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

/** Collections: submissions and changes to review, and the ones in the catalog. */
function CollectionModeration() {
  const qc = useQueryClient();
  const data = useQuery({ queryKey: ['moderation-collections'], queryFn: api.moderation.collections });
  const [error, setError] = useState<string | null>(null);
  const opts = {
    onSuccess: () => {
      setError(null);
      void invalidateFor(qc, 'catalog');
    },
    onError: (e: Error) => setError(e.message),
  };
  const approve = useMutation({ mutationFn: api.moderation.approveCollection, ...opts });
  const decline = useMutation({ mutationFn: (a: { id: string; reason: string }) => api.moderation.declineCollection(a.id, a.reason), ...opts });
  const unpublish = useMutation({ mutationFn: (a: { id: string; reason: string }) => api.moderation.unpublishCollection(a.id, a.reason), ...opts });
  const feature = useMutation({ mutationFn: (a: { id: string; featured: boolean }) => api.moderation.featureCollection(a.id, a.featured), ...opts });
  const remove = useMutation({ mutationFn: (a: { id: string; reason: string }) => api.moderation.removeCollection(a.id, a.reason), ...opts });
  if (!data.data) return null;
  const { queue, collections } = data.data;
  const trustedQueue = data.data.trustedQueue ?? [];
  const renderTextQueue = (list: typeof queue) => (
          <ul className="space-y-2">
              {list.map((q) => (
                <li key={q.id} data-testid="moderation-collection" className="flex flex-wrap gap-3 rounded-lg border border-line bg-panel p-3 text-sm">
                  <div className="min-w-[12rem] flex-1 space-y-2">
                    <p className="font-semibold">
                      {q.title} <span className="font-normal text-muted">(collection {q.isUpdate ? 'text, a change' : 'text, new'})</span>
                    </p>
                    <p className="text-xs text-muted">
                      From {q.by}
                      {q.email ? ` (${q.email})` : ''} · {new Date(q.createdAt).toLocaleString()} ·{' '}
                      <a href={`/catalog/collections/${q.id}`} target="_blank" rel="noreferrer" className="hover:underline">
                        {q.itemCount} {q.itemCount === 1 ? 'item' : 'items'}
                      </a>
                    </p>
                    <TextReview q={q} />
                  </div>
                  <div className="flex basis-full flex-wrap justify-end gap-2 sm:basis-auto sm:flex-col">
                    <button
                      type="button"
                      onClick={() => approve.mutate(q.id)}
                      aria-label={`Approve collection ${q.title}`}
                      className="tap-target rounded-lg bg-accent px-3 py-1.5 font-semibold text-accent-ink hover:bg-accent-hover"
                    >
                      Approve
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        const reason = prompt(`Why is "${q.title}" declined? (optional; the curator sees this)`);
                        if (reason !== null) decline.mutate({ id: q.id, reason });
                      }}
                      aria-label={`Decline collection ${q.title}`}
                      className="tap-target rounded-lg border border-border px-3 py-1.5 hover:bg-soft"
                    >
                      Decline…
                    </button>
                  </div>
                  {q.owner && <WarnOwner owner={q.owner} title={q.title} by={q.by} link={`/catalog/collections/${q.id}`} />}
                </li>
              ))}
            </ul>
  );
  const clubCollections = data.data.clubCollections ?? [];
  return (
    <>
      <section className="space-y-3" aria-labelledby="mod-coll-queue">
        <h2 id="mod-coll-queue" className="text-sm font-semibold">Collections waiting for review ({queue.length})</h2>
        {queue.length === 0 ? (
          <p className="rounded-lg border border-dashed border-line p-4 text-sm text-muted">Nothing waiting.</p>
        ) : (
          renderTextQueue(queue)
        )}
      </section>
      {trustedQueue.length > 0 && (
        <section className="space-y-3" aria-labelledby="mod-coll-trusted">
          <h2 id="mod-coll-trusted" className="text-sm font-semibold">Collections in trusted clubs’ own queues ({trustedQueue.length})</h2>
          {renderTextQueue(trustedQueue)}
        </section>
      )}
      <section className="space-y-3" aria-labelledby="mod-colls">
        <h2 id="mod-colls" className="text-sm font-semibold">Collections in the catalog</h2>
        {collections.length === 0 ? (
          <p className="rounded-lg border border-dashed border-line p-4 text-sm text-muted">Nothing yet. Make one from the Catalog page (Your collections › New collection).</p>
        ) : (
          <ul className="divide-y divide-line rounded-lg border border-line bg-panel">
            {collections.map((c) => (
              <li key={c.id} data-testid="moderated-collection" className="flex flex-wrap items-center gap-3 px-3 py-2 text-sm">
                <div className="min-w-[10rem] flex-1">
                  <p className="font-medium">{c.title}</p>
                  <p className="text-xs text-muted">
                    {c.official ? 'Official' : `By ${c.by}`} · {c.itemCount} items ·{' '}
                    {c.status === 'public' ? (c.featured ? 'Featured' : 'Public') : `Unpublished${c.reason ? `: ${c.reason}` : ''}`}
                  </p>
                </div>
                {c.status === 'public' && c.official && (
                  <label className="flex items-center gap-1 text-xs">
                    <input type="checkbox" checked={c.featured} onChange={(e) => feature.mutate({ id: c.id, featured: e.target.checked })} aria-label={`Feature ${c.title}`} />
                    Featured
                  </label>
                )}
                {c.status === 'public' && (
                  <button
                    type="button"
                    onClick={() => {
                      const reason = prompt(`Unpublish "${c.title}"? Reason (optional; the curator sees this):`);
                      if (reason !== null) unpublish.mutate({ id: c.id, reason });
                    }}
                    aria-label={`Unpublish collection ${c.title}`}
                    className="tap-target rounded-lg border border-border px-3 py-1.5 text-danger hover:bg-soft"
                  >
                    Unpublish
                  </button>
                )}
                {c.owner && !c.official && <WarnOwner owner={c.owner} title={c.title} by={c.by} link={`/catalog/collections/${c.id}`} />}
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="space-y-3" aria-labelledby="mod-club-colls">
        <h2 id="mod-club-colls" className="text-sm font-semibold">Clubs’ private collections ({clubCollections.length})</h2>
        <p className="text-xs text-muted">Only each club’s members see these, and they’re never reviewed. Remove one only for abuse; it’s logged.</p>
        {clubCollections.length > 0 && (
          <ul className="divide-y divide-line rounded-lg border border-line bg-panel">
            {clubCollections.map((c) => (
              <li key={c.id} data-testid="moderated-club-collection" className="flex flex-wrap items-center gap-3 px-3 py-2 text-sm">
                <div className="min-w-[10rem] flex-1">
                  <a href={`/catalog/collections/${c.id}`} className="font-medium hover:underline">
                    {c.title}
                  </a>
                  <p className="text-xs text-muted">
                    {c.by} · {c.itemCount} items
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    const reason = prompt(`Remove "${c.title}" from ${c.by}? It's deleted for good. Reason (logged):`);
                    if (reason !== null) remove.mutate({ id: c.id, reason });
                  }}
                  aria-label={`Remove collection ${c.title}`}
                  className="tap-target rounded-lg border border-border px-3 py-1.5 text-danger hover:bg-soft"
                >
                  Remove
                </button>
                {c.owner && <WarnOwner owner={c.owner} title={c.title} by={c.by} link={`/catalog/collections/${c.id}`} />}
              </li>
            ))}
          </ul>
        )}
      </section>
      {error && <p className="text-danger">{error}</p>}
    </>
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
        People can share modules and custom parts for everyone, and add what others shared to their own. Both are off until you turn them on.
      </p>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={c.modules} onChange={(e) => save.mutate({ moduleCatalogEnabled: e.target.checked })} />
        Public module catalog
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={c.parts} onChange={(e) => save.mutate({ partsCatalogEnabled: e.target.checked })} />
        Public parts catalog
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
    </section>
  );
}

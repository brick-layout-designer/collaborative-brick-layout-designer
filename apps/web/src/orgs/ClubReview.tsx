// A trusted club's own review (its admins and managers): what members
// shared under the club's name, and collections' text, waiting for a
// decision; and what's public, to take down if need be.

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import { invalidateFor } from '../live/invalidate';
import { CoverReviewList, TextReview } from '../admin/Moderation';
import { HelpButton } from '../help/HelpButton';
import { askReason } from '../ui/ConfirmDialog';

const btn = 'tap-target rounded-lg border border-border px-3 py-1.5 hover:bg-soft';
const primary = 'tap-target rounded-lg bg-accent px-3 py-1.5 font-semibold text-accent-ink hover:bg-accent-hover';

export function ClubReviewTab({ slug, name }: { slug: string; name: string }) {
  const qc = useQueryClient();
  const data = useQuery({ queryKey: ['club-review', slug], queryFn: () => api.clubReview.get(slug) });
  const [error, setError] = useState<string | null>(null);
  const opts = {
    onSuccess: () => {
      setError(null);
      void invalidateFor(qc, 'catalog');
    },
    onError: (e: Error) => setError(e.message),
  };
  const version = useMutation({ mutationFn: (a: { id: string; ok: boolean; reason?: string }) => api.clubReview.decideVersion(slug, a.id, a.ok, a.reason), ...opts });
  const unpublishItem = useMutation({ mutationFn: (a: { id: string; reason: string }) => api.clubReview.unpublishItem(slug, a.id, a.reason), ...opts });
  const text = useMutation({ mutationFn: (a: { id: string; ok: boolean; reason?: string }) => api.clubReview.decideCollection(slug, a.id, a.ok, a.reason), ...opts });
  const cover = useMutation({ mutationFn: (a: { id: string; ok: boolean; reason?: string }) => api.clubReview.decideCover(slug, a.id, a.ok, a.reason), ...opts });
  const unpublishColl = useMutation({ mutationFn: (a: { id: string; reason: string }) => api.clubReview.unpublishCollection(slug, a.id, a.reason), ...opts });
  if (data.isLoading) return <p className="text-muted">Loading…</p>;
  if (data.isError) return <p className="text-danger">{(data.error as Error).message}</p>;
  const d = data.data!;
  const card = 'space-y-3 rounded-section border border-line bg-panel p-4';
  const covers = d.covers ?? [];
  return (
    <div className="space-y-5">
      <p className="flex items-center gap-2 text-sm text-muted">
        {name} is a trusted club: you check what members share under its name, instead of the site’s moderators.
        <HelpButton helpKey="club.trusted" />
      </p>
      <section className={card} aria-labelledby="club-review-queue">
        <h2 id="club-review-queue" className="text-lg font-semibold">
          Waiting for you ({d.items.length + d.collections.length + covers.length})
        </h2>
        {d.items.length + d.collections.length + covers.length === 0 && <p className="text-sm text-muted">Nothing waiting.</p>}
        {covers.length > 0 && (
          <CoverReviewList list={covers} warn={false} decide={(id, ok, reason) => cover.mutate({ id, ok, ...(reason !== undefined ? { reason } : {}) })} />
        )}
        <ul className="space-y-2">
          {d.items.map((q) => (
            <li key={q.versionId} data-testid="club-review-item" className="flex flex-wrap gap-3 rounded-lg border border-line p-3 text-sm">
              {q.previewUrl ? (
                <img src={q.previewUrl} alt="" className="size-20 shrink-0 rounded-lg border border-line bg-soft object-contain" />
              ) : (
                <span aria-hidden className="block size-20 shrink-0 rounded-lg border border-line bg-soft" />
              )}
              <div className="min-w-[10rem] flex-1 space-y-1">
                <p className="font-semibold">
                  {q.title} <span className="font-normal text-muted">({q.kind}, {q.isUpdate ? `update, version ${q.version}` : 'new'})</span>
                </p>
                <p className="text-xs text-muted">
                  {q.submitter ? `Sent by ${q.submitter} · ` : ''}
                  {new Date(q.createdAt).toLocaleString()}
                </p>
                {q.description && <p>{q.description}</p>}
                {q.note && <p className="text-xs">What changed: {q.note}</p>}
              </div>
              <div className="flex basis-full flex-wrap justify-end gap-2 sm:basis-auto sm:flex-col">
                <button type="button" onClick={() => version.mutate({ id: q.versionId, ok: true })} aria-label={`Approve ${q.title}`} className={primary}>
                  Approve
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    const reason = await askReason({
                      title: `Decline “${q.title}”?`,
                      removes: 'It doesn’t go into the catalog.',
                      keeps: 'Nothing is deleted; they can change it and send it again.',
                      confirmLabel: 'Decline',
                      reason: { label: 'Why? (the member sees this)' },
                    });
                    if (reason !== null) version.mutate({ id: q.versionId, ok: false, reason });
                  }}
                  aria-label={`Decline ${q.title}`}
                  className={btn}
                >
                  Decline…
                </button>
              </div>
            </li>
          ))}
          {d.collections.map((q) => (
            <li key={q.id} data-testid="club-review-collection" className="flex flex-wrap gap-3 rounded-lg border border-line p-3 text-sm">
              <div className="min-w-[10rem] flex-1 space-y-2">
                <p className="font-semibold">
                  {q.title} <span className="font-normal text-muted">(collection text)</span>
                </p>
                <TextReview q={q} />
              </div>
              <div className="flex basis-full flex-wrap justify-end gap-2 sm:basis-auto sm:flex-col">
                <button type="button" onClick={() => text.mutate({ id: q.id, ok: true })} aria-label={`Approve collection ${q.title}`} className={primary}>
                  Approve
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    const reason = await askReason({
                      title: `Decline “${q.title}”?`,
                      removes: 'It doesn’t go into the catalog.',
                      keeps: 'Nothing is deleted; they can change it and send it again.',
                      confirmLabel: 'Decline',
                      reason: { label: 'Why? (the curator sees this)' },
                    });
                    if (reason !== null) text.mutate({ id: q.id, ok: false, reason });
                  }}
                  aria-label={`Decline collection ${q.title}`}
                  className={btn}
                >
                  Decline…
                </button>
              </div>
            </li>
          ))}
        </ul>
      </section>
      <section className={card} aria-labelledby="club-review-public">
        <h2 id="club-review-public" className="text-lg font-semibold">
          In the catalog under {name}
        </h2>
        {d.published.length + d.publicCollections.length === 0 && <p className="text-sm text-muted">Nothing yet.</p>}
        <ul className="divide-y divide-line">
          {d.published.map((i) => (
            <li key={i.id} data-testid="club-published" className="flex flex-wrap items-center gap-3 py-2 text-sm">
              <span className="min-w-[10rem] flex-1">
                <span className="font-medium">{i.title}</span>{' '}
                <span className="text-xs text-muted">
                  {i.kind} · {i.status === 'public' ? 'Public' : `Unpublished${i.reason ? `: ${i.reason}` : ''}`}
                </span>
              </span>
              {i.status === 'public' && (
                <button
                  type="button"
                  onClick={async () => {
                    const reason = await askReason({
                      title: `Unpublish “${i.title}”?`,
                      removes: 'It leaves the public catalog, so nobody new can add it.',
                      keeps: 'Copies people already added keep working.',
                      confirmLabel: 'Unpublish',
                      reason: { label: 'Reason' },
                    });
                    if (reason !== null) unpublishItem.mutate({ id: i.id, reason });
                  }}
                  aria-label={`Unpublish ${i.title}`}
                  className={`${btn} text-danger`}
                >
                  Unpublish
                </button>
              )}
            </li>
          ))}
          {d.publicCollections.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center gap-3 py-2 text-sm">
              <span className="min-w-[10rem] flex-1">
                <span className="font-medium">{c.title}</span>{' '}
                <span className="text-xs text-muted">collection · {c.status === 'public' ? 'Public' : `Unpublished${c.reason ? `: ${c.reason}` : ''}`}</span>
              </span>
              {c.status === 'public' && (
                <button
                  type="button"
                  onClick={async () => {
                    const reason = await askReason({
                      title: `Unpublish “${c.title}”?`,
                      removes: 'It leaves the public catalog, so nobody new can add it.',
                      keeps: 'Copies people already added keep working.',
                      confirmLabel: 'Unpublish',
                      reason: { label: 'Reason' },
                    });
                    if (reason !== null) unpublishColl.mutate({ id: c.id, reason });
                  }}
                  aria-label={`Unpublish collection ${c.title}`}
                  className={`${btn} text-danger`}
                >
                  Unpublish
                </button>
              )}
            </li>
          ))}
        </ul>
      </section>
      {error && <p className="text-danger">{error}</p>}
    </div>
  );
}

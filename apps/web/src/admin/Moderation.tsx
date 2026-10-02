// Moderation (moderators and global admins): the queue of catalog
// submissions to approve or decline, and what's in the catalogs, which can
// be unpublished at once. Plus the catalog settings (global admins only).

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type CatalogReview, type WarningSubject } from '../api';
import { WarnForm } from '../notices/Notices';

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
  const items = data.data?.items ?? [];
  return (
    <div className="max-w-3xl space-y-8">
      <section className="space-y-3" aria-labelledby="mod-queue">
        <h2 id="mod-queue" className="text-sm font-semibold">Waiting for review ({queue.length})</h2>
        {queue.length === 0 ? (
          <p className="rounded-lg border border-dashed border-line p-4 text-sm text-muted">Nothing waiting.</p>
        ) : (
          <ul className="space-y-2">
            {queue.map((q) => (
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
        )}
      </section>
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
                  <p className="font-medium">{i.title}</p>
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
    </div>
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

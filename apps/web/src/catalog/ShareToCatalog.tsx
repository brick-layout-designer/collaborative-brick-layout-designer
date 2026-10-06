// Sharing a module or custom part to the public catalog, and the status
// badges on what you've shared ("In review", "Public", "Declined: …") or
// added ("Update available").

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type CatalogKind, type MyCatalogItem } from '../api';
import { ItemCoverDialog } from './ItemCover';

/** What the catalogs know about your things: shared items by source, and copies by id. */
export function useCatalogStatus() {
  const settings = useQuery({ queryKey: ['catalog-settings'], queryFn: api.catalog.settings, staleTime: 60_000 });
  const on = !!(settings.data?.modules || settings.data?.parts || settings.data?.layouts || settings.data?.venues);
  const mine = useQuery({ queryKey: ['catalog-mine'], queryFn: api.catalog.mine, enabled: on });
  const copies = useQuery({ queryKey: ['catalog-copies'], queryFn: api.catalog.copies, enabled: on });
  const bySource = new Map((mine.data?.items ?? []).map((i) => [`${i.kind}:${i.sourceId}`, i]));
  const byCopy = new Map((copies.data?.copies ?? []).map((c) => [c.copyId, c]));
  return {
    enabled: (kind: CatalogKind) =>
      kind === 'module' ? !!settings.data?.modules : kind === 'part' ? !!settings.data?.parts : kind === 'layout' ? !!settings.data?.layouts : !!settings.data?.venues,
    review: settings.data?.review ?? 'moderators',
    shared: (kind: CatalogKind, sourceId: string) => bySource.get(`${kind}:${sourceId}`),
    copy: (id: string) => byCopy.get(id),
  };
}

const LABEL: Record<MyCatalogItem['status'], string> = {
  in_review: 'In review',
  public: 'Public',
  declined: 'Declined',
  unpublished: 'Unpublished',
  withdrawn: 'Withdrawn',
};

export function CatalogBadge({ item }: { item: MyCatalogItem }) {
  const tone =
    item.status === 'public' ? 'bg-ok-soft text-ok' : item.status === 'in_review' ? 'bg-amber-950 text-amber-300' : 'bg-soft text-muted';
  const text =
    item.status === 'public' && item.pendingVersion ? 'Public · update in review' : LABEL[item.status] + (item.reason ? `: ${item.reason}` : '');
  return (
    <span data-testid="catalog-badge" className={`rounded-full px-2 py-0.5 text-xs font-bold ${tone}`} title="In the public catalog">
      {text}
    </span>
  );
}

/** "Update available" on your copy of a catalog item, with "Get the new version". */
export function UpdateAvailable({ copyId, label }: { copyId: string; label: string }) {
  const qc = useQueryClient();
  const status = useCatalogStatus();
  const copy = status.copy(copyId);
  const get = useMutation({
    mutationFn: () => api.catalog.updateCopy(copyId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['catalog-copies'] });
      void qc.invalidateQueries({ queryKey: ['modules'] });
      void qc.invalidateQueries({ queryKey: ['custom-parts'] });
    },
  });
  if (!copy?.updateAvailable) return null;
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-accent/15 px-2 py-0.5 text-xs font-bold text-accent-text">
      Update available
      <button
        type="button"
        disabled={get.isPending}
        onClick={() => get.mutate()}
        aria-label={`Get the new version of ${label}`}
        className="rounded-full px-1 underline disabled:opacity-50"
      >
        Get the new version
      </button>
    </span>
  );
}

export function ShareToCatalogDialog({
  kind,
  sourceId,
  title: initialTitle,
  existing,
  onClose,
  clubReview,
  makeThumbnail,
}: {
  kind: CatalogKind;
  sourceId: string;
  title: string;
  /** Already shared: this is an update. */
  existing?: MyCatalogItem | undefined;
  onClose: () => void;
  /** A trusted club's name, when its own admins and managers review this. */
  clubReview?: string | undefined;
  /** A layout's picture for its card (the editor draws it). */
  makeThumbnail?: () => Promise<{ mime: string; data: string } | null>;
}) {
  const qc = useQueryClient();
  const settings = useQuery({ queryKey: ['catalog-settings'], queryFn: api.catalog.settings });
  const [title, setTitle] = useState(existing?.title ?? initialTitle);
  const [description, setDescription] = useState('');
  const [tags, setTags] = useState('');
  const [note, setNote] = useState('');
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [coverOpen, setCoverOpen] = useState(false);
  const share = useMutation({
    mutationFn: async () => {
      // A picture that can't be drawn doesn't stop the share: cards show a placeholder.
      const thumbnail = makeThumbnail ? await makeThumbnail().catch(() => null) : null;
      return api.catalog.share({
        ...(thumbnail ? { thumbnail } : {}),
        kind,
        sourceId,
        title: title.trim(),
        // An update keeps its description and tags unless new ones are given.
        ...(description.trim() || !existing ? { description: description.trim() } : {}),
        ...(tags.trim() || !existing ? { tags: tags.split(',').map((t) => t.trim()).filter(Boolean) } : {}),
        ...(note.trim() ? { note: note.trim() } : {}),
      });
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['catalog-mine'] });
      void qc.invalidateQueries({ queryKey: ['catalog-items'] });
    },
    onError: (e: Error) => setError(e.message),
  });
  const review = settings.data?.review !== 'none';
  return (
    <div className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-black/60 p-4">
      <form
        role="dialog"
        aria-modal="true"
        aria-label="Share to the public catalog"
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          if (!title.trim()) return setError('Give it a name.');
          if (!consent) return setError('Tick the box to agree that anyone can copy it.');
          share.mutate();
        }}
        className="w-full max-w-md space-y-3 rounded-section border border-line bg-panel p-5 text-sm"
      >
        <h3 className="text-lg font-semibold">{existing ? 'Publish this update' : 'Share to the public catalog'}</h3>
        {share.data ? (
          <>
            <p role="status">
              {share.data.status === 'public'
                ? 'Shared: it’s in the public catalog now.'
                : clubReview
                  ? `Sent to ${clubReview}’s own review: its admins and managers check it before it appears in the catalog.`
                  : 'Sent for review. A moderator looks at it before it appears in the catalog.'}
            </p>
            <p className="text-muted">Cards show its drawn picture. You can upload your own instead, like a photo of the real thing.</p>
            <div className="flex flex-wrap justify-end gap-2">
              <button type="button" onClick={() => setCoverOpen(true)} className="tap-target rounded-lg border border-border px-4 py-2 hover:bg-soft">
                Choose a cover picture…
              </button>
              <button type="button" onClick={onClose} className="tap-target rounded-lg bg-accent px-4 py-2 font-semibold text-accent-ink">
                Done
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="text-muted">
              A copy of it as it is now goes to the catalog. Later changes stay yours until you publish an update.
              {kind === 'layout' ? ' Collaborators, comments, chat, file paths, the background picture and the venue’s notes stay private.' : ''}
              {kind === 'venue' ? ' Notes on the plan stay private.' : ''}
              {review ? ' A moderator reviews it first.' : ''}
            </p>
            <label className="block">
              <span className="mb-1 block text-muted">Name</span>
              <input value={title} maxLength={80} onChange={(e) => setTitle(e.target.value)} className="w-full rounded-lg border border-border bg-soft px-3 py-2" />
            </label>
            <label className="block">
              <span className="mb-1 block text-muted">Description (optional)</span>
              <textarea value={description} maxLength={1000} rows={3} onChange={(e) => setDescription(e.target.value)} className="w-full rounded-lg border border-border bg-soft px-3 py-2" />
            </label>
            <label className="block">
              <span className="mb-1 block text-muted">Tags, separated by commas (optional)</span>
              <input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="e.g. station, 9V" className="w-full rounded-lg border border-border bg-soft px-3 py-2" />
            </label>
            {existing && (
              <label className="block">
                <span className="mb-1 block text-muted">What changed? (optional)</span>
                <input value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} className="w-full rounded-lg border border-border bg-soft px-3 py-2" />
              </label>
            )}
            {existing && (
              <p>
                <button type="button" onClick={() => setCoverOpen(true)} className="text-accent-text hover:underline">
                  Change its cover picture…
                </button>
              </p>
            )}
            <label className="flex items-start gap-2">
              <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-1" />
              <span>Anyone can copy this into their own layouts.</span>
            </label>
            {error && <p className="text-danger">{error}</p>}
            <div className="flex justify-end gap-2">
              <button type="button" onClick={onClose} className="tap-target rounded-lg border border-border px-4 py-2 hover:bg-soft">
                Cancel
              </button>
              <button
                type="submit"
                disabled={share.isPending}
                className="tap-target rounded-lg bg-accent px-4 py-2 font-semibold text-accent-ink hover:bg-accent-hover disabled:opacity-50"
              >
                {existing ? 'Publish update' : 'Share'}
              </button>
            </div>
          </>
        )}
      </form>
      {coverOpen && (share.data?.id ?? existing?.id) && (
        <ItemCoverDialog itemId={(share.data?.id ?? existing?.id)!} clubReview={clubReview} onClose={() => setCoverOpen(false)} />
      )}
    </div>
  );
}

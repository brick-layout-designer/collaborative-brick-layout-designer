// A catalog item's cover picture (a module or part you shared): the drawn
// one, or your own, placed with CoverPicker. While the item is public a new
// picture waits for review and the old one stays up; removing it goes back
// to the drawn picture at once.

import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type MyCatalogItem } from '../api';
import { invalidateFor } from '../live/invalidate';
import { CoverPicker, type CoverMode, type CoverPickerHandle } from '../ui/CoverPicker';

/** The drawn picture of what's shared: the public version, else the one waiting. */
export const drawnPictureUrl = (i: Pick<MyCatalogItem, 'id' | 'version' | 'pendingVersion'>) =>
  `/api/catalog/items/${i.id}/preview?v=${i.version || i.pendingVersion || 0}`;

/** What saving said, in plain words. */
export function coverSavedText(status: 'public' | 'in_review' | undefined, removed: boolean, clubReview?: string): string {
  if (removed) return 'Back to the drawn picture.';
  if (status === 'in_review') {
    return clubReview
      ? `Sent to ${clubReview}’s own review. The current picture stays until it’s approved.`
      : 'Sent for review. The current picture stays until a moderator approves the new one.';
  }
  return 'Saved: cards show your picture now.';
}

export function ItemCoverDialog({ itemId, onClose, clubReview }: { itemId: string; onClose: () => void; clubReview?: string | undefined }) {
  const qc = useQueryClient();
  const settings = useQuery({ queryKey: ['catalog-settings'], queryFn: api.catalog.settings });
  const mine = useQuery({ queryKey: ['catalog-mine'], queryFn: api.catalog.mine });
  const item = mine.data?.items.find((i) => i.id === itemId);
  const current = item ? (item.pendingCoverUrl ?? item.customCoverUrl ?? null) : null;
  const [mode, setMode] = useState<CoverMode | null>(null);
  const shownMode: CoverMode = mode ?? (current ? 'upload' : 'drawn');
  const picker = useRef<CoverPickerHandle | null>(null);
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: async () => {
      if (shownMode === 'upload') {
        const upload = await picker.current?.compose();
        if (upload) return { removed: false, r: await api.catalog.uploadItemCover(itemId, { mime: upload.mime, data: upload.data }) };
        return null;
      }
      if (current) return { removed: true, r: await api.catalog.removeItemCover(itemId) };
      return null;
    },
    onSuccess: (res) => {
      if (!res) return onClose();
      void qc.invalidateQueries({ queryKey: ['catalog-mine'] });
      void invalidateFor(qc, 'catalog');
    },
    onError: (e: Error) => setError(e.message),
  });
  const live = item?.status === 'public';
  const review = settings.data?.review !== 'none';
  return (
    <div className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-black/60 p-4">
      <div role="dialog" aria-modal="true" aria-label="Cover picture" className="w-full max-w-md space-y-3 rounded-section border border-line bg-panel p-5 text-sm">
        <h3 className="text-lg font-semibold">Cover picture{item ? <span className="font-normal text-muted"> · {item.title}</span> : null}</h3>
        {save.data ? (
          <>
            <p role="status">{coverSavedText(save.data.r.status, save.data.removed, clubReview)}</p>
            <div className="flex justify-end">
              <button type="button" onClick={onClose} className="tap-target rounded-lg bg-accent px-4 py-2 font-semibold text-accent-ink">
                Done
              </button>
            </div>
          </>
        ) : !item ? (
          <p className="text-muted">{mine.isLoading ? 'Loading…' : 'This isn’t one of your shared items.'}</p>
        ) : (
          <>
            {item.pendingCoverUrl && <p className="rounded-lg bg-soft p-2 text-xs">A new picture is waiting for review. The one showing stays until it’s approved.</p>}
            {item.coverReason && <p className="rounded-lg bg-soft p-2 text-xs">Your last picture was declined: {item.coverReason}</p>}
            <CoverPicker
              mode={shownMode}
              onModeChange={setMode}
              drawnUrl={drawnPictureUrl(item)}
              currentUrl={current}
              maxBytes={settings.data?.coverMaxBytes ?? 5 * 1024 * 1024}
              reviewNote={live && review ? (clubReview ? `${clubReview}’s admins check it before everyone sees it.` : 'A moderator checks it before everyone sees it.') : undefined}
              handle={picker}
              name={`cover-${itemId}`}
            />
            {error && <p className="text-danger">{error}</p>}
            <div className="flex justify-end gap-2">
              <button type="button" onClick={onClose} className="tap-target rounded-lg border border-border px-4 py-2 hover:bg-soft">
                Cancel
              </button>
              <button
                type="button"
                disabled={save.isPending}
                onClick={() => {
                  setError(null);
                  save.mutate();
                }}
                className="tap-target rounded-lg bg-accent px-4 py-2 font-semibold text-accent-ink hover:bg-accent-hover disabled:opacity-50"
              >
                {save.isPending ? 'Saving…' : 'Save picture'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// "Add to a collection…": put a catalog item, or one of your own (or your
// club's) modules or parts, in a collection you curate, or start a new one
// with it. Private collections are never checked; in a public one, your
// own module or part is shared to the catalog for its own review first.

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type CatalogItem, type CollectionEntry, type CustomPartSummary, type ModuleSummary } from '../api';
import { invalidateFor } from '../live/invalidate';
import { audienceLabel, CollectionEditor, type Picked } from './Collections';
import { showCollectionToast } from './collectionToast';

export type CollectionTarget =
  | { kind: 'catalog'; item: Pick<CatalogItem, 'id' | 'kind' | 'title' | 'previewUrl'> }
  | { kind: 'module'; module: Pick<ModuleSummary, 'id' | 'title' | 'ownerUserId' | 'ownerOrgId' | 'thumbnailAt'> }
  | { kind: 'part'; part: Pick<CustomPartSummary, 'id' | 'displayName' | 'partNumber' | 'ownerUserId' | 'ownerOrgId'> };

/** The item as the editor and the server spell it. */
export function targetPicked(t: CollectionTarget): Picked {
  if (t.kind === 'catalog') return { source: 'catalog', kind: t.item.kind, id: t.item.id, title: t.item.title, previewUrl: t.item.previewUrl };
  if (t.kind === 'module')
    return {
      source: 'library',
      kind: 'module',
      id: t.module.id,
      title: t.module.title,
      previewUrl: t.module.thumbnailAt ? `/api/modules/${t.module.id}/thumbnail?v=${t.module.thumbnailAt}` : '',
    };
  return { source: 'library', kind: 'part', id: t.part.id, title: t.part.displayName || t.part.partNumber, previewUrl: api.customParts.spriteUrl(t.part.id) };
}

const entryOf = (p: Picked): CollectionEntry => (p.source === 'catalog' ? { source: 'catalog', id: p.id } : { source: 'library', kind: p.kind, id: p.id });

/** Whose it is: a club's (by id), yours, or a catalog item (anyone's). */
export function targetOwner(t: CollectionTarget): { club: string } | 'me' | 'catalog' {
  if (t.kind === 'catalog') return 'catalog';
  const o = t.kind === 'module' ? t.module : t.part;
  return o.ownerOrgId ? { club: o.ownerOrgId } : 'me';
}

export function AddToCollectionDialog({ target, onClose }: { target: CollectionTarget; onClose: () => void }) {
  const qc = useQueryClient();
  const mine = useQuery({ queryKey: ['catalog-collections-mine'], queryFn: api.catalog.myCollections });
  const clubs = useQuery({ queryKey: ['club-collections', ''], queryFn: () => api.catalog.clubCollections() });
  const [newIn, setNewIn] = useState<{ club: { id: string; slug: string; name: string } | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const picked = targetPicked(target);
  const owner = targetOwner(target);
  const add = useMutation({
    mutationFn: (c: { id: string; title: string }) => api.catalog.addToCollection(c.id, entryOf(picked)).then((r) => ({ r, c })),
    onSuccess: ({ r, c }) => {
      void invalidateFor(qc, 'catalog');
      const waits = (r.submitted?.length ?? 0) > 0;
      showCollectionToast({
        text: `Added “${picked.title}” to “${c.title}”.${waits ? ' It shows publicly once it’s approved.' : ''}`,
        collectionId: c.id,
      });
      onClose();
    },
    onError: (e: Error) => setError(e.message),
  });

  const curated = (clubs.data?.clubs ?? []).filter((cl) => cl.canCurate);
  const mineRows = owner === 'me' || owner === 'catalog' ? (mine.data?.collections ?? []).filter((c) => c.status !== 'withdrawn') : [];
  const clubGroups = curated.filter((cl) => owner === 'catalog' || (typeof owner === 'object' && owner.club === cl.id));
  const ownerClub = typeof owner === 'object' ? (clubs.data?.clubs ?? []).find((cl) => cl.id === owner.club) : undefined;
  const cannot = typeof owner === 'object' && clubs.isSuccess && !clubGroups.length;
  const options = [
    ...mineRows.map((c) => ({ c, where: audienceLabel(c.audience, null) })),
    ...clubGroups.flatMap((cl) => cl.collections.map((c) => ({ c, where: `${cl.name} · ${audienceLabel(c.audience, cl.name)}` }))),
  ];

  if (newIn) {
    return <CollectionEditor id={null} club={newIn.club} initial={[picked]} onClose={onClose} />;
  }
  return (
    <div className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-black/60 p-4">
      <div role="dialog" aria-modal="true" aria-label="Add to a collection" className="w-full max-w-md space-y-4 rounded-section border border-line bg-panel p-5 text-sm">
        <h3 className="text-lg font-semibold">Add “{picked.title}” to a collection</h3>
        {cannot ? (
          <p className="text-muted">
            Only {ownerClub?.name ?? 'the club'}’s admins and managers put its {picked.kind === 'module' ? 'modules' : 'parts'} in its collections. Ask one of them.
          </p>
        ) : (
          <>
            {(mine.isLoading || clubs.isLoading) && <p className="text-muted">Loading…</p>}
            {options.length > 0 ? (
              <ul aria-label="Your collections" className="max-h-72 divide-y divide-line overflow-y-auto rounded-lg border border-line">
                {options.map(({ c, where }) => (
                  <li key={c.id} className="flex items-center gap-2 px-3 py-2">
                    <span className="min-w-0 flex-1">
                      <span className="block break-words font-medium">{c.title}</span>
                      <span className="text-xs text-muted">{where}</span>
                    </span>
                    <button
                      type="button"
                      disabled={add.isPending}
                      onClick={() => {
                        setError(null);
                        add.mutate(c);
                      }}
                      aria-label={`Add to ${c.title}`}
                      className="tap-target rounded-lg border border-border px-3 py-1.5 font-semibold hover:bg-soft disabled:opacity-50"
                    >
                      Add
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              mine.isSuccess && clubs.isSuccess && <p className="text-muted">You have no collections it can go in yet.</p>
            )}
            {picked.source === 'library' && (
              <p className="text-xs text-muted">In a public collection, it’s shared to the catalog and checked first; private collections are never checked.</p>
            )}
            <div className="flex flex-wrap gap-2">
              {owner !== 'catalog' && typeof owner === 'object' ? (
                clubGroups.map((cl) => (
                  <button
                    key={cl.id}
                    type="button"
                    onClick={() => setNewIn({ club: { id: cl.id, slug: cl.slug, name: cl.name } })}
                    className="tap-target rounded-lg border border-border px-3 py-1.5 hover:bg-soft"
                  >
                    New {cl.name} collection with this
                  </button>
                ))
              ) : (
                <>
                  <button type="button" onClick={() => setNewIn({ club: null })} className="tap-target rounded-lg border border-border px-3 py-1.5 hover:bg-soft">
                    New collection with this
                  </button>
                  {owner === 'catalog' &&
                    clubGroups.map((cl) => (
                      <button
                        key={cl.id}
                        type="button"
                        onClick={() => setNewIn({ club: { id: cl.id, slug: cl.slug, name: cl.name } })}
                        className="tap-target rounded-lg border border-border px-3 py-1.5 hover:bg-soft"
                      >
                        New {cl.name} collection with this
                      </button>
                    ))}
                </>
              )}
            </div>
          </>
        )}
        {error && <p className="text-danger">{error}</p>}
        <div className="flex justify-end">
          <button type="button" onClick={onClose} className="tap-target rounded-lg border border-border px-4 py-2 hover:bg-soft">
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

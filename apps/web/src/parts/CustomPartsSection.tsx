// Custom parts on the home page: yours, your clubs' and the ones shared
// with you, each with its owner chip, narrowed by the home page's owner
// filter. Upload a new one, download one's XML, or delete one you own.
// (This used to be the separate Library page.)

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type CustomPartSummary, type OrgSummary } from '../api';
import { matchesOwnerFilter, type OwnerFilter } from '../owners/owners';
import { CreditLine, MoveCopyDialog, OwnerChip, ReturnMenuItems } from '../owners/OwnerControls';
import { MoreMenu, MORE_ITEM } from '../ui/MoreMenu';
import { CatalogBadge, ShareToCatalogDialog, UpdateAvailable, useCatalogStatus } from '../catalog/ShareToCatalog';
import { UploadPartDialog } from './UploadPartDialog';
import { AddToCollectionDialog } from '../catalog/AddToCollection';
import { atLeast } from '../orgs/clubRoles';
import { askConfirm, confirmDelete, toastDeleted } from '../ui/ConfirmDialog';
import { CUSTOM_PART_DELETE_WORDING } from '../ui/deleteWording';

/** Where the old Library page (/library) now lands: the home page's parts section. */
export const PARTS_SECTION = { pathname: '/', hash: '#parts' } as const;

/** May delete it: the server says so; older servers: your own, or a club you admin. */
export function canDeletePart(p: CustomPartSummary, myUserId: string | undefined, orgs: readonly OrgSummary[] | undefined): boolean {
  if (p.role !== undefined) return p.role === 'owner';
  if (p.ownerOrgId) return atLeast(orgs?.find((o) => o.id === p.ownerOrgId)?.myRole, 'manager');
  return p.ownerUserId === myUserId;
}

export function CustomPartsSection({
  filter,
  myUserId,
  orgs,
  canUpload,
}: {
  filter: OwnerFilter;
  myUserId: string | undefined;
  orgs: readonly OrgSummary[] | undefined;
  /** Demo accounts can't add parts. */
  canUpload: boolean;
}) {
  const qc = useQueryClient();
  const parts = useQuery({ queryKey: ['custom-parts'], queryFn: api.customParts.list });
  const [uploading, setUploading] = useState(false);
  const [sharing, setSharing] = useState<CustomPartSummary | null>(null);
  const [toCollection, setToCollection] = useState<CustomPartSummary | null>(null);
  const [moving, setMoving] = useState<CustomPartSummary | null>(null);
  const hasClubs = (orgs?.length ?? 0) > 0;
  // A member (not an admin or manager) of a trusted club shares its parts for the club's own review.
  const trustedMember = (p: CustomPartSummary) =>
    !canDeletePart(p, myUserId, orgs) && !!p.ownerOrgId && !!orgs?.find((o) => o.id === p.ownerOrgId && o.trusted);
  const catalog = useCatalogStatus();
  const withdraw = useMutation({
    mutationFn: api.catalog.withdraw,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['catalog-mine'] }),
  });
  const remove = useMutation({
    mutationFn: api.customParts.remove,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['custom-parts'] });
      qc.invalidateQueries({ queryKey: ['parts-catalog'] });
    },
    onError: (e: Error) => alert(`Could not delete the part: ${e.message}`),
  });
  const list = (parts.data?.parts ?? [])
    .filter((p) => matchesOwnerFilter(p, filter, myUserId, orgs))
    .sort((a, b) => a.partNumber.localeCompare(b.partNumber));

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="parts-heading" className="text-2xl font-bold">
          Custom parts
        </h2>
        {canUpload && (
          <button
            type="button"
            onClick={() => setUploading(true)}
            className="tap-target rounded-lg border border-border px-3 py-1.5 text-sm font-semibold hover:bg-soft"
          >
            Upload part
          </button>
        )}
      </div>
      {parts.isLoading ? (
        <p className="text-sm text-muted">Loading…</p>
      ) : list.length === 0 ? (
        <p className="rounded-lg border border-dashed border-line p-4 text-sm text-muted">
          No custom parts here yet. Upload a part’s XML and picture to use it in your layouts.
        </p>
      ) : (
        <ul aria-labelledby="parts-heading" className="divide-y divide-line rounded-lg border border-line bg-panel">
          {list.map((p) => (
            <li key={p.id} className="flex items-center justify-between gap-3 px-4 py-2 text-sm">
              <div className="flex min-w-0 items-center gap-3">
                <img
                  src={api.customParts.spriteUrl(p.id)}
                  alt=""
                  className="h-10 w-10 shrink-0 object-contain"
                  loading="lazy"
                />
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2">
                    <span className="break-words font-medium">{p.displayName || p.partNumber}</span>
                    <OwnerChip item={p} myUserId={myUserId} orgs={orgs} />
                    {catalog.shared('part', p.id) && <CatalogBadge item={catalog.shared('part', p.id)!} />}
                    <UpdateAvailable copyId={p.id} label={p.displayName || p.partNumber} />
                  </p>
                  <p className="break-all font-mono text-xs text-muted">{p.partNumber}</p>
                  <CreditLine credit={p.credit} />
                </div>
              </div>
              <MoreMenu label={`More for ${p.partNumber}`}>
                <a role="menuitem" href={api.customParts.xmlUrl(p.id)} download={`${p.partNumber}.xml`} className={MORE_ITEM}>
                  Download XML
                </a>
                <a role="menuitem" href={api.customParts.spriteUrl(p.id)} download className={MORE_ITEM}>
                  Download picture
                </a>
                {(catalog.enabled('part') || catalog.enabled('module')) && canDeletePart(p, myUserId, orgs) && (
                  <button role="menuitem" type="button" onClick={() => setToCollection(p)} className={MORE_ITEM}>
                    Add to a collection…
                  </button>
                )}
                {catalog.enabled('part') && (canDeletePart(p, myUserId, orgs) || trustedMember(p)) && (
                  <button role="menuitem" type="button" onClick={() => setSharing(p)} className={MORE_ITEM}>
                    {catalog.shared('part', p.id) ? 'Publish this update…' : 'Share to the public catalog…'}
                  </button>
                )}
                {canDeletePart(p, myUserId, orgs) &&
                  (catalog.shared('part', p.id)?.status === 'public' || catalog.shared('part', p.id)?.status === 'in_review') && (
                    <button
                      role="menuitem"
                      type="button"
                      onClick={async () => {
                        if (await askConfirm({
                          title: `Withdraw “${p.partNumber}” from the catalog?`,
                          removes: 'It leaves the public catalog, so nobody new can add it.',
                          keeps: 'Yours stays here, and copies people already added keep working.',
                          undo: 'You can share it to the catalog again later.',
                          confirmLabel: 'Withdraw',
                        })) withdraw.mutate(catalog.shared('part', p.id)!.id);
                      }}
                      className={MORE_ITEM}
                    >
                      Withdraw from the catalog
                    </button>
                  )}
                {hasClubs && canUpload && (
                  <button role="menuitem" type="button" onClick={() => setMoving(p)} className={MORE_ITEM}>
                    Move or copy…
                  </button>
                )}
                <ReturnMenuItems kind="custom-parts" id={p.id} title={p.displayName || p.partNumber} credit={p.credit} />
                {canDeletePart(p, myUserId, orgs) && (
                  <button
                    role="menuitem"
                    type="button"
                    className={`${MORE_ITEM} text-danger`}
                    onClick={async () => {
                      if (await confirmDelete(p.partNumber, CUSTOM_PART_DELETE_WORDING))
                        remove.mutate(p.id, { onSuccess: () => toastDeleted(p.partNumber) });
                    }}
                  >
                    Delete
                  </button>
                )}
              </MoreMenu>
            </li>
          ))}
        </ul>
      )}
      {/* It saves to the club being shown, like New layout. */}
      {uploading && <UploadPartDialog filter={filter} onClose={() => setUploading(false)} />}
      {moving && orgs && (
        <MoveCopyDialog
          kind="part"
          item={{ id: moving.id, title: moving.displayName || moving.partNumber, ownerOrgId: moving.ownerOrgId }}
          canMove={moving.ownerOrgId ? canDeletePart(moving, myUserId, orgs) : moving.ownerUserId === myUserId}
          orgs={orgs}
          onClose={() => setMoving(null)}
        />
      )}
      {toCollection && <AddToCollectionDialog target={{ kind: 'part', part: toCollection }} onClose={() => setToCollection(null)} />}
      {sharing && (
        <ShareToCatalogDialog
          kind="part"
          sourceId={sharing.id}
          title={sharing.displayName || sharing.partNumber}
          existing={catalog.shared('part', sharing.id)}
          onClose={() => setSharing(null)}
          clubReview={trustedMember(sharing) ? orgs?.find((o) => o.id === sharing.ownerOrgId)?.name : undefined}
        />
      )}
    </div>
  );
}

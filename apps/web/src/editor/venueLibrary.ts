// Venue Library helpers — VenueLibraryPanel.cpp: the detail line for a
// saved venue, and saving the current venue under a name that may
// already be taken (desktop asks before overwriting that file).

import type { Venue } from '@cld/bbm';
import { askConfirm } from '../ui/ConfirmDialog';

export interface SavedVenue {
  id: string;
  name: string;
  ownerOrgId: string | null;
}

/** "name\nN wall seg · N door · N obstacle · walkway ≥ X mm" (VenueLibraryPanel.cpp detailText). */
export function venueDetail(v: Venue): string {
  const walls = v.edges.filter((e) => e.kind === 0).length;
  const doors = v.edges.filter((e) => e.kind === 1).length;
  // Desktop's own conversion (~0.8 mm per stud there), kept as-is.
  const walkwayMm = Math.trunc(v.minWalkwayStuds * 0.8);
  return `${v.name || '(unnamed)'}\n${walls} wall seg · ${doors} door · ${v.obstacles.length} obstacle · walkway ≥ ${walkwayMm} mm`;
}

/** A saved venue of the same owner (personal, or that org) with this name, ignoring case. */
export function venueNamed(list: readonly SavedVenue[], name: string, ownerOrgId: string | null, exceptId?: string): SavedVenue | undefined {
  const n = name.trim().toLowerCase();
  return list.find((v) => v.id !== exceptId && v.ownerOrgId === ownerOrgId && v.name.trim().toLowerCase() === n);
}

export interface VenueSaveApi {
  create: (body: { name: string; data: unknown; orgSlug?: string }) => Promise<unknown>;
  update: (id: string, data: unknown) => Promise<unknown>;
}

/** "‹name› already exists. Replace it?" in the app's confirmation dialog. */
export function askOverwrite(name: string): Promise<boolean> {
  return askConfirm({
    title: `Replace “${name}”?`,
    removes: `A venue called “${name}” is already in the library. Its walls, doors and obstacles are replaced by this one.`,
    keeps: 'Layouts made from it keep their own copy.',
    undo: 'This can’t be undone.',
    confirmLabel: 'Replace',
  });
}

/**
 * Save `venue` to the library as `name` for the personal library or an
 * org. When that owner already has a venue with the name, `confirm`
 * decides whether to overwrite it (VenueLibraryPanel.cpp:180-184).
 */
export async function saveVenueToLibrary(
  venue: Venue,
  name: string,
  owner: { orgSlug?: string; orgId: string | null },
  list: readonly SavedVenue[],
  api: VenueSaveApi,
  confirm: (name: string) => boolean | Promise<boolean>,
): Promise<'created' | 'overwritten' | 'cancelled'> {
  const existing = venueNamed(list, name, owner.orgId);
  if (existing) {
    if (!(await confirm(existing.name))) return 'cancelled';
    await api.update(existing.id, venue);
    return 'overwritten';
  }
  await api.create(owner.orgSlug ? { name, data: venue, orgSlug: owner.orgSlug } : { name, data: venue });
  return 'created';
}

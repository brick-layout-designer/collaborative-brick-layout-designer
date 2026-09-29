// Starting a layout from a saved venue: the venue rides in the new
// layout's sidecar (the same `venue` field the editor and the desktop
// read), merged into any sidecar the user also picked or the template
// brought, and replacing a venue that was already there.

import { CURRENT_SCHEMA_VERSION, readSidecar, writeSidecar, type Sidecar, type Venue } from '@cld/bbm';

export function sidecarWithVenue(sidecarText: string | undefined, venue: Venue): string {
  const base: Sidecar = sidecarText ? readSidecar(sidecarText) : { schemaVersion: CURRENT_SCHEMA_VERSION, bbmHashSha256: '' };
  return writeSidecar({ ...base, venue: { ...venue, enabled: true } });
}

export interface VenueChoice {
  id: string;
  name: string;
  ownerOrgId: string | null;
}

/**
 * Venues for the "Start from venue" list: the chosen owner's venues first
 * (the org's, or your own for a personal layout), then the rest, each group
 * by name.
 */
export function orderVenuesForOwner(venues: readonly VenueChoice[], ownerOrgId: string | null): VenueChoice[] {
  const byName = (a: VenueChoice, b: VenueChoice) => a.name.localeCompare(b.name);
  const mine = venues.filter((v) => v.ownerOrgId === ownerOrgId).sort(byName);
  const rest = venues.filter((v) => v.ownerOrgId !== ownerOrgId).sort(byName);
  return [...mine, ...rest];
}

/** Save text as a file download. */
export function downloadText(filename: string, text: string, type = 'application/json'): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

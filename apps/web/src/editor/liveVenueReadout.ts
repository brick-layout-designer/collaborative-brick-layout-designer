// The status bar's venue check, against the parts where a drag has them now
// (liveDragPose.ts), so a warning shows (or clears) before the drop.

import { useMemo } from 'react';
import type { BbmMap } from '@cld/model';
import type { Venue } from '@cld/bbm';
import { usePosedMap } from './liveDragPose';
import { validateVenue, venueStatus } from './venueValidator';

export function useLiveVenueReadout(venue: Venue | null | undefined, map: BbmMap | null): ReturnType<typeof venueStatus> {
  // Only with a venue to check against.
  const live = usePosedMap(map, () => !!venue?.enabled);
  return useMemo(() => venueStatus(venue, validateVenue(venue, live)), [venue, live]);
}

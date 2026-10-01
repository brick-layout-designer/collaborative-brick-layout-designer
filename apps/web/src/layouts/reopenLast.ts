// "Reopen last layout on startup" (Preferences, like desktop's
// general/reopenLastFile): the home page opens the layout last edited, once
// per browser visit, so coming back home from the editor stays home. A link
// that came to the home page for something else (?owner=, ?newLayoutVenue=,
// #parts) wins over it.

export const LAST_LAYOUT_KEY = 'cld:lastLayoutId';
const DONE_KEY = 'cld:reopenedLast';

/** The layout to open now, or null; marks this visit as done either way. */
export function lastLayoutToReopen(enabled: boolean, search: string, hash: string): string | null {
  try {
    if (sessionStorage.getItem(DONE_KEY)) return null;
    sessionStorage.setItem(DONE_KEY, '1');
    if (!enabled || search.length > 1 || hash.length > 1) return null;
    return localStorage.getItem(LAST_LAYOUT_KEY) || null;
  } catch {
    return null; // storage blocked: just stay home
  }
}

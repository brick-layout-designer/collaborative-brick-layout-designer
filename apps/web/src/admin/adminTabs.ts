// The admin page's tabs, shared with the header's Settings menu (one
// entry per tab) without loading the admin page itself. The tab is in
// the address (/admin?tab=users) so links and back/forward work.

export type AdminTab = 'dashboard' | 'heavy' | 'users' | 'orgs' | 'layouts' | 'parts' | 'libraries' | 'moderation' | 'audit' | 'settings';

export const ADMIN_TABS: readonly AdminTab[] = ['dashboard', 'heavy', 'users', 'orgs', 'layouts', 'parts', 'libraries', 'moderation', 'audit', 'settings'];

/** The tab button's words (shown capitalised). */
export function adminTabText(t: AdminTab): string {
  return t === 'orgs' ? 'clubs' : t === 'heavy' ? 'heavy use' : t;
}

/** The Settings menu's words for each tab. */
export const ADMIN_MENU_LABELS: Record<AdminTab, string> = {
  dashboard: 'Dashboard',
  heavy: 'Heavy use',
  users: 'Users',
  orgs: 'Clubs',
  layouts: 'Layouts',
  parts: 'Parts',
  libraries: 'Part libraries',
  moderation: 'Moderation',
  audit: 'Audit log',
  settings: 'Site settings',
};

export function adminTabUrl(t: AdminTab): string {
  return `/admin?tab=${t}`;
}

/** The tabs someone may open: everything for an admin, Moderation for a moderator. */
export function adminTabsFor(user: { isGlobalAdmin: boolean; isModerator?: boolean }): readonly AdminTab[] {
  if (user.isGlobalAdmin) return ADMIN_TABS;
  return user.isModerator ? ['moderation'] : [];
}

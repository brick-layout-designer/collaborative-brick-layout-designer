// Who in a club hears about what. Each club-wide notice, email or badge
// goes to the members whose roles hold its permission, never to fixed
// roles: a club's own "Door crew" role that answers requests to join gets
// the join-request email, and a Manager whose role no longer invites
// doesn't. The Admin role always hears everything. A person is one
// recipient however many of their roles qualify, so nobody gets the same
// notice twice.
//
//   join_request    a request to join waits (email; the Clubs badge and the
//                   club's "waiting" count use the same rule)
//   club_warning    the site team warned or sent a note to the club itself
//                   (notice, email, live update, "I understand")
//   member_warning  the club warned one of its members: a copy for the
//                   people who see the club's Warnings list (live update)
//   club_note       something happened to the club's things, such as an
//                   author taking back a module they made (notice)
//
// The badges for shares waiting in a trusted club's review queue go by
// "Send to the catalog" (routes/orgs.ts), as the queue does.

import { clubAccessMap, clubMembersAccess, type ClubAccess, type ClubPermission } from './clubPermissions.js';

export type ClubNotice = 'join_request' | 'club_warning' | 'member_warning' | 'club_note';

/** The permissions that hear each notice (any one of them is enough). */
export const CLUB_NOTICE_PERMISSIONS: Record<ClubNotice, readonly ClubPermission[]> = {
  // Whoever answers requests to join (routes/clubJoin.ts asManager).
  join_request: ['invite', 'manage_members'],
  // Whoever runs the club's people: they see its Warnings list.
  club_warning: ['invite', 'manage_members'],
  member_warning: ['invite', 'manage_members'],
  // Whoever looks after the club's things (gives them back, deletes them).
  club_note: ['delete_items'],
};

/** Whether someone with `access` hears about `notice`. Admins hear everything. */
export function hears(access: ClubAccess | null | undefined, notice: ClubNotice): boolean {
  if (!access) return false;
  return access.isAdmin || CLUB_NOTICE_PERMISSIONS[notice].some((p) => access.permissions.has(p));
}

/** The members of the club who hear about `notice`, each once. */
export async function clubAudience(orgId: string, notice: ClubNotice): Promise<string[]> {
  const out: string[] = [];
  for (const [userId, access] of await clubMembersAccess(orgId)) if (hears(access, notice)) out.push(userId);
  return out;
}

/** The clubs where `userId` hears about `notice`. */
export async function clubsHearing(userId: string, notice: ClubNotice): Promise<string[]> {
  return [...(await clubAccessMap(userId)).values()].filter((a) => hears(a, notice)).map((a) => a.orgId);
}

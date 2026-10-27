// @vitest-environment jsdom
// The club's member list and the hand-over picker sort by the strongest
// roles each member holds: anyone with the Admin role first, then by how
// many permissions their roles grant together, then by name. The picker
// names the roles each member holds. The desktop's Members view pins the
// same order on the same club (tests/sync/ClubMembersTest.cpp).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import type { ClubRoleSummary, OrgDetail, OrgMemberSummary } from '../../api';
import type { ClubPermission } from '../clubPermissions';
import { HandOverSection, MembersSection } from '../ClubManage';
import { byStrongestRole } from '../clubRoles';

const ALL: ClubPermission[] = ['view_items', 'edit_layouts', 'start_layouts', 'edit_modules', 'add_parts', 'manage_venues', 'send_catalog', 'invite', 'manage_members', 'export_data', 'delete_items'];
const role = (id: string, key: ClubRoleSummary['key'], name: string, permissions: ClubPermission[], position: number): ClubRoleSummary => ({ id, key, name, permissions, position, memberCount: 0 });
const ROLES: ClubRoleSummary[] = [
  role('c:admin', 'admin', 'Admin', ALL, 0),
  role('c:manager', 'manager', 'Manager', ALL.filter((p) => p !== 'manage_members' && p !== 'export_data'), 1),
  role('c:member', 'member', 'Member', ['view_items', 'edit_layouts', 'start_layouts', 'edit_modules', 'add_parts'], 2),
  role('c:viewer', 'viewer', 'Viewer', ['view_items'], 3),
  role('crew', null, 'Track crew', ['view_items', 'edit_layouts'], 4),
  role('door', null, 'Door crew', ['view_items', 'invite', 'manage_members'], 5),
];
const member = (userId: string, displayName: string, roleIds: string[], fixed: OrgMemberSummary['role'] = 'member'): OrgMemberSummary => ({
  userId,
  role: fixed,
  roleIds,
  joinedAt: 0,
  email: `${userId}@x.com`,
  displayName,
  avatarUrl: null,
});
// Listed in the server's order (by joining), not the order they show in.
const MEMBERS: OrgMemberSummary[] = [
  member('zed', 'Zed', ['c:viewer']),
  member('abe', 'Abe', ['c:member']),
  member('cal', 'Cal', ['c:viewer', 'crew']),
  member('dee', 'Dee', ['crew', 'c:member']),
  member('yan', 'Yan', ['c:admin'], 'admin'),
  member('bob', 'Bob', ['c:member', 'c:manager'], 'manager'),
  member('amy', 'Amy', ['c:member', 'door']),
];
// Admin; then 9, 7, 5, 5 (by name), 2 and 1 permissions.
const ORDER = ['Yan', 'Bob', 'Amy', 'Abe', 'Dee', 'Cal', 'Zed'];
const ADMIN_ORG = { id: 'c', name: 'Rail Club', slug: 'rail', createdAt: 0, myRole: 'admin', permissions: ALL, isAdmin: true } as OrgDetail;

beforeEach(() => {
  vi.stubGlobal('fetch', async () => new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function show(ui: ReactNode) {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('members sorted by their strongest roles', () => {
  it('lists Admin first, then by how many permissions their roles grant, then by name', () => {
    show(<MembersSection slug="rail" myUserId="yan" myRole="admin" members={MEMBERS} roles={ROLES} org={ADMIN_ORG} />);
    const list = screen.getByText('Yan').closest('ul')!;
    const names = within(list)
      .getAllByRole('listitem')
      .filter((li) => li.parentElement === list)
      .map((li) => ORDER.find((n) => within(li).queryByText(n)));
    expect(names).toEqual(ORDER);
  });

  it('a role edited to grant more moves its holders up', () => {
    const roles = ROLES.map((r) => (r.id === 'crew' ? { ...r, permissions: ALL.filter((p) => p !== 'export_data') } : r));
    const order = [...MEMBERS].sort(byStrongestRole(roles)).map((m) => m.displayName);
    expect(order).toEqual(['Yan', 'Cal', 'Dee', 'Bob', 'Amy', 'Abe', 'Zed']);
  });

  it('an older server without club roles keeps the fixed roles, then the name', () => {
    const old = MEMBERS.map(({ roleIds: _ids, ...m }) => m);
    expect([...old].sort(byStrongestRole(undefined)).map((m) => m.displayName)).toEqual(['Yan', 'Bob', 'Abe', 'Amy', 'Cal', 'Dee', 'Zed']);
  });
});

describe('the hand-over picker', () => {
  it('names the roles each member holds, strongest first', () => {
    show(<HandOverSection slug="rail" myUserId="yan" members={MEMBERS} roles={ROLES} />);
    const options = within(screen.getByLabelText('New admin')).getAllByRole('option').map((o) => o.textContent);
    expect(options).toEqual(['Bob (Manager, Member)', 'Amy (Member, Door crew)', 'Abe (Member)', 'Dee (Member, Track crew)', 'Cal (Viewer, Track crew)', 'Zed (Viewer)']);
    expect(options.join(' ')).not.toContain('a manager');
  });

  it('an older server says who is a manager, as before', () => {
    const old = MEMBERS.map(({ roleIds: _ids, ...m }) => m);
    show(<HandOverSection slug="rail" myUserId="zed" members={old} />);
    const options = within(screen.getByLabelText('New admin')).getAllByRole('option').map((o) => o.textContent);
    expect(options.slice(0, 2)).toEqual(['Yan (already an admin)', 'Bob (a manager)']);
  });
});

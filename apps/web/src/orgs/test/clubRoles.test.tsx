// @vitest-environment jsdom
// Club roles on the web: the Roles list with members' counts and a first-
// time hint, the role editor's grouped tick boxes (admins), role chips on
// the Members list (several roles each, at least one kept), invites to any
// role I may give, the friendly reason for a missing permission, and the
// Save to picker leaving out clubs that won't take the thing (with why).
// The API is a stubbed fetch.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import { api, type ClubRoleSummary, type OrgDetail, type OrgMemberSummary, type OrgSummary } from '../../api';
import { RolesSection } from '../ClubRoles';
import { InviteSection, MembersSection, describeEvent } from '../ClubManage';
import { askForPermission, clubCan, clubCanAdd } from '../clubPermissions';
import { SaveToPicker } from '../../owners/OwnerControls';

const ALL = ['view_items', 'edit_layouts', 'start_layouts', 'edit_modules', 'add_parts', 'manage_venues', 'send_catalog', 'invite', 'manage_members', 'export_data', 'delete_items'] as const;
const ROLES: ClubRoleSummary[] = [
  { id: 'c:admin', key: 'admin', name: 'Admin', permissions: [...ALL], position: 0, memberCount: 1 },
  { id: 'c:manager', key: 'manager', name: 'Manager', permissions: ALL.filter((p) => p !== 'manage_members' && p !== 'export_data'), position: 1, memberCount: 0 },
  { id: 'c:member', key: 'member', name: 'Member', permissions: ['view_items', 'edit_layouts', 'start_layouts', 'edit_modules', 'add_parts'], position: 2, memberCount: 1 },
  { id: 'c:viewer', key: 'viewer', name: 'Viewer', permissions: ['view_items'], position: 3, memberCount: 0 },
  { id: 'crew', key: null, name: 'Track crew', permissions: ['view_items', 'edit_layouts'], position: 4, memberCount: 0 },
];
const MEMBERS: OrgMemberSummary[] = [
  { userId: 'u1', role: 'admin', roleIds: ['c:admin'], joinedAt: 0, email: 'ann@x.com', displayName: 'Ann', avatarUrl: null },
  { userId: 'u2', role: 'member', roleIds: ['c:member'], joinedAt: 0, email: 'ben@x.com', displayName: 'Ben', avatarUrl: null },
];
const ADMIN_ORG = { id: 'c', name: 'Rail Club', slug: 'rail', createdAt: 0, myRole: 'admin', permissions: [...ALL], isAdmin: true } as OrgDetail;

let calls: { method: string; path: string; body: unknown }[];
beforeEach(() => {
  calls = [];
  try {
    localStorage.clear();
  } catch {
    /* no storage */
  }
  vi.stubGlobal('fetch', async (input: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    calls.push({ method, path: input, body: init?.body ? JSON.parse(init.body as string) : undefined });
    let body: unknown = { ok: true };
    if (input.endsWith('/roles') && method === 'GET') body = { roles: ROLES, mine: ['c:admin'], permissions: [...ALL], isAdmin: true };
    if (input.endsWith('/roles') && method === 'POST') body = { id: 'new', name: 'Track crew', permissions: ['view_items', 'edit_layouts'] };
    if (input.endsWith('/invites')) body = { id: 'i9', token: 't', inviteUrl: 'http://x/t', emailDelivered: false, expiresAt: 0 };
    return new Response(JSON.stringify(body), { status: method === 'POST' && input.endsWith('/roles') ? 201 : 200, headers: { 'content-type': 'application/json' } });
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function show(ui: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
}
const writes = () => calls.filter((c) => c.method !== 'GET');

describe('Roles page', () => {
  it('lists each role with how many hold it, and shows the first-time hint once', async () => {
    show(<RolesSection slug="rail" isAdmin />);
    const list = await screen.findByRole('list', { name: 'Club roles' });
    expect(within(list).getByText('Track crew')).toBeTruthy();
    expect(within(list).getAllByText('1 member')).toHaveLength(2);
    expect(within(list).getByText('Always has every permission')).toBeTruthy();
    const hint = screen.getByTestId('roles-hint');
    fireEvent.click(within(hint).getByRole('button', { name: 'Got it' }));
    expect(screen.queryByTestId('roles-hint')).toBeNull();
    cleanup();
    show(<RolesSection slug="rail" isAdmin />);
    await screen.findByRole('list', { name: 'Club roles' });
    expect(screen.queryByTestId('roles-hint')).toBeNull();
  });

  it('an admin makes Track crew with only Edit club layouts ticked', async () => {
    show(<RolesSection slug="rail" isAdmin />);
    fireEvent.click(await screen.findByRole('button', { name: 'New role' }));
    const form = screen.getByRole('form', { name: 'New role' });
    fireEvent.change(within(form).getByLabelText('Role name'), { target: { value: 'Track crew' } });
    // View club items is everyone's and can't be unticked.
    expect((within(form).getByRole('checkbox', { name: /View club items/ }) as HTMLInputElement).disabled).toBe(true);
    fireEvent.click(within(form).getByRole('checkbox', { name: /Edit club layouts/ }));
    fireEvent.click(within(form).getByRole('button', { name: 'Add role' }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toEqual({ method: 'POST', path: '/api/orgs/rail/roles', body: { name: 'Track crew', permissions: ['view_items', 'edit_layouts'] } });
  });

  it('members only look: no editor, a plain line on who changes roles', async () => {
    show(<RolesSection slug="rail" isAdmin={false} />);
    await screen.findByRole('list', { name: 'Club roles' });
    expect(screen.queryByRole('button', { name: 'New role' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull();
    expect(screen.getByText(/Only club admins change roles/)).toBeTruthy();
  });
});

describe('role chips on the Members list', () => {
  it('an admin gives Ben Track crew as well, and can’t take his last role', async () => {
    show(<MembersSection slug="rail" myUserId="u1" myRole="admin" members={MEMBERS} roles={ROLES} org={ADMIN_ORG} />);
    const ben = within(screen.getByRole('group', { name: 'Roles for Ben' }));
    expect((ben.getByRole('button', { name: '✓ Member' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(ben.getByRole('button', { name: '+ Track crew' }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toEqual({ method: 'PATCH', path: '/api/orgs/rail/members/u2', body: { roleIds: ['c:member', 'crew'] } });
  });

  it('a member sees roles as labels and the reason they can’t change them', () => {
    const org = { ...ADMIN_ORG, myRole: 'member', isAdmin: false, permissions: ['view_items', 'edit_layouts'] } as OrgDetail;
    show(<MembersSection slug="rail" myUserId="u2" myRole="member" members={MEMBERS} roles={ROLES} org={org} />);
    expect(screen.queryByRole('button', { name: /Track crew/ })).toBeNull();
    expect(screen.getByText(/ask a club admin for the Manage members and roles permission/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Remove' })).toBeNull();
  });

  it('invites to a club role by id', async () => {
    show(<InviteSection slug="rail" myRole="admin" org={ADMIN_ORG} roles={ROLES} />);
    fireEvent.change(screen.getByPlaceholderText('Search by name, or type an email'), { target: { value: 'cal@x.com' } });
    fireEvent.change(screen.getByLabelText('Joins as'), { target: { value: 'crew' } });
    fireEvent.click(screen.getByRole('button', { name: /Invite|Send/ }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]!.body).toMatchObject({ email: 'cal@x.com', roleId: 'crew' });
  });

  it('the activity says what happened to roles in plain words', () => {
    const e = (eventType: string, payload: Record<string, unknown>) =>
      describeEvent({ id: '1', eventType, userName: 'Ann', payload, createdAt: 0 } as never, (id) => (id === 'u2' ? 'Ben' : undefined));
    expect(e('role_create', { roleName: 'Track crew' })).toBe('Ann made the Track crew role');
    expect(e('role_assign', { roleName: 'Track crew', targetUserId: 'u2' })).toBe('Ann gave Ben the Track crew role');
    expect(e('role_unassign', { roleName: 'Viewer', targetUserId: 'u2' })).toBe('Ann took the Viewer role from Ben');
    expect(e('role_edit', { roleName: 'Track crew' })).toBe('Ann changed what the Track crew role allows');
    expect(e('role_delete', { roleName: 'Track crew' })).toBe('Ann deleted the Track crew role');
  });
});

describe('permissions in the rest of the app', () => {
  const crew = { id: 'c', name: 'Rail Club', slug: 'rail', createdAt: 0, myRole: 'member', permissions: ['view_items', 'edit_layouts'], canAdd: false } as OrgSummary;

  it('a Track crew member may edit layouts but add no modules', () => {
    expect(clubCan(crew, 'edit_layouts')).toBe(true);
    expect(clubCanAdd(crew, 'module')).toBe(false);
    // Older servers: the old roles' rules.
    expect(clubCanAdd({ myRole: 'member', canAdd: true }, 'module')).toBe(true);
    expect(clubCan({ myRole: 'manager' }, 'manage_members')).toBe(false);
  });

  it('Save to leaves the club out for a module, and says why', () => {
    show(<SaveToPicker value="" onChange={() => {}} orgs={[crew]} kind="module" />);
    // Only Me is left, so there's nothing to pick, but the club isn't left out silently.
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(screen.getByText('It’s saved to your own things.')).toBeTruthy();
    expect(screen.getByTestId('clubs-left-out').textContent).toMatch(/^Rail Club isn’t listed/);
    cleanup();
    const other = { ...crew, id: 'd', slug: 'other', name: 'Other club', permissions: ['view_items', 'edit_modules'] } as OrgSummary;
    show(<SaveToPicker value="" onChange={() => {}} orgs={[crew, other]} kind="module" />);
    expect(screen.getByTestId('clubs-left-out').textContent).toBe(
      'Rail Club isn’t listed: your roles there can’t add modules. Ask a club admin for the Add or edit modules permission.',
    );
  });

  it('a refusal names the missing permission', async () => {
    vi.stubGlobal('fetch', async () =>
      new Response(JSON.stringify({ error: 'only_club_admins_can_add', permission: 'edit_modules' }), { status: 403, headers: { 'content-type': 'application/json' } }),
    );
    await expect(api.orgs.createRole('rail', 'x', [])).rejects.toThrow(askForPermission('edit_modules'));
    expect(askForPermission('edit_modules')).toBe('Ask a club admin for the Add or edit modules permission.');
  });

  it('older refusals without a permission still name one, not “admins and managers”', async () => {
    for (const [error, text] of [
      ['only_club_admins_can_curate', 'Ask a club admin for the Send to the catalog permission.'],
      ['only_club_admins_can_give_back', 'Ask a club admin for the Delete club items permission.'],
    ] as const) {
      vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ error }), { status: 403, headers: { 'content-type': 'application/json' } }));
      await expect(api.orgs.createRole('rail', 'x', [])).rejects.toThrow(text);
    }
  });
});

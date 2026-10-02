// @vitest-environment jsdom
// The Manager role on the web: admins pick any of the three roles (with a
// line on what each can do); managers remove members only, invite members
// only, and look after member invites; badges and the activity name the
// role. The API is a stubbed fetch.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import type { AuditEventSummary, OrgInviteSummary, OrgMemberSummary } from '../../api';
import { describeEvent, InviteSection, MembersSection, PendingInvitesSection } from '../ClubManage';
import { aRole, atLeast } from '../clubRoles';

const MEMBERS: OrgMemberSummary[] = [
  { userId: 'u1', role: 'admin', joinedAt: 0, email: 'ada@x.com', displayName: 'Zoe', avatarUrl: null },
  { userId: 'u2', role: 'manager', joinedAt: 0, email: 'max@x.com', displayName: 'Max', avatarUrl: null },
  { userId: 'u3', role: 'member', joinedAt: 0, email: 'mia@x.com', displayName: 'Abe', avatarUrl: null },
  { userId: 'u4', role: 'manager', joinedAt: 0, email: 'meg@x.com', displayName: 'Meg', avatarUrl: null },
];
const INVITES: OrgInviteSummary[] = [
  { id: 'i1', invitedEmail: 'new@x.com', role: 'member', expiresAt: Date.now() + 5 * 86_400_000, inviteUrl: 'http://x/1' },
  { id: 'i2', invitedEmail: 'boss@x.com', role: 'manager', expiresAt: Date.now() + 5 * 86_400_000, inviteUrl: 'http://x/2' },
];

let calls: { method: string; path: string; body: unknown }[];
beforeEach(() => {
  calls = [];
  vi.stubGlobal('fetch', async (input: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    calls.push({ method, path: input, body: init?.body ? JSON.parse(init.body as string) : undefined });
    const body = input.endsWith('/invites') ? { id: 'i9', token: 't', inviteUrl: 'http://x/t', emailDelivered: false, expiresAt: 0 } : { ok: true };
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  });
  vi.stubGlobal('confirm', () => true);
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
const row = (name: string) => screen.getByText(name).closest('li')!;

describe('roles', () => {
  it('ranks admin over manager over member', () => {
    expect(atLeast('manager', 'manager')).toBe(true);
    expect(atLeast('member', 'manager')).toBe(false);
    expect(atLeast('manager', 'admin')).toBe(false);
    expect(aRole('manager')).toBe('a manager');
  });

  it('lets an admin pick any role, with a line on what each can do', async () => {
    show(<MembersSection slug="arklug" myUserId="u1" myRole="admin" members={MEMBERS} />);
    const lines = screen.getByRole('list', { name: 'What each role can do' });
    expect(within(lines).getByText(/Invites people, answers requests/)).toBeTruthy();
    const picker = within(row('Abe')).getByRole('combobox', { name: 'Role for Abe' }) as HTMLSelectElement;
    expect([...picker.options].map((o) => o.textContent)).toEqual(['Admin', 'Manager', 'Member']);
    fireEvent.change(picker, { target: { value: 'manager' } });
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toEqual({ method: 'PATCH', path: '/api/orgs/arklug/members/u3', body: { role: 'manager' } });
    // Strongest first.
    const names = screen.getAllByText(/^(Zoe|Max|Abe|Meg)\b/).map((e) => e.textContent!.split(' ')[0]);
    expect(names).toEqual(['Zoe', 'Max', 'Meg', 'Abe']);
  });

  it('lets a manager remove members only, and change no roles', () => {
    show(<MembersSection slug="arklug" myUserId="u2" myRole="manager" members={MEMBERS} />);
    expect(screen.queryAllByRole('combobox')).toHaveLength(0);
    expect(screen.queryByRole('list', { name: 'What each role can do' })).toBeNull();
    expect(within(row('Abe')).getByRole('button', { name: 'Remove' })).toBeTruthy();
    expect(within(row('Meg')).queryByRole('button', { name: 'Remove' })).toBeNull();
    expect(within(row('Zoe')).queryByRole('button', { name: 'Remove' })).toBeNull();
    expect(within(row('Meg')).getByText('Manager')).toBeTruthy();
    expect(within(row('Zoe')).getByText('Admin')).toBeTruthy();
  });

  it('shows members the badges and nothing to change', () => {
    show(<MembersSection slug="arklug" myUserId="u3" myRole="member" members={MEMBERS} />);
    expect(screen.queryAllByRole('button', { name: 'Remove' })).toHaveLength(0);
    expect(within(row('Max')).getByText('Manager')).toBeTruthy();
  });

  it('has a manager invite members only', async () => {
    show(<InviteSection slug="arklug" myRole="manager" />);
    expect(screen.queryByLabelText('Joins as')).toBeNull();
    expect(screen.getByText('They join as a member.')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Name or email'), { target: { value: 'new@x.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send invite' }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]!.body).toMatchObject({ email: 'new@x.com', role: 'member' });
  });

  it('lets an admin invite a manager', async () => {
    show(<InviteSection slug="arklug" myRole="admin" />);
    fireEvent.change(screen.getByLabelText('Name or email'), { target: { value: 'boss@x.com' } });
    fireEvent.change(screen.getByLabelText('Joins as'), { target: { value: 'manager' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send invite' }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]!.body).toMatchObject({ role: 'manager' });
  });

  it('lets a manager look after member invites, not a manager invite', () => {
    show(<PendingInvitesSection slug="arklug" myRole="manager" invites={INVITES} />);
    const member = screen.getByText('new@x.com').closest('li')!;
    const manager = screen.getByText('boss@x.com').closest('li')!;
    expect(within(member).getByRole('button', { name: 'Send again' })).toBeTruthy();
    expect(within(member).getByRole('button', { name: 'Cancel invite' })).toBeTruthy();
    expect(within(manager).queryByRole('button', { name: 'Send again' })).toBeNull();
    expect(within(manager).queryByRole('button', { name: 'Cancel invite' })).toBeNull();
    expect(within(manager).getByText(/Manager/)).toBeTruthy();
  });

  it('says role changes in plain words', () => {
    const ev = { id: 'e', eventType: 'role_change', userName: 'Zoe', payload: { targetUserId: 'u3', toRole: 'manager' }, createdAt: 0, resourceKind: 'org' } as unknown as AuditEventSummary;
    expect(describeEvent(ev, (id) => (id === 'u3' ? 'Abe' : undefined))).toBe('Zoe made Abe a manager');
  });
});

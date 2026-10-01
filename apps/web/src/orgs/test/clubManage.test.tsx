// @vitest-environment jsdom
// Running a club from the web: settings, invites with an expiry, resend
// and cancel, handing over, leaving (with the last-admin rule) and
// deleting with a typed name. The API is a stubbed fetch.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import type { AuditEventSummary, OrgDetail, OrgMemberSummary } from '../../api';
import {
  DeleteClubSection,
  describeEvent,
  HandOverSection,
  InviteSection,
  LeaveClubButton,
  MembersSection,
  PendingInvitesSection,
  SettingsSection,
} from '../ClubManage';

const ORG: OrgDetail = {
  id: 'o1',
  name: 'ArkLUG',
  slug: 'arklug',
  createdAt: 0,
  myRole: 'admin',
  description: '',
  membersCanCreate: true,
  memberCount: 2,
  adminCount: 1,
};
const MEMBERS: OrgMemberSummary[] = [
  { userId: 'u1', role: 'admin', joinedAt: Date.UTC(2026, 0, 5), email: 'me@x.com', displayName: 'Sam', avatarUrl: null },
  { userId: 'u2', role: 'member', joinedAt: Date.UTC(2026, 2, 9), email: 'kim@x.com', displayName: 'Kim', avatarUrl: null },
];

let calls: { method: string; path: string; body: unknown }[];
beforeEach(() => {
  calls = [];
  vi.stubGlobal('fetch', async (input: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    calls.push({ method, path: input, body: init?.body ? JSON.parse(init.body as string) : undefined });
    const body =
      method === 'POST' && input.endsWith('/invites')
        ? { id: 'i9', token: 't', inviteUrl: 'http://x/org-invite/t', emailDelivered: false, expiresAt: 0 }
        : method === 'POST' && input.endsWith('/resend')
          ? { ok: true, inviteUrl: 'http://x/org-invite/t', emailDelivered: true, expiresAt: 0 }
          : method === 'PATCH'
            ? { ok: true, slug: 'arklug', name: 'Arkansas LUG' }
            : { ok: true };
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

describe('club management', () => {
  it('settings send only what changed', async () => {
    show(<SettingsSection org={ORG} />);
    const save = screen.getByRole('button', { name: 'Save settings' }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Arkansas LUG' } });
    fireEvent.click(screen.getByRole('checkbox', { name: /Members can add/ }));
    fireEvent.click(save);
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toEqual({ method: 'PATCH', path: '/api/orgs/arklug', body: { name: 'Arkansas LUG', membersCanCreate: false } });
  });

  it('a description alone is all that is sent when only it changed', async () => {
    show(<SettingsSection org={ORG} />);
    fireEvent.change(screen.getByLabelText('About the club'), { target: { value: 'Tuesdays at the library.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save settings' }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]!.body).toEqual({ description: 'Tuesdays at the library.' });
  });

  it('invites with the chosen expiry and shows the link to copy', async () => {
    show(<InviteSection slug="arklug" />);
    fireEvent.change(screen.getByLabelText('Name or email'), { target: { value: 'new@x.com' } });
    fireEvent.change(screen.getByLabelText('Link works for'), { target: { value: '7' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send invite' }));
    await screen.findByText('http://x/org-invite/t');
    expect(writes()[0]).toEqual({
      method: 'POST',
      path: '/api/orgs/arklug/invites',
      body: { email: 'new@x.com', role: 'member', expiresInDays: 7 },
    });
  });

  it('pending invites can be sent again or cancelled', async () => {
    show(
      <PendingInvitesSection
        slug="arklug"
        invites={[{ id: 'i1', invitedEmail: 'new@x.com', role: 'member', expiresAt: Date.now() + 3 * 86_400_000, inviteUrl: 'http://x/i' }]}
      />,
    );
    expect(screen.getByText(/expires in 3 days/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Send again' }));
    await screen.findByText(/Sent again/);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel invite' }));
    await waitFor(() => expect(writes().map((c) => `${c.method} ${c.path}`)).toEqual([
      'POST /api/orgs/arklug/invites/i1/resend',
      'DELETE /api/orgs/arklug/invites/i1',
    ]));
  });

  it('admins change roles and remove people; members only see the list', async () => {
    show(<MembersSection slug="arklug" myUserId="u1" isAdmin members={MEMBERS} />);
    expect(screen.getAllByText(/joined/)).toHaveLength(2);
    fireEvent.change(screen.getByLabelText('Role for Kim'), { target: { value: 'admin' } });
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(writes().map((c) => `${c.method} ${c.path}`)).toEqual([
      'PATCH /api/orgs/arklug/members/u2',
      'DELETE /api/orgs/arklug/members/u2',
    ]));
    // You can't demote or remove yourself here (that's Hand over / Leave).
    expect(screen.queryByLabelText('Role for Sam')).toBeNull();
    cleanup();
    show(<MembersSection slug="arklug" myUserId="u2" isAdmin={false} members={MEMBERS} />);
    expect(screen.queryByRole('button', { name: 'Remove' })).toBeNull();
    expect(screen.queryByRole('combobox')).toBeNull();
  });

  it('hands the club to the member picked', async () => {
    show(<HandOverSection slug="arklug" myUserId="u1" members={MEMBERS} />);
    fireEvent.click(screen.getByRole('button', { name: 'Hand over' }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toEqual({ method: 'POST', path: '/api/orgs/arklug/hand-over', body: { userId: 'u2' } });
  });

  it('the only admin is told to hand over before leaving; a member just leaves', async () => {
    show(<LeaveClubButton org={ORG} myUserId="u1" />);
    fireEvent.click(screen.getByRole('button', { name: 'Leave the club' }));
    expect(screen.getByRole('alert').textContent).toMatch(/only admin/);
    expect(writes()).toHaveLength(0);
    cleanup();
    show(<LeaveClubButton org={{ ...ORG, myRole: 'member' }} myUserId="u2" />);
    fireEvent.click(screen.getByRole('button', { name: 'Leave the club' }));
    await waitFor(() => expect(writes()[0]?.path).toBe('/api/orgs/arklug/members/u2'));
  });

  it('deleting needs the club’s name typed out', async () => {
    show(<DeleteClubSection org={ORG} counts="its 2 layouts" />);
    const del = screen.getByRole('button', { name: 'Delete club' }) as HTMLButtonElement;
    expect(del.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText(/Type the club’s name/), { target: { value: 'arklu' } });
    expect(del.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText(/Type the club’s name/), { target: { value: 'arklug' } });
    expect(del.disabled).toBe(false);
    fireEvent.click(del);
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toEqual({ method: 'DELETE', path: '/api/orgs/arklug', body: { confirm: 'arklug' } });
  });

  it('describes activity in plain words', () => {
    const ev = (eventType: string, payload: unknown): AuditEventSummary => ({
      id: 1, layoutId: null, resourceKind: 'org', resourceId: 'o1', userId: 'u1', userName: 'Sam', eventType, payload, docVersion: null, createdAt: 0,
    });
    const name = (id: string) => MEMBERS.find((m) => m.userId === id)?.displayName;
    expect(describeEvent(ev('role_change', { targetUserId: 'u2', toRole: 'admin' }), name)).toBe('Sam made Kim an admin');
    expect(describeEvent(ev('hand_over', { toUserId: 'u2' }), name)).toBe('Sam handed the club to Kim');
    expect(describeEvent(ev('share', { invitedEmail: 'new@x.com' }), name)).toBe('Sam invited new@x.com');
    expect(describeEvent(ev('unshare', { selfRemoved: true }), name)).toBe('Sam left the club');
  });
});

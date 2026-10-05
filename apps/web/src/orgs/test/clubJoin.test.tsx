// @vitest-environment jsdom
// Joining a club from the web: an admin's "Who can join" and "Show in the
// club list" settings, approving and declining requests, and the join
// button in each state (Join, Ask to join with a note, Request sent with
// Cancel, Invite only). The API is a stubbed fetch.

import { autoConfirm } from '../../test/confirmHost';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import type { AuditEventSummary, ClubSummary, JoinRequestSummary, OrgDetail } from '../../api';
import { describeEvent, JoinRequestsSection, JoinSettingsSection } from '../ClubManage';
import { FindClubSection, JoinControls } from '../ClubDirectory';

const ORG: OrgDetail = {
  id: 'o1',
  name: 'ArkLUG',
  slug: 'arklug',
  createdAt: 0,
  myRole: 'admin',
  joinPolicy: 'invite',
  listed: false,
};
const CLUB: ClubSummary = {
  id: 'o1',
  name: 'ArkLUG',
  slug: 'arklug',
  description: 'Trains',
  memberCount: 3,
  joinPolicy: 'open',
  listed: true,
  myStatus: null,
};
const REQUESTS: JoinRequestSummary[] = [
  { id: 'r1', userId: 'u9', displayName: 'Rita', avatarUrl: null, message: 'I build trains', createdAt: Date.UTC(2026, 8, 1) },
];

let calls: { method: string; path: string; body: unknown }[];
let directory: ClubSummary[];
beforeEach(() => {
  calls = [];
  directory = [CLUB];
  vi.stubGlobal('fetch', async (input: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    calls.push({ method, path: input, body: init?.body ? JSON.parse(init.body as string) : undefined });
    const body =
      method === 'GET' && input.startsWith('/api/club-directory')
        ? { clubs: directory }
        : method === 'POST' && input.endsWith('/join')
          ? { status: (init?.body ? 'requested' : 'member'), slug: 'arklug' }
          : method === 'PATCH'
            ? { ok: true, slug: 'arklug', name: 'ArkLUG' }
            : { ok: true };
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
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

describe('who can join (admins)', () => {
  it('starts on the club’s setting and sends only what changed', async () => {
    show(<JoinSettingsSection org={ORG} />);
    expect((screen.getByRole('radio', { name: /Invite only/ }) as HTMLInputElement).checked).toBe(true);
    const save = screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    fireEvent.click(screen.getByRole('radio', { name: /Ask to join/ }));
    fireEvent.click(save);
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toEqual({ method: 'PATCH', path: '/api/orgs/arklug', body: { joinPolicy: 'request' } });
    expect(await screen.findByText('Saved.')).toBeTruthy();
  });

  it('lists the club, and warns that an unlisted club still needs invites', async () => {
    show(<JoinSettingsSection org={ORG} />);
    fireEvent.click(screen.getByRole('radio', { name: /Open/ }));
    expect(screen.getByRole('note').textContent).toMatch(/still need an invite/);
    fireEvent.click(screen.getByRole('checkbox', { name: /Show in the club list/ }));
    expect(screen.queryByRole('note')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]!.body).toEqual({ joinPolicy: 'open', listed: true });
  });

  it('lists the club without touching who can join', async () => {
    show(<JoinSettingsSection org={{ ...ORG, joinPolicy: 'request' }} />);
    fireEvent.click(screen.getByRole('checkbox', { name: /Show in the club list/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]!.body).toEqual({ listed: true });
  });

  it('has help for who can join and the listing', () => {
    show(<JoinSettingsSection org={ORG} />);
    expect(screen.getByRole('button', { name: /Who can join/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Show in the club list/i, hidden: false })).toBeTruthy();
  });
});

describe('requests to join (admins)', () => {
  it('shows who asked and their note, and approves', async () => {
    show(<JoinRequestsSection slug="arklug" requests={REQUESTS} />);
    expect(screen.getByText('Rita')).toBeTruthy();
    expect(screen.getByText('“I build trains”')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toMatchObject({ method: 'POST', path: '/api/orgs/arklug/join-requests/r1/approve' });
    expect(await screen.findByText('Rita is now a member.')).toBeTruthy();
  });

  it('declines', async () => {
    show(<JoinRequestsSection slug="arklug" requests={REQUESTS} />);
    autoConfirm(true);
    fireEvent.click(screen.getByRole('button', { name: 'Decline' }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toMatchObject({ method: 'POST', path: '/api/orgs/arklug/join-requests/r1/decline' });
  });

  it('says when nobody is waiting', () => {
    show(<JoinRequestsSection slug="arklug" requests={[]} />);
    expect(screen.getByText('Nobody is waiting.')).toBeTruthy();
  });
});

describe('the join button', () => {
  it('joins an open club with one click', async () => {
    show(<JoinControls club={CLUB} />);
    fireEvent.click(screen.getByRole('button', { name: 'Join' }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toEqual({ method: 'POST', path: '/api/orgs/arklug/join', body: {} });
  });

  it('asks to join with an optional note', async () => {
    show(<JoinControls club={{ ...CLUB, joinPolicy: 'request' }} />);
    expect(screen.queryByRole('button', { name: 'Join' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Ask to join' }));
    fireEvent.change(screen.getByLabelText(/A note to the admins/), { target: { value: ' Hi there ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send request' }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toEqual({ method: 'POST', path: '/api/orgs/arklug/join', body: { message: 'Hi there' } });
  });

  it('shows Request sent and lets the asker cancel', async () => {
    show(<JoinControls club={{ ...CLUB, joinPolicy: 'request', myStatus: 'requested' }} />);
    expect(screen.getByText('Request sent')).toBeTruthy();
    autoConfirm(true);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel request' }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toMatchObject({ method: 'DELETE', path: '/api/orgs/arklug/join' });
  });

  it('offers no way in to an invite-only club', () => {
    show(<JoinControls club={{ ...CLUB, joinPolicy: 'invite' }} />);
    expect(screen.getByText('Invite only')).toBeTruthy();
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });

  it('opens a club you’re already in', () => {
    show(<JoinControls club={{ ...CLUB, myStatus: 'member' }} />);
    expect(screen.getByRole('link', { name: 'Open' }).getAttribute('href')).toBe('/orgs/arklug');
  });
});

describe('find a club', () => {
  it('lists listed clubs with their size, and searches', async () => {
    show(<FindClubSection />);
    expect(await screen.findByText('ArkLUG')).toBeTruthy();
    expect(screen.getByText('3 members')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Search clubs'), { target: { value: 'castle' } });
    directory = [];
    await waitFor(() => expect(calls.some((c) => c.path === '/api/club-directory?q=castle')).toBe(true));
    expect(await screen.findByText('No listed club matches that.')).toBeTruthy();
  });
});

describe('activity', () => {
  it('describes joins, approvals and declines', () => {
    const ev = (eventType: string, payload: object = {}): AuditEventSummary =>
      ({ id: 'e', eventType, userName: 'Sam', payload, createdAt: 0, resourceKind: 'org' }) as unknown as AuditEventSummary;
    const name = (id: string) => (id === 'u9' ? 'Rita' : undefined);
    expect(describeEvent(ev('join'), name)).toBe('Sam joined the club');
    expect(describeEvent(ev('join_approve', { targetUserId: 'u9' }), name)).toBe('Sam let Rita join');
    expect(describeEvent(ev('join_decline', { targetUserId: 'u9' }), name)).toBe('Sam declined a request to join');
  });
});

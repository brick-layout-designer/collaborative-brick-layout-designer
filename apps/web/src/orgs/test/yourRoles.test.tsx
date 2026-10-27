// @vitest-environment jsdom
// Your clubs say the roles you hold: a Viewer reads "you are a viewer"
// (not "a member", the fixed role the server keeps for them), and someone
// holding a club's own roles sees them by name, on the Clubs page and at
// the top of the club's Manage page. The API is a stubbed fetch.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { OrgDetail, OrgSummary } from '../../api';
import { OrgAdminPage } from '../OrgAdminPage';
import { OrgsPage } from '../OrgsPage';
import { yourRolesSentence, yourRolesText } from '../clubRoles';

const club = (slug: string, extra: Partial<OrgSummary>): OrgSummary => ({ id: slug, name: slug, slug, createdAt: 0, myRole: 'member', logoUrl: null, ...extra });

let orgs: OrgSummary[] = [];
let detail: Partial<OrgDetail> = {};
beforeEach(() => {
  vi.stubGlobal('fetch', async (input: string) => {
    const body =
      input === '/api/orgs'
        ? { orgs }
        : input === '/api/orgs/crew-club'
          ? { id: 'o1', name: 'Crew Club', slug: 'crew-club', createdAt: 0, myRole: 'member', description: '', membersCanCreate: true, memberCount: 2, adminCount: 1, ...detail }
          : input === '/api/orgs/crew-club/members'
            ? { members: [], invites: [] }
            : input === '/api/orgs/crew-club/join-requests'
              ? { requests: [] }
              : input === '/api/custom-parts'
                ? { parts: [] }
        : input === '/api/auth/me'
          ? { user: { id: 'u1', displayName: 'Vic', email: 'vic@x.com', isDemoAccount: false } }
          : input.startsWith('/api/club-directory')
            ? { clubs: [] }
            : input === '/api/join-requests/count'
              ? { count: 0, clubs: [] }
              : {};
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('your roles in your clubs', () => {
  it('the Clubs page says Viewer, and a club’s own roles by name', async () => {
    orgs = [club('viewers-club', { roleNames: ['Viewer'] }), club('crew-club', { roleNames: ['Viewer', 'Track crew'] }), club('old-server', {})];
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter>
          <OrgsPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(await screen.findByText('/viewers-club · you are a viewer')).toBeTruthy();
    expect(screen.getByText('/crew-club · your roles: Viewer, Track crew')).toBeTruthy();
    expect(screen.getByText('/old-server · you are a member')).toBeTruthy();
  });

  it('the Manage page header names the roles held, not "a member"', async () => {
    const show = () =>
      render(
        <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
          <MemoryRouter initialEntries={['/orgs/crew-club/admin']}>
            <Routes>
              <Route path="/orgs/:slug/admin" element={<OrgAdminPage />} />
            </Routes>
          </MemoryRouter>
        </QueryClientProvider>,
      );
    // Custom roles only (one of which may invite, so the Manage page opens).
    detail = { roleNames: ['Viewer', 'Track crew'], permissions: ['view_items', 'invite'], isAdmin: false };
    show();
    expect((await screen.findByTestId('your-roles')).textContent).toBe('Your roles: Viewer, Track crew.');
    expect(screen.queryByText(/You’re a member/)).toBeNull();
    cleanup();
    detail = { roleNames: ['Door crew'], permissions: ['view_items', 'invite'], isAdmin: false };
    show();
    expect((await screen.findByTestId('your-roles')).textContent).toBe('Your role: Door crew.');
    cleanup();
    detail = { myRole: 'manager', roleNames: ['Manager'] };
    show();
    expect((await screen.findByTestId('your-roles')).textContent).toBe('You’re a manager of this club.');
  });

  it('words each case', () => {
    expect(yourRolesSentence({ myRole: 'member', roleNames: ['Viewer'] })).toBe('You’re a viewer of this club.');
    expect(yourRolesSentence({ myRole: 'admin' })).toBe('You’re an admin of this club.');
    expect(yourRolesText({ myRole: 'admin', roleNames: ['Admin'] })).toBe('you are an admin');
    expect(yourRolesText({ myRole: 'member', roleNames: ['Builder'] })).toBe('your role: Builder');
    expect(yourRolesText({ myRole: 'manager' })).toBe('you are a manager');
  });
});

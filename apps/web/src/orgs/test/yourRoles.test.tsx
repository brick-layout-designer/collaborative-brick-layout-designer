// @vitest-environment jsdom
// Your clubs say the roles you hold: a Viewer reads "you are a viewer"
// (not "a member", the fixed role the server keeps for them), and someone
// holding a club's own roles sees them by name. The API is a stubbed fetch.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { OrgSummary } from '../../api';
import { OrgsPage } from '../OrgsPage';
import { yourRolesText } from '../clubRoles';

const club = (slug: string, extra: Partial<OrgSummary>): OrgSummary => ({ id: slug, name: slug, slug, createdAt: 0, myRole: 'member', logoUrl: null, ...extra });

let orgs: OrgSummary[] = [];
beforeEach(() => {
  vi.stubGlobal('fetch', async (input: string) => {
    const body =
      input === '/api/orgs'
        ? { orgs }
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

  it('words each case', () => {
    expect(yourRolesText({ myRole: 'admin', roleNames: ['Admin'] })).toBe('you are an admin');
    expect(yourRolesText({ myRole: 'member', roleNames: ['Builder'] })).toBe('your role: Builder');
    expect(yourRolesText({ myRole: 'manager' })).toBe('you are a manager');
  });
});

// @vitest-environment jsdom
// The club invite page says the role the invite gives by its name: a
// Viewer, or a club's own role, not "a member" for both.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { api } from '../../api';
import { OrgInvitePage } from '../OrgInvitePage';

const preview = { invitedEmail: 'd…@example.com', forYou: null, role: 'member' as const, orgId: 'o1', orgName: 'Rail Club', orgSlug: 'rail-club', expiresAt: Date.now() + 86_400_000 };

function show() {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={['/org-invite/tok']}>
        <Routes>
          <Route path="/org-invite/:token" element={<OrgInvitePage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('club invite page', () => {
  it('says a club’s own role by name, a Viewer as a viewer, and an older server’s role as before', async () => {
    vi.spyOn(api, 'me').mockResolvedValue({ user: null } as never);
    const ask = vi.spyOn(api.orgInvites, 'preview').mockResolvedValue({ ...preview, roleName: 'Track crew' });
    show();
    expect((await screen.findByText(/You've been invited to join/)).textContent).toBe("You've been invited to join Rail Club with the role Track crew.");
    cleanup();
    ask.mockResolvedValue({ ...preview, roleName: 'Viewer' });
    show();
    expect((await screen.findByText(/You've been invited to join/)).textContent).toBe("You've been invited to join Rail Club as a viewer.");
    cleanup();
    ask.mockResolvedValue(preview);
    show();
    expect((await screen.findByText(/You've been invited to join/)).textContent).toBe("You've been invited to join Rail Club as a member.");
  });
});

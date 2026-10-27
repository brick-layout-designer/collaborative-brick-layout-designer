// @vitest-environment jsdom
// The layout invite page: an invite that no longer holds says so plainly,
// and the server (not the page) says whether the invite is for the account
// signed in, since the address is masked for anyone else.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { api } from '../../api';
import { InvitePage } from '../InvitePage';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function page() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/invite/abc']}>
        <Routes>
          <Route path="/invite/:token" element={<InvitePage />} />
          <Route path="/editor/:id" element={<p>editor page</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const ME = (email: string) => ({ user: { id: 'u1', email, displayName: 'Me', isDemoAccount: false } }) as unknown as Awaited<ReturnType<typeof api.me>>;
const preview = { invitedEmail: 'bob@example.com', forYou: true, role: 'editor' as const, layoutId: 'l1', layoutTitle: 'Harbor', expiresAt: 0 };

describe('layout invite page', () => {
  it('an invite that no longer holds says why and what to do', async () => {
    vi.stubGlobal('fetch', async (input: string) => {
      if (input === '/api/auth/me') return new Response(JSON.stringify({ user: null }), { status: 200, headers: { 'content-type': 'application/json' } });
      return new Response(JSON.stringify({ error: 'invite_no_longer_valid' }), { status: 410, headers: { 'content-type': 'application/json' } });
    });
    page();
    expect(await screen.findByText("This invite isn't valid.")).toBeTruthy();
    expect(screen.getByText(/the layout changed hands, or the person who sent it no longer manages it/)).toBeTruthy();
  });

  it('signed in as the invited person: accepts and opens the layout', async () => {
    vi.spyOn(api, 'me').mockResolvedValue(ME('Bob@example.com'));
    vi.spyOn(api.invites, 'preview').mockResolvedValue(preview);
    const accept = vi.spyOn(api.invites, 'accept').mockResolvedValue({ layoutId: 'l1' } as never);
    page();
    await waitFor(() => expect(accept).toHaveBeenCalledWith('abc'));
    expect(await screen.findByText('editor page', {}, { timeout: 3000 })).toBeTruthy();
  });

  it('signed in as someone else: shows only the masked address and doesn’t accept', async () => {
    vi.spyOn(api, 'me').mockResolvedValue(ME('eve@example.com'));
    vi.spyOn(api.invites, 'preview').mockResolvedValue({ ...preview, invitedEmail: 'b…@example.com', forYou: false });
    const accept = vi.spyOn(api.invites, 'accept');
    page();
    expect(await screen.findByText('This invite is for a different account.')).toBeTruthy();
    expect(screen.getByText('b…@example.com')).toBeTruthy();
    expect(document.body.textContent).not.toContain('bob@example.com');
    expect(accept).not.toHaveBeenCalled();
  });

  it('signed out: asks to sign in as the masked address', async () => {
    vi.spyOn(api, 'me').mockResolvedValue({ user: null } as never);
    vi.spyOn(api.invites, 'preview').mockResolvedValue({ ...preview, invitedEmail: 'b…@example.com', forYou: null });
    const accept = vi.spyOn(api.invites, 'accept');
    page();
    expect(await screen.findByText('b…@example.com')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Sign in' }).getAttribute('href')).toBe(`/login?next=${encodeURIComponent('/invite/abc')}`);
    expect(accept).not.toHaveBeenCalled();
  });
});

describe('layout invite page wording', () => {
  it('an invite to edit says "as an editor"', async () => {
    vi.stubGlobal('fetch', async (input: string) => {
      const body =
        input === '/api/auth/me'
          ? { user: null }
          : { invitedEmail: 'b…@example.com', forYou: null, role: 'editor', layoutId: 'l1', layoutTitle: 'Yard', expiresAt: Date.now() + 86_400_000 };
      return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
    });
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter initialEntries={['/invite/abc']}>
          <Routes>
            <Route path="/invite/:token" element={<InvitePage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect((await screen.findByText(/You've been invited to/)).textContent).toBe("You've been invited to Yard as an editor.");
  });
});

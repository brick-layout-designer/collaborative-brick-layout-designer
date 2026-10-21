// @vitest-environment jsdom
// The layout invite page when the invite no longer holds (the layout
// changed hands, or its sender no longer manages it): it says so plainly.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { InvitePage } from '../InvitePage';

beforeEach(() => {
  vi.stubGlobal('fetch', async (input: string) => {
    if (input === '/api/auth/me') return new Response(JSON.stringify({ user: null }), { status: 200, headers: { 'content-type': 'application/json' } });
    return new Response(JSON.stringify({ error: 'invite_no_longer_valid' }), { status: 410, headers: { 'content-type': 'application/json' } });
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('layout invite page', () => {
  it('an invite that no longer holds says why and what to do', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={['/invite/abc']}>
          <Routes>
            <Route path="/invite/:token" element={<InvitePage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(await screen.findByText("This invite isn't valid.")).toBeTruthy();
    expect(screen.getByText(/the layout changed hands, or the person who sent it no longer manages it/)).toBeTruthy();
  });
});

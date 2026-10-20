// @vitest-environment jsdom
// Sign-up says "check your email" whatever the address, and a verification
// link that leaves the account without a password asks for one first.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { LoginPage } from '../LoginPage';
import { VerifyEmailPage } from '../VerifyEmailPage';

type Call = { url: string; body: unknown };

function stubFetch(answers: Record<string, unknown>): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal('fetch', async (input: string, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const key = Object.keys(answers).find((k) => url.startsWith(k));
    const body = key ? answers[key] : { error: 'not_found' };
    return new Response(JSON.stringify(body), { status: key ? 200 : 404, headers: { 'content-type': 'application/json' } });
  });
  return calls;
}

function renderAt(path: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/verify-email/:token" element={<VerifyEmailPage />} />
          <Route path="/" element={<p>Home page</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('sign-up and verification pages', () => {
  it('sign-up shows "check your email" with the address', async () => {
    const calls = stubFetch({
      '/api/auth/me': { user: null },
      '/api/auth/providers': { providers: [], passwordEnabled: true, demoEnabled: false },
      '/api/auth/password/register': { ok: true, verificationRequired: true },
    });
    renderAt('/login');
    fireEvent.click(await screen.findByRole('button', { name: /need an account/i }));
    fireEvent.change(screen.getByLabelText('Your name (shown to others)'), { target: { value: 'Sam' } });
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'sam@example.com' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'sam-password-1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));
    expect(await screen.findByText(/check your email/i)).toBeTruthy();
    expect(screen.getByText('sam@example.com')).toBeTruthy();
    expect(calls.some((c) => c.url === '/api/auth/password/register')).toBe(true);
  });

  it('a link that keeps the password goes straight on', async () => {
    stubFetch({
      '/api/auth/password/verify-email/': { ok: true, needsPassword: false },
      '/api/auth/me': { user: null },
    });
    renderAt('/verify-email/abc');
    expect(await screen.findByText(/email verified/i)).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Choose a password' })).toBeNull();
    expect(await screen.findByText('Home page', {}, { timeout: 3000 })).toBeTruthy();
  });

  it('a link that leaves no password asks for one, saves it, then goes on', async () => {
    const calls = stubFetch({
      '/api/auth/password/verify-email/': { ok: true, needsPassword: true },
      '/api/auth/password/set': { ok: true },
      '/api/auth/me': { user: null },
    });
    renderAt('/verify-email/abc');
    expect(await screen.findByRole('heading', { name: 'Choose a password' })).toBeTruthy();

    fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'chosen-password-2' } });
    fireEvent.change(screen.getByLabelText('New password again'), { target: { value: 'not-the-same' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save and continue' }));
    expect(await screen.findByText(/don’t match/)).toBeTruthy();
    expect(calls.some((c) => c.url === '/api/auth/password/set')).toBe(false);

    fireEvent.change(screen.getByLabelText('New password again'), { target: { value: 'chosen-password-2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save and continue' }));
    expect(await screen.findByText('Home page')).toBeTruthy();
    await waitFor(() => expect(calls.find((c) => c.url === '/api/auth/password/set')?.body).toEqual({ password: 'chosen-password-2' }));
  });
});

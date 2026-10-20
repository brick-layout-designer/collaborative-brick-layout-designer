// @vitest-environment jsdom
// Signing in too often: the page says how long to wait, in words.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { LoginPage } from '../LoginPage';
import { tooManyTriesMessage } from '../../api';

function stubLogin(status: number, body: unknown, headers: Record<string, string> = {}) {
  vi.stubGlobal('fetch', async (input: string) => {
    const url = String(input);
    if (url === '/api/auth/me') return Response.json({ user: null });
    if (url === '/api/auth/providers') return Response.json({ providers: [], passwordEnabled: true, demoEnabled: false });
    if (url === '/api/auth/password/login') {
      return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
    }
    return Response.json({ error: 'not_found' }, { status: 404 });
  });
}

async function signIn() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/login']}>
        <LoginPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  fireEvent.change(await screen.findByLabelText('Email'), { target: { value: 'sam@example.com' } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'some-password-1' } });
  fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('sign-in waits', () => {
  it('shows "too many tries, wait N" for a paced account', async () => {
    stubLogin(429, { error: 'login_paced', retryAfter: 8 }, { 'retry-after': '8' });
    await signIn();
    expect(await screen.findByText('Too many tries. Please wait 8 seconds and try again.')).toBeTruthy();
  });

  it('uses Retry-After for the per-address limit, in minutes when long', async () => {
    stubLogin(429, { statusCode: 429, error: 'Too Many Requests', message: 'Rate limit exceeded, retry in 1 minute' }, { 'retry-after': '60' });
    await signIn();
    expect(await screen.findByText('Too many tries. Please wait 1 minute and try again.')).toBeTruthy();
  });

  it('words the wait', () => {
    expect(tooManyTriesMessage(1)).toBe('Too many tries. Please wait 1 second and try again.');
    expect(tooManyTriesMessage(61)).toBe('Too many tries. Please wait 2 minutes and try again.');
    expect(tooManyTriesMessage(900)).toBe('Too many tries. Please wait 15 minutes and try again.');
    expect(tooManyTriesMessage(null)).toBe('Too many tries. Please wait a little and try again.');
  });
});

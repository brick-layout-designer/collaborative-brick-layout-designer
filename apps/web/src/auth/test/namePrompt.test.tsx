// Names are shown to other people, so sign-up asks for one, and anyone
// whose name is missing or an email address is asked "What should we
// call you?" after signing in. The API is a stubbed fetch.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import { api } from '../../api';
import { LoginPage } from '../LoginPage';
import { NamePrompt, forgetNamePromptSkip } from '../NamePrompt';

type Handler = (body: unknown) => { status?: number; body: unknown };
let routes: Record<string, Handler>;
let calls: { method: string; path: string; body: unknown }[];

const me = (over: Record<string, unknown>) => ({
  user: { id: 'u1', email: 'sam.jones@example.com', displayName: 'sam.jones@example.com', publicName: 'Builder #u1', avatarUrl: null, isDemoAccount: false, isGlobalAdmin: false, linkedProviders: [], needsName: true, suggestedName: 'sam jones', ...over },
});

beforeEach(() => {
  calls = [];
  forgetNamePromptSkip();
  routes = {
    'GET /api/auth/me': () => ({ body: me({}) }),
    'GET /api/auth/providers': () => ({ body: { providers: [], passwordEnabled: true, demoEnabled: false } }),
  };
  vi.stubGlobal('fetch', async (input: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(init.body as string) : undefined;
    calls.push({ method, path: input, body });
    const h = routes[`${method} ${input}`];
    if (!h) return new Response(JSON.stringify({ error: 'not_found' }), { status: 404 });
    const { status = 200, body: out } = h(body);
    return new Response(JSON.stringify(out), { status, headers: { 'content-type': 'application/json' } });
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** Shows once 'me' has loaded, so "the prompt isn't there" is checked after it could have been. */
function MeLoaded() {
  const me = useQuery({ queryKey: ['me'], queryFn: api.me });
  return me.data ? <span data-testid="me-loaded" /> : null;
}

function renderAt(ui: ReactNode, path = '/') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('sign-up asks for a name', () => {
  it('has a required "Your name (shown to others)" field and sends it', async () => {
    routes['POST /api/auth/password/register'] = () => ({ body: { ok: true, verificationRequired: true } });
    routes['GET /api/auth/me'] = () => ({ body: { user: null } });
    renderAt(<LoginPage />, '/login');
    fireEvent.click(await screen.findByRole('button', { name: 'Need an account?' }));
    const name = screen.getByLabelText('Your name (shown to others)') as HTMLInputElement;
    expect(name.required).toBe(true);
    fireEvent.change(name, { target: { value: 'Sam' } });
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'sam@example.com' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'correct horse battery' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));
    await waitFor(() => expect(calls.find((c) => c.path === '/api/auth/password/register')?.body).toMatchObject({ displayName: 'Sam' }));
  });

  it('refuses an email address as the name', async () => {
    routes['GET /api/auth/me'] = () => ({ body: { user: null } });
    renderAt(<LoginPage />, '/login');
    fireEvent.click(await screen.findByRole('button', { name: 'Need an account?' }));
    fireEvent.change(screen.getByLabelText('Your name (shown to others)'), { target: { value: 'sam@example.com' } });
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'sam@example.com' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'correct horse battery' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));
    expect(await screen.findByText(/can’t be an email address/)).toBeTruthy();
    expect(calls.some((c) => c.path === '/api/auth/password/register')).toBe(false);
  });
});

describe('"What should we call you?"', () => {
  it('asks when the name is an email, prefilled with the part before @, and saves', async () => {
    let saved = false;
    routes['PATCH /api/auth/me'] = (b) => {
      saved = true;
      return { body: { ok: true, displayName: (b as { displayName: string }).displayName } };
    };
    routes['GET /api/auth/me'] = () => ({ body: saved ? me({ displayName: 'Sam', publicName: 'Sam', needsName: false }) : me({}) });
    renderAt(<NamePrompt />);
    const input = (await screen.findByLabelText('Your name (shown to others)')) as HTMLInputElement;
    expect(input.value).toBe('sam jones');
    fireEvent.change(input, { target: { value: 'Sam' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save name' }));
    await waitFor(() => expect(calls.find((c) => c.method === 'PATCH')?.body).toEqual({ displayName: 'Sam' }));
    // The write refetches 'me', which no longer needs a name: the prompt goes.
    await waitFor(() => expect(screen.queryByTestId('name-prompt')).toBeNull());
  });

  it('can be skipped, and asks again after signing out', async () => {
    const first = renderAt(<NamePrompt />);
    fireEvent.click(await screen.findByRole('button', { name: 'Not now' }));
    expect(screen.queryByTestId('name-prompt')).toBeNull();
    first.unmount();
    // Same session: still skipped.
    renderAt(<><NamePrompt /><MeLoaded /></>);
    await screen.findByTestId('me-loaded');
    expect(screen.queryByTestId('name-prompt')).toBeNull();
    cleanup();
    forgetNamePromptSkip();
    renderAt(<NamePrompt />);
    expect(await screen.findByTestId('name-prompt')).toBeTruthy();
  });

  it('stays away when the name is fine, and on the sign-in page', async () => {
    routes['GET /api/auth/me'] = () => ({ body: me({ displayName: 'Sam', needsName: false }) });
    renderAt(<><NamePrompt /><MeLoaded /></>);
    await screen.findByTestId('me-loaded');
    expect(screen.queryByTestId('name-prompt')).toBeNull();
    cleanup();
    routes['GET /api/auth/me'] = () => ({ body: me({}) });
    renderAt(<><NamePrompt /><MeLoaded /></>, '/login');
    await screen.findByTestId('me-loaded');
    expect(screen.queryByTestId('name-prompt')).toBeNull();
  });
});

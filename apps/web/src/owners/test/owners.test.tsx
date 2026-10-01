// @vitest-environment jsdom
// Mine and my clubs' things together: the filter's rules, the chip's
// words, and the home page showing both with a remembered filter.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { ReactNode } from 'react';
import { defaultSaveTo, matchesOwnerFilter, ownerLabel, OWNER_FILTER_KEY, validOwnerFilter } from '../owners';
import { LayoutsPage } from '../../layouts/LayoutsPage';

const CLUB = { id: 'org1', name: 'ArkLUG', slug: 'arklug', createdAt: 0, myRole: 'member' as const };
const ORGS = [CLUB];
const mine = { ownerUserId: 'u1', ownerOrgId: null };
const club = { ownerUserId: null, ownerOrgId: 'org1' };
const shared = { ownerUserId: 'u2', ownerOrgId: null, owner: { kind: 'user' as const, id: 'u2', name: 'Dana', slug: null } };

describe('owner filter rules', () => {
  it('All shows everything; Mine only my own; a club only its things', () => {
    for (const item of [mine, club, shared]) expect(matchesOwnerFilter(item, 'all', 'u1', ORGS)).toBe(true);
    expect([mine, club, shared].map((i) => matchesOwnerFilter(i, 'me', 'u1', ORGS))).toEqual([true, false, false]);
    expect([mine, club, shared].map((i) => matchesOwnerFilter(i, 'arklug', 'u1', ORGS))).toEqual([false, true, false]);
    // Rooms from older servers carry no ownerUserId: a club's is still not "mine".
    expect(matchesOwnerFilter({ ownerOrgId: 'org1' }, 'me', 'u1', ORGS)).toBe(false);
    expect(matchesOwnerFilter({ ownerOrgId: null }, 'me', 'u1', ORGS)).toBe(true);
  });

  it('a club the user has left falls back to All', () => {
    expect(validOwnerFilter('arklug', ORGS)).toBe('arklug');
    expect(validOwnerFilter('gone-club', ORGS)).toBe('all');
    expect(validOwnerFilter('me', [])).toBe('me');
  });

  it('the chip says Me, the club, or who shared it', () => {
    expect(ownerLabel(mine, 'u1', ORGS)).toEqual({ text: 'Me', kind: 'me' });
    expect(ownerLabel(club, 'u1', ORGS)).toEqual({ text: 'ArkLUG', kind: 'club' });
    expect(ownerLabel(shared, 'u1', ORGS)).toEqual({ text: 'Shared by Dana', kind: 'shared' });
  });

  it('Save to starts at the club being shown, otherwise Me', () => {
    expect(defaultSaveTo('arklug')).toBe('arklug');
    expect(defaultSaveTo('all')).toBe('');
    expect(defaultSaveTo('me')).toBe('');
  });
});

type Handler = (body: unknown) => { status?: number; body: unknown };
let routes: Record<string, Handler>;

beforeEach(() => {
  localStorage.clear();
  routes = {
    'GET /api/auth/me': () => ({ body: { user: { id: 'u1', email: 'me@x.com', displayName: 'Me' } } }),
    'GET /api/orgs': () => ({ body: { orgs: ORGS } }),
    'GET /api/layouts': () => ({
      body: {
        layouts: [
          { id: 'l1', title: 'My Town', ...mine, role: 'owner', updatedAt: 0, expiresAt: null, hasSidecar: false },
          { id: 'l2', title: 'Club Show', ...club, role: 'editor', updatedAt: 0, expiresAt: null, hasSidecar: false, owner: { kind: 'org', id: 'org1', name: 'ArkLUG', slug: 'arklug' } },
        ],
      },
    }),
    'GET /api/modules': () => ({
      body: { modules: [{ id: 'm1', title: 'Club Station', ...club, role: 'editor', updatedAt: 0 }] },
    }),
    'GET /api/venues': () => ({ body: { venues: [{ id: 'v1', name: 'My Garage', ownerOrgId: null, ownerUserId: 'u1', canManage: true }] } }),
  };
  vi.stubGlobal('fetch', async (input: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    const h = routes[`${method} ${input}`];
    if (!h) return new Response(JSON.stringify({ error: 'not_found' }), { status: 404 });
    const { status = 200, body } = h(init?.body ? JSON.parse(init.body as string) : undefined);
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderHome(url = '/'): void {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const ui: ReactNode = (
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[url]}>
        <Routes>
          <Route path="/" element={<LayoutsPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
  render(ui);
}

const filterButton = (name: string) => within(screen.getByRole('group', { name: 'Show whose things' })).getByRole('button', { name });

describe('home page', () => {
  it('lists my things and my club’s together, each with an owner chip', async () => {
    renderHome();
    const town = (await screen.findByText('My Town')).closest('li')!;
    const show = screen.getByText('Club Show').closest('li')!;
    expect(within(town).getByTestId('owner-chip').textContent).toBe('Me');
    expect(within(show).getByTestId('owner-chip').textContent).toBe('ArkLUG');
    expect(await screen.findByText('Club Station')).toBeTruthy();
    expect(await screen.findByText('My Garage')).toBeTruthy();
    // A member can't delete the club's layout; the owner can delete theirs.
    expect(within(show).queryByRole('button', { name: 'Delete' })).toBeNull();
    expect(within(town).getByRole('button', { name: 'Delete' })).toBeTruthy();
  });

  it('filters by owner and remembers the choice', async () => {
    renderHome();
    await screen.findByText('My Town');
    fireEvent.click(await screen.findByRole('button', { name: 'ArkLUG' }));
    expect(filterButton('ArkLUG').getAttribute('aria-pressed')).toBe('true');
    expect(screen.queryByText('My Town')).toBeNull();
    expect(screen.getByText('Club Show')).toBeTruthy();
    expect(screen.queryByText('My Garage')).toBeNull();
    expect(localStorage.getItem(OWNER_FILTER_KEY)).toBe('arklug');

    cleanup();
    renderHome();
    await screen.findByText('Club Show');
    await waitFor(() => expect(filterButton('ArkLUG').getAttribute('aria-pressed')).toBe('true'));
    expect(screen.queryByText('My Town')).toBeNull();

    fireEvent.click(filterButton('Mine'));
    expect(screen.getByText('My Town')).toBeTruthy();
    expect(screen.queryByText('Club Show')).toBeNull();
    expect(screen.queryByText('Club Station')).toBeNull();
  });

  it('a club page link (?owner=) picks that club, and New layout saves there by default', async () => {
    renderHome('/?owner=arklug');
    await screen.findByText('Club Show');
    expect(screen.queryByText('My Town')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'New layout' }));
    const picker = (await screen.findByLabelText('Save to')) as HTMLSelectElement;
    expect(picker.value).toBe('arklug');
    expect([...picker.options].map((o) => o.textContent)).toEqual(['Me', 'ArkLUG']);
  });
});

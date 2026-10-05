// @vitest-environment jsdom
// Mine and my clubs' things together: the filter's rules, the chip's
// words, and the home page showing both with a remembered filter.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { ReactNode } from 'react';
import { defaultSaveTo, matchesOwnerFilter, ownerFilterKey, ownerLabel, readOwnerFilter, validOwnerFilter, writeOwnerFilter } from '../owners';
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
    // Open is on the row; the rest is in its ⋯ menu.
    expect(within(town).getByRole('link', { name: 'Open' })).toBeTruthy();
    expect(within(town).queryByRole('button', { name: 'Delete' })).toBeNull();
    // A member can't delete the club's layout; the owner can delete theirs.
    fireEvent.click(within(show).getByRole('button', { name: 'More for Club Show' }));
    expect(within(show).getByRole('menuitem', { name: 'Share…' })).toBeTruthy();
    expect(within(show).queryByRole('menuitem', { name: 'Delete' })).toBeNull();
    fireEvent.click(within(town).getByRole('button', { name: 'More for My Town' }));
    expect(within(town).getByRole('menuitem', { name: 'Delete' })).toBeTruthy();
  });

  it('filters by owner and remembers the choice', async () => {
    renderHome();
    await screen.findByText('My Town');
    fireEvent.click(await screen.findByRole('button', { name: 'ArkLUG' }));
    expect(filterButton('ArkLUG').getAttribute('aria-pressed')).toBe('true');
    expect(screen.queryByText('My Town')).toBeNull();
    expect(screen.getByText('Club Show')).toBeTruthy();
    expect(screen.queryByText('My Garage')).toBeNull();
    expect(localStorage.getItem(ownerFilterKey('u1'))).toBe('arklug');

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

  it('opens on All the first time', async () => {
    renderHome();
    await screen.findByText('My Town');
    expect(filterButton('All').getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByText('Club Show')).toBeTruthy();
    expect(localStorage.getItem(ownerFilterKey('u1'))).toBeNull();
  });

  it('a club page link shows the club but isn’t remembered as the pick', async () => {
    renderHome('/?owner=arklug');
    await screen.findByText('Club Show');
    expect(filterButton('ArkLUG').getAttribute('aria-pressed')).toBe('true');
    cleanup();
    renderHome();
    await screen.findByText('My Town');
    expect(filterButton('All').getAttribute('aria-pressed')).toBe('true');
  });

  it('a remembered club that’s gone (left or deleted) opens on All and is forgotten', async () => {
    localStorage.setItem(ownerFilterKey('u1'), 'gone-club');
    renderHome();
    await screen.findByText('My Town');
    await waitFor(() => expect(filterButton('All').getAttribute('aria-pressed')).toBe('true'));
    expect(screen.getByText('Club Show')).toBeTruthy();
    await waitFor(() => expect(localStorage.getItem(ownerFilterKey('u1'))).toBe('all'));
  });

  it('remembers per person: someone else signing in here starts on All', async () => {
    localStorage.setItem(ownerFilterKey('u2'), 'arklug');
    localStorage.setItem('cld:ownerFilter', 'arklug'); // an older build's one-per-browser value
    renderHome();
    await screen.findByText('My Town');
    expect(filterButton('All').getAttribute('aria-pressed')).toBe('true');
  });
});

describe('remembered owner filter storage', () => {
  it('is keyed by person and server', () => {
    expect(ownerFilterKey('u1', 'https://a.example')).toBe('cld:ownerFilter:https://a.example:u1');
    expect(ownerFilterKey('u1', 'https://a.example')).not.toBe(ownerFilterKey('u1', 'https://b.example'));
    expect(ownerFilterKey('u1')).toBe(`cld:ownerFilter:${window.location.origin}:u1`);
  });

  it('All when signed out or never picked; reads back a pick', () => {
    expect(readOwnerFilter(undefined)).toBe('all');
    expect(readOwnerFilter('u1')).toBe('all');
    writeOwnerFilter('u1', 'me');
    expect(readOwnerFilter('u1')).toBe('me');
    writeOwnerFilter(undefined, 'arklug');
    expect(localStorage.length).toBe(1);
  });

  it('blocked storage just means All and nothing remembered', () => {
    const get = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(readOwnerFilter('u1')).toBe('all');
    expect(() => writeOwnerFilter('u1', 'me')).not.toThrow();
    get.mockRestore();
    set.mockRestore();
  });
});

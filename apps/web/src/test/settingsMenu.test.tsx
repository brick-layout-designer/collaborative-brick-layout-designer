// @vitest-environment jsdom
// The header's Settings ▾ menu: Account, Look and (for admins and
// moderators) Admin settings, each entry a deep link; the waiting-review
// badge on the button; keyboard use; and the pages it links to opening at
// the right part (/settings#help, /admin?tab=users).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';
import { AppHeader } from '../AppHeader';
import { SettingsPage } from '../settings/SettingsPage';
import { AdminPage } from '../admin/AdminPage';
import type { Me } from '../api';

const base: Me = {
  id: 'u1',
  email: 'sam@example.com',
  displayName: 'Sam',
  avatarUrl: null,
  isDemoAccount: false,
  isGlobalAdmin: false,
  isModerator: false,
  linkedProviders: [],
};
const USER = base;
const MODERATOR: Me = { ...base, isModerator: true };
const ADMIN: Me = { ...base, isGlobalAdmin: true };
const DEMO: Me = { ...base, isDemoAccount: true };

let me: Me;
let calls: string[];
let catalogSettings: unknown = null;

beforeEach(() => {
  me = USER;
  calls = [];
  catalogSettings = null;
  vi.stubGlobal('fetch', async (input: string, init?: RequestInit) => {
    const key = `${init?.method ?? 'GET'} ${input}`;
    calls.push(key);
    const body: unknown =
      input === '/api/auth/me'
        ? { user: me }
        : input === '/api/moderation/items'
          ? { queue: [{ id: 'q1' }, { id: 'q2' }], items: [] }
          : input === '/api/moderation/collections'
            ? { queue: [{ id: 'c1' }], collections: [] }
            : input === '/api/auth/logout'
              ? { ok: true }
              : input === '/api/catalog/settings'
                ? catalogSettings
                : null;
    if (body === null) return new Response(JSON.stringify({ error: 'not_found' }), { status: 404 });
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function Where() {
  const l = useLocation();
  return <p data-testid="where">{l.pathname + l.search + l.hash}</p>;
}

function wrap(ui: ReactNode, url = '/') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[url]}>
        {ui}
        <Where />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const header = (user: Me) => wrap(<AppHeader user={user} />);
const settingsButton = () => screen.getByRole('button', { name: /^Menu/ });
function openMenu() {
  fireEvent.click(settingsButton());
  return screen.getByRole('menu', { name: 'Menu' });
}
/** Each group's title and its entries' names and links (Help is checked on its own). */
function groupsOf(menu: HTMLElement, opts: { withHelp?: boolean } = {}) {
  return within(menu)
    .getAllByRole('group')
    .filter((g) => opts.withHelp || g.getAttribute('aria-labelledby') !== 'settings-menu-help')
    .map((g) => ({
      title: g.getAttribute('aria-labelledby') && document.getElementById(g.getAttribute('aria-labelledby')!)!.textContent,
      entries: within(g)
        .getAllByRole('menuitem')
        .map((i) => `${i.textContent!.replace(/\d+$/, '')} ${i.getAttribute('href') ?? '(button)'}`),
    }));
}

describe('Settings menu by role', () => {
  it('a member: Account and Look only; no Admin, Settings or Profile links left in the bar', () => {
    header(USER);
    const nav = screen.getByRole('navigation', { name: 'Site' });
    expect(within(nav).queryByRole('link', { name: 'Settings' })).toBeNull();
    expect(within(nav).queryByRole('link', { name: /Admin|Moderation/ })).toBeNull();
    expect(within(nav).queryByRole('link', { name: 'Sam' })).toBeNull();
    expect(within(nav).queryByRole('button', { name: 'Sign out' })).toBeNull();

    expect(groupsOf(openMenu())).toEqual([
      {
        title: 'Account',
        entries: ['Profile and name /profile#name', 'Sign-in methods /profile#sign-in', 'Devices /profile#devices', 'Your data /profile#my-data', 'Delete my account /profile#delete-account', 'Sign out (button)'],
      },
      {
        title: 'Look',
        entries: ['Light or dark /settings#look', 'Colour and text size /settings#colour', 'Help and tours /settings#help'],
      },
    ]);
    expect(screen.getByTestId('settings-menu-who').textContent).toContain('Sam');
  });

  it('a moderator: Admin settings has only Moderation, and waiting reviews show on the button', async () => {
    header(MODERATOR);
    await waitFor(() => expect(within(settingsButton()).getByLabelText('3 reviews waiting')).toBeTruthy());
    const groups = groupsOf(openMenu());
    expect(groups.map((g) => g.title)).toEqual(['Account', 'Look', 'Admin settings']);
    expect(groups[2]!.entries).toEqual(['Moderation /admin?tab=moderation']);
    expect(within(screen.getByRole('menuitem', { name: /Moderation/ })).getByText('3')).toBeTruthy();
  });

  it('an admin: one entry per admin tab, each straight to it', async () => {
    header(ADMIN);
    const groups = groupsOf(openMenu());
    expect(groups[2]).toEqual({
      title: 'Admin settings',
      entries: [
        'Dashboard /admin?tab=dashboard',
        'Heavy use /admin?tab=heavy',
        'Users /admin?tab=users',
        'Clubs /admin?tab=orgs',
        'Layouts /admin?tab=layouts',
        'Parts /admin?tab=parts',
        'Part libraries /admin?tab=libraries',
        'Moderation /admin?tab=moderation',
        'Privacy requests /admin?tab=privacy',
        'Audit log /admin?tab=audit',
        'Site settings /admin?tab=settings',
      ],
    });
  });

  it('one menu: Help comes first, with the tours, the help buttons switch and the help pages', () => {
    header(USER);
    const [help] = groupsOf(openMenu(), { withHelp: true });
    expect(help!.title).toBe('Help');
    expect(help!.entries.some((e) => e.startsWith('Tour: '))).toBe(true);
    expect(help!.entries).toEqual(
      expect.arrayContaining(['Turn help buttons off (button)', 'All help topics /help', 'Keyboard shortcuts /help#shortcuts']),
    );
    // No separate ? button in the header any more.
    expect(within(screen.getByRole('banner')).queryByRole('button', { name: 'Help' })).toBeNull();
  });

  it('on a phone the page links are in the menu too', () => {
    const before = window.matchMedia;
    window.matchMedia = ((q: string) =>
      ({ matches: q.includes('max-width'), media: q, addEventListener: () => {}, removeEventListener: () => {} }) as unknown as MediaQueryList);
    try {
      header(USER);
      const groups = groupsOf(openMenu(), { withHelp: true });
      expect(groups[0]!.title).toBe('Pages');
      expect(groups[0]!.entries).toEqual(expect.arrayContaining(['Home /', 'Clubs /orgs', 'About /about']));
    } finally {
      window.matchMedia = before;
    }
  });

  it('a member never asks for the review queues', async () => {
    header(USER);
    await act(async () => {});
    expect(calls.some((c) => c.includes('/api/moderation'))).toBe(false);
    expect(within(settingsButton()).queryByLabelText(/waiting/)).toBeNull();
  });

  it('the demo account has no sign-in methods or devices to change', () => {
    header(DEMO);
    expect(groupsOf(openMenu())[0]!.entries).toEqual(['Profile and name /profile#name', 'Sign out (button)']);
  });

  it('Install the app is there only where installing is offered (phones and tablets)', () => {
    const ua = vi.spyOn(window.navigator, 'userAgent', 'get').mockReturnValue('Mozilla/5.0 (Linux; Android 14) Mobile');
    header(USER);
    expect(within(openMenu()).getByRole('menuitem', { name: 'Install the app' }).getAttribute('href')).toBe('/settings#install');
    ua.mockRestore();
  });

  it('an entry goes to its section and closes the menu; Sign out signs out', async () => {
    header(USER);
    fireEvent.click(within(openMenu()).getByRole('menuitem', { name: 'Help and tours' }));
    expect(screen.getByTestId('where').textContent).toBe('/settings#help');
    expect(screen.queryByRole('menu')).toBeNull();
    fireEvent.click(within(openMenu()).getByRole('menuitem', { name: 'Sign out' }));
    await waitFor(() => expect(calls).toContain('POST /api/auth/logout'));
  });
});

describe('Settings menu by keyboard and touch', () => {
  it('arrows open it and move through the entries; Escape closes it and returns focus', () => {
    header(USER);
    const button = settingsButton();
    button.focus();
    fireEvent.keyDown(button, { key: 'ArrowDown' });
    const menu = screen.getByRole('menu');
    const items = within(menu).getAllByRole('menuitem');
    expect(document.activeElement).toBe(items[0]);
    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(items[1]);
    fireEvent.keyDown(menu, { key: 'End' });
    expect(document.activeElement).toBe(items[items.length - 1]);
    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(items[0]);
    fireEvent.keyDown(menu, { key: 'ArrowUp' });
    expect(document.activeElement).toBe(items[items.length - 1]);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(button);
    expect(button.getAttribute('aria-expanded')).toBe('false');
  });

  it('ArrowUp on the button opens at the last entry', () => {
    header(USER);
    fireEvent.keyDown(settingsButton(), { key: 'ArrowUp' });
    const items = within(screen.getByRole('menu')).getAllByRole('menuitem');
    expect(document.activeElement).toBe(items[items.length - 1]);
  });

  it('a tap outside closes it; on a phone it is a bottom sheet with a Close button', () => {
    header(USER);
    const menu = openMenu();
    expect(menu.className).toContain('max-sm:bottom-0');
    fireEvent.click(within(menu).getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('menu')).toBeNull();
    openMenu();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('menu')).toBeNull();
  });
});

describe('the pages the menu links to', () => {
  it('/settings#help opens at Help and tours', async () => {
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    wrap(<Routes><Route path="/settings" element={<SettingsPage />} /></Routes>, '/settings#help');
    await waitFor(() => expect(scroll).toHaveBeenCalled());
    expect(scroll.mock.contexts[0]).toBe(document.getElementById('help'));
  });

  it('/admin?tab=users opens the Users tab, and picking a tab puts it in the address', async () => {
    me = ADMIN;
    wrap(<Routes><Route path="/admin" element={<AdminPage />} /></Routes>, '/admin?tab=users');
    const users = await screen.findByRole('button', { name: 'users' });
    expect(users.getAttribute('aria-current')).toBe('page');
    fireEvent.click(screen.getByRole('button', { name: 'audit' }));
    expect(screen.getByTestId('where').textContent).toBe('/admin?tab=audit');
    expect(screen.getByRole('button', { name: 'audit' }).getAttribute('aria-current')).toBe('page');
  });

  it('a moderator sent to an admin-only tab gets Moderation', async () => {
    me = MODERATOR;
    wrap(<Routes><Route path="/admin" element={<AdminPage />} /></Routes>, '/admin?tab=users');
    const mod = await screen.findByRole('button', { name: 'moderation' });
    expect(mod.getAttribute('aria-current')).toBe('page');
    expect(screen.queryByRole('button', { name: 'users' })).toBeNull();
  });
});

describe('Settings › Back', () => {
  it('goes back only to a page of this site (React Router numbers its entries)', async () => {
    const { backWithinSite } = await import('../settings/SettingsPage');
    expect(backWithinSite({ idx: 3, key: 'k', usr: null })).toBe(true);
    // Opened straight from a link, or the tab's earlier pages are another site's.
    expect(backWithinSite({ idx: 0, key: 'k', usr: null })).toBe(false);
    expect(backWithinSite(null)).toBe(false);
  });
});

describe('AppHeader', () => {
  it('links the Catalog when only the layout catalog is on', async () => {
    catalogSettings = { modules: false, parts: false, layouts: true, venues: false, review: 'moderators', anonymousBrowse: true };
    header(USER);
    expect(await screen.findByRole('link', { name: 'Catalog' })).toBeTruthy();
  });

  it('says so when the account is on hold, instead of letting each change fail', () => {
    header({ ...USER, restricted: true });
    expect(screen.getByTestId('account-on-hold').textContent).toContain('on hold (read only)');
  });
});

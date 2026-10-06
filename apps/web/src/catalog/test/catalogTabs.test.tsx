// @vitest-environment jsdom
// The Catalog's tabs come first, with Collections as one of them (as in
// the desktop app): a phone opens on the list asked for, not on a
// screenful of collection cards.

import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { CatalogPage } from '../CatalogPage';

beforeEach(() => {
  vi.stubGlobal('fetch', async (input: string) => {
    const path = input.split('?')[0]!;
    const body =
      path === '/api/auth/me'
        ? { user: null }
        : path === '/api/catalog/settings'
          ? { modules: true, parts: false, layouts: true, venues: false, review: 'moderators', anonymousBrowse: true }
          : path === '/api/catalog/items'
            ? { items: [] }
            : path === '/api/catalog/collections'
              ? { collections: [] }
              : {};
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function at(url: string) {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={[url]}>
        <CatalogPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

it('shows the tabs first, Collections among them, and only the list asked for', async () => {
  at('/catalog?kind=layout');
  const tabs = await screen.findAllByRole('tab');
  expect(tabs.map((t) => t.textContent)).toEqual(['Modules', 'Layouts', 'Collections']);
  expect(screen.getByRole('tab', { name: 'Layouts' }).getAttribute('aria-selected')).toBe('true');
  expect(screen.queryByRole('heading', { name: /Collections/ })).toBeNull();
  expect(screen.getByRole('searchbox', { name: 'Search the catalog' })).toBeTruthy();
});

it('the Collections tab shows the collections, without the item search', async () => {
  at('/catalog?kind=collections');
  expect(await screen.findByRole('heading', { name: /Collections/ })).toBeTruthy();
  expect(screen.getByRole('tab', { name: 'Collections' }).getAttribute('aria-selected')).toBe('true');
  expect(screen.queryByRole('searchbox', { name: 'Search the catalog' })).toBeNull();
});

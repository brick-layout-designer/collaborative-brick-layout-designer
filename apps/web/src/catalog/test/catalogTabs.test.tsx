// @vitest-environment jsdom
// The Catalog's tabs come first, with All and Collections among them (as
// in the desktop app). With no filter it's a landing: Featured, then a row
// per kind with "See all"; a kind, a search or a tag shows that whole list.

import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { CatalogPage } from '../CatalogPage';

const asked: string[] = [];
const item = (kind: string, title: string) => ({ id: title, kind, title, by: 'Ada', version: 1, uses: 0, tags: [], description: '', previewUrl: '', trustedClub: false, summary: null });

beforeEach(() => {
  asked.length = 0;
  vi.stubGlobal('fetch', async (input: string) => {
    asked.push(input);
    const [path, query] = input.split('?') as [string, string | undefined];
    const kind = new URLSearchParams(query).get('kind');
    const body =
      path === '/api/auth/me'
        ? { user: null }
        : path === '/api/catalog/settings'
          ? { modules: true, parts: false, layouts: true, venues: false, review: 'moderators', anonymousBrowse: true }
          : path === '/api/catalog/items'
            ? { items: kind === 'module' ? [item('module', 'Coal stage')] : kind === 'all' ? [item('layout', 'Harbour')] : [], nextOffset: null }
            : path === '/api/catalog/collections'
              ? {
                  collections: [
                    { id: 'c1', title: 'Starter town', featured: true, by: 'Mo', itemCount: 2, moduleCount: 2, partCount: 0, description: '', coverUrl: null },
                  ],
                }
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
  expect(tabs.map((t) => t.textContent)).toEqual(['All', 'Modules', 'Layouts', 'Collections']);
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

it('with no filter: Featured first, then a row per kind with See all', async () => {
  at('/catalog');
  expect(await screen.findByRole('heading', { name: /Featured/ })).toBeTruthy();
  expect(await screen.findByText('Starter town')).toBeTruthy();
  expect(await screen.findByText('Coal stage')).toBeTruthy();
  expect(screen.getByRole('tab', { name: 'All' }).getAttribute('aria-selected')).toBe('true');
  // The Layouts row is empty: no row.
  expect(screen.queryByRole('heading', { name: 'Layouts' })).toBeNull();
  // Rows ask for a few, never the whole list.
  expect(asked.filter((u) => u.startsWith('/api/catalog/items')).every((u) => u.includes('limit=8'))).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'See all modules' }));
  expect(screen.getByRole('tab', { name: 'Modules' }).getAttribute('aria-selected')).toBe('true');
});

it('a search covers every kind, a page at a time', async () => {
  at('/catalog?q=harb');
  expect(await screen.findByText('Harbour')).toBeTruthy();
  expect(screen.queryByRole('heading', { name: /Featured/ })).toBeNull();
  expect(asked.some((u) => u.includes('kind=all') && u.includes('q=harb') && u.includes('limit=24'))).toBe(true);
});

// @vitest-environment jsdom
// /catalog/items/:id for a module or a part (they have no page of their
// own) goes to that kind's list, instead of "Loading…" for ever.

import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { CatalogItemPage } from '../CatalogItemPage';

beforeEach(() => {
  vi.stubGlobal('fetch', async (input: string) => {
    const path = input.split('?')[0]!;
    const body =
      path === '/api/catalog/items/m1'
        ? { item: { id: 'm1', kind: 'module', title: 'Shed', description: '', tags: [], by: 'Olive', uses: 0, version: 1, updatedAt: 1, previewUrl: null } }
        : path === '/api/auth/me'
          ? { user: null }
          : {};
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function Where() {
  const l = useLocation();
  return <p data-testid="where">{l.pathname + l.search}</p>;
}

it("a module's address goes to the modules list", async () => {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={['/catalog/items/m1']}>
        <Routes>
          <Route path="/catalog/items/:id" element={<CatalogItemPage />} />
          <Route path="/catalog" element={<Where />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  expect((await screen.findByTestId('where')).textContent).toBe('/catalog?kind=module');
});

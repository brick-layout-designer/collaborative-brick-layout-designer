// @vitest-environment jsdom
// The sign-in page's quiet footer: where the source lives (the website and
// the desktop app), opening in a new tab, with the licence.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { LoginPage } from '../LoginPage';

beforeEach(() => {
  vi.stubGlobal('fetch', async (input: string) => {
    const body =
      input === '/api/auth/me'
        ? { user: null }
        : input === '/api/auth/providers'
          ? { providers: [], passwordEnabled: true, demoEnabled: false }
          : { error: 'not_found' };
    return new Response(JSON.stringify(body), { status: body && 'error' in body ? 404 : 200, headers: { 'content-type': 'application/json' } });
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('sign-in footer', () => {
  it('links to both GitHub projects in a new tab, with the licence', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={['/login']}>
          <LoginPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    const footer = await screen.findByRole('contentinfo');
    expect(footer.textContent).toContain('Source on GitHub');
    expect(footer.textContent).toContain('AGPL-3.0-or-later');
    const web = within(footer).getByRole('link', { name: 'Website' });
    const desktop = within(footer).getByRole('link', { name: 'Desktop app' });
    expect(web.getAttribute('href')).toBe('https://github.com/brick-layout-designer/collaborative-brick-layout-designer');
    expect(desktop.getAttribute('href')).toBe('https://github.com/brick-layout-designer/brick-layout-designer');
    for (const a of [web, desktop]) {
      expect(a.getAttribute('target')).toBe('_blank');
      expect(a.getAttribute('rel')).toBe('noopener noreferrer');
    }
  });
});

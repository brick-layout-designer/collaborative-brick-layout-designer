// @vitest-environment jsdom
// Moderation: an update's new text beside what's public now, restoring
// what was unpublished, and the owner's badge for an update in review.

import { autoConfirm } from '../../test/confirmHost';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { ModerationTab } from '../Moderation';
import { CatalogBadge } from '../../catalog/ShareToCatalog';

let calls: { method: string; path: string }[];
let answer: (method: string, path: string, view: string | null) => unknown;

beforeEach(() => {
  calls = [];
  vi.stubGlobal('fetch', async (input: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    calls.push({ method, path: input });
    const [path, qs] = input.split('?');
    const body = answer(method, path!, new URLSearchParams(qs ?? '').get('view')) ?? { ok: true };
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const counts = { waiting: 1, trusted: 0, covers: 0, trustedCovers: 0, public: 0, unpublished: 1, collections: 0 };
const empty = { total: 0, nextOffset: null, rows: [] };

function show(url: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[url]}>
        <ModerationTab />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('an update waiting for review', () => {
  it('shows the new text, and what the public sees now', async () => {
    answer = (method, path, view) => {
      if (path === '/api/moderation/counts') return counts;
      if (path === '/api/moderation/covers') return { covers: [], trustedCovers: [] };
      if (path === '/api/moderation/catalog' && view === 'waiting')
        return {
          total: 1,
          nextOffset: null,
          rows: [
            {
              versionId: 'v2',
              itemId: 'i1',
              kind: 'module',
              title: 'Grand station',
              description: 'Now with a roof',
              tags: ['station', 'roof'],
              current: { title: 'Station', description: 'A small station', tags: ['station'] },
              version: 2,
              isUpdate: true,
              note: null,
              by: 'Sid',
              submitter: { name: 'Sid' },
              createdAt: 1,
              previewUrl: '',
              owner: null,
            },
          ],
        };
      if (path === '/api/moderation/collections/list') return empty;
      return undefined;
    };
    show('/admin?tab=moderation');
    const row = await screen.findByTestId('moderation-entry');
    expect(row.textContent).toContain('Grand station');
    expect(row.textContent).toContain('new text');
    fireEvent.click(within(row).getByRole('button', { name: 'Details of Grand station' }));
    const panel = await screen.findByRole('dialog', { name: 'Grand station' });
    expect(panel.textContent).toContain('Now with a roof');
    const now = within(panel).getByTestId('entry-current-text');
    expect(now.textContent).toContain('Station');
    expect(now.textContent).toContain('A small station');
  });
});

describe('restoring', () => {
  it('restores an unpublished item after asking', async () => {
    answer = (method, path, view) => {
      if (path === '/api/moderation/counts') return counts;
      if (path === '/api/moderation/catalog' && view === 'unpublished')
        return {
          total: 1,
          nextOffset: null,
          rows: [{ id: 'i1', kind: 'module', title: 'Station', description: '', tags: [], by: 'Sid', uses: 0, version: 1, updatedAt: 1, previewUrl: '', coverUrl: '', customCover: false, status: 'unpublished', reason: 'Check', owner: null }],
        };
      if (path === '/api/moderation/catalog') return empty;
      return undefined;
    };
    show('/admin?tab=moderation&view=published');
    fireEvent.click(await screen.findByLabelText('Unpublished'));
    const asked = autoConfirm(true);
    fireEvent.click(await screen.findByRole('button', { name: 'Restore Station' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.path === '/api/moderation/items/i1/restore')).toBe(true));
    expect(asked.titles).toEqual(['Restore “Station”?']);
  });

  it('restores an unpublished collection after asking', async () => {
    answer = (method, path, view) => {
      if (path === '/api/moderation/counts') return counts;
      if (path === '/api/moderation/collections/list' && view === 'listed')
        return {
          total: 1,
          nextOffset: null,
          rows: [{ id: 'c1', title: 'My picks', description: '', featured: false, official: false, by: 'Sid', itemCount: 2, modules: 0, parts: 0, coverUrl: null, updatedAt: 1, status: 'unpublished', reason: 'Check', owner: null }],
        };
      if (path === '/api/moderation/collections/list') return empty;
      return undefined;
    };
    show('/admin?tab=moderation&view=collections');
    const asked = autoConfirm(true);
    fireEvent.click(await screen.findByRole('button', { name: 'Restore collection My picks' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.path === '/api/moderation/collections/c1/restore')).toBe(true));
    expect(asked.titles).toEqual(['Restore “My picks”?']);
  });
});

describe('the owner’s badge', () => {
  it('names an update’s new title while it waits', () => {
    render(
      <CatalogBadge
        item={{ id: 'i1', kind: 'module', sourceId: 'm', title: 'Station', status: 'public', reason: null, version: 1, pendingVersion: 2, pendingText: { title: 'Grand station', description: '', tags: [] } }}
      />,
    );
    const badge = screen.getByTestId('catalog-badge');
    expect(badge.textContent).toBe('Public · update in review (new name: “Grand station”)');
  });
});

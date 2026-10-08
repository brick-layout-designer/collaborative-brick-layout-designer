// @vitest-environment jsdom
// Trusted clubs on the web: the moderators' list (trust, stop trusting),
// the club's own Review tab, the share note, and what refetches.

import { autoConfirm } from '../../test/confirmHost';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { TrustedClubsSection } from '../../admin/Moderation';
import { ClubReviewTab } from '../ClubReview';
import { ShareToCatalogDialog } from '../../catalog/ShareToCatalog';
import { keysFor, hintsForWrite } from '../../live/invalidate';

let routes: Record<string, unknown>;
let calls: { method: string; path: string; body?: string | undefined }[];

beforeEach(() => {
  calls = [];
  routes = {};
  vi.stubGlobal('fetch', async (input: string, init?: RequestInit) => {
    calls.push({ method: init?.method ?? 'GET', path: input, body: init?.body as string | undefined });
    const body = routes[`${init?.method ?? 'GET'} ${input}`] ?? routes[`${init?.method ?? 'GET'} ${input.split('?')[0]}`] ?? { ok: true };
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function show(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('Trusted clubs (moderators)', () => {
  it('lists trusted clubs, finds others to trust, and asks before stopping', async () => {
    routes['GET /api/moderation/clubs'] = { clubs: [{ id: 'o1', slug: 'arklug', name: 'ArkLUG', trusted: true, trustedAt: 1 }] };
    routes['GET /api/moderation/clubs?q=tex'] = { clubs: [{ id: 'o2', slug: 'texlug', name: 'TexLUG', trusted: false, trustedAt: null }] };
    show(<TrustedClubsSection />);
    expect((await screen.findByTestId('trusted-club')).textContent).toContain('ArkLUG');
    fireEvent.change(screen.getByLabelText('Find a club to trust'), { target: { value: 'tex' } });
    const found = await screen.findByRole('list', { name: 'Clubs found' });
    fireEvent.click(within(found).getByRole('button', { name: 'Trust TexLUG' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.path === '/api/moderation/clubs/texlug/trust')).toBe(true));
    expect(JSON.parse(calls.find((c) => c.path === '/api/moderation/clubs/texlug/trust')!.body!)).toEqual({ trusted: true });
    // Back to the trusted list (a search shows only what it found).
    fireEvent.change(screen.getByLabelText('Find a club to trust'), { target: { value: '' } });
    await screen.findByRole('list', { name: 'Trusted clubs' });
    // Stopping asks first; saying no sends nothing.
    const asked = autoConfirm(false, true);
    fireEvent.click(screen.getByRole('button', { name: 'Stop trusting ArkLUG' }));
    await waitFor(() => expect(asked.titles).toEqual(['Stop trusting ArkLUG?']));
    // Give a request time to go out, had it been sent.
    await new Promise((r) => setTimeout(r, 50));
    expect(calls.some((c) => c.path === '/api/moderation/clubs/arklug/trust')).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Stop trusting ArkLUG' }));
    await waitFor(() => expect(calls.some((c) => c.path === '/api/moderation/clubs/arklug/trust')).toBe(true));
    expect(JSON.parse(calls.find((c) => c.path === '/api/moderation/clubs/arklug/trust')!.body!)).toEqual({ trusted: false });
  });
});

describe('The club’s Review tab', () => {
  it('approves and declines members’ shares and collection text, and unpublishes, on the club’s routes', async () => {
    routes['GET /api/orgs/arklug/review'] = {
      items: [{ versionId: 'v1', itemId: 'i1', kind: 'module', title: 'Bench', description: '', version: 1, isUpdate: false, note: null, submitter: 'Mel', createdAt: 1, previewUrl: '/p' }],
      collections: [{ id: 'c1', isUpdate: false, by: 'ArkLUG', email: null, createdAt: 1, owner: null, title: 'Standards', description: '', coverUrl: null, old: null, itemCount: 2 }],
      published: [{ id: 'i2', kind: 'part', title: 'Sign', description: '', tags: [], by: 'ArkLUG', uses: 0, version: 1, updatedAt: 1, previewUrl: '/p', status: 'public', reason: null }],
      publicCollections: [],
    };
    show(<ClubReviewTab slug="arklug" name="ArkLUG" />);
    expect((await screen.findByTestId('club-review-item')).textContent).toContain('Sent by Mel');
    fireEvent.click(screen.getByRole('button', { name: 'Approve Bench' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.path === '/api/orgs/arklug/review/versions/v1/approve')).toBe(true));
    autoConfirm('Too dark');
    fireEvent.click(screen.getByRole('button', { name: 'Decline collection Standards' }));
    await waitFor(() => expect(calls.some((c) => c.path === '/api/orgs/arklug/review/collections/c1/decline')).toBe(true));
    expect(JSON.parse(calls.find((c) => c.path === '/api/orgs/arklug/review/collections/c1/decline')!.body!)).toEqual({ reason: 'Too dark' });
    fireEvent.click(screen.getByRole('button', { name: 'Unpublish Sign' }));
    await waitFor(() => expect(calls.some((c) => c.path === '/api/orgs/arklug/review/items/i2/unpublish')).toBe(true));
  });
});

describe('sharing under a trusted club', () => {
  it('says it goes to the club’s own review', async () => {
    routes['GET /api/catalog/settings'] = { modules: true, parts: true, review: 'moderators', anonymousBrowse: true, canModerate: false };
    routes['POST /api/catalog/submissions'] = { id: 'i', version: 1, status: 'in_review' };
    show(<ShareToCatalogDialog kind="module" sourceId="m" title="Bench" onClose={() => undefined} clubReview="ArkLUG" />);
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: /Share|Send/ }));
    expect((await screen.findByRole('status')).textContent).toBe('Sent to ArkLUG’s own review: its admins and managers check it before it appears in the catalog.');
  });
});

describe('live updates', () => {
  it('catalog and club changes refetch the club’s queue and the trusted list', () => {
    expect(keysFor({ kind: 'catalog' }).map((k) => k[0])).toEqual(expect.arrayContaining(['club-review', 'moderation-clubs']));
    expect(keysFor({ kind: 'club' }).map((k) => k[0])).toEqual(expect.arrayContaining(['club-review']));
    expect(hintsForWrite('POST', '/api/orgs/arklug/review/versions/v/approve').map((h) => h.kind)).toContain('club');
    expect(hintsForWrite('POST', '/api/moderation/clubs/arklug/trust').map((h) => h.kind)).toEqual(['catalog']);
  });
});

describe('Manage the club badge words', () => {
  it('says what waits', async () => {
    const { waitingWords } = await import('../OrgDetailPage');
    expect(waitingWords(2, 1)).toBe('2 requests to join, 1 share to review');
    expect(waitingWords(0, 3)).toBe('3 shares to review');
    expect(waitingWords(1, 0)).toBe('1 request to join');
  });
});

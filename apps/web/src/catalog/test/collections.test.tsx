// @vitest-environment jsdom
// Catalog collections on the web: how my collections' status reads, the
// "Add all" summary, reordering, the Collections section (featured first),
// the editor's request, and what a collection change refetches. The API is
// a stubbed fetch.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { CatalogItem, CollectionSummary, MyCollection } from '../../api';
import {
  addAllSummary,
  audienceLabel,
  ClubCollectionsSection,
  CollectionEditor,
  CollectionsSection,
  collectionStatus,
  counts,
  filterLibrary,
  HomeCollections,
  moveItem,
  MyCollections,
  reviewLabel,
  savedSummary,
} from '../Collections';
import { AddToCollectionDialog } from '../AddToCollection';
import { CollectionToastHost } from '../collectionToast';
import { hintsForWrite, keysFor } from '../../live/invalidate';

const summary = (over: Partial<CollectionSummary>): CollectionSummary => ({
  id: 'c',
  title: 'C',
  description: '',
  featured: false,
  official: false,
  by: 'Someone',
  itemCount: 1,
  modules: 1,
  parts: 0,
  coverUrl: null,
  updatedAt: 1,
  ...over,
});
const item = (over: Partial<CatalogItem>): CatalogItem => ({
  id: 'i',
  kind: 'module',
  title: 'I',
  description: '',
  tags: [],
  by: 'Olive',
  uses: 0,
  version: 1,
  updatedAt: 1,
  previewUrl: '/p.png',
  ...over,
});

let routes: Record<string, unknown>;
let calls: { method: string; path: string; body?: string | undefined }[];

beforeEach(() => {
  calls = [];
  routes = {};
  vi.stubGlobal('fetch', async (input: string, init?: RequestInit) => {
    calls.push({ method: init?.method ?? 'GET', path: input, body: init?.body as string | undefined });
    const path = input.split('?')[0]!;
    const body = routes[`${init?.method ?? 'GET'} ${path}`] ?? { ok: true };
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function show(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
  return qc;
}

describe('collectionStatus', () => {
  const mine = (over: Partial<MyCollection>) => ({ status: 'public' as const, reason: null, pending: false, itemCount: 2, ...over });
  it('reads the way the owner needs it', () => {
    expect(collectionStatus(mine({ status: 'in_review' })).label).toBe('In review');
    expect(collectionStatus(mine({})).label).toBe('Public');
    expect(collectionStatus(mine({})).tone).toBe('ok');
    expect(collectionStatus(mine({ status: 'declined', reason: 'Too thin' })).label).toBe('Declined: Too thin');
    expect(collectionStatus(mine({ status: 'declined' })).label).toBe('Declined');
    expect(collectionStatus(mine({ status: 'unpublished', reason: 'Spam' })).label).toBe('Unpublished: Spam');
    expect(collectionStatus(mine({ pending: true })).label).toBe('Public · your change is in review');
    expect(collectionStatus(mine({ reason: 'No' })).label).toBe('Public · your change was declined: No');
    expect(collectionStatus(mine({ itemCount: 0 })).label).toBe('Hidden: no items left');
    expect(collectionStatus(mine({ status: 'withdrawn' })).tone).toBe('bad');
  });
  it('a private one says who sees it, whatever its review state', () => {
    expect(collectionStatus({ ...mine({ status: 'in_review' }), audience: 'private' }).label).toBe('Private · only you');
    expect(collectionStatus({ ...mine({}), audience: 'private' }, 'ArkLUG').label).toBe('Private · only arklug members');
    expect(collectionStatus({ ...mine({ itemCount: 0 }), audience: 'private' }).label).toBe('Empty: no items left');
    expect(audienceLabel('private', 'ArkLUG')).toBe('Only ArkLUG members');
    expect(audienceLabel('private')).toBe('Only you');
    expect(audienceLabel('everyone', 'ArkLUG')).toBe('Everyone');
  });
});

describe('labels', () => {
  it('counts read "3 modules · 5 parts"', () => {
    expect(counts({ modules: 3, parts: 5 })).toBe('3 modules · 5 parts');
    expect(counts({ modules: 1, parts: 0 })).toBe('1 module');
    expect(counts({ modules: 0, parts: 1 })).toBe('1 part');
    expect(counts({ modules: 0, parts: 0 })).toBe('empty');
  });
  it('an item waiting for its own review says so to its curators', () => {
    expect(reviewLabel({ state: 'in_review', reason: null })).toBe('Waiting for review');
    expect(reviewLabel({ state: 'declined', reason: 'Blurry' })).toBe('Declined: Blurry');
    expect(reviewLabel({ state: 'public', reason: null })).toBeNull();
    expect(reviewLabel(null)).toBeNull();
  });
  it('a save says what happens next', () => {
    expect(savedSummary({ id: 'x', status: 'public' }, 'private', 'ArkLUG')).toBe('Saved. Only ArkLUG members can see it.');
    expect(savedSummary({ id: 'x', status: 'in_review', submitted: ['m'] }, 'everyone')).toContain('One of your own items was shared to the catalog for review');
    expect(savedSummary({ id: 'x', status: 'public', pending: true }, 'everyone')).toContain('Sent for review');
    expect(savedSummary({ id: 'x', status: 'public' }, 'everyone')).toBe('It’s in the catalog now for everyone.');
  });
  it('the editor’s own items filter by words and by kind', () => {
    const rows = [
      { title: 'Show corner', kind: 'module' as const },
      { title: 'Show sign', kind: 'part' as const },
      { title: 'Bridge', kind: 'module' as const },
    ];
    expect(filterLibrary(rows, 'show', 'all').map((r) => r.title)).toEqual(['Show corner', 'Show sign']);
    expect(filterLibrary(rows, '', 'part').map((r) => r.title)).toEqual(['Show sign']);
    expect(filterLibrary(rows, ' BRIDGE ', 'module').map((r) => r.title)).toEqual(['Bridge']);
  });
});

describe('addAllSummary', () => {
  it('says what was added and what was already there', () => {
    const a = (n: number) => Array.from({ length: n }, (_, i) => ({ itemId: `i${i}`, kind: 'module' as const, id: `m${i}` }));
    expect(addAllSummary({ added: a(2), skipped: ['x'], failed: [] })).toBe('Added 2 items · already had 1.');
    expect(addAllSummary({ added: a(1), skipped: [], failed: [] })).toBe('Added 1 item.');
    expect(addAllSummary({ added: [], skipped: ['x', 'y'], failed: [{ itemId: 'z', error: 'limit_reached' }] })).toBe(
      'Nothing new to add · already had 2 · 1 couldn’t be added.',
    );
  });
});

describe('moveItem', () => {
  it('moves one entry and ignores moves off the ends', () => {
    expect(moveItem(['a', 'b', 'c'], 2, 0)).toEqual(['c', 'a', 'b']);
    expect(moveItem(['a', 'b', 'c'], 0, 1)).toEqual(['b', 'a', 'c']);
    expect(moveItem(['a', 'b'], 0, -1)).toEqual(['a', 'b']);
    expect(moveItem(['a', 'b'], 1, 2)).toEqual(['a', 'b']);
    expect(moveItem(['a', 'b', 'c'], 0, -1)).toEqual(['a', 'b', 'c']);
    expect(moveItem(['a', 'b'], 5, 0)).toEqual(['a', 'b']);
  });
});

describe('CollectionsSection', () => {
  it('shows featured collections first, apart from the rest', async () => {
    routes['GET /api/catalog/collections'] = {
      collections: [summary({ id: 'f', title: 'Starter town', featured: true, official: true }), summary({ id: 'u', title: 'Bob’s yard' })],
    };
    show(<CollectionsSection signedIn={false} />);
    const featured = await screen.findByRole('list', { name: 'Featured collections' });
    expect(within(featured).getByText('Starter town')).toBeTruthy();
    expect(within(screen.getByRole('list', { name: 'More collections' })).getByText('Bob’s yard')).toBeTruthy();
    expect(screen.getAllByTestId('collection-card').map((c) => c.textContent)).toEqual([
      expect.stringContaining('Starter town'),
      expect.stringContaining('Bob’s yard'),
    ]);
    expect(screen.getByRole('link', { name: /Starter town/ }).getAttribute('href')).toBe('/catalog/collections/f');
  });

  it('says so when there are none, with a help button', async () => {
    routes['GET /api/catalog/collections'] = { collections: [] };
    show(<CollectionsSection signedIn={false} />);
    expect(await screen.findByText('No public collections yet.')).toBeTruthy();
    expect(screen.getByRole('heading', { name: /Collections/ })).toBeTruthy();
  });
});

describe('MyCollections', () => {
  it('shows each one’s status and the note about items that left', async () => {
    routes['GET /api/catalog/collections/mine'] = {
      collections: [
        { ...summary({ id: 'a', title: 'Waiting' }), status: 'in_review', reason: null, pending: false, curatorNote: null },
        { ...summary({ id: 'b', title: 'Turned down' }), status: 'declined', reason: 'Add a description', pending: false, curatorNote: null },
        { ...summary({ id: 'c', title: 'Out there' }), status: 'public', reason: null, pending: false, curatorNote: '“Shed” was unpublished by a moderator, so it was taken out of this collection.' },
      ],
    };
    show(<MyCollections />);
    await screen.findByText('Waiting');
    expect(screen.getByRole('heading', { name: /Your collections/ })).toBeTruthy();
    expect(screen.getAllByTestId('collection-status').map((s) => s.textContent)).toEqual(['In review', 'Declined: Add a description', 'Public']);
    expect(screen.getByRole('note').textContent).toContain('“Shed” was unpublished');
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.path === '/api/catalog/collections/c/dismiss-note')).toBe(true));
  });
});

describe('CollectionEditor', () => {
  it('sends the title, the items in order and the cover', async () => {
    routes['GET /api/catalog/settings'] = { modules: true, parts: true, review: 'moderators', anonymousBrowse: true, canModerate: false };
    routes['GET /api/catalog/items'] = { items: [item({ id: 'm1', title: 'Yard' }), item({ id: 'm2', title: 'Shed' })] };
    routes['POST /api/catalog/collections'] = { id: 'new', status: 'in_review' };
    show(<CollectionEditor id={null} onClose={() => undefined} />);
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: '  Starter yard ' } });
    fireEvent.click((await screen.findAllByRole('button', { name: 'Put Yard in the collection' }))[0]!);
    fireEvent.click(screen.getAllByRole('button', { name: 'Put Shed in the collection' })[0]!);
    fireEvent.click(screen.getByRole('button', { name: 'Move Shed up' }));
    fireEvent.click(screen.getByLabelText('Use Yard as the cover'));
    // Private by default; everyone means a review first.
    expect((screen.getByLabelText('Only you') as HTMLInputElement).checked).toBe(true);
    fireEvent.click(screen.getByLabelText('Everyone (reviewed first)'));
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }));
    expect((await screen.findByRole('status')).textContent).toContain('Sent for review');
    expect(screen.getByRole('link', { name: 'Open collection' }).getAttribute('href')).toBe('/catalog/collections/new');
    const sent = calls.find((c) => c.method === 'POST' && c.path === '/api/catalog/collections');
    expect(JSON.parse(sent!.body!)).toEqual({
      title: 'Starter yard',
      description: '',
      entries: [
        { source: 'catalog', id: 'm2' },
        { source: 'catalog', id: 'm1' },
      ],
      coverItemId: 'm1',
      coverModuleId: null,
      audience: 'everyone',
    });
  });

  it('a club’s: who sees it, the club’s own modules and parts, and the club in the request', async () => {
    routes['GET /api/auth/me'] = { user: { id: 'u1', displayName: 'Ada' } };
    routes['GET /api/catalog/settings'] = { modules: true, parts: true, review: 'moderators', anonymousBrowse: true, canModerate: false };
    routes['GET /api/catalog/items'] = { items: [] };
    routes['GET /api/modules'] = {
      modules: [
        { id: 'cm', title: 'Show corner', ownerUserId: null, ownerOrgId: 'org1', docVersion: 1, hasSidecar: false, createdAt: 1, updatedAt: 1 },
        { id: 'mine', title: 'My bridge', ownerUserId: 'u1', ownerOrgId: null, docVersion: 1, hasSidecar: false, createdAt: 1, updatedAt: 1 },
      ],
    };
    routes['GET /api/custom-parts'] = {
      parts: [{ id: 'cp', partNumber: 'ARK.1', displayName: 'Show sign', ownerUserId: null, ownerOrgId: 'org1', spriteMime: 'image/png', createdAt: 1, updatedAt: 1 }],
    };
    routes['POST /api/catalog/collections'] = { id: 'c9', status: 'public', audience: 'private' };
    show(<CollectionEditor id={null} club={{ id: 'org1', slug: 'arklug', name: 'ArkLUG' }} onClose={() => undefined} />);
    expect(screen.getByLabelText('Only ArkLUG members')).toBeTruthy();
    const own = await screen.findByRole('list', { name: 'ArkLUG’s modules and parts' });
    // Only the club's own, not Ada's.
    expect(within(own).queryByText(/My bridge/)).toBeNull();
    fireEvent.click(within(own).getByRole('button', { name: 'Put Show corner in the collection' }));
    fireEvent.click(within(own).getByRole('button', { name: 'Put Show sign in the collection' }));
    // Parts only: the filter.
    fireEvent.change(screen.getByLabelText('Show modules or parts'), { target: { value: 'part' } });
    expect(within(screen.getByRole('list', { name: 'ArkLUG’s modules and parts' })).queryByText(/Show corner/)).toBeNull();
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'ArkLUG show standards' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect((await screen.findByRole('status')).textContent).toBe('Saved. Only ArkLUG members can see it.');
    const sent = JSON.parse(calls.find((c) => c.method === 'POST' && c.path === '/api/catalog/collections')!.body!);
    expect(sent).toMatchObject({
      clubSlug: 'arklug',
      audience: 'private',
      entries: [
        { source: 'library', kind: 'module', id: 'cm' },
        { source: 'library', kind: 'part', id: 'cp' },
      ],
    });
  });

  it('with nothing to add, says why and how to share one', async () => {
    routes['GET /api/auth/me'] = { user: { id: 'u1', displayName: 'Ada' } };
    routes['GET /api/catalog/settings'] = { modules: true, parts: true, review: 'moderators', anonymousBrowse: true, canModerate: false };
    routes['GET /api/catalog/items'] = { items: [] };
    routes['GET /api/modules'] = { modules: [] };
    routes['GET /api/custom-parts'] = { parts: [] };
    show(<CollectionEditor id={null} onClose={() => undefined} />);
    const empty = await screen.findByTestId('picker-empty');
    expect(empty.textContent).toContain('it has to be shared to the catalog first');
    expect(within(empty).getByRole('link', { name: 'How to share a module or part' }).getAttribute('href')).toBe('/help#catalog');
  });
});

describe('Add to a collection…', () => {
  beforeEach(() => {
    routes['GET /api/catalog/collections/mine'] = {
      collections: [
        { ...summary({ id: 'p1', title: 'My picks', audience: 'private' }), status: 'public', reason: null, pending: false, curatorNote: null },
        { ...summary({ id: 'w', title: 'Gone' }), status: 'withdrawn', reason: null, pending: false, curatorNote: null },
      ],
    };
    routes['GET /api/catalog/collections/clubs'] = {
      clubs: [
        { id: 'org1', slug: 'arklug', name: 'ArkLUG', myRole: 'manager', canCurate: true, collections: [{ ...summary({ id: 'k1', title: 'Show standards', audience: 'everyone', club: true }), status: 'public', reason: null, pending: false, curatorNote: null, pinned: false, curator: 'Ada' }] },
        { id: 'org2', slug: 'other', name: 'Other', myRole: 'member', canCurate: false, collections: [{ ...summary({ id: 'x1', title: 'Not mine' }), status: 'public', reason: null, pending: false, curatorNote: null, pinned: false, curator: 'Bo' }] },
      ],
    };
  });

  it('a catalog item: every collection you curate; adding shows a note with Open collection', async () => {
    routes['POST /api/catalog/collections/k1/items'] = { id: 'k1', status: 'public', pending: false, submitted: [] };
    let closed = false;
    show(
      <>
        <AddToCollectionDialog target={{ kind: 'catalog', item: item({ id: 'yard', title: 'Freight yard' }) }} onClose={() => (closed = true)} />
        <CollectionToastHost />
      </>,
    );
    const list = await screen.findByRole('list', { name: 'Your collections' });
    await within(list).findByText('Show standards');
    expect(within(list).getAllByRole('button').map((b) => b.getAttribute('aria-label'))).toEqual(['Add to My picks', 'Add to Show standards']);
    expect(screen.getByRole('button', { name: 'New ArkLUG collection with this' })).toBeTruthy();
    fireEvent.click(within(list).getByRole('button', { name: 'Add to Show standards' }));
    const toast = await screen.findByTestId('collection-toast');
    expect(toast.textContent).toContain('Added “Freight yard” to “Show standards”.');
    expect(within(toast).getByRole('link', { name: 'Open collection' }).getAttribute('href')).toBe('/catalog/collections/k1');
    expect(closed).toBe(true);
    const sent = calls.find((c) => c.method === 'POST' && c.path === '/api/catalog/collections/k1/items');
    expect(JSON.parse(sent!.body!)).toEqual({ itemId: 'yard' });
  });

  it('a club’s module: only that club’s collections, and it says when it waits for review', async () => {
    routes['POST /api/catalog/collections/k1/items'] = { id: 'k1', status: 'public', pending: false, submitted: ['cm'] };
    show(
      <>
        <AddToCollectionDialog
          target={{ kind: 'module', module: { id: 'cm', title: 'Show corner', ownerUserId: null, ownerOrgId: 'org1', thumbnailAt: null } }}
          onClose={() => undefined}
        />
        <CollectionToastHost />
      </>,
    );
    const list = await screen.findByRole('list', { name: 'Your collections' });
    expect(within(list).getAllByRole('button').map((b) => b.getAttribute('aria-label'))).toEqual(['Add to Show standards']);
    fireEvent.click(within(list).getByRole('button', { name: 'Add to Show standards' }));
    expect((await screen.findByTestId('collection-toast')).textContent).toContain('It shows publicly once it’s approved.');
    const sent = calls.find((c) => c.method === 'POST' && c.path === '/api/catalog/collections/k1/items');
    expect(JSON.parse(sent!.body!)).toEqual({ source: 'library', kind: 'module', id: 'cm' });
  });

  it('a club’s part where you only are a member: who to ask', async () => {
    show(
      <AddToCollectionDialog
        target={{ kind: 'part', part: { id: 'op', partNumber: 'O.1', displayName: 'Other sign', ownerUserId: null, ownerOrgId: 'org2' } }}
        onClose={() => undefined}
      />,
    );
    expect(await screen.findByText(/Only Other’s admins and managers put its parts in its collections/)).toBeTruthy();
  });
});

describe('club collections and Home', () => {
  it('a club’s members see its collections; its curators get New collection and each one’s status', async () => {
    routes['GET /api/catalog/collections/clubs'] = {
      clubs: [
        {
          id: 'org1',
          slug: 'arklug',
          name: 'ArkLUG',
          myRole: 'admin',
          canCurate: true,
          collections: [{ ...summary({ id: 'k1', title: 'Show standards', by: 'ArkLUG', audience: 'private', modules: 3, parts: 5, itemCount: 8 }), status: 'public', reason: null, pending: false, curatorNote: null, pinned: true, curator: 'Ada' }],
        },
      ],
    };
    show(<ClubCollectionsSection club="arklug" />);
    const card = await screen.findByTestId('club-collection-card');
    expect(card.textContent).toContain('Pinned');
    expect(card.textContent).toContain('Private');
    expect(within(card).getByTestId('collection-counts').textContent).toBe('3 modules · 5 parts · by ArkLUG');
    expect(within(card).getByTestId('collection-status').textContent).toBe('Private · only arklug members');
    expect(screen.getByRole('button', { name: 'New collection for ArkLUG' })).toBeTruthy();
    expect(calls.some((c) => c.path === '/api/catalog/collections/clubs?club=arklug')).toBe(true);
  });

  it('Home shows featured, your clubs’ and your own, with Browse all; nothing while the catalogs are off', async () => {
    routes['GET /api/catalog/settings'] = { modules: true, parts: false, review: 'moderators', anonymousBrowse: true, canModerate: false };
    routes['GET /api/catalog/collections'] = { collections: [summary({ id: 'f', title: 'Starter town', featured: true }), summary({ id: 'n', title: 'Not featured' })] };
    routes['GET /api/catalog/collections/clubs'] = {
      clubs: [{ id: 'org1', slug: 'arklug', name: 'ArkLUG', myRole: 'member', canCurate: false, collections: [{ ...summary({ id: 'k1', title: 'Show standards' }), status: 'public', reason: null, pending: false, curatorNote: null, pinned: false, curator: 'Ada' }] }],
    };
    routes['GET /api/catalog/collections/mine'] = { collections: [{ ...summary({ id: 'm1', title: 'My picks' }), status: 'public', reason: null, pending: false, curatorNote: null }] };
    show(<HomeCollections />);
    expect((await screen.findByTestId('home-featured-collection')).textContent).toContain('Starter town');
    expect(screen.queryByText('Not featured')).toBeNull();
    expect((await screen.findByTestId('home-club-collection')).textContent).toContain('Show standards');
    expect((await screen.findByTestId('home-my-collection')).textContent).toContain('My picks');
    expect(screen.getByRole('link', { name: 'Browse all' }).getAttribute('href')).toBe('/catalog');
    expect(screen.getByRole('button', { name: 'New collection' })).toBeTruthy();
    cleanup();
    routes['GET /api/catalog/settings'] = { modules: false, parts: false, review: 'moderators', anonymousBrowse: true, canModerate: false };
    show(<HomeCollections />);
    await waitFor(() => expect(calls.filter((c) => c.path === '/api/catalog/settings').length).toBeGreaterThan(1));
    expect(screen.queryByTestId('home-collections')).toBeNull();
  });
});

describe('live updates', () => {
  it('a catalog change refetches the collections, and Add all refetches your modules and parts', () => {
    const keys = keysFor({ kind: 'catalog' }).map((k) => k[0]);
    expect(keys).toEqual(expect.arrayContaining(['catalog-collections', 'catalog-collection', 'catalog-collections-mine', 'moderation-collections', 'club-collections']));
    // A module or part that's deleted, and joining or leaving a club, change collections too.
    for (const kind of ['module', 'custom-part', 'club'] as const) {
      expect(keysFor({ kind }).map((k) => k[0])).toEqual(expect.arrayContaining(['club-collections', 'catalog-collection', 'catalog-collections-mine']));
    }
    expect(hintsForWrite('POST', '/api/catalog/collections/x/items').map((h) => h.kind)).toEqual(['catalog']);
    expect(hintsForWrite('DELETE', '/api/catalog/collections/x').map((h) => h.kind)).toEqual(['catalog']);
    expect(hintsForWrite('POST', '/api/catalog/collections/x/add').map((h) => h.kind)).toEqual(['catalog', 'module', 'custom-part', 'layout', 'venue']);
    expect(hintsForWrite('PATCH', '/api/catalog/collections/x').map((h) => h.kind)).toEqual(['catalog']);
    expect(hintsForWrite('POST', '/api/moderation/collections/x/approve').map((h) => h.kind)).toEqual(['catalog']);
  });
});

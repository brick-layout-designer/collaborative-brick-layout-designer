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
import { addAllSummary, CollectionEditor, CollectionsSection, collectionStatus, moveItem, MyCollections } from '../Collections';
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
    show(<CollectionsSection />);
    const featured = await screen.findByRole('list', { name: 'Featured collections' });
    expect(within(featured).getByText('Starter town')).toBeTruthy();
    expect(within(screen.getByRole('list', { name: 'More collections' })).getByText('Bob’s yard')).toBeTruthy();
    expect(screen.getAllByTestId('collection-card').map((c) => c.textContent)).toEqual([
      expect.stringContaining('Starter town'),
      expect.stringContaining('Bob’s yard'),
    ]);
    expect(screen.getByRole('link', { name: /Starter town/ }).getAttribute('href')).toBe('/catalog/collections/f');
  });

  it('shows nothing when there are none', async () => {
    routes['GET /api/catalog/collections'] = { collections: [] };
    show(<CollectionsSection />);
    await waitFor(() => expect(calls.some((c) => c.path === '/api/catalog/collections')).toBe(true));
    expect(screen.queryByText('Collections')).toBeNull();
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
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }));
    expect((await screen.findByRole('status')).textContent).toContain('Sent for review');
    const sent = calls.find((c) => c.method === 'POST' && c.path === '/api/catalog/collections');
    expect(JSON.parse(sent!.body!)).toEqual({ title: 'Starter yard', description: '', itemIds: ['m2', 'm1'], coverItemId: 'm1' });
  });
});

describe('live updates', () => {
  it('a catalog change refetches the collections, and Add all refetches your modules and parts', () => {
    const keys = keysFor({ kind: 'catalog' }).map((k) => k[0]);
    expect(keys).toEqual(expect.arrayContaining(['catalog-collections', 'catalog-collection', 'catalog-collections-mine', 'moderation-collections']));
    expect(hintsForWrite('POST', '/api/catalog/collections/x/add').map((h) => h.kind)).toEqual(['catalog', 'module', 'custom-part']);
    expect(hintsForWrite('PATCH', '/api/catalog/collections/x').map((h) => h.kind)).toEqual(['catalog']);
    expect(hintsForWrite('POST', '/api/moderation/collections/x/approve').map((h) => h.kind)).toEqual(['catalog']);
  });
});

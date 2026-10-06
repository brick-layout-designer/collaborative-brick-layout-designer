// Deleting a club from the web: save and move things first, then a
// confirmation that says what happens, the public catalog choice and the
// typed name; and Clubs › Being deleted with Restore. Stubbed fetch.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import type { OrgDetail } from '../../api';
import { BeingDeletedSection, DeleteClubSection, type ClubDeletionSummary } from '../DeleteClub';

const ORG: OrgDetail = { id: 'o1', name: 'ArkLUG', slug: 'arklug', createdAt: 0, myRole: 'admin', description: '', membersCanCreate: true, memberCount: 2, adminCount: 1 };
const SUMMARY: ClubDeletionSummary = {
  name: 'ArkLUG',
  members: [
    { userId: 'u1', name: 'Sam', role: 'admin' },
    { userId: 'u2', name: 'Kim', role: 'member' },
  ],
  layouts: [{ id: 'l1', name: 'Show yard' }],
  modules: [{ id: 'm1', name: 'Shed' }],
  parts: [],
  venues: [],
  clubCollections: [{ id: 'c1', name: 'Members only' }],
  publicItems: [{ id: 'i1', name: 'Crossing' }],
  publicCollections: [],
  graceDays: 14,
};

let calls: { method: string; path: string; body: unknown }[] = [];
function stub(extra: (method: string, path: string) => unknown = () => undefined) {
  calls = [];
  vi.stubGlobal('fetch', async (input: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    calls.push({ method, path: input, body: init?.body ? JSON.parse(init.body as string) : undefined });
    const body =
      extra(method, input) ??
      (input.endsWith('/deletion')
        ? SUMMARY
        : input.endsWith('/exports')
          ? method === 'POST'
            ? { export: { id: 'e1', status: 'building' } }
            : { exports: [], nextAllowedAt: null }
          : input === '/api/orgs'
            ? { orgs: [{ id: 'o1', name: 'ArkLUG', slug: 'arklug', myRole: 'admin', createdAt: 0 }, { id: 'o2', name: 'Other', slug: 'other', myRole: 'member', createdAt: 0 }] }
            : input.endsWith('/move-all')
              ? { ok: true, moved: 1 }
              : method === 'DELETE'
                ? { ok: true, dueAt: 1_900_000_000_000 }
                : { ok: true });
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  });
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function show(ui: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
}

const writes = () => calls.filter((c) => c.method !== 'GET');

describe('Delete the club', () => {
  it('offers saving and moving things first', async () => {
    stub();
    show(<DeleteClubSection org={ORG} myUserId="u1" />);
    fireEvent.click(screen.getByRole('button', { name: 'Delete the club…' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Download the club’s data' }));
    await waitFor(() => expect(writes()[0]).toMatchObject({ method: 'POST', path: '/api/orgs/arklug/exports' }));
    fireEvent.change(screen.getByLabelText('Move them to'), { target: { value: 'user:u2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Move all 1 layout' }));
    await waitFor(() => expect(writes()[1]).toEqual({ method: 'POST', path: '/api/orgs/arklug/move-all', body: { kind: 'layouts', toUserId: 'u2' } }));
    fireEvent.change(screen.getByLabelText('Move them to'), { target: { value: 'org:other' } });
    fireEvent.click(screen.getByRole('button', { name: 'Move all 1 module' }));
    await waitFor(() => expect(writes()[2]).toEqual({ method: 'POST', path: '/api/orgs/arklug/move-all', body: { kind: 'modules', toOrgSlug: 'other' } }));
  });

  it('says exactly what happens, asks about the public catalog, and needs the name typed', async () => {
    stub();
    show(<DeleteClubSection org={ORG} myUserId="u1" />);
    fireEvent.click(screen.getByRole('button', { name: 'Delete the club…' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Continue to delete…' }));
    const c = screen.getByTestId('delete-club-confirm');
    expect(c.textContent).toContain('hidden straight away from all 2 members');
    expect(c.textContent).toContain('14 days');
    expect(c.textContent).toContain('any other admin of the club, or a site admin can restore it');
    expect(c.textContent).toContain('1 layout (“Show yard”)');
    expect(c.textContent).toContain('1 members-only collection (“Members only”)');
    expect(c.textContent).toContain('1 item (“Crossing”)');
    expect(c.textContent).toContain('Copies people already added to their own things are theirs, and stay either way.');
    // Hand them to Kim.
    fireEvent.change(screen.getByLabelText('Member who looks after them'), { target: { value: 'u2' } });
    const del = screen.getByRole('button', { name: 'Delete the club' }) as HTMLButtonElement;
    expect(del.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Type the club’s name to confirm'), { target: { value: 'arklug' } });
    expect(del.disabled).toBe(false);
    fireEvent.click(del);
    await waitFor(() => expect(writes().find((w) => w.method === 'DELETE')).toEqual({ method: 'DELETE', path: '/api/orgs/arklug', body: { confirm: 'arklug', catalog: 'hand', heirUserId: 'u2' } }));
  });

  it('can take the public items down instead', async () => {
    stub();
    show(<DeleteClubSection org={ORG} myUserId="u1" />);
    fireEvent.click(screen.getByRole('button', { name: 'Delete the club…' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Continue to delete…' }));
    fireEvent.click(screen.getByLabelText('Take them down.'));
    fireEvent.change(screen.getByLabelText('Type the club’s name to confirm'), { target: { value: 'ArkLUG' } });
    fireEvent.click(screen.getByRole('button', { name: 'Delete the club' }));
    await waitFor(() => expect(writes().find((w) => w.method === 'DELETE')!.body).toEqual({ confirm: 'ArkLUG', catalog: 'takedown', heirUserId: null }));
  });
});

describe('Clubs › Being deleted', () => {
  it('lists clubs being deleted; admins restore with one click, members are told who can', async () => {
    stub((method, path) =>
      path === '/api/orgs/deleting'
        ? {
            clubs: [
              { id: 'o1', name: 'ArkLUG', slug: 'arklug', deletionRequestedAt: 0, deletionDueAt: 1_900_000_000_000, canRestore: true },
              { id: 'o2', name: 'Other', slug: 'other', deletionRequestedAt: 0, deletionDueAt: 1_900_000_000_000, canRestore: false },
            ],
          }
        : undefined,
    );
    show(<BeingDeletedSection />);
    expect((await screen.findByTestId('being-deleted')).textContent).toContain('Ask one of its admins to restore it.');
    fireEvent.click(screen.getByRole('button', { name: 'Restore' }));
    await waitFor(() => expect(writes()[0]).toMatchObject({ method: 'POST', path: '/api/orgs/arklug/restore' }));
  });
});

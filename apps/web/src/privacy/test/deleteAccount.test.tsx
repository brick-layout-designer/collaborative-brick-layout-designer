// Profile › Delete my account: the plain-words plan, the guided step for a
// last club admin, and the typed confirmation. Stubbed fetch.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import { DeletePlan, DeletingNotice, type DeletionSummary } from '../DeleteAccount';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function wrap(ui: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
}

const SUMMARY: DeletionSummary = {
  ownedAlone: {
    layouts: [{ id: 'l1', name: 'Main yard' }],
    modules: [],
    parts: [],
    venues: [],
    collections: [],
    catalogItems: [{ id: 'c1', name: 'Crossing' }],
  },
  madeForClubs: 3,
  sharedWithThem: 2,
  clubs: [],
  blockers: [],
  graceDays: 14,
  pending: null,
  erasedAs: 'Deleted user #abc123',
};

function stub(summary: DeletionSummary, onPost?: (body: unknown) => Response | object) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        const out = onPost?.(JSON.parse(String(init.body))) ?? { ok: true, dueAt: 1_900_000_000_000 };
        return out instanceof Response ? out : new Response(JSON.stringify(out), { status: 202 });
      }
      return new Response(JSON.stringify(summary), { status: 200 });
    }),
  );
}

describe('Delete my account', () => {
  it('says what goes, what stays and how long it waits', async () => {
    stub(SUMMARY);
    wrap(<DeletePlan email="ann@example.com" name="Ann" onCancel={() => {}} />);
    const plan = await screen.findByTestId('delete-plan');
    expect(plan.textContent).toContain('1 layout');
    expect(plan.textContent).toContain('“Main yard”');
    expect(plan.textContent).toContain('1 public catalog item');
    expect(plan.textContent).toContain('Copies people already added from the catalog are theirs');
    expect(plan.textContent).toContain('3 things you made for your clubs stay with the club, credited to “Builder #abc123”');
    expect(plan.textContent).toContain('2 layouts, modules and parts other people shared with you');
    expect(plan.textContent).toContain('as “Deleted user #abc123”');
    expect(plan.textContent).toContain('14 days');
  });

  it('turns Delete on only once the email or name is typed, then goes to sign-in', async () => {
    let sent: unknown = null;
    stub(SUMMARY, (b) => {
      sent = b;
      return { ok: true, dueAt: 1_900_000_000_000 };
    });
    const assign = vi.fn();
    vi.stubGlobal('location', { ...window.location, assign });
    wrap(<DeletePlan email="ann@example.com" name="Ann" onCancel={() => {}} />);
    const del = (await screen.findByRole('button', { name: 'Delete my account' })) as HTMLButtonElement;
    expect(del.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Type your email or name to confirm'), { target: { value: 'someone@else' } });
    expect(del.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Type your email or name to confirm'), { target: { value: ' ann ' } });
    expect(del.disabled).toBe(false);
    fireEvent.click(del);
    await waitFor(() => expect(assign).toHaveBeenCalledWith('/login?deleting=1900000000000'));
    expect(sent).toEqual({ confirm: ' ann ' });
  });

  it('a last club admin gets a guided step, not a dead end', async () => {
    stub({
      ...SUMMARY,
      clubs: [{ id: 'o1', name: 'Train Club', slug: 'train-club', role: 'admin', onlyMember: false, lastAdmin: true }],
      blockers: [{ kind: 'last_club_admin', text: "You're the only admin of Train Club. Hand it over first.", club: { name: 'Train Club', slug: 'train-club' } }],
    });
    wrap(<DeletePlan email="ann@example.com" name="Ann" onCancel={() => {}} />);
    const link = await screen.findByRole('link', { name: 'Hand over Train Club' });
    expect(link.getAttribute('href')).toBe('/orgs/train-club/admin?tab=settings#hand-over');
    expect(screen.queryByRole('button', { name: 'Delete my account' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Keep my account' })).toBeTruthy();
  });

  it('the sign-in page says when it goes and how to keep it', () => {
    render(<DeletingNotice dueAt={1_900_000_000_000} />);
    expect(screen.getByTestId('deleting-notice').textContent).toContain('Sign in before then and everything is kept');
  });
});

// Admin › Privacy requests, the dashboard card, the privacy page and its
// markdown, against a stubbed fetch.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import { PrivacyDashboardCard, PrivacyRequestsTab, type PrivacyRequest } from '../PrivacyRequests';
import { PrivacyPage } from '../PrivacyPage';
import { Markdown, safeHref } from '../Markdown';
import { settingsMenuGroups } from '../../SettingsMenu';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function wrap(ui: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
}

function stub(handler: (url: string, init?: RequestInit) => unknown) {
  const calls: { url: string; method: string; body: unknown }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, method: init?.method ?? 'GET', body: init?.body ? JSON.parse(String(init.body)) : undefined });
      return new Response(JSON.stringify(handler(url, init)), { status: 200 });
    }),
  );
  return calls;
}

const DAY = 86_400_000;
const REQ = (over: Partial<PrivacyRequest>): PrivacyRequest => ({
  id: 'r1',
  type: 'access',
  subjectUserId: 'u1',
  subjectText: null,
  subject: { id: 'u1', email: 'ann@example.com', displayName: 'Ann', restrictedAt: null, deletionDueAt: null, isGlobalAdmin: false },
  receivedVia: 'email',
  receivedAt: Date.now() - 40 * DAY,
  dueAt: Date.now() - 10 * DAY,
  due: 'overdue',
  status: 'open',
  notes: '',
  closedAt: null,
  ...over,
});

describe('Admin › Privacy requests', () => {
  it('lists open requests soonest first, with Overdue and Due soon badges', async () => {
    stub(() => ({
      requests: [REQ({}), REQ({ id: 'r2', type: 'erasure', due: 'soon', dueAt: Date.now() + 3 * DAY, subject: null, subjectUserId: null, subjectText: 'Sam, by letter' })],
      summary: { open: 2, overdue: 1, dueSoon: 1, noticeMissing: false, contactMissing: false },
    }));
    wrap(<PrivacyRequestsTab />);
    const rows = await screen.findAllByTestId('privacy-request-row');
    expect(rows).toHaveLength(2);
    expect(rows[0]!.textContent).toContain('Overdue');
    expect(rows[0]!.textContent).toContain('Ann (ann@example.com)');
    expect(rows[1]!.textContent).toContain('Due soon');
    expect(rows[1]!.textContent).toContain('Sam, by letter');
  });

  it('logs a request from someone with no account', async () => {
    const calls = stub((url, init) => {
      if (init?.method === 'POST') return { request: REQ({ id: 'new', subject: null, subjectUserId: null, subjectText: 'Sam' }) };
      if (url.startsWith('/api/admin/privacy/requests/new')) return { request: REQ({ id: 'new' }), history: [], exports: [] };
      return { requests: [], summary: { open: 0, overdue: 0, dueSoon: 0, noticeMissing: false, contactMissing: false } };
    });
    wrap(<PrivacyRequestsTab />);
    fireEvent.click(await screen.findByRole('button', { name: 'Log a request' }));
    const submit = screen.getByRole('button', { name: 'Log it' }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Who asked, if they have no account'), { target: { value: 'Sam (sam@example.org)' } });
    fireEvent.change(screen.getByLabelText('What they ask'), { target: { value: 'objection' } });
    fireEvent.click(submit);
    await waitFor(() => expect(calls.some((c) => c.method === 'POST')).toBe(true));
    const post = calls.find((c) => c.method === 'POST')!;
    expect(post.body).toMatchObject({ type: 'objection', receivedVia: 'email', subjectText: 'Sam (sam@example.org)' });
    expect(await screen.findByTestId('privacy-request-detail')).toBeTruthy();
  });

  it('the dashboard card counts what is due and nudges for a notice', async () => {
    stub(() => ({ open: 3, overdue: 1, dueSoon: 2, noticeMissing: true, contactMissing: false }));
    wrap(<PrivacyDashboardCard />);
    const card = await screen.findByTestId('privacy-dashboard-card');
    expect(card.textContent).toContain('1 overdue');
    expect(card.textContent).toContain('2 due within a week');
    expect(card.textContent).toContain('add a privacy notice');
  });

  it('the Admin menu badges privacy requests that are due', () => {
    const groups = settingsMenuGroups({ isGlobalAdmin: true, isModerator: false, isDemoAccount: false }, { installOffered: false, waitingReviews: 0, privacyDue: 3 });
    const entry = groups.find((g) => g.id === 'admin')!.entries.find((e) => e.label === 'Privacy requests')!;
    expect(entry.badge).toBe(3);
    expect(entry.badgeLabel).toContain('3 privacy requests');
  });
});

describe('the privacy page', () => {
  it('shows the notice and contact, and what anyone can do themselves', async () => {
    stub(() => ({ notice: '# Who we are\n\nRun by the **Train Club**.\n\n- your email\n- your layouts', contact: 'privacy@club.example' }));
    wrap(<PrivacyPage />);
    const notice = await screen.findByTestId('privacy-notice');
    expect(notice.querySelector('h2')!.textContent).toBe('Who we are');
    expect(notice.querySelector('strong')!.textContent).toBe('Train Club');
    expect(notice.querySelectorAll('li')).toHaveLength(2);
    expect(screen.getByTestId('privacy-contact').querySelector('a')!.getAttribute('href')).toBe('mailto:privacy@club.example');
    expect(screen.getByRole('link', { name: 'Download your data' }).getAttribute('href')).toBe('/profile#my-data');
  });

  it('says so when there is no notice yet', async () => {
    stub(() => ({ notice: null, contact: null }));
    wrap(<PrivacyPage />);
    expect(await screen.findByText(/haven’t written their privacy notice yet/)).toBeTruthy();
  });
});

describe('Markdown', () => {
  it('only links to safe places', () => {
    expect(safeHref('javascript:alert(1)')).toBeNull();
    expect(safeHref('//evil.example')).toBeNull();
    expect(safeHref('/profile')).toBe('/profile');
    expect(safeHref('mailto:a@b.c')).toBe('mailto:a@b.c');
    expect(safeHref('https://club.example/p')).toBe('https://club.example/p');
    render(<Markdown source={'[bad](javascript:alert(1)) and [good](https://club.example) <b>x</b>'} />);
    expect(screen.queryByRole('link', { name: 'bad' })).toBeNull();
    expect(screen.getByRole('link', { name: 'good' }).getAttribute('href')).toBe('https://club.example/');
    // Raw HTML stays text.
    expect(document.querySelector('b')).toBeNull();
  });
});

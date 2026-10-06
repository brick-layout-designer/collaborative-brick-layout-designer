// @vitest-environment jsdom
// What someone who got a warning sees (a banner until "I understand", and
// the Notices page), the form senders use, and who a club member may warn.
// The API is a stubbed fetch.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { WarningSummary } from '../../api';
import { NoticeBanner, NoticesPage, WarnForm } from '../Notices';
import { mayWarn, MembersSection } from '../../orgs/ClubManage';

const base: WarningSummary = {
  id: 'w1',
  scope: 'site',
  severity: 'warning',
  reason: 'Please stop posting spam',
  link: '/catalog',
  createdAt: 1000,
  acknowledgedAt: null,
  issuedBy: null,
  club: null,
  to: { kind: 'user', id: 'u1', name: 'Me' },
};

let notices: WarningSummary[];
let calls: { method: string; path: string; body?: string | undefined }[];

beforeEach(() => {
  calls = [];
  notices = [];
  vi.stubGlobal('fetch', async (input: string, init?: RequestInit) => {
    calls.push({ method: init?.method ?? 'GET', path: input, body: init?.body as string | undefined });
    let body: unknown = { ok: true };
    if (input === '/api/auth/me') body = { user: { id: 'u1', email: 'me@x.com', displayName: 'Me' } };
    if (input === '/api/notices') body = { notices };
    if (input.endsWith('/acknowledge')) {
      notices = notices.map((n) => (input.includes(n.id) ? { ...n, acknowledgedAt: 2000 } : n));
      body = { ok: true, acknowledgedAt: 2000 };
    }
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function show(ui: React.ReactNode, at = '/') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[at]}>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
  return qc;
}

describe('NoticeBanner', () => {
  it('shows the newest unread warning until "I understand"', async () => {
    notices = [
      { ...base, id: 'w2', severity: 'final', reason: 'Last chance', scope: 'club', club: { id: 'o1', name: 'Train Club', slug: 'train' } },
      base,
    ];
    const qc = show(<NoticeBanner />);
    const banner = await screen.findByTestId('notice-banner');
    expect((banner).textContent).toContain('Final warning · From Train Club');
    expect((banner).textContent).toContain('(1 of 2)');
    expect((banner).textContent).toContain('Last chance');
    fireEvent.click(screen.getByRole('button', { name: 'I understand' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.path === '/api/notices/w2/acknowledge')).toBe(true));
    // The write refetches the notices (live/invalidate.ts); then the next one shows.
    await qc.invalidateQueries({ queryKey: ['notices'] });
    await waitFor(() => expect((screen.getByTestId('notice-banner')).textContent).toContain('Please stop posting spam'));
    expect(screen.getByRole('link', { name: "See what it's about" }).getAttribute('href')).toBe('/catalog');
  });

  it('shows nothing when everything was read', async () => {
    notices = [{ ...base, acknowledgedAt: 5 }];
    show(<NoticeBanner />);
    await waitFor(() => expect(calls.some((c) => c.path === '/api/notices')).toBe(true));
    expect(screen.queryByTestId('notice-banner')).toBeNull();
  });

  it('stays off the Notices page, which lists them with their own I understand', async () => {
    notices = [base];
    show(<NoticeBanner />, '/notices');
    await waitFor(() => expect(calls.some((c) => c.path === '/api/notices')).toBe(true));
    expect(screen.queryByTestId('notice-banner')).toBeNull();
  });

  it("a warning to a club says it's to your club", async () => {
    notices = [{ ...base, to: { kind: 'org', id: 'o1', name: 'Train Club', slug: 'train' } }];
    show(<NoticeBanner />);
    expect((await screen.findByTestId('notice-banner')).textContent).toContain('To your club Train Club');
  });
});

describe('NoticesPage', () => {
  it('lists every notice, read or not', async () => {
    notices = [base, { ...base, id: 'w0', severity: 'note', reason: 'Old note', acknowledgedAt: 3 }];
    show(<NoticesPage />);
    const rows = await screen.findAllByTestId('notice-row');
    expect(rows).toHaveLength(2);
    expect(rows[0]!.textContent).toContain('Warning · From the site team');
    expect(rows[1]!.textContent).toContain('Note');
    expect(rows[1]!.textContent).toContain('Read');
    expect(screen.getAllByRole('button', { name: 'I understand' })).toHaveLength(1);
  });
});

describe('WarnForm', () => {
  it('sends the severity, the reason and the link', async () => {
    const onSend = vi.fn(async () => ({ id: 'x' }));
    show(<WarnForm label="Warn Ann" onSend={onSend} />);
    fireEvent.click(screen.getByLabelText('Final warning'));
    fireEvent.change(screen.getByLabelText(/Reason/), { target: { value: '  Rude comments  ' } });
    fireEvent.change(screen.getByLabelText(/Link to what/), { target: { value: '/editor/abc' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send final warning' }));
    await waitFor(() => expect(onSend).toHaveBeenCalledWith({ severity: 'final', reason: 'Rude comments', link: '/editor/abc' }));
    expect(await screen.findByText('Sent.')).toBeTruthy();
  });

  it("won't send without a reason", () => {
    show(<WarnForm label="Warn Ann" onSend={vi.fn()} />);
    expect((screen.getByRole('button', { name: /Send/ }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('who a club member may warn', () => {
  it('managers warn members; admins warn managers too; nobody warns an admin', () => {
    expect(mayWarn('manager', 'member')).toBe(true);
    expect(mayWarn('manager', 'manager')).toBe(false);
    expect(mayWarn('admin', 'manager')).toBe(true);
    expect(mayWarn('admin', 'admin')).toBe(false);
    expect(mayWarn('member', 'member')).toBe(false);
  });

  it('the Members list offers Warn only where allowed', () => {
    const m = (userId: string, role: 'admin' | 'manager' | 'member') => ({ userId, role, displayName: userId, email: `${userId}@x.com`, avatarUrl: null, joinedAt: 0 });
    show(<MembersSection slug="train" myUserId="bob" myRole="manager" members={[m('ann', 'admin'), m('bob', 'manager'), m('cat', 'member'), m('dee', 'manager')]} />);
    expect(screen.getAllByRole('button', { name: 'Warn' })).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Warn' }));
    expect(screen.getByRole('form', { name: 'Warn cat' })).toBeTruthy();
  });
});

// @vitest-environment jsdom
// Sharing a custom part with people on the web, by invite link like a
// module: the owner invites by email and gets the link, sees the invite
// waiting and can cancel it (asked first); someone it's shared with sees
// who has it and can leave; the invite page accepts for the invited
// account and opens the parts, and says when the account is the wrong one.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';
import { api, type InviteSummary } from '../../api';
import { PartShareDialog } from '../../modules/ModuleShareDialog';
import { PartInvitePage } from '../../auth/PartInvitePage';
import { autoConfirm } from '../../test/confirmHost';

function wrap(node: ReactNode, path = '/') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>{node}</MemoryRouter>
    </QueryClientProvider>,
  );
}

const ME = (email: string) => ({ user: { id: 'u1', email, displayName: 'Me', isDemoAccount: false } }) as unknown as Awaited<ReturnType<typeof api.me>>;
const PART = { id: 'p1', partNumber: 'SIG.1', displayName: 'Signal tower' };

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('Share with people (custom part)', () => {
  it('the owner invites by email, sees the link and the waiting invite, and can cancel it', async () => {
    vi.spyOn(api, 'me').mockResolvedValue(ME('owner@example.com'));
    let invites: InviteSummary[] = [];
    vi.spyOn(api.customParts, 'collaborators').mockImplementation(async () => ({ collaborators: [], invites }));
    const invite = vi.spyOn(api.customParts, 'invite').mockImplementation(async () => {
      invites = [{ id: 'i1', invitedEmail: 'bob@example.com', role: 'editor', expiresAt: Date.now() + 86_400_000 }];
      return { id: 'i1', token: 't', inviteUrl: 'https://example.test/part-invite/t', emailDelivered: false, expiresAt: 0 };
    });
    const revoke = vi.spyOn(api.customParts, 'revokeInvite').mockImplementation(async () => {
      invites = [];
      return { ok: true } as never;
    });

    wrap(<PartShareDialog part={{ ...PART, role: 'owner' }} myUserId="u1" onClose={() => {}} />);
    expect(screen.getByRole('heading', { name: 'Share “Signal tower”' })).toBeTruthy();
    expect(await screen.findByText('Not shared with anyone yet.')).toBeTruthy();
    expect(screen.getByText(/have the part once they accept/)).toBeTruthy();
    fireEvent.change(screen.getByPlaceholderText('alice@example.com'), { target: { value: 'bob@example.com' } });
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'editor' } });
    fireEvent.click(screen.getByRole('button', { name: 'Invite' }));
    await waitFor(() => expect(invite).toHaveBeenCalledWith('p1', 'bob@example.com', 'editor'));
    expect((await screen.findByRole('status')).textContent).toContain('https://example.test/part-invite/t');
    expect(screen.getByRole('button', { name: /Copy link/ })).toBeTruthy();
    const waiting = await screen.findByTestId('part-invites');
    expect(waiting.textContent).toContain('bob@example.com');

    const asked = autoConfirm(true);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel invite' }));
    await waitFor(() => expect(revoke).toHaveBeenCalledWith('p1', 'i1'));
    expect(asked.titles).toEqual(['Cancel the invite for bob@example.com?']);
    await waitFor(() => expect(screen.queryByTestId('part-invites')).toBeNull());
  });

  it('an invite past its date says it has expired, not when it expires', async () => {
    vi.spyOn(api, 'me').mockResolvedValue(ME('owner@example.com'));
    vi.spyOn(api.customParts, 'collaborators').mockResolvedValue({
      collaborators: [],
      invites: [
        { id: 'i1', invitedEmail: 'old@example.com', role: 'viewer', expiresAt: Date.now() - 86_400_000 },
        { id: 'i2', invitedEmail: 'new@example.com', role: 'editor', expiresAt: Date.now() + 3 * 86_400_000 },
      ],
    });
    wrap(<PartShareDialog part={{ ...PART, role: 'owner' }} myUserId="u1" onClose={() => {}} />);
    const waiting = await screen.findByTestId('part-invites');
    const rows = [...waiting.querySelectorAll('li')].map((li) => li.textContent ?? '');
    expect(rows[0]).toContain('viewer · expired: invite them again for a new link');
    expect(rows[0]).not.toContain('expires');
    expect(rows[1]).toContain('editor · expires');
  });

  it('a set says which of your parts come along, and a part says who has it with a set', async () => {
    vi.spyOn(api, 'me').mockResolvedValue(ME('owner@example.com'));
    vi.spyOn(api.customParts, 'collaborators').mockResolvedValue({
      collaborators: [],
      invites: [],
      setParts: [
        { id: 'p2', partNumber: 'SHED', displayName: 'Engine shed' },
        { id: 'p3', partNumber: 'TOWER', displayName: 'TOWER' },
      ],
    });
    wrap(<PartShareDialog part={{ id: 's1', partNumber: 'Yard', displayName: 'Yard', role: 'owner' }} myUserId="u1" onClose={() => {}} />);
    const along = await screen.findByTestId('set-parts-come-along');
    expect(along.textContent).toContain('These 2 custom parts of yours come along with the set');
    expect(along.textContent).toContain('Engine shed (SHED)');
    expect(along.textContent).toContain('Taking the set back takes them back too');
    cleanup();

    vi.spyOn(api.customParts, 'collaborators').mockResolvedValue({
      collaborators: [{ userId: 'u2', role: 'viewer', addedAt: 0, email: 'bob@example.com', displayName: 'Bob', avatarUrl: null, viaSets: ['Yard'] }],
      invites: [],
    });
    wrap(<PartShareDialog part={{ id: 'p2', partNumber: 'SHED', displayName: 'Engine shed', role: 'owner' }} myUserId="u1" onClose={() => {}} />);
    expect((await screen.findByTestId('part-people')).textContent).toContain('With the set “Yard”');
    expect(screen.queryByTestId('set-parts-come-along')).toBeNull();
  });

  it('someone it’s shared with sees who has it, can’t invite, and can leave', async () => {
    vi.spyOn(api, 'me').mockResolvedValue(ME('bob@example.com'));
    vi.spyOn(api.customParts, 'collaborators').mockResolvedValue({
      collaborators: [{ userId: 'u1', role: 'viewer', addedAt: 0, email: 'bob@example.com', displayName: 'Bob', avatarUrl: null }],
    });
    const leave = vi.spyOn(api.customParts, 'removeCollaborator').mockResolvedValue({ ok: true } as never);
    const onClose = vi.fn();
    wrap(<PartShareDialog part={{ ...PART, role: 'viewer' }} myUserId="u1" onClose={onClose} />);
    expect((await screen.findByTestId('part-people')).textContent).toContain('Bob (you)');
    expect(screen.queryByRole('button', { name: 'Invite' })).toBeNull();
    const asked = autoConfirm(true);
    fireEvent.click(screen.getByRole('button', { name: 'Leave' }));
    await waitFor(() => expect(leave).toHaveBeenCalledWith('p1', 'u1'));
    expect(asked.titles).toEqual(['Leave this part?']);
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });
});

function Where() {
  const l = useLocation();
  return <p data-testid="where">{l.pathname + l.hash}</p>;
}

describe('part invite page', () => {
  const page = (
    <>
      <Routes>
        <Route path="/part-invite/:token" element={<PartInvitePage />} />
        <Route path="/" element={<p>home page</p>} />
      </Routes>
      <Where />
    </>
  );
  const preview = { invitedEmail: 'bob@example.com', forYou: true, role: 'viewer' as const, partId: 'p1', partNumber: 'SIG.1', partName: 'Signal tower', expiresAt: 0 };

  it('signed in as the invited person: accepts and opens the parts', async () => {
    vi.spyOn(api, 'me').mockResolvedValue(ME('Bob@example.com'));
    vi.spyOn(api.partInvites, 'preview').mockResolvedValue(preview);
    const accept = vi.spyOn(api.partInvites, 'accept').mockResolvedValue({ partId: 'p1', role: 'viewer' });
    wrap(page, '/part-invite/tok');
    await waitFor(() => expect(accept).toHaveBeenCalledWith('tok'));
    expect(await screen.findByText('home page', {}, { timeout: 3000 })).toBeTruthy();
    expect(screen.getByTestId('where').textContent).toBe('/#parts');
  });

  it('a set: lists the parts that come with it, and says they came', async () => {
    vi.spyOn(api, 'me').mockResolvedValue(ME('bob@example.com'));
    vi.spyOn(api.partInvites, 'preview').mockResolvedValue({
      ...preview,
      forYou: false,
      partName: 'Yard',
      setParts: [
        { partNumber: 'SHED', displayName: 'Engine shed' },
        { partNumber: 'TOWER', displayName: 'TOWER' },
      ],
    });
    wrap(page, '/part-invite/tok');
    const parts = await screen.findByTestId('invite-set-parts');
    expect(parts.textContent).toContain('these 2 parts of theirs come with it');
    expect(parts.textContent).toContain('Engine shed (SHED)');
    expect(parts.textContent).toContain('TOWER');
    cleanup();

    vi.spyOn(api.partInvites, 'preview').mockResolvedValue({ ...preview, setParts: [{ partNumber: 'SHED', displayName: 'Engine shed' }] });
    const accept = vi.spyOn(api.partInvites, 'accept').mockResolvedValue({ partId: 'p1', role: 'viewer', setParts: [{ id: 'p2', partNumber: 'SHED' }] });
    wrap(page, '/part-invite/tok');
    await waitFor(() => expect(accept).toHaveBeenCalledWith('tok'));
    expect(await screen.findByText('You have the set and its part! Opening your parts…')).toBeTruthy();
  });

  it('signed in as someone else: says so, shows only the masked address, and doesn’t accept', async () => {
    vi.spyOn(api, 'me').mockResolvedValue(ME('eve@example.com'));
    vi.spyOn(api.partInvites, 'preview').mockResolvedValue({ ...preview, invitedEmail: 'b…@example.com', forYou: false });
    const accept = vi.spyOn(api.partInvites, 'accept');
    wrap(page, '/part-invite/tok');
    expect(await screen.findByText('This invite is for a different account.')).toBeTruthy();
    expect(screen.getByText(/the custom part/).textContent).toContain('Signal tower');
    expect(document.body.textContent).not.toContain('bob@example.com');
    expect(accept).not.toHaveBeenCalled();
  });

  it('signed out: asks to sign in with the invited address and comes back here', async () => {
    vi.spyOn(api, 'me').mockResolvedValue({ user: null } as never);
    vi.spyOn(api.partInvites, 'preview').mockResolvedValue({ ...preview, invitedEmail: 'b…@example.com', forYou: null });
    wrap(page, '/part-invite/tok');
    const link = await screen.findByRole('link', { name: 'Sign in' });
    expect(link.getAttribute('href')).toBe(`/login?next=${encodeURIComponent('/part-invite/tok')}`);
  });

  it('an invite that no longer holds says why', async () => {
    vi.spyOn(api, 'me').mockResolvedValue({ user: null } as never);
    vi.spyOn(api.partInvites, 'preview').mockRejectedValue(new Error('This invite no longer works: the part changed hands.'));
    wrap(page, '/part-invite/tok');
    expect(await screen.findByText("This invite isn't valid.")).toBeTruthy();
    expect(screen.getByText(/the part changed hands/)).toBeTruthy();
  });
});

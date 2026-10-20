// @vitest-environment jsdom
// Sharing a module with people on the web: the owner invites by email and
// gets the link, sees the invite waiting and can cancel it (asked first);
// someone it's shared with sees who has it and can leave; the invite page
// accepts for the invited account and opens the module, and says when the
// account is the wrong one.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { ReactNode } from 'react';
import { api, type InviteSummary } from '../../api';
import { ModuleShareDialog } from '../ModuleShareDialog';
import { ModuleInvitePage } from '../../auth/ModuleInvitePage';
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

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('Share with people (module)', () => {
  it('the owner invites by email, sees the link and the waiting invite, and can cancel it', async () => {
    vi.spyOn(api, 'me').mockResolvedValue(ME('owner@example.com'));
    let invites: InviteSummary[] = [];
    vi.spyOn(api.modules, 'collaborators').mockImplementation(async () => ({ collaborators: [], invites }));
    const invite = vi.spyOn(api.modules, 'invite').mockImplementation(async () => {
      invites = [{ id: 'i1', invitedEmail: 'bob@example.com', role: 'editor', expiresAt: Date.now() + 86_400_000 }];
      return { id: 'i1', token: 't', inviteUrl: 'https://example.test/module-invite/t', emailDelivered: false, expiresAt: 0 };
    });
    const revoke = vi.spyOn(api.modules, 'revokeInvite').mockImplementation(async () => {
      invites = [];
      return { ok: true } as never;
    });

    wrap(<ModuleShareDialog module={{ id: 'm1', title: 'Turntable' }} myUserId="u1" onClose={() => {}} />);
    expect(await screen.findByText('Not shared with anyone yet.')).toBeTruthy();
    fireEvent.change(screen.getByPlaceholderText('alice@example.com'), { target: { value: 'bob@example.com' } });
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'editor' } });
    fireEvent.click(screen.getByRole('button', { name: 'Invite' }));
    await waitFor(() => expect(invite).toHaveBeenCalledWith('m1', 'bob@example.com', 'editor'));
    expect((await screen.findByRole('status')).textContent).toContain('https://example.test/module-invite/t');
    expect(screen.getByRole('status').textContent).toContain('send them the link yourself');
    const waiting = await screen.findByTestId('module-invites');
    expect(waiting.textContent).toContain('bob@example.com');

    const asked = autoConfirm(true);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel invite' }));
    await waitFor(() => expect(revoke).toHaveBeenCalledWith('m1', 'i1'));
    expect(asked.titles).toEqual(['Cancel the invite for bob@example.com?']);
    await waitFor(() => expect(screen.queryByTestId('module-invites')).toBeNull());
  });

  it('someone it’s shared with sees who has it, can’t invite, and can leave', async () => {
    vi.spyOn(api, 'me').mockResolvedValue(ME('bob@example.com'));
    vi.spyOn(api.modules, 'collaborators').mockResolvedValue({
      collaborators: [{ userId: 'u1', role: 'viewer', addedAt: 0, email: 'bob@example.com', displayName: 'Bob', avatarUrl: null }],
    });
    const leave = vi.spyOn(api.modules, 'removeCollaborator').mockResolvedValue({ ok: true } as never);
    const onClose = vi.fn();
    wrap(<ModuleShareDialog module={{ id: 'm1', title: 'Turntable', role: 'viewer' }} myUserId="u1" onClose={onClose} />);
    expect((await screen.findByTestId('module-people')).textContent).toContain('Bob (you)');
    expect(screen.queryByRole('button', { name: 'Invite' })).toBeNull();
    autoConfirm(true);
    fireEvent.click(screen.getByRole('button', { name: 'Leave' }));
    await waitFor(() => expect(leave).toHaveBeenCalledWith('m1', 'u1'));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });
});

describe('module invite page', () => {
  const page = (
    <Routes>
      <Route path="/module-invite/:token" element={<ModuleInvitePage />} />
      <Route path="/modules/:id" element={<p>module page</p>} />
    </Routes>
  );
  const preview = { invitedEmail: 'bob@example.com', forYou: true, role: 'viewer' as const, moduleId: 'm1', moduleTitle: 'Turntable', expiresAt: 0 };

  it('signed in as the invited person: accepts and opens the module', async () => {
    vi.spyOn(api, 'me').mockResolvedValue(ME('Bob@example.com'));
    vi.spyOn(api.moduleInvites, 'preview').mockResolvedValue(preview);
    const accept = vi.spyOn(api.moduleInvites, 'accept').mockResolvedValue({ moduleId: 'm1', role: 'viewer' });
    wrap(page, '/module-invite/tok');
    await waitFor(() => expect(accept).toHaveBeenCalledWith('tok'));
    expect(await screen.findByText('module page', {}, { timeout: 3000 })).toBeTruthy();
  });

  it('signed in as someone else: says so and doesn’t accept', async () => {
    vi.spyOn(api, 'me').mockResolvedValue(ME('eve@example.com'));
    vi.spyOn(api.moduleInvites, 'preview').mockResolvedValue({ ...preview, invitedEmail: 'b…@example.com', forYou: false });
    const accept = vi.spyOn(api.moduleInvites, 'accept');
    wrap(page, '/module-invite/tok');
    expect(await screen.findByText('This invite is for a different account.')).toBeTruthy();
    expect(screen.getByText(/the module/).textContent).toContain('Turntable');
    expect(accept).not.toHaveBeenCalled();
  });

  it('signed out: asks to sign in with the invited address and comes back here', async () => {
    vi.spyOn(api, 'me').mockResolvedValue({ user: null } as never);
    vi.spyOn(api.moduleInvites, 'preview').mockResolvedValue({ ...preview, invitedEmail: 'b…@example.com', forYou: null });
    wrap(page, '/module-invite/tok');
    const link = await screen.findByRole('link', { name: 'Sign in' });
    expect(link.getAttribute('href')).toBe(`/login?next=${encodeURIComponent('/module-invite/tok')}`);
  });
});

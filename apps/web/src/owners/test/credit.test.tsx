// @vitest-environment jsdom
// Author credit on the web: the credit's words, Take back / Give back in a
// ⋯ menu (asked first, Cancel does nothing), and moving your own thing
// into a club asking first.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { api, type Credit } from '../../api';
import { creditText, moveToClubWording } from '../owners';
import { CreditLine, MoveCopyDialog, ReturnMenuItems } from '../OwnerControls';
import { autoConfirm } from '../../test/confirmHost';

const base: Credit = { by: null, authorName: null, club: null, basedOn: null, canTakeBack: false, canGiveBack: false };

function wrap(node: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{node}</QueryClientProvider>);
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('credit words', () => {
  it('a club\'s thing: by its author, in the club', () => {
    expect(creditText({ ...base, by: 'Sam', club: 'ArkLUG' })).toEqual({ line: 'by Sam · in ArkLUG', basedOn: null });
  });
  it('a person\'s thing: by its author', () => {
    expect(creditText({ ...base, by: 'you' }).line).toBe('by you');
  });
  it('a copy: based on the original by its author', () => {
    expect(creditText({ ...base, by: 'Bo', basedOn: { id: 'x', title: 'Yard', by: 'Sam' } }).basedOn).toBe('based on Yard by Sam');
    expect(creditText({ ...base, basedOn: { id: 'x', title: 'Yard', by: null } })).toEqual({ line: null, basedOn: 'based on Yard' });
  });
  it('nothing to say: nothing shown (older servers send no credit)', () => {
    expect(creditText(undefined)).toEqual({ line: null, basedOn: null });
    wrap(<CreditLine credit={null} />);
    expect(screen.queryByTestId('credit')).toBeNull();
  });
  it('the line shows both parts', () => {
    wrap(<CreditLine credit={{ ...base, by: 'a former member', club: 'ArkLUG', basedOn: { id: 'x', title: 'Yard', by: 'Builder #abc123' } }} />);
    expect(screen.getByTestId('credit').textContent).toBe('by a former member · in ArkLUG · based on Yard by Builder #abc123');
  });
  it('moving into a club says what that means', () => {
    const w = moveToClubWording('ArkLUG');
    expect(w.removes).toBe('ArkLUG will own this. Members with the Delete club items permission can rename, share or delete it.');
    expect(w.keeps).toBe('You stay credited as the author, and you can take it back while you’re a member.');
  });
});

describe('Take back / Give back', () => {
  it('shows nothing when neither applies', () => {
    wrap(<ReturnMenuItems kind="modules" id="m1" title="Yard" credit={{ ...base, by: 'Sam', club: 'ArkLUG' }} />);
    expect(screen.queryByRole('menuitem')).toBeNull();
  });

  it('Take back asks first: Cancel does nothing, confirming calls the route', async () => {
    const take = vi.spyOn(api.ownership, 'takeBack').mockResolvedValue({ ok: true, id: 'm1', keptCopyId: 'm2', ownerUserId: 'u1' });
    wrap(<ReturnMenuItems kind="modules" id="m1" title="Yard" credit={{ ...base, by: 'you', club: 'ArkLUG', canTakeBack: true }} />);
    expect(screen.queryByRole('menuitem', { name: /Give back/ })).toBeNull();
    const asked = autoConfirm(false);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Take back to mine' }));
    await waitFor(() => expect(asked.titles).toEqual(['Take “Yard” back?']));
    expect(asked.texts[0]).toContain('ArkLUG keeps its own copy');
    // Who hears of it goes by permission (#410), not by fixed roles.
    expect(asked.texts[0]).toContain('Members with the Delete club items permission are told.');
    expect(asked.texts[0]).not.toContain('admins and managers');
    await new Promise((r) => setTimeout(r, 20));
    expect(take).not.toHaveBeenCalled();
    autoConfirm(true);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Take back to mine' }));
    await waitFor(() => expect(take).toHaveBeenCalledWith('modules', 'm1'));
  });

  it('Give back names the author and calls the give-back route', async () => {
    const give = vi.spyOn(api.ownership, 'giveBack').mockResolvedValue({ ok: true, id: 'v1', keptCopyId: 'v2', ownerUserId: 'u2' });
    const take = vi.spyOn(api.ownership, 'takeBack');
    wrap(<ReturnMenuItems kind="venues" id="v1" title="Hall" credit={{ ...base, by: 'Sam', authorName: 'Sam', club: 'ArkLUG', canGiveBack: true }} />);
    const asked = autoConfirm(true);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Give back to Sam' }));
    await waitFor(() => expect(give).toHaveBeenCalledWith('venues', 'v1'));
    expect(asked.titles).toEqual(['Give “Hall” back to Sam?']);
    expect(asked.texts[0]).toContain('Members with the Delete club items permission are told.');
    expect(take).not.toHaveBeenCalled();
  });
});

describe('moving your own thing into a club', () => {
  const ORGS = [{ id: 'org1', name: 'ArkLUG', slug: 'arklug', createdAt: 0, myRole: 'member' as const }];

  it('asks first; Cancel keeps it, Move moves it', async () => {
    const move = vi.spyOn(api.customParts, 'move').mockResolvedValue({ ok: true, id: 'p1' });
    const onClose = vi.fn();
    wrap(<MoveCopyDialog kind="part" item={{ id: 'p1', title: '3001x', ownerOrgId: null }} canMove orgs={ORGS} onClose={onClose} />);
    fireEvent.click(screen.getByLabelText(/Move to a club/));
    const asked = autoConfirm(false);
    fireEvent.click(screen.getByRole('button', { name: 'Move' }));
    await waitFor(() => expect(asked.titles).toEqual(['Move it to ArkLUG?']));
    expect(asked.texts[0]).toContain('ArkLUG will own this.');
    await new Promise((r) => setTimeout(r, 20));
    expect(move).not.toHaveBeenCalled();
    autoConfirm(true);
    fireEvent.click(screen.getByRole('button', { name: 'Move' }));
    await waitFor(() => expect(move).toHaveBeenCalledWith('p1', 'arklug'));
  });

  it('a set lists which of your parts move with it, stay yours, or are the club’s', async () => {
    const sp = (id: string, partNumber: string, displayName = partNumber) => ({ id, partNumber, displayName });
    const planned = vi.spyOn(api.customParts, 'movePlan').mockResolvedValue({
      parts: { move: [sp('a', 'TOWER', 'Signal tower'), sp('b', 'SHED')], copy: [sp('c', 'LAMP')], inClub: [sp('d', 'GATE')], notYours: [] },
    });
    const move = vi.spyOn(api.customParts, 'move').mockResolvedValue({ ok: true, id: 'p1' });
    autoConfirm(true);
    wrap(<MoveCopyDialog kind="part" item={{ id: 'p1', title: 'Yard', ownerOrgId: null, isSet: true }} canMove orgs={ORGS} onClose={() => {}} />);
    // Copying lists nothing.
    expect(screen.queryByTestId('set-move-parts')).toBeNull();
    fireEvent.click(screen.getByLabelText(/Move to a club/));
    const box = await screen.findByTestId('set-move-parts');
    await waitFor(() => expect(box.textContent).toContain('These 2 custom parts of yours move with the set:'));
    expect(planned).toHaveBeenCalledWith('p1', 'arklug');
    expect(box.textContent).toContain('Signal tower (TOWER)');
    expect(box.textContent).toContain('These stay yours, because another of your sets uses them. The club gets its own copy:LAMP');
    expect(box.textContent).toContain('so the set uses the club’s:GATE');
    expect(box.textContent).not.toContain('aren’t yours');
    expect(screen.getByRole('button', { name: /help/i })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Move' }));
    await waitFor(() => expect(move).toHaveBeenCalledWith('p1', 'arklug'));
  });

  it('copying asks nothing', async () => {
    const copy = vi.spyOn(api.customParts, 'copy').mockResolvedValue({ id: 'p2' });
    const asked = autoConfirm(false);
    wrap(<MoveCopyDialog kind="part" item={{ id: 'p1', title: '3001x', ownerOrgId: null }} canMove orgs={ORGS} onClose={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    await waitFor(() => expect(copy).toHaveBeenCalledWith('p1', 'arklug'));
    expect(asked.titles).toEqual([]);
  });
});

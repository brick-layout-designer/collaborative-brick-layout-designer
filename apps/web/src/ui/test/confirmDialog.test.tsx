// The one confirmation dialog: what it says, Cancel/Esc/Delete, focus,
// typing the name, the reason box, and the "Deleted ‹name›" toast.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { askConfirm, askReason, confirmDelete, deleteOptions, ToastHost, toastDeleted, typedMatches } from '../ConfirmDialog';
import { confirmDialog } from '../../test/confirmHost';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const dialog = () => screen.getByTestId('confirm-dialog');
const button = (name: string) => screen.getByRole('button', { name });

describe('ConfirmDialog', () => {
  it('says what goes, what stays and whether it comes back; focus starts on Cancel', async () => {
    let answer: Promise<boolean>;
    act(() => {
      answer = confirmDelete('Main yard', { removes: 'The layout is deleted.', keeps: 'Its parts stay in your library.' });
    });
    expect(dialog().getAttribute('role')).toBe('alertdialog');
    expect(screen.getByRole('heading').textContent).toBe('Delete “Main yard”?');
    expect(dialog().textContent).toContain('The layout is deleted.');
    expect(dialog().textContent).toContain('Its parts stay in your library.');
    expect(dialog().textContent).toContain('This can’t be undone.');
    expect(document.activeElement).toBe(button('Cancel'));
    expect(button('Delete').className).toContain('bg-danger');
    fireEvent.click(button('Cancel'));
    await expect(answer!).resolves.toBe(false);
    expect(confirmDialog()).toBeNull();
  });

  it('Delete answers yes', async () => {
    let answer: Promise<boolean>;
    act(() => {
      answer = confirmDelete('Bench');
    });
    fireEvent.click(button('Delete'));
    await expect(answer!).resolves.toBe(true);
    expect(confirmDialog()).toBeNull();
  });

  it('Esc and a tap outside cancel', async () => {
    let answer: Promise<boolean>;
    act(() => {
      answer = askConfirm({ title: 'Go?' });
    });
    fireEvent.keyDown(dialog(), { key: 'Escape' });
    await expect(answer!).resolves.toBe(false);
    act(() => {
      answer = askConfirm({ title: 'Go?' });
    });
    fireEvent.pointerDown(dialog().parentElement!);
    await expect(answer!).resolves.toBe(false);
  });

  it('a big deletion turns Delete on only once the name is typed', async () => {
    let answer: Promise<boolean>;
    act(() => {
      answer = confirmDelete('Main Yard', { typeName: true });
    });
    const typed = screen.getByLabelText('Type Main Yard to confirm');
    expect((button('Delete') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(typed, { target: { value: 'Main' } });
    expect((button('Delete') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(button('Delete'));
    fireEvent.keyDown(typed, { key: 'Enter' });
    expect(confirmDialog()).not.toBeNull();
    fireEvent.change(typed, { target: { value: '  main yard ' } });
    expect((button('Delete') as HTMLButtonElement).disabled).toBe(false);
    fireEvent.keyDown(typed, { key: 'Enter' });
    await expect(answer!).resolves.toBe(true);
  });

  it('a second question cancels the first; each starts with nothing typed', async () => {
    let first: Promise<boolean>;
    act(() => {
      first = confirmDelete('One', { typeName: true });
    });
    fireEvent.change(screen.getByLabelText('Type One to confirm'), { target: { value: 'One' } });
    let second: Promise<boolean>;
    act(() => {
      second = confirmDelete('Two', { typeName: true });
    });
    await expect(first!).resolves.toBe(false);
    expect((screen.getByLabelText('Type Two to confirm') as HTMLInputElement).value).toBe('');
    fireEvent.click(button('Cancel'));
    await expect(second!).resolves.toBe(false);
  });

  it('asks for a reason, and can require one', async () => {
    let answer: Promise<string | null>;
    act(() => {
      answer = askReason({ title: 'Decline “Bench”?', confirmLabel: 'Decline', reason: { label: 'Why?', required: true } });
    });
    expect((button('Decline') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Why?'), { target: { value: ' Too dark ' } });
    fireEvent.click(button('Decline'));
    await expect(answer!).resolves.toBe('Too dark');
  });

  it('words: verb, own title, undoable', () => {
    expect(deleteOptions('Ann', { verb: 'Remove' })).toMatchObject({ title: 'Remove “Ann”?', confirmLabel: 'Remove' });
    expect(deleteOptions('x', { title: 'Cancel the invite?' }).title).toBe('Cancel the invite?');
    expect(deleteOptions('x', { undoable: true }).undo).toBe('You can undo this.');
    expect(deleteOptions('x', { undoable: 'You can undo this with Ctrl+Z.' }).undo).toBe('You can undo this with Ctrl+Z.');
    expect(deleteOptions('x').typeName).toBeUndefined();
    expect(deleteOptions('x', { typeName: true }).typeName).toBe('x');
    expect(typedMatches(' ABC ', 'abc')).toBe(true);
    expect(typedMatches('ab', 'abc')).toBe(false);
  });
});

describe('ToastHost', () => {
  it('says "Deleted ‹name›", offers Undo when given one, and goes by itself', () => {
    vi.useFakeTimers();
    render(<ToastHost />);
    const undo = vi.fn();
    act(() => toastDeleted('Bench', undo));
    expect(screen.getByTestId('toast').textContent).toContain('Deleted “Bench”');
    fireEvent.click(button('Undo'));
    expect(undo).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('toast')).toBeNull();
    act(() => toastDeleted('Yard'));
    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull();
    act(() => vi.advanceTimersByTime(6001));
    expect(screen.queryByTestId('toast')).toBeNull();
  });
});

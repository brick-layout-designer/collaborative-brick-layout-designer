// The share dialog's Copy link buttons (audit 2026-10-20): they said
// "Copied!" (or nothing) even when the clipboard refused, and threw on a
// server reached over plain http, where there is no clipboard.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { CopyLinkButton } from '../ShareDialog';

const realClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard');

function setClipboard(value: unknown) {
  Object.defineProperty(navigator, 'clipboard', { value, configurable: true });
}

afterEach(() => {
  cleanup();
  if (realClipboard) Object.defineProperty(navigator, 'clipboard', realClipboard);
  else delete (navigator as { clipboard?: unknown }).clipboard;
});

describe('CopyLinkButton', () => {
  it('copies the link and says so', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    setClipboard({ writeText });
    render(<CopyLinkButton url="https://example.test/s/abc" />);
    fireEvent.click(screen.getByRole('button', { name: 'Copy link' }));
    expect(await screen.findByRole('button', { name: 'Copied!' })).toBeTruthy();
    expect(writeText).toHaveBeenCalledWith('https://example.test/s/abc');
  });

  it('says it could not copy when the clipboard refuses', async () => {
    setClipboard({ writeText: vi.fn().mockRejectedValue(new Error('NotAllowedError')) });
    render(<CopyLinkButton url="https://example.test/s/abc" />);
    fireEvent.click(screen.getByRole('button', { name: 'Copy link' }));
    expect(await screen.findByRole('button', { name: /Could not copy/ })).toBeTruthy();
  });

  it('says it could not copy where there is no clipboard (plain http)', async () => {
    setClipboard(undefined);
    render(<CopyLinkButton url="http://192.168.1.5/s/abc" />);
    fireEvent.click(screen.getByRole('button', { name: 'Copy link' }));
    expect(await screen.findByRole('button', { name: /Could not copy/ })).toBeTruthy();
  });
});

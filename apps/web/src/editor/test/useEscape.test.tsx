// Escape closes the editor's dialogs one at a time: the last opened first,
// and never one under a confirmation.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { useEscape } from '../useEscape';

function Dialog({ onClose }: { onClose: () => void }) {
  useEscape(onClose);
  return <div role="dialog" aria-modal="true" />;
}
const escape = () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }));

afterEach(cleanup);

describe('useEscape', () => {
  it('closes the dialog opened last, then the one under it', () => {
    const outer = vi.fn();
    const inner = vi.fn();
    const a = render(<Dialog onClose={outer} />);
    const b = render(<Dialog onClose={inner} />);
    escape();
    expect(inner).toHaveBeenCalledTimes(1);
    expect(outer).not.toHaveBeenCalled();
    b.unmount();
    escape();
    expect(outer).toHaveBeenCalledTimes(1);
    a.unmount();
  });

  it('leaves the dialog alone while a confirmation is up', () => {
    const close = vi.fn();
    render(<Dialog onClose={close} />);
    const confirm = document.createElement('div');
    confirm.dataset.testid = 'confirm-dialog';
    document.body.appendChild(confirm);
    escape();
    expect(close).not.toHaveBeenCalled();
    confirm.remove();
    escape();
    expect(close).toHaveBeenCalledTimes(1);
  });
});

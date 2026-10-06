// Escape closes the editor's dialogs, one at a time: only the dialog opened
// last answers (a dialog opened from another closes first), and never while
// a confirmation (ui/ConfirmDialog) is up over it, which has its own Escape.

import { useEffect, useRef } from 'react';

const open: symbol[] = [];

export function useEscape(onClose: () => void): void {
  const close = useRef(onClose);
  useEffect(() => {
    close.current = onClose;
  });
  useEffect(() => {
    const me = Symbol('dialog');
    open.push(me);
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented || open.at(-1) !== me) return;
      if (document.querySelector('[data-testid="confirm-dialog"]')) return;
      e.preventDefault();
      close.current();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      open.splice(open.indexOf(me), 1);
    };
  }, []);
}

// The on-screen keyboard on a phone or tablet covers the bottom of the
// page without resizing it, so a dialog's lower fields (and its buttons)
// can end up underneath. We publish how much of the screen the keyboard
// takes as --keyboard-inset on <html>; on small screens the dialog
// overlays stop above it (styles.css), and the focused field is scrolled
// back into view.

interface VisualViewportLike {
  height: number;
  offsetTop: number;
}

/** The px hidden under the keyboard: the layout height not covered by the visual viewport. */
export function keyboardInset(innerHeight: number, vv: VisualViewportLike | null | undefined): number {
  if (!vv) return 0;
  const hidden = Math.round(innerHeight - (vv.height + vv.offsetTop));
  // Browser bars sliding in and out move a few px; only a keyboard is this tall.
  return hidden > 80 ? hidden : 0;
}

/** Start tracking the keyboard; call once at startup. */
export function watchKeyboard(win: Window = window): void {
  const vv = win.visualViewport;
  if (!vv) return;
  const root = win.document.documentElement;
  let last = 0;
  const update = () => {
    const inset = keyboardInset(win.innerHeight, vv);
    if (inset === last) return;
    last = inset;
    root.style.setProperty('--keyboard-inset', `${inset}px`);
    // The keyboard just opened: keep the field being typed in on screen.
    const el = win.document.activeElement;
    if (inset > 0 && el instanceof HTMLElement && el.matches('input, textarea, select, [contenteditable="true"]')) {
      win.requestAnimationFrame(() => el.scrollIntoView({ block: 'nearest' }));
    }
  };
  vv.addEventListener('resize', update);
  vv.addEventListener('scroll', update);
}

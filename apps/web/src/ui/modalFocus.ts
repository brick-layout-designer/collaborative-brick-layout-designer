// The keyboard and a dialog, for every dialog in the app at once: a dialog
// that says it's modal (role="dialog" or "alertdialog" with
// aria-modal="true") takes the focus when it opens, Tab and Shift+Tab go
// round its controls instead of wandering off to the page behind it, and
// when it closes the focus goes back to what had it before (the button
// that opened it), so a keyboard user carries on where they were.
//
// A dialog that already moves the focus itself (an autofocus field, the
// confirmation box) keeps doing so; one that handles Tab itself (the
// tour, the confirmation box) does, and this leaves that key alone.

const MODAL = '[role=dialog][aria-modal=true], [role=alertdialog][aria-modal=true]';
const TABBABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type=hidden])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'summary',
  '[tabindex]:not([tabindex="-1"])',
  '[contenteditable=true]',
].join(',');

/** The controls in `root` the Tab key stops at, in order. */
export function tabbables(root: HTMLElement): HTMLElement[] {
  const all = [...root.querySelectorAll<HTMLElement>(TABBABLE)].filter((el) => {
    if (el.closest('[inert]')) return false;
    if (el.tabIndex < 0) return false;
    // Hidden (display: none somewhere up, or visibility: hidden).
    if (el.getClientRects().length === 0 && !isJsdom()) return false;
    const cs = getComputedStyle(el);
    return cs.visibility !== 'hidden' && cs.display !== 'none';
  });
  // A group of radio buttons is one stop: the picked one (or the first).
  const radios = new Map<string, HTMLInputElement>();
  for (const el of all) {
    if (!(el instanceof HTMLInputElement) || el.type !== 'radio' || !el.name) continue;
    const key = `${el.form?.id ?? ''}|${el.name}`;
    const was = radios.get(key);
    if (!was || (!was.checked && el.checked)) radios.set(key, el);
  }
  return all.filter((el) => !(el instanceof HTMLInputElement) || el.type !== 'radio' || !el.name || radios.get(`${el.form?.id ?? ''}|${el.name}`) === el);
}

/** A field the on-screen keyboard comes up for. */
function typesText(el: HTMLElement): boolean {
  if (el instanceof HTMLTextAreaElement || el.isContentEditable) return true;
  return el instanceof HTMLInputElement && !['checkbox', 'radio', 'button', 'submit', 'reset', 'range', 'color', 'file', 'image'].includes(el.type);
}

// jsdom lays nothing out, so every element has no boxes there.
const isJsdom = () => typeof navigator !== 'undefined' && /jsdom/i.test(navigator.userAgent);

interface Open {
  el: HTMLElement;
  /** What had the focus before it opened. */
  before: HTMLElement | null;
}

/** Starts looking after the app's dialogs. Returns a function that stops. */
export function installModalFocus(doc: Document = document): () => void {
  const open: Open[] = [];
  const top = (): HTMLElement | null => {
    for (let i = open.length - 1; i >= 0; i--) if (open[i]!.el.isConnected) return open[i]!.el;
    return null;
  };

  const opened = (el: HTMLElement) => {
    if (open.some((o) => o.el === el)) return;
    const active = doc.activeElement as HTMLElement | null;
    open.push({ el, before: active && active !== doc.body ? active : null });
    if (el.contains(doc.activeElement)) return;
    // After React has run the dialog's own effects (an autofocus field, its own first focus).
    queueMicrotask(() => {
      if (!el.isConnected || el.contains(doc.activeElement) || top() !== el) return;
      // The first control, passing over the ⓘ help buttons (focused, one
      // shows its tip at once): a field, a choice, the dialog's own buttons.
      // On a touch screen not a text field: that would pop the on-screen
      // keyboard up over the dialog before anyone asked to type.
      const touch = typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;
      const items = tabbables(el).filter((i) => !i.hasAttribute('data-help-key') && !(touch && typesText(i)));
      const first = el.querySelector<HTMLElement>('[autofocus]') ?? items[0];
      if (first) first.focus();
      else {
        if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '-1');
        el.focus();
      }
    });
  };

  const closed = () => {
    for (let i = open.length - 1; i >= 0; i--) {
      const o = open[i]!;
      if (o.el.isConnected) continue;
      open.splice(i, 1);
      // Back to where the focus was, unless something else has taken it since.
      const now = doc.activeElement;
      const lost = !now || now === doc.body || !now.isConnected;
      if (lost && o.before?.isConnected) o.before.focus();
    }
  };

  const scan = (node: Node) => {
    if (!(node instanceof HTMLElement)) return;
    if (node.matches(MODAL)) opened(node);
    node.querySelectorAll<HTMLElement>(MODAL).forEach(opened);
  };

  const observer = new MutationObserver((records) => {
    let removed = false;
    for (const r of records) {
      if (r.type === 'attributes') {
        if (r.target instanceof HTMLElement && r.target.matches(MODAL)) opened(r.target);
        continue;
      }
      r.addedNodes.forEach(scan);
      if (r.removedNodes.length > 0) removed = true;
    }
    if (removed) closed();
  });
  observer.observe(doc.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-modal', 'role'] });
  doc.querySelectorAll<HTMLElement>(MODAL).forEach(opened);

  const onKey = (e: KeyboardEvent) => {
    if (e.key !== 'Tab' || e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
    const dialog = top();
    if (!dialog) return;
    const items = tabbables(dialog);
    if (items.length === 0) {
      e.preventDefault();
      return;
    }
    const at = items.indexOf(doc.activeElement as HTMLElement);
    const inside = dialog.contains(doc.activeElement);
    if (!inside) {
      e.preventDefault();
      (e.shiftKey ? items.at(-1)! : items[0]!).focus();
    } else if (e.shiftKey && (at === 0 || at === -1)) {
      e.preventDefault();
      items.at(-1)!.focus();
    } else if (!e.shiftKey && (at === items.length - 1 || at === -1)) {
      e.preventDefault();
      items[0]!.focus();
    }
  };
  doc.addEventListener('keydown', onKey);

  return () => {
    observer.disconnect();
    doc.removeEventListener('keydown', onKey);
  };
}

// The "⋯" menu at the end of a list row: the row's main action stays a
// button of its own, and everything else (share, download, move, delete…)
// sits in here, so a row on a phone is one tidy line instead of a heap of
// buttons. Works by tap, mouse and keyboard (Escape closes it, focus goes
// back to the ⋯ button).

import { useEffect, useRef, useState, type ReactNode } from 'react';

export const MORE_ITEM =
  'flex w-full min-h-11 items-center gap-2 px-3.5 py-2 text-left text-sm hover:bg-soft focus-visible:bg-soft focus-visible:outline-none pointer-fine:min-h-9';

export function MoreMenu({ label = 'More actions', children }: { label?: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  // Open upwards when there isn't room below (the last rows on a phone).
  const [up, setUp] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setOpen(false);
      button.current?.focus();
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    const b = button.current?.getBoundingClientRect();
    const m = menu.current?.getBoundingClientRect();
    if (b && m) setUp(b.bottom + m.height + 8 > window.innerHeight && b.top - m.height - 8 > 0);
    menu.current?.querySelector<HTMLElement>('[role^=menuitem]')?.focus();
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  function onMenuKey(e: React.KeyboardEvent) {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const items = Array.from(menu.current?.querySelectorAll<HTMLElement>('[role^=menuitem]') ?? []);
    const at = items.indexOf(document.activeElement as HTMLElement);
    const next = items[(at + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length];
    next?.focus();
  }

  return (
    <div ref={wrap} className="relative">
      <button
        ref={button}
        type="button"
        aria-label={label}
        title={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="tap-target inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg border border-border text-lg leading-none text-ink hover:bg-soft pointer-fine:min-h-9 pointer-fine:min-w-9"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
          <circle cx="5" cy="12" r="2" />
          <circle cx="12" cy="12" r="2" />
          <circle cx="19" cy="12" r="2" />
        </svg>
      </button>
      {open && (
        <div
          ref={menu}
          role="menu"
          aria-label={label}
          onKeyDown={onMenuKey}
          // A choice closes the menu; ticking a box (the template) keeps it open.
          onClick={(e) => {
            if ((e.target as HTMLElement).closest('[data-keep-open]')) return;
            if ((e.target as HTMLElement).closest('[role^=menuitem]')) setOpen(false);
          }}
          className={`absolute right-0 z-40 w-max min-w-52 max-w-[calc(100vw-2rem)] overflow-hidden rounded-card border border-line bg-panel py-1 text-ink shadow-pop ${
            up ? 'bottom-full mb-1' : 'top-full mt-1'
          }`}
        >
          {children}
        </div>
      )}
    </div>
  );
}

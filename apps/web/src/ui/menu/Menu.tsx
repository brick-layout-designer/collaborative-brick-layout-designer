// A dropdown menu with submenus, drawn from a menu model (menuModel.ts).
//
// With a mouse: a list under the button; a submenu opens on hover, on
// click or with →, beside its item (to the left near the right edge of the
// window). ↑ ↓ Home End move, → opens, ← and Esc close one level, Enter
// picks, Tab closes.
//
// On a phone or a touch screen: a bottom sheet. A submenu opens as a page
// of its own with "‹ Back" at the top; every row is at least 44 px tall.

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { activate, ariaKeyShortcut, nextFocusable, type ResolvedEntry } from './menuModel';
import { placeDropdown, placeSubmenu, type Placed } from './menuPlace';

export type MenuMode = 'auto' | 'popover' | 'sheet';

/** A touch screen, or a window too narrow for a menu beside a menu. */
export function prefersSheet(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    if (window.matchMedia('(pointer: coarse)').matches) return true;
  } catch {
    /* no matchMedia: decide by width */
  }
  return window.innerWidth < 640;
}

export interface MenuProps {
  /** The button's text, and the menu's name. */
  label: string;
  entries: readonly ResolvedEntry[];
  mode?: MenuMode;
  /** Classes for the button that opens the menu. */
  buttonClassName?: string;
  buttonTitle?: string;
  /** What the button shows, when not just the label. */
  buttonContent?: ReactNode;
  /** Width of each list with a mouse, px. */
  width?: number;
}

const POPOVER_ITEM =
  'flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-xs text-ink outline-none hover:bg-soft focus:bg-soft disabled:cursor-default disabled:opacity-40';
const SHEET_ITEM =
  'flex w-full min-h-11 items-center gap-3 px-4 py-2 text-left text-sm text-ink outline-none hover:bg-soft focus-visible:bg-soft disabled:opacity-40';

export function Menu({ label, entries, mode = 'auto', buttonClassName, buttonTitle, buttonContent, width = 224 }: MenuProps) {
  const [open, setOpen] = useState(false);
  const [sheet, setSheet] = useState(false);
  /** Ids of the open submenus, outermost first. */
  const [path, setPath] = useState<string[]>([]);
  const [placed, setPlaced] = useState<Record<number, Placed>>({});
  /** Focus this entry once it is drawn (keyboard). */
  const [focusReq, setFocusReq] = useState<{ level: number; id?: string | undefined } | null>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const lists = useRef(new Map<number, HTMLDivElement>());
  const items = useRef(new Map<string, HTMLButtonElement>());

  /** The entries shown at each level: the top, then each open submenu. */
  const levels: ResolvedEntry[][] = [entries as ResolvedEntry[]];
  for (const id of path) {
    const sub = levels[levels.length - 1]!.find((e) => e.kind === 'submenu' && e.id === id);
    if (!sub || sub.kind !== 'submenu') break;
    levels.push(sub.items);
  }
  const depth = levels.length - 1;
  const titles = [label, ...path.slice(0, depth).map((id, i) => (levels[i]!.find((e) => e.kind === 'submenu' && e.id === id) as { label: string }).label)];

  const close = useCallback((refocus: boolean) => {
    setOpen(false);
    setPath([]);
    setPlaced({});
    setFocusReq(null);
    if (refocus) button.current?.focus();
  }, []);

  const openMenu = () => {
    setSheet(mode === 'sheet' || (mode === 'auto' && prefersSheet()));
    setPath([]);
    setPlaced({});
    setOpen(true);
    setFocusReq({ level: 0 });
  };

  // Click or tap outside, or the window changes size: close.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) close(false);
    };
    const onResize = () => close(false);
    document.addEventListener('pointerdown', onDown);
    window.addEventListener('resize', onResize);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      window.removeEventListener('resize', onResize);
    };
  }, [open, close]);

  // Place each list (with a mouse) once it can be measured.
  useLayoutEffect(() => {
    if (!open || sheet) return;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const next: Record<number, Placed> = {};
    for (let level = 0; level <= depth; level++) {
      const list = lists.current.get(level);
      if (!list) continue;
      const size = list.getBoundingClientRect();
      if (level === 0) {
        const b = button.current?.getBoundingClientRect();
        if (b) next[0] = placeDropdown(b, size.width || width, vw, vh);
      } else {
        const it = items.current.get(`${level - 1}:${path[level - 1]}`)?.getBoundingClientRect();
        if (it) next[level] = placeSubmenu(it, size.width || width, list.scrollHeight || size.height, vw, vh);
      }
    }
    setPlaced((p) => (JSON.stringify(p) === JSON.stringify(next) ? p : next));
  }, [open, sheet, depth, path, width]);

  // Keyboard focus requests, after the list is drawn.
  useEffect(() => {
    if (!open || !focusReq) return;
    const { level, id } = focusReq;
    const el = id
      ? items.current.get(`${level}:${id}`)
      : lists.current.get(level)?.querySelector<HTMLElement>('[role^=menuitem]:not(:disabled)');
    el?.focus();
    setFocusReq(null);
  }, [open, focusReq]);

  const openSub = (level: number, id: string, focus: boolean) => {
    setPath((p) => (p.length === level + 1 && p[level] === id ? p : [...p.slice(0, level), id]));
    if (focus) setFocusReq({ level: level + 1 });
  };
  const closeLevel = (level: number) => {
    if (level === 0) {
      close(true);
      return;
    }
    const parent = path[level - 1];
    setPath((p) => p.slice(0, level - 1));
    setFocusReq({ level: level - 1, id: parent });
  };

  const choose = (e: ResolvedEntry, level: number, byKeyboard: boolean) => {
    if (e.kind === 'submenu') {
      if (!e.disabled) openSub(level, e.id, byKeyboard || sheet);
      return;
    }
    if (e.kind === 'separator' || e.disabled) return;
    // Back to the button first: a dialog the action opens then takes focus.
    close(byKeyboard);
    activate(e);
  };

  const onListKey = (level: number) => (ev: React.KeyboardEvent) => {
    const list = levels[level]!;
    const at = list.findIndex((e) => e.kind !== 'separator' && items.current.get(`${level}:${e.id}`) === document.activeElement);
    const focusAt = (i: number) => {
      const e = list[i];
      if (e) items.current.get(`${level}:${e.id}`)?.focus();
    };
    const cur = at >= 0 ? list[at] : undefined;
    let handled = true;
    switch (ev.key) {
      case 'ArrowDown':
        focusAt(nextFocusable(list, at, 1));
        break;
      case 'ArrowUp':
        focusAt(nextFocusable(list, at < 0 ? 0 : at, -1));
        break;
      case 'Home':
        focusAt(nextFocusable(list, -1, 1));
        break;
      case 'End':
        focusAt(nextFocusable(list, 0, -1));
        break;
      case 'ArrowRight':
        if (cur?.kind === 'submenu' && !cur.disabled) openSub(level, cur.id, true);
        break;
      case 'ArrowLeft':
        if (level > 0) closeLevel(level);
        break;
      case 'Escape':
        closeLevel(level);
        break;
      case 'Tab':
        close(false);
        handled = false;
        break;
      default:
        handled = false;
    }
    if (handled) {
      ev.preventDefault();
      ev.stopPropagation();
    }
  };

  const row = (e: ResolvedEntry, level: number) => {
    if (e.kind === 'separator') {
      return <div key={e.id} role="separator" className={sheet ? 'mx-4 my-1 border-t border-line' : 'mx-2 my-1 border-t border-line'} />;
    }
    const key = `${level}:${e.id}`;
    const expanded = e.kind === 'submenu' && path[level] === e.id && level < depth;
    return (
      <button
        key={e.id}
        ref={(el) => {
          if (el) items.current.set(key, el);
          else items.current.delete(key);
        }}
        type="button"
        tabIndex={-1}
        disabled={e.disabled}
        role={e.kind === 'check' ? 'menuitemcheckbox' : 'menuitem'}
        aria-checked={e.kind === 'check' ? e.checked : undefined}
        aria-haspopup={e.kind === 'submenu' ? 'menu' : undefined}
        aria-expanded={e.kind === 'submenu' ? expanded : undefined}
        aria-keyshortcuts={e.kind !== 'submenu' && e.shortcut ? ariaKeyShortcut(e.shortcut) : undefined}
        data-menu-id={e.id}
        className={`${sheet ? SHEET_ITEM : POPOVER_ITEM} ${expanded ? 'bg-soft' : ''}`}
        onClick={(ev) => choose(e, level, ev.detail === 0)}
        onPointerEnter={(ev) => {
          if (sheet || ev.pointerType !== 'mouse') return;
          ev.currentTarget.focus({ preventScroll: true });
          if (e.kind === 'submenu' && !e.disabled) openSub(level, e.id, false);
          else if (path.length > level) setPath((p) => p.slice(0, level));
        }}
      >
        <span aria-hidden className="w-4 shrink-0 text-center text-accent-text">
          {e.kind === 'check' && e.checked ? '✓' : ''}
        </span>
        <span className="min-w-0 flex-1 truncate">{e.label}</span>
        {e.kind === 'submenu' ? (
          <span aria-hidden className="shrink-0 pl-3 text-muted">›</span>
        ) : e.shortcut ? (
          <span aria-hidden className="shrink-0 whitespace-nowrap pl-4 text-right text-muted tabular-nums">{e.shortcut}</span>
        ) : null}
      </button>
    );
  };

  const listRef = (level: number) => (el: HTMLDivElement | null) => {
    if (el) lists.current.set(level, el);
    else lists.current.delete(level);
  };

  return (
    <div ref={wrap} className="relative">
      <button
        ref={button}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        title={buttonTitle}
        onClick={() => (open ? close(false) : openMenu())}
        onKeyDown={(ev) => {
          if (!open && (ev.key === 'ArrowDown' || ev.key === 'Enter' || ev.key === ' ')) {
            ev.preventDefault();
            openMenu();
          }
        }}
        className={buttonClassName}
      >
        {buttonContent ?? label}
      </button>
      {open && !sheet &&
        levels.map((list, level) => {
          const p = placed[level];
          return (
            <div
              key={level === 0 ? 'root' : path[level - 1]}
              ref={listRef(level)}
              role="menu"
              aria-label={titles[level]}
              aria-orientation="vertical"
              onKeyDown={onListKey(level)}
              // Fixed, not absolute: the toolbar it sits in may scroll or
              // clip. Above the modeless Find / Budget panels (z-40), below
              // modal dialogs (z-50).
              className="fixed z-[45] overflow-y-auto rounded-lg border border-line bg-panel py-1 shadow-pop"
              style={{
                width,
                left: p?.left ?? -9999,
                top: p?.top ?? 0,
                maxHeight: p?.maxHeight,
                // Not hidden: an entry has to be focusable before it is placed.
                opacity: p ? 1 : 0,
              }}
            >
              {list.map((e) => row(e, level))}
            </div>
          );
        })}
      {open && sheet && (
        <>
          <div aria-hidden className="fixed inset-0 z-[45] bg-black/40" onClick={() => close(false)} />
          <div
            data-testid="menu-sheet"
            className="fixed inset-x-0 bottom-0 z-[46] flex max-h-[85dvh] flex-col rounded-t-card border-t border-line bg-panel pb-[max(0.5rem,env(safe-area-inset-bottom))] shadow-pop"
          >
            <div className="flex min-h-12 shrink-0 items-center gap-2 border-b border-line px-2">
              {depth > 0 ? (
                <button
                  type="button"
                  onClick={() => closeLevel(depth)}
                  className="flex min-h-11 items-center gap-1 rounded-control px-2 text-sm font-bold text-accent-text hover:bg-soft"
                >
                  ‹ Back
                </button>
              ) : null}
              <span className="min-w-0 flex-1 truncate px-2 text-sm font-bold text-ink">{titles[depth]}</span>
              <button
                type="button"
                aria-label="Close menu"
                onClick={() => close(true)}
                className="flex size-11 items-center justify-center rounded-control text-lg text-muted hover:bg-soft"
              >
                ×
              </button>
            </div>
            <div
              key={depth === 0 ? 'root' : path[depth - 1]}
              ref={listRef(depth)}
              role="menu"
              aria-label={titles[depth]}
              aria-orientation="vertical"
              onKeyDown={onListKey(depth)}
              className="min-h-0 overflow-y-auto py-1"
            >
              {levels[depth]!.map((e) => row(e, depth))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

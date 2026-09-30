// The editor's top bar pieces, per the redesign mockup: the layout-name
// menu, the Saved pill, the task tabs, Help and Settings. EditorPage
// wires them to the existing panels, dialogs and menus; nothing here
// owns layout state.

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { SaveStatus } from './useLayoutDoc';

export type EditorTask = 'build' | 'room' | 'notes' | 'parts';

export const TASKS: { id: EditorTask; label: string; hint: string }[] = [
  { id: 'build', label: 'Build', hint: 'Parts and sheets: lay out the track and buildings' },
  { id: 'room', label: 'Room', hint: 'The room the layout goes in' },
  { id: 'notes', label: 'Notes', hint: 'Author, club, event and notes for this layout' },
  { id: 'parts', label: 'Parts list', hint: 'Every part this layout uses' },
];

function useDismiss(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, close]);
  return ref;
}

const Chevron = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden>
    <path d="M6 9l6 6 6-6" />
  </svg>
);

const MENU = 'absolute z-40 mt-1 min-w-56 overflow-hidden rounded-card border border-line bg-panel py-1 text-sm text-ink shadow-pop';
const MENU_ITEM = 'block w-full px-3.5 py-2 text-left hover:bg-soft';

/** The layout's name, opening a menu of the whole-layout actions. */
export function LayoutNameMenu({
  title,
  onNew,
  onOpen,
  children,
}: {
  title: string;
  onNew?: (() => void) | undefined;
  onOpen?: (() => void) | undefined;
  /** Extra items (e.g. the existing Save). */
  children?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const ref = useDismiss(open, () => setOpen(false));
  return (
    <div ref={ref} className="relative min-w-0">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex min-w-0 items-center gap-1.5 rounded-lg px-2 py-1.5 font-display text-[17px] font-bold text-ink hover:bg-soft"
      >
        <h1 className="truncate text-[17px]">{title}</h1>
        <Chevron />
      </button>
      {open && (
        <div role="menu" className={MENU} onClick={() => setOpen(false)}>
          <Link role="menuitem" to="/" className={MENU_ITEM}>
            All layouts
          </Link>
          {onNew && (
            <button role="menuitem" type="button" title="New layout (Ctrl+N)" onClick={onNew} className={MENU_ITEM}>
              New layout
            </button>
          )}
          {onOpen && (
            <button role="menuitem" type="button" title="Open layout (Ctrl+O)" onClick={onOpen} className={MENU_ITEM}>
              Open another layout
            </button>
          )}
          {children}
        </div>
      )}
    </div>
  );
}

/** "Saved" when the server has everything; otherwise what's going on, in words. */
export function SavePill({ status }: { status: SaveStatus }) {
  let tone = 'bg-soft text-muted';
  let text: string;
  let title: string | undefined;
  switch (status.kind) {
    case 'connecting':
      text = 'Connecting…';
      break;
    case 'synced':
      tone = 'bg-ok-soft text-ok';
      text = 'Saved';
      title = 'Every change is saved to the server';
      break;
    case 'reconnecting':
      tone = 'bg-amber-950 text-amber-300';
      text = 'Reconnecting…';
      title = status.lastSyncedAt ? `Last saved ${timeAgo(status.lastSyncedAt)}` : undefined;
      break;
    case 'offline':
      tone = 'bg-amber-950 text-amber-300';
      text = 'Offline';
      title = status.lastSyncedAt ? 'Edits are kept on this computer and will save when you reconnect' : undefined;
      break;
    case 'error':
      tone = 'bg-red-950 text-danger';
      text = status.message;
      break;
  }
  return (
    <span
      data-testid="save-status"
      title={title}
      className={`flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-bold ${tone}`}
    >
      {status.kind === 'synced' && (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" aria-hidden>
          <path d="M5 12l5 5 9-10" />
        </svg>
      )}
      {text}
    </span>
  );
}

function timeAgo(ts: number): string {
  const secs = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (secs < 5) return 'just now';
  if (secs < 60) return `${secs}s ago`;
  return `${Math.round(secs / 60)}m ago`;
}

export function TaskTabs({ task, onTask }: { task: EditorTask; onTask: (t: EditorTask) => void }) {
  return (
    <div role="group" aria-label="Tasks" className="flex items-center gap-0.5 rounded-control bg-soft p-[3px]">
      {TASKS.map((t) => {
        const on = task === t.id;
        return (
          <button
            key={t.id}
            type="button"
            aria-pressed={on}
            title={t.hint}
            onClick={() => onTask(t.id)}
            className={`h-[34px] whitespace-nowrap rounded-lg px-3.5 text-[13px] ${on ? 'bg-panel font-bold text-ink shadow-sm' : 'font-semibold text-muted hover:text-ink'}`}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}

export const ICON_BUTTON =
  'flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-control border border-border bg-panel text-ink hover:bg-soft';

/** Help: a few first steps and the way to Settings and About. Tours come in a later phase. */
export function HelpMenu({ onSettings }: { onSettings: () => void }) {
  const [open, setOpen] = useState(false);
  const ref = useDismiss(open, () => setOpen(false));
  return (
    <div ref={ref} className="relative">
      <button type="button" aria-label="Help" aria-expanded={open} onClick={() => setOpen((v) => !v)} className={ICON_BUTTON}>
        <span className="flex h-[18px] w-[18px] items-center justify-center rounded-full border-[1.8px] border-current text-[11px] font-extrabold" aria-hidden>
          ?
        </span>
      </button>
      {open && (
        <div role="dialog" aria-label="Help" className={`${MENU} right-0 w-80 p-4`}>
          <div className="mb-2 font-display text-base font-bold">Getting started</div>
          <ul className="mb-3 list-disc space-y-1.5 pl-5 text-[13px] leading-snug text-muted">
            <li>Drag a part from the Parts panel onto the map, or click it to drop it in the middle.</li>
            <li>Ends of track snap together when they meet. Press R to turn the selected piece.</li>
            <li>Sheets keep things apart: track on one, buildings on another.</li>
            <li>The Room tab holds the hall or room the layout has to fit in.</li>
            <li>Ctrl+Z undoes, Ctrl+Shift+Z redoes. Everything saves by itself.</li>
          </ul>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                onSettings();
              }}
              className="h-9 rounded-control border border-border px-3 text-[13px] font-semibold hover:bg-soft"
            >
              Help settings
            </button>
            <Link to="/about" target="_blank" className="flex h-9 items-center rounded-control border border-border px-3 text-[13px] font-semibold hover:bg-soft">
              About this app
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}

export function SettingsButton({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" aria-label="Settings" title="Settings" onClick={onClick} className={ICON_BUTTON}>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
        <circle cx="12" cy="12" r="3" />
        <path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1" />
      </svg>
    </button>
  );
}

/** The app mark, linking back to the layouts list. */
export function AppMark() {
  return (
    <Link to="/" title="All layouts" aria-label="All layouts" className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-[9px] bg-accent text-accent-ink">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <rect x="3" y="9" width="18" height="11" rx="2" />
        <path d="M7 9V6h4v3M13 9V6h4v3" />
      </svg>
    </Link>
  );
}

// The header's "Settings ▾" menu: shortcuts straight to the parts of the
// Settings, Profile and Admin pages, in three groups.
//
//   Account         Profile and name · Sign-in methods · Devices · Sign out
//   Look            Light or dark · Colour and text size · Help and tours ·
//                   Install the app (only where installing is offered)
//   Admin settings  one entry per admin tab (moderators: Moderation only)
//
// Reviews waiting for a moderator show as a badge on the button. Works by
// mouse, touch and keyboard (arrows, Home/End, Escape returns focus to the
// button). On a phone it opens as a bottom sheet over a dimmed page.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api, type Me } from './api';
import { isMobileDevice } from './pwa/install';
import { ADMIN_MENU_LABELS, adminTabsFor, adminTabUrl } from './admin/adminTabs';

interface Entry {
  label: string;
  to: string;
  badge?: number;
}

interface Group {
  id: string;
  title: string;
  entries: Entry[];
}

/** How many reviews are waiting (catalog items and collections), for moderators and admins. */
export function useWaitingReviews(user: Pick<Me, 'isGlobalAdmin' | 'isModerator'>): number {
  const reviews = user.isGlobalAdmin || !!user.isModerator;
  // The same queries as the Moderation tab, so a live change refreshes both.
  const items = useQuery({ queryKey: ['moderation'], queryFn: api.moderation.items, enabled: reviews, staleTime: 60_000, retry: false });
  const collections = useQuery({
    queryKey: ['moderation-collections'],
    queryFn: api.moderation.collections,
    enabled: reviews,
    staleTime: 60_000,
    retry: false,
  });
  if (!reviews) return 0;
  return (items.data?.queue.length ?? 0) + (collections.data?.queue.length ?? 0);
}

/** The menu's groups for this person. */
export function settingsMenuGroups(
  user: Pick<Me, 'isGlobalAdmin' | 'isModerator' | 'isDemoAccount'>,
  opts: { installOffered: boolean; waitingReviews: number },
): Group[] {
  const account: Entry[] = [{ label: 'Profile and name', to: '/profile#name' }];
  // The shared demo account can't change its sign-in or connect a desktop app.
  if (!user.isDemoAccount) {
    account.push({ label: 'Sign-in methods', to: '/profile#sign-in' }, { label: 'Devices', to: '/profile#devices' });
  }
  const look: Entry[] = [
    { label: 'Light or dark', to: '/settings#look' },
    { label: 'Colour and text size', to: '/settings#colour' },
    { label: 'Help and tours', to: '/settings#help' },
  ];
  if (opts.installOffered) look.push({ label: 'Install the app', to: '/settings#install' });
  const groups: Group[] = [
    { id: 'account', title: 'Account', entries: account },
    { id: 'look', title: 'Look', entries: look },
  ];
  const tabs = adminTabsFor(user);
  if (tabs.length > 0) {
    groups.push({
      id: 'admin',
      title: 'Admin settings',
      entries: tabs.map((t) => ({
        label: ADMIN_MENU_LABELS[t],
        to: adminTabUrl(t),
        ...(t === 'moderation' && opts.waitingReviews > 0 ? { badge: opts.waitingReviews } : {}),
      })),
    });
  }
  return groups;
}

const ITEM =
  'flex w-full min-h-11 items-center gap-2 px-4 py-2 text-left text-[15px] font-semibold text-ink hover:bg-soft focus-visible:bg-soft focus-visible:outline-none sm:min-h-9 sm:text-sm pointer-coarse:min-h-11';

function Badge({ n, label }: { n: number; label: string }) {
  return (
    <span className="rounded-full bg-accent px-1.5 text-xs font-bold text-accent-ink" aria-label={label}>
      {n}
    </span>
  );
}

export function SettingsMenu({ user, onSignOut, signingOut = false }: { user: Me; onSignOut: () => void; signingOut?: boolean }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const waiting = useWaitingReviews(user);
  // Installing is offered on phones and tablets (the Settings page's rule).
  const installOffered = useMemo(() => isMobileDevice(), []);
  const groups = settingsMenuGroups(user, { installOffered, waitingReviews: waiting });
  const reviewWords = `${waiting} ${waiting === 1 ? 'review' : 'reviews'} waiting`;

  const items = () => Array.from(menu.current?.querySelectorAll<HTMLElement>('[role=menuitem]') ?? []);
  const close = useCallback((refocus: boolean) => {
    setOpen(false);
    if (refocus) button.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close(true);
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, close]);

  // Opening by keyboard or tap puts focus on the first entry.
  const [focusLast, setFocusLast] = useState(false);
  useEffect(() => {
    if (!open) return;
    const all = items();
    (focusLast ? all[all.length - 1] : all[0])?.focus();
  }, [open, focusLast]);

  function onButtonKey(e: React.KeyboardEvent) {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    setFocusLast(e.key === 'ArrowUp');
    setOpen(true);
  }

  function onMenuKey(e: React.KeyboardEvent) {
    const all = items();
    const at = all.indexOf(document.activeElement as HTMLElement);
    let next: HTMLElement | undefined;
    if (e.key === 'ArrowDown') next = all[(at + 1) % all.length];
    else if (e.key === 'ArrowUp') next = all[(at - 1 + all.length) % all.length];
    else if (e.key === 'Home') next = all[0];
    else if (e.key === 'End') next = all[all.length - 1];
    else if (e.key === 'Tab') {
      // Tabbing out closes it, like any menu.
      setOpen(false);
      return;
    } else return;
    e.preventDefault();
    next?.focus();
  }

  return (
    <div ref={wrap} className="relative">
      <button
        ref={button}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? 'settings-menu' : undefined}
        onClick={() => {
          setFocusLast(false);
          setOpen((v) => !v);
        }}
        onKeyDown={onButtonKey}
        className="tap-target inline-flex h-11 items-center gap-1.5 rounded-control border border-border px-3 text-sm font-semibold text-ink hover:bg-soft sm:h-9 pointer-coarse:h-11"
      >
        {user.avatarUrl && <img src={user.avatarUrl} alt="" className="-ml-1 hidden h-6 w-6 rounded-full sm:block" />}
        {/* Phones: a gear, so the header fits on one row; the name is still "Settings". */}
        <svg aria-hidden viewBox="0 0 24 24" className="h-5 w-5 sm:hidden" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
        <span className="sr-only sm:not-sr-only">Settings</span>
        {waiting > 0 && <Badge n={waiting} label={reviewWords} />}
        <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden className={`hidden transition-transform sm:block ${open ? 'rotate-180' : ''}`}>
          <path d="M2.5 4.5L6 8l3.5-3.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && (
        <>
          {/* Phones: the page dims behind the sheet; a tap on it closes. */}
          <div aria-hidden className="fixed inset-0 z-40 bg-black/40 sm:hidden" onClick={() => setOpen(false)} />
          <div
            ref={menu}
            id="settings-menu"
            role="menu"
            aria-label="Settings"
            onKeyDown={onMenuKey}
            onClick={(e) => {
              if ((e.target as HTMLElement).closest('[role=menuitem]')) setOpen(false);
            }}
            className="z-50 overflow-y-auto overscroll-contain border-line bg-panel text-ink shadow-pop max-sm:fixed max-sm:inset-x-0 max-sm:bottom-0 max-sm:max-h-[80dvh] max-sm:rounded-t-2xl max-sm:border-t max-sm:pb-[env(safe-area-inset-bottom)] sm:absolute sm:right-0 sm:top-full sm:mt-1 sm:max-h-[calc(100dvh-6rem)] sm:w-72 sm:rounded-card sm:border sm:py-1"
          >
            <div className="mx-auto mt-2 h-1 w-10 rounded-full bg-line sm:hidden" aria-hidden />
            <p className="truncate px-4 pb-1 pt-2 text-xs text-muted" data-testid="settings-menu-who">
              Signed in as <span className="font-semibold text-ink">{user.displayName || user.publicName || user.email}</span>
            </p>
            {groups.map((g) => (
              <div key={g.id} role="group" aria-labelledby={`settings-menu-${g.id}`} className="border-t border-line py-1">
                <p id={`settings-menu-${g.id}`} className="px-4 pb-1 pt-2 text-xs font-bold uppercase tracking-wide text-muted">
                  {g.title}
                </p>
                {g.entries.map((e) => (
                  <Link key={e.to} role="menuitem" to={e.to} className={ITEM}>
                    <span className="flex-1">{e.label}</span>
                    {e.badge !== undefined && <Badge n={e.badge} label={reviewWords} />}
                  </Link>
                ))}
                {g.id === 'account' && (
                  <button
                    type="button"
                    role="menuitem"
                    disabled={signingOut}
                    onClick={onSignOut}
                    className={`${ITEM} text-danger disabled:opacity-50`}
                  >
                    Sign out
                  </button>
                )}
              </div>
            ))}
            {/* A phone sheet gets a plain way out besides tapping the page. */}
            <div className="border-t border-line p-2 sm:hidden">
              <button type="button" onClick={() => close(true)} className="min-h-11 w-full rounded-control text-sm font-bold hover:bg-soft">
                Close
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

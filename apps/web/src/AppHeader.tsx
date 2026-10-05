// Shared site header used by every authenticated page (except the
// editor, which has its own dense per-document toolbar).
//
// Top-left: app title (links to Layouts home).
// Top-right: Home / Clubs / [Catalog] / About / [Notices], then the Help
//            menu (tours) and the Settings ▾ menu: Account (profile, sign-in,
//            devices, sign out), Look, and Admin settings for admins and
//            moderators (see SettingsMenu.tsx).
//
// All routes go through `<Link>` so React Router takes the
// hard-refresh out of the loop. Logout posts to /api/auth/logout and
// then sends the user to /login.

import { useState } from 'react';
import { Link, NavLink, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type Me } from './api';
import { HelpMenu } from './editor/EditorChrome';
import { forgetNamePromptSkip } from './auth/NamePrompt';
import { SettingsMenu } from './SettingsMenu';

interface Props {
  user: Me;
}

export function AppHeader({ user }: Props) {
  // The Catalog link shows only while a public catalog is on.
  const catalog = useQuery({ queryKey: ['catalog-settings'], queryFn: api.catalog.settings, staleTime: 60_000 });
  // Only shown once there's something in it (a warning or a note).
  const notices = useQuery({ queryKey: ['notices'], queryFn: api.warnings.notices });
  const qc = useQueryClient();
  const navigate = useNavigate();
  const logout = useMutation({
    mutationFn: api.logout,
    onSuccess: () => {
      qc.clear();
      // The next sign-in asks "What should we call you?" again, if it's still needed.
      forgetNamePromptSkip();
      navigate('/login', { replace: true });
    },
  });

  // Club admins see how many people are waiting to join their clubs.
  const waiting = useQuery({
    queryKey: ['join-request-count'],
    queryFn: api.orgs.joinRequestCount,
    staleTime: 60_000,
    retry: false,
  });
  const waitingCount = waiting.data?.count ?? 0;

  // Phones: the links fold into a Menu button, and open as a list.
  const [menuOpen, setMenuOpen] = useState(false);
  const linkBase = 'tap-target flex items-center rounded-control px-3 py-2 font-semibold hover:bg-soft hover:text-ink';
  // The page you're on is marked (aria-current="page" from NavLink).
  const link = ({ isActive }: { isActive: boolean }) => `${linkBase} ${isActive ? 'bg-soft text-ink' : 'text-muted'}`;
  return (
    <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-section border border-line bg-panel px-4 py-3">
      <Link to="/" className="tap-target flex min-w-0 flex-1 items-center gap-3 sm:flex-none">
        <img src="/logo.png" alt="" className="h-9 w-9 shrink-0 rounded-[9px]" />
        <span className="truncate font-display text-base font-bold text-ink sm:text-xl">Brick Layout Designer</span>
      </Link>
      {/* Help (tours, help topics), Settings and, on a phone, the Menu button
          share one row with the name, so the header never wraps onto a second line. */}
      <div className="flex shrink-0 items-center gap-2 sm:order-last">
        <HelpMenu />
        <SettingsMenu user={user} onSignOut={() => logout.mutate()} signingOut={logout.isPending} />
        <button
          type="button"
          aria-expanded={menuOpen}
          aria-controls="site-nav"
          aria-label="Menu"
          onClick={() => setMenuOpen((v) => !v)}
          className="relative inline-flex h-11 w-11 items-center justify-center rounded-control border border-border text-ink hover:bg-soft sm:hidden"
        >
          <svg aria-hidden viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            {menuOpen ? <path d="M6 6l12 12M18 6L6 18" /> : <path d="M4 7h16M4 12h16M4 17h16" />}
          </svg>
          {waitingCount > 0 && !menuOpen && (
            <span aria-hidden className="absolute -right-1.5 -top-1.5 rounded-full bg-accent px-1.5 text-xs font-bold text-accent-ink">
              {waitingCount}
            </span>
          )}
        </button>
      </div>
      <nav
        id="site-nav"
        aria-label="Site"
        className={`${menuOpen ? 'flex' : 'hidden'} w-full flex-col items-stretch gap-1 text-base sm:ml-auto sm:flex sm:w-auto sm:flex-row sm:flex-wrap sm:items-center sm:justify-end sm:text-sm`}
        onClick={(e) => {
          if ((e.target as HTMLElement).closest('a')) setMenuOpen(false);
        }}
      >
        <NavLink to="/" end className={link}>
          Home
        </NavLink>
        <NavLink to="/orgs" data-tour="clubs.page" className={(s) => `${link(s)} gap-2`}>
          Clubs
          {waitingCount > 0 && (
            <span
              className="rounded-full bg-accent px-1.5 text-xs font-bold text-accent-ink"
              aria-label={`${waitingCount} ${waitingCount === 1 ? 'request' : 'requests'} to join`}
            >
              {waitingCount}
            </span>
          )}
        </NavLink>
        {(catalog.data?.modules || catalog.data?.parts) && (
          <NavLink to="/catalog" className={link}>
            Catalog
          </NavLink>
        )}
        <NavLink to="/about" className={link}>
          About
        </NavLink>
        {(notices.data?.notices?.length ?? 0) > 0 && (
          <NavLink to="/notices" className={link}>
            Notices
          </NavLink>
        )}
      </nav>
    </header>
  );
}

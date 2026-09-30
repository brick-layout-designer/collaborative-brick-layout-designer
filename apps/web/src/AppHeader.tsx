// Shared site header used by every authenticated page (except the
// editor, which has its own dense per-document toolbar).
//
// Top-left: app title (links to Layouts home).
// Top-right: Library / Organizations / [Admin if applicable] / display
//            name → Profile / Sign out.
//
// All routes go through `<Link>` so React Router takes the
// hard-refresh out of the loop. Logout posts to /api/auth/logout and
// then sends the user to /login.

import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, type Me } from './api';

interface Props {
  user: Me;
}

export function AppHeader({ user }: Props) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const logout = useMutation({
    mutationFn: api.logout,
    onSuccess: () => {
      qc.clear();
      navigate('/login', { replace: true });
    },
  });

  const link = 'rounded-control px-3 py-2 font-semibold text-muted hover:bg-soft hover:text-ink';
  return (
    <header className="flex flex-wrap items-center justify-between gap-4 rounded-section border border-line bg-panel px-4 py-3">
      <Link to="/" className="flex items-center gap-3">
        <img src="/logo.png" alt="" className="h-9 w-9 rounded-[9px]" />
        <span className="font-display text-xl font-bold text-ink">Brick Layout Designer</span>
      </Link>
      <nav className="flex flex-wrap items-center gap-1 text-sm">
        <Link to="/library" className={link}>
          Library
        </Link>
        <Link to="/orgs" className={link}>
          Organizations
        </Link>
        <Link to="/about" className={link}>
          About
        </Link>
        {user.isGlobalAdmin && (
          <Link
            to="/admin"
            className="rounded-control bg-amber-900/40 px-3 py-2 font-semibold text-amber-300 hover:bg-amber-900/60"
            title="Platform admin"
          >
            Admin
          </Link>
        )}
        <Link to="/settings" className={link}>
          Settings
        </Link>
        <Link to="/profile" className="ml-1 flex items-center gap-2 rounded-control px-2 py-1.5 font-semibold hover:bg-soft">
          {user.avatarUrl && (
            <img src={user.avatarUrl} alt="" className="h-8 w-8 rounded-full" />
          )}
          <span>{user.displayName}</span>
        </Link>
        <button
          onClick={() => logout.mutate()}
          disabled={logout.isPending}
          className="h-9 rounded-control border border-border px-3 text-sm font-semibold text-ink hover:bg-soft disabled:opacity-50"
          title="Sign out"
        >
          Sign out
        </button>
      </nav>
    </header>
  );
}

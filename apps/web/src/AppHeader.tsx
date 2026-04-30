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

  return (
    <header className="flex items-center justify-between border-b border-neutral-800 pb-4">
      <Link to="/" className="text-2xl font-semibold hover:underline">
        Collaborative Layout Designer
      </Link>
      <nav className="flex items-center gap-4 text-sm">
        <Link to="/library" className="text-neutral-300 hover:underline">
          Library
        </Link>
        <Link to="/orgs" className="text-neutral-300 hover:underline">
          Organizations
        </Link>
        <Link to="/about" className="text-neutral-300 hover:underline">
          About
        </Link>
        {user.isGlobalAdmin && (
          <Link
            to="/admin"
            className="rounded bg-amber-900/40 px-2 py-0.5 text-amber-300 hover:bg-amber-900/60"
            title="Platform admin"
          >
            Admin
          </Link>
        )}
        <Link to="/profile" className="flex items-center gap-2 hover:underline">
          {user.avatarUrl && (
            <img src={user.avatarUrl} alt="" className="h-8 w-8 rounded-full" />
          )}
          <span>{user.displayName}</span>
        </Link>
        <button
          onClick={() => logout.mutate()}
          disabled={logout.isPending}
          className="rounded border border-neutral-700 px-3 py-1 text-xs text-neutral-300 hover:bg-neutral-800 disabled:opacity-50"
          title="Sign out"
        >
          Sign out
        </button>
      </nav>
    </header>
  );
}

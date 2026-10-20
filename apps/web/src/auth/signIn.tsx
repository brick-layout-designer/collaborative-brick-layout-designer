// Signing in and coming back: the sign-in page's `?next=`, and the links
// and redirects that send people there from a page that needs an account.

import { Link, Navigate, useLocation, useNavigate, type LinkProps } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';

/**
 * Whether `raw` is a path on this site. Browsers drop tabs and line breaks
 * from URLs and read a backslash as a slash, so "/\t/host" and "/\\host"
 * would go to another site; control characters and backslashes are
 * refused. Same rule as the server's safeNextPath.
 */
export function isSitePath(raw: string): boolean {
  // eslint-disable-next-line no-control-regex -- control characters are what this refuses
  return raw.startsWith('/') && !raw.startsWith('//') && !/[\u0000-\u001f\u007f\\]/.test(raw);
}

/**
 * `?next=` target to return to after signing in (e.g. /device, /invite/…).
 * Same-origin paths only, so the login page can't be used as an open
 * redirect.
 */
export function safeNext(raw: string | null): string {
  return raw && isSitePath(raw) ? raw : '/';
}

/** The sign-in page, coming back to `here` (a path on this site) afterwards. */
export function loginPath(here: string): string {
  const next = safeNext(here);
  return next === '/' ? '/login' : `/login?next=${encodeURIComponent(next)}`;
}

/** The address being shown, for `?next=`. */
export function useHere(): string {
  const { pathname, search, hash } = useLocation();
  return pathname + search + hash;
}

/** For pages that need an account: off to sign in, then straight back here. */
export function SignInFirst() {
  return <Navigate to={loginPath(useHere())} replace />;
}

/** A "Sign in" link that comes back to this page afterwards. */
export function SignInLink(props: Omit<LinkProps, 'to'>) {
  return <Link {...props} to={loginPath(useHere())} />;
}

/**
 * "Sign out and use the right account": for a link meant for someone
 * else's account (an invite, a transfer). Signs out, then the sign-in
 * page comes straight back to the link.
 */
export function SwitchAccountButton({ className = '', label = 'Sign out and use that account' }: { className?: string; label?: string }) {
  const here = useHere();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const out = useMutation({
    mutationFn: api.logout,
    onSuccess: () => {
      qc.clear();
      navigate(loginPath(here), { replace: true });
    },
  });
  return (
    <button
      type="button"
      onClick={() => out.mutate()}
      disabled={out.isPending}
      className={`tap-target rounded-lg border border-border px-3 py-1.5 text-sm font-semibold hover:bg-soft disabled:opacity-50 ${className}`}
    >
      {out.isPending ? 'Signing out…' : label}
    </button>
  );
}

/** Under "This invite isn't valid.": what to do now, and a way out. */
export function DeadLinkHelp({ what }: { what: string }) {
  return (
    <>
      <p className="mt-2 text-sm text-muted">It may have been used already, taken back, or run out. Ask whoever sent you the {what} for a new one.</p>
      <Link to="/" className="tap-target mt-2 inline-flex items-center text-sm font-semibold text-accent-text hover:underline">
        Go to Home
      </Link>
    </>
  );
}

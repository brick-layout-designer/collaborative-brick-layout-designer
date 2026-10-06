import { useState } from 'react';
import { Link, Navigate, useSearchParams } from 'react-router-dom';
import { DeletingNotice } from '../privacy/DeleteAccount';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import { HelpButton } from '../help/HelpButton';
import { DESKTOP_URL, LICENCE, REPO_URL } from '../projectLinks';

/**
 * `?next=` target to return to after signing in (e.g. /device, /invite/…).
 * Same-origin paths only, so the login page can't be used as an open
 * redirect.
 */
export function safeNext(raw: string | null): string {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/\\')) return '/';
  return raw;
}

export function LoginPage() {
  const me = useQuery({ queryKey: ['me'], queryFn: api.me });
  const providers = useQuery({ queryKey: ['providers'], queryFn: api.providers });
  const [params] = useSearchParams();
  const next = safeNext(params.get('next'));
  const deleting = Number(params.get('deleting') ?? '');
  if (me.data?.user) return <Navigate to={next} replace />;

  return (
    <div className="grid min-h-screen place-items-center px-4 py-6">
      <div className="w-full max-w-sm space-y-4">
        {deleting > 0 && <DeletingNotice dueAt={deleting} />}
        <div className="space-y-6 rounded-lg border border-line bg-panel p-8 shadow-sm">
          <img src="/logo.png" alt="" className="mx-auto h-12 w-12 rounded-lg" />
          <h1 className="text-center text-xl font-semibold">Sign in to Collaborative Brick Layout Designer</h1>

          <div className="space-y-2">
            {providers.data?.providers
              .filter((p) => p.enabled)
              .map((p) => (
                <a
                  key={p.id}
                  href={`/api/auth/${p.id}`}
                  className="block rounded-lg border border-border px-4 py-2 text-center hover:bg-soft"
                >
                  Continue with {p.label}
                </a>
              ))}
            {providers.data && !providers.data.passwordEnabled && !providers.data.demoEnabled && providers.data.providers.every((p) => !p.enabled) && (
              <p className="text-center text-sm text-muted">
                Signing in isn’t set up on this site yet. Ask the person who runs it.
              </p>
            )}
          </div>

          {providers.data?.passwordEnabled && <PasswordForm next={next} />}
          {providers.data?.demoEnabled && <TryDemo next={next} />}
        </div>
        <SourceFooter />
      </div>
    </div>
  );
}

/** A quiet line under the card: where the code lives, and its licence. */
function SourceFooter() {
  const link = 'tap-target inline-flex items-center hover:text-ink hover:underline';
  return (
    <footer className="flex flex-wrap items-center justify-center gap-x-2 text-xs text-muted">
      <span>Source on GitHub:</span>
      <a href={REPO_URL} target="_blank" rel="noopener noreferrer" className={link}>
        Website
      </a>
      <span aria-hidden="true">·</span>
      <a href={DESKTOP_URL} target="_blank" rel="noopener noreferrer" className={link}>
        Desktop app
      </a>
      <span aria-hidden="true">·</span>
      <span>{LICENCE}</span>
      <span aria-hidden="true">·</span>
      <Link to="/privacy" className={link}>
        Privacy
      </Link>
    </footer>
  );
}

/**
 * "Try the demo": signs in as the site's shared demo account, shown only
 * while an admin has it switched on (Admin › Settings › Demo account).
 */
function TryDemo({ next }: { next: string }) {
  const qc = useQueryClient();
  const go = useMutation({
    mutationFn: api.tryDemo,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['me'] });
      window.location.href = next;
    },
  });
  return (
    <div className="space-y-2 border-t border-line pt-4 text-center">
      <button
        type="button"
        onClick={() => go.mutate()}
        disabled={go.isPending}
        className="w-full rounded-lg border border-border px-4 py-2 hover:bg-soft disabled:opacity-50"
      >
        {go.isPending ? 'Opening the demo…' : 'Try the demo'}
      </button>
      <p className="text-xs text-muted">No account needed. The demo is shared and resets itself, so don’t keep anything there.</p>
      {go.error && <p className="text-sm text-danger">{go.error.message}</p>}
    </div>
  );
}

function PasswordForm({ next }: { next: string }) {
  const qc = useQueryClient();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  // Set after a successful registration — password signups no longer log
  // straight in; the account needs to click the emailed link first.
  const [awaitingVerification, setAwaitingVerification] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () =>
      mode === 'login'
        ? api.passwordLogin(email, password)
        : api.passwordRegister(email, password, name.trim()),
    onSuccess: () => {
      if (mode === 'register') {
        setAwaitingVerification(email);
        return;
      }
      qc.invalidateQueries({ queryKey: ['me'] });
      window.location.href = next;
    },
    onError: (e: Error) => setError(e.message),
  });

  const resend = useMutation({
    mutationFn: () => api.resendVerification(email),
  });

  if (awaitingVerification) {
    return (
      <div className="space-y-3 border-t border-line pt-4 text-center">
        <p className="text-sm text-neutral-300">
          Check <span className="font-medium text-ink">{awaitingVerification}</span> for a
          confirmation link to finish creating your account.
        </p>
        <button
          type="button"
          onClick={() => resend.mutate()}
          disabled={resend.isPending || resend.isSuccess}
          className="text-sm text-accent-text hover:underline disabled:opacity-50"
        >
          {resend.isSuccess ? 'Email sent — check your inbox' : "Didn't get it? Resend"}
        </button>
      </div>
    );
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        if (mode === 'register' && name.includes('@')) {
          setError('Other people see your name, so it can’t be an email address. Try your first name or a nickname.');
          return;
        }
        mutation.mutate();
      }}
      className="space-y-3 border-t border-line pt-4"
    >
      {mode === 'register' && (
        <div>
          <div className="mb-1 flex items-center gap-1 text-sm text-muted">
            <label htmlFor="signup-name">Your name (shown to others)</label>
            <HelpButton helpKey="account.publicName" target="#signup-name" />
          </div>
          <input
            id="signup-name"
            type="text"
            placeholder="e.g. Sam, or Sam from ArkLUG"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            maxLength={60}
            autoComplete="nickname"
            className="w-full rounded-lg border border-border bg-soft px-3 py-2"
          />
        </div>
      )}
      <input
        type="email"
        placeholder="Email"
        aria-label="Email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        required
        className="w-full rounded-lg border border-border bg-soft px-3 py-2"
      />
      <input
        type="password"
        placeholder="Password"
        aria-label="Password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        required
        minLength={8}
        className="w-full rounded-lg border border-border bg-soft px-3 py-2"
      />
      {mode === 'register' && (
        <p className="text-xs text-muted" data-testid="signup-privacy">
          We keep your email to sign you in and send you what you ask for. How this site looks after your data:{' '}
          <Link to="/privacy" className="text-accent-text hover:underline">
            Privacy
          </Link>
          .
        </p>
      )}
      {error && (
        <div className="text-sm text-danger">
          <p>{error}</p>
          {mode === 'login' && error.toLowerCase().includes('verify') && (
            <button
              type="button"
              onClick={() => resend.mutate()}
              disabled={resend.isPending || resend.isSuccess}
              className="mt-1 text-accent-text hover:underline disabled:opacity-50"
            >
              {resend.isSuccess ? 'Email sent — check your inbox' : 'Resend confirmation email'}
            </button>
          )}
        </div>
      )}
      <button
        type="submit"
        disabled={mutation.isPending}
        className="w-full rounded-lg bg-accent text-accent-ink py-2 hover:bg-accent-hover disabled:opacity-50"
      >
        {mode === 'login' ? 'Sign in' : 'Create account'}
      </button>
      <button
        type="button"
        onClick={() => setMode(mode === 'login' ? 'register' : 'login')}
        className="w-full text-sm text-muted hover:underline"
      >
        {mode === 'login' ? 'Need an account?' : 'Already have an account?'}
      </button>
    </form>
  );
}

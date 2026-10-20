import { useEffect, useRef } from 'react';
import { Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { safeNext } from './signIn';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import { SetPasswordForm } from './SetPasswordForm';

/**
 * Email-verification landing (POST /api/auth/password/verify-email/:token).
 * Unlike an invite, there's no identity to match — the token itself is
 * the proof — so this simply fires the request on mount and, on success,
 * the server has already set the session cookie: refresh `me` and go
 * on to `?next=` (where they were going when they signed up, e.g. a club
 * invite), else Home. On failure (expired/invalid/already used) show the error with a
 * link back to /login where the user can request a fresh one. When the
 * server says the account has no password (the link wasn't opened in the
 * browser that signed up, or it was a "choose a password" link), the page
 * asks for one before going on.
 */
export function VerifyEmailPage() {
  const params = useParams<{ token: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [params2] = useSearchParams();
  const next = safeNext(params2.get('next'));

  const verify = useMutation({
    mutationFn: () => api.verifyEmail(params.token!),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['me'] });
      if (res.needsPassword) return;
      setTimeout(() => navigate(next, { replace: true }), 600);
    },
  });

  // A link works once: send it once, even when React runs the effect twice (StrictMode).
  const sentFor = useRef<string | null>(null);
  useEffect(() => {
    if (params.token && sentFor.current !== params.token) {
      sentFor.current = params.token;
      verify.mutate();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.token]);

  if (!params.token) return <Navigate to="/" replace />;

  return (
    <div className="grid min-h-screen place-items-center px-4">
      <div className="w-full max-w-sm space-y-4 rounded-lg border border-line bg-panel p-8 text-center shadow-sm">
        <img src="/logo.png" alt="" className="mx-auto h-12 w-12 rounded-lg" />
        {verify.isSuccess && !verify.data.needsPassword && <p className="text-neutral-300">Email verified! Taking you in…</p>}
        {verify.isSuccess && verify.data.needsPassword && (
          <>
            <h1 className="text-lg font-semibold">Choose a password</h1>
            <p className="text-sm text-muted">
              Your email is confirmed and you’re signed in. Pick a password to sign in with next time.
            </p>
            <SetPasswordForm submitLabel="Save and continue" onDone={() => navigate(next, { replace: true })} />
          </>
        )}
        {verify.isError && (
          <>
            <p className="text-danger">{(verify.error as Error).message}</p>
            <a href="/login" className="tap-target inline-flex items-center text-sm text-accent-text hover:underline">
              Back to sign in
            </a>
          </>
        )}
        {!verify.isSuccess && !verify.isError && <p className="text-muted">Verifying…</p>}
      </div>
    </div>
  );
}

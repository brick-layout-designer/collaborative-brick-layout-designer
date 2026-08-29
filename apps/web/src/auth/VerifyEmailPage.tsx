import { useEffect } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';

/**
 * Email-verification landing (POST /api/auth/password/verify-email/:token).
 * Unlike an invite, there's no identity to match — the token itself is
 * the proof — so this simply fires the request on mount and, on success,
 * the server has already set the session cookie: refresh `me` and go
 * home. On failure (expired/invalid/already used) show the error with a
 * link back to /login where the user can request a fresh one.
 */
export function VerifyEmailPage() {
  const params = useParams<{ token: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const verify = useMutation({
    mutationFn: () => api.verifyEmail(params.token!),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['me'] });
      setTimeout(() => navigate('/', { replace: true }), 600);
    },
  });

  useEffect(() => {
    if (params.token && !verify.isPending && !verify.isSuccess && !verify.isError) {
      verify.mutate();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.token]);

  if (!params.token) return <Navigate to="/" replace />;

  return (
    <div className="grid min-h-screen place-items-center px-4">
      <div className="w-full max-w-sm space-y-4 rounded-lg border border-neutral-800 bg-neutral-900 p-8 text-center shadow">
        <img src="/logo.png" alt="" className="mx-auto h-12 w-12 rounded" />
        {verify.isSuccess && <p className="text-neutral-300">Email verified! Taking you in…</p>}
        {verify.isError && (
          <>
            <p className="text-red-400">{(verify.error as Error).message}</p>
            <a href="/login" className="block text-sm text-blue-400 hover:underline">
              Back to sign in
            </a>
          </>
        )}
        {!verify.isSuccess && !verify.isError && <p className="text-neutral-400">Verifying…</p>}
      </div>
    </div>
  );
}

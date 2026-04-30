import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';

export function LoginPage() {
  const me = useQuery({ queryKey: ['me'], queryFn: api.me });
  const providers = useQuery({ queryKey: ['providers'], queryFn: api.providers });
  if (me.data?.user) return <Navigate to="/" replace />;

  return (
    <div className="grid min-h-screen place-items-center px-4">
      <div className="w-full max-w-sm space-y-6 rounded-lg border border-neutral-800 bg-neutral-900 p-8 shadow">
        <h1 className="text-center text-xl font-semibold">Sign in to Collaborative Brick Layout Designer</h1>

        <div className="space-y-2">
          {providers.data?.providers
            .filter((p) => p.enabled)
            .map((p) => (
              <a
                key={p.id}
                href={`/api/auth/${p.id}`}
                className="block rounded border border-neutral-700 px-4 py-2 text-center hover:bg-neutral-800"
              >
                Continue with {p.label}
              </a>
            ))}
          {providers.data && providers.data.providers.every((p) => !p.enabled) && (
            <p className="text-center text-sm text-neutral-500">
              No OAuth providers configured.
            </p>
          )}
        </div>

        {providers.data?.passwordEnabled && <PasswordForm />}
      </div>
    </div>
  );
}

function PasswordForm() {
  const qc = useQueryClient();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () =>
      mode === 'login'
        ? api.passwordLogin(email, password)
        : api.passwordRegister(email, password),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['me'] });
      window.location.href = '/';
    },
    onError: (e: Error) => setError(e.message),
  });

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        mutation.mutate();
      }}
      className="space-y-3 border-t border-neutral-800 pt-4"
    >
      <input
        type="email"
        placeholder="Email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        required
        className="w-full rounded border border-neutral-700 bg-neutral-800 px-3 py-2"
      />
      <input
        type="password"
        placeholder="Password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        required
        minLength={8}
        className="w-full rounded border border-neutral-700 bg-neutral-800 px-3 py-2"
      />
      {error && <p className="text-sm text-red-400">{error}</p>}
      <button
        type="submit"
        disabled={mutation.isPending}
        className="w-full rounded bg-blue-600 py-2 hover:bg-blue-500 disabled:opacity-50"
      >
        {mode === 'login' ? 'Sign in' : 'Create account'}
      </button>
      <button
        type="button"
        onClick={() => setMode(mode === 'login' ? 'register' : 'login')}
        className="w-full text-sm text-neutral-400 hover:underline"
      >
        {mode === 'login' ? 'Need an account?' : 'Already have an account?'}
      </button>
    </form>
  );
}

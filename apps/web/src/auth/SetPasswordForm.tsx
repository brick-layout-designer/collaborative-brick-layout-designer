import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';

/**
 * Choose a password for an account that has none yet: after confirming
 * an email address from a link that asks for a new one, or for an
 * account that has only signed in with GitHub/Google so far.
 */
export function SetPasswordForm({ onDone, submitLabel = 'Save password' }: { onDone?: () => void; submitLabel?: string }) {
  const qc = useQueryClient();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: () => api.setPassword(password),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['me'] });
      onDone?.();
    },
    onError: (e: Error) => setError(e.message),
  });

  if (save.isSuccess && !onDone) return <p className="text-sm text-emerald-400">Password saved. You can sign in with it from now on.</p>;

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        if (password.length < 8) {
          setError('Use at least 8 characters.');
          return;
        }
        if (password !== confirm) {
          setError('The two passwords don’t match.');
          return;
        }
        save.mutate();
      }}
      className="space-y-2 text-left"
    >
      <input
        type="password"
        aria-label="New password"
        placeholder="New password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        required
        minLength={8}
        maxLength={128}
        autoComplete="new-password"
        className="w-full rounded-lg border border-border bg-soft px-3 py-2"
      />
      <input
        type="password"
        aria-label="New password again"
        placeholder="New password again"
        value={confirm}
        onChange={(e) => setConfirm(e.target.value)}
        required
        minLength={8}
        maxLength={128}
        autoComplete="new-password"
        className="w-full rounded-lg border border-border bg-soft px-3 py-2"
      />
      {error && <p className="text-sm text-danger">{error}</p>}
      <button
        type="submit"
        disabled={save.isPending}
        className="w-full rounded-lg bg-accent py-2 text-accent-ink hover:bg-accent-hover disabled:opacity-50"
      >
        {save.isPending ? 'Saving…' : submitLabel}
      </button>
    </form>
  );
}

import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import { AppHeader } from '../AppHeader';

export function ProfilePage() {
  const qc = useQueryClient();
  const me = useQuery({ queryKey: ['me'], queryFn: api.me });
  const providers = useQuery({ queryKey: ['providers'], queryFn: api.providers });

  const [editing, setEditing] = useState(false);
  const [draftName, setDraftName] = useState('');
  const [error, setError] = useState<string | null>(null);

  const saveName = useMutation({
    mutationFn: (displayName: string) => api.updateDisplayName(displayName),
    onSuccess: () => {
      setEditing(false);
      setError(null);
      // Awareness (live cursors/presence) reads displayName from this
      // same cached `me` query — see useAwareness.ts — so invalidating
      // it is also what makes a rename show up for peers in an open
      // editor session on the next presence broadcast.
      qc.invalidateQueries({ queryKey: ['me'] });
    },
    onError: (e: Error) => setError(e.message),
  });

  if (me.isLoading) return <div className="p-8 text-neutral-500">Loading…</div>;
  if (!me.data?.user) return <Navigate to="/login" replace />;
  const user = me.data.user;

  return (
    <div className="h-full overflow-y-auto p-8">
      <AppHeader user={user} />
      <main className="mx-auto mt-8 max-w-2xl space-y-6">
        <header className="flex items-center gap-4">
          {user.avatarUrl && <img src={user.avatarUrl} alt="" className="h-16 w-16 rounded-full" />}
          <div className="flex-1">
            {editing ? (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const trimmed = draftName.trim();
                  if (trimmed) saveName.mutate(trimmed);
                }}
                className="flex items-center gap-2"
              >
                <input
                  autoFocus
                  value={draftName}
                  onChange={(e) => setDraftName(e.target.value)}
                  maxLength={60}
                  className="rounded border border-neutral-700 bg-neutral-800 px-2 py-1 text-xl font-semibold"
                />
                <button
                  type="submit"
                  disabled={saveName.isPending || draftName.trim() === ''}
                  className="rounded bg-blue-600 px-3 py-1 text-sm hover:bg-blue-500 disabled:opacity-50"
                >
                  Save
                </button>
                <button
                  type="button"
                  onClick={() => { setEditing(false); setError(null); }}
                  className="text-sm text-neutral-400 hover:underline"
                >
                  Cancel
                </button>
              </form>
            ) : (
              <h1 className="flex items-center gap-2 text-xl font-semibold">
                {user.displayName}
                <button
                  onClick={() => { setDraftName(user.displayName); setEditing(true); }}
                  className="text-xs font-normal text-blue-400 hover:underline"
                >
                  Edit
                </button>
              </h1>
            )}
            {error && <p className="mt-1 text-sm text-red-400">{error}</p>}
            <p className="text-sm text-neutral-400">{user.email}</p>
            {user.isDemoAccount && (
              <p className="text-xs text-amber-400">Demo account</p>
            )}
          </div>
        </header>

        <section className="space-y-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-400">
            Linked sign-in methods
          </h2>
          <ul className="rounded border border-neutral-800">
            {providers.data?.providers.map((p) => {
              const linked = user.linkedProviders.includes(p.id);
              return (
                <li
                  key={p.id}
                  className="flex items-center justify-between border-b border-neutral-800 px-4 py-2 last:border-b-0"
                >
                  <span className={p.enabled ? '' : 'text-neutral-500'}>{p.label}</span>
                  {linked ? (
                    <span className="text-sm text-emerald-400">linked</span>
                  ) : p.enabled ? (
                    <a href={`/api/auth/${p.id}`} className="text-sm text-blue-400 hover:underline">
                      link
                    </a>
                  ) : (
                    <span className="text-sm text-neutral-500">disabled</span>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      </main>
    </div>
  );
}

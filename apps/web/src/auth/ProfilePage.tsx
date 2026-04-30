import { Navigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api';
import { AppHeader } from '../AppHeader';

export function ProfilePage() {
  const me = useQuery({ queryKey: ['me'], queryFn: api.me });
  const providers = useQuery({ queryKey: ['providers'], queryFn: api.providers });

  if (me.isLoading) return <div className="p-8 text-neutral-500">Loading…</div>;
  if (!me.data?.user) return <Navigate to="/login" replace />;
  const user = me.data.user;

  return (
    <div className="h-full overflow-y-auto p-8">
      <AppHeader user={user} />
      <main className="mx-auto mt-8 max-w-2xl space-y-6">
        <header className="flex items-center gap-4">
          {user.avatarUrl && <img src={user.avatarUrl} alt="" className="h-16 w-16 rounded-full" />}
          <div>
            <h1 className="text-xl font-semibold">{user.displayName}</h1>
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

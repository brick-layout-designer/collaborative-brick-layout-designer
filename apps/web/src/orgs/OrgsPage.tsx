import { useState, type FormEvent } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import { AppHeader } from '../AppHeader';

/** /orgs landing — list orgs the user is a member of, plus a create button. */
export function OrgsPage() {
  const list = useQuery({ queryKey: ['orgs'], queryFn: api.orgs.list });
  const me = useQuery({ queryKey: ['me'], queryFn: api.me });
  const [showCreate, setShowCreate] = useState(false);

  if (me.isLoading) return <div className="p-8 text-neutral-500">Loading…</div>;
  if (!me.data?.user) return <Navigate to="/login" replace />;

  return (
    <div className="h-full overflow-y-auto p-8">
      <AppHeader user={me.data.user} />
      <main className="mx-auto mt-8 max-w-3xl space-y-4">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-semibold">Organizations</h1>
          {!me.data.user.isDemoAccount && (
            <button
              onClick={() => setShowCreate(true)}
              className="rounded bg-blue-600 px-3 py-1.5 text-sm hover:bg-blue-500"
            >
              New org
            </button>
          )}
        </div>

        {list.isLoading && <p className="text-neutral-500">Loading…</p>}
        {list.data && (list.data.orgs.length === 0 ? (
          <p className="rounded border border-dashed border-neutral-700 p-8 text-center text-neutral-500">
            You're not a member of any organizations yet.
          </p>
        ) : (
          <ul className="divide-y divide-neutral-800 rounded border border-neutral-800">
            {list.data.orgs.map((o) => (
              <li key={o.id} className="flex items-center justify-between px-4 py-3">
                <div>
                  <Link to={`/orgs/${o.slug}`} className="font-medium hover:underline">
                    {o.name}
                  </Link>
                  <p className="text-xs text-neutral-500">
                    /{o.slug} · you are {o.myRole}
                  </p>
                </div>
                <Link
                  to={`/orgs/${o.slug}`}
                  className="rounded border border-neutral-700 px-3 py-1 text-sm hover:bg-neutral-800"
                >
                  Open
                </Link>
              </li>
            ))}
          </ul>
        ))}

        {showCreate && <CreateOrgDialog onClose={() => setShowCreate(false)} />}
      </main>
    </div>
  );
}

/**
 * Slug-from-name: lowercase, replace anything non-alnum with `-`,
 * collapse consecutive `-`, trim leading/trailing `-`, cap at 40
 * chars, fall back to `org` when the name has no usable characters.
 * Constraint matches the server's validator (a-z0-9 + hyphens, 1–40).
 */
export function slugifyOrgName(name: string): string {
  const cleaned = name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/^-+|-+$/g, '');
  return cleaned || 'org';
}

function CreateOrgDialog({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  // Slug is server-side derived now; we only show a preview here.
  const slug = slugifyOrgName(name);
  const create = useMutation({
    mutationFn: () => api.orgs.create(name.trim()),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['orgs'] });
      onClose();
    },
    onError: (e: Error) => setError(e.message),
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    create.mutate();
  }

  return (
    <div className="fixed inset-0 grid place-items-center bg-black/60 p-4">
      <form
        onSubmit={submit}
        className="w-full max-w-md space-y-4 rounded-lg border border-neutral-800 bg-neutral-900 p-6"
      >
        <h3 className="text-lg font-semibold">New organization</h3>
        <label className="block text-sm">
          <span className="mb-1 block text-neutral-400">Name</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            placeholder="Acme Bricks"
            className="w-full rounded border border-neutral-700 bg-neutral-800 px-3 py-2"
          />
          {/* Slug is auto-derived from the name and kept read-only —
              users found the manual two-field form annoying, and the
              slug is mostly an implementation detail (it shows up in
              URLs but nobody cares whether it's `acme` vs `acme-bricks`). */}
          <p className="mt-1 text-xs text-neutral-500">
            URL: <span className="text-neutral-300">/orgs/{slug}</span>
          </p>
        </label>
        {error && <p className="text-sm text-red-400">{error}</p>}
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-neutral-700 px-4 py-2 hover:bg-neutral-800"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={create.isPending || name.trim().length === 0}
            className="rounded bg-blue-600 px-4 py-2 hover:bg-blue-500 disabled:opacity-50"
          >
            Create
          </button>
        </div>
      </form>
    </div>
  );
}

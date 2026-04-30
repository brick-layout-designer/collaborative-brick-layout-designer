import { Link, Navigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api, type OrgMemberSummary, type OrgPartLibrary } from '../api';
import { AppHeader } from '../AppHeader';

export function OrgDetailPage() {
  const params = useParams<{ slug: string }>();
  if (!params.slug) return <Navigate to="/orgs" replace />;
  return <OrgDetail slug={params.slug} />;
}

function OrgDetail({ slug }: { slug: string }) {
  const me = useQuery({ queryKey: ['me'], queryFn: api.me });
  const detail = useQuery({ queryKey: ['org', slug], queryFn: () => api.orgs.get(slug) });
  const members = useQuery({
    queryKey: ['org-members', slug],
    queryFn: () => api.orgs.members(slug),
  });
  const layouts = useQuery({
    queryKey: ['org-layouts', slug],
    queryFn: () => api.orgs.layouts(slug),
  });

  if (me.isLoading || detail.isLoading) {
    return <div className="grid h-screen place-items-center text-neutral-500">Loading…</div>;
  }
  if (!me.data?.user) return <Navigate to="/login" replace />;
  if (detail.isError) {
    return (
      <div className="grid h-screen place-items-center">
        <div className="rounded border border-red-900 bg-red-950/30 p-4 text-sm">
          <p className="font-semibold text-red-400">Organization not found.</p>
          <Link to="/orgs" className="mt-2 inline-block text-blue-400 hover:underline">← back</Link>
        </div>
      </div>
    );
  }

  const org = detail.data!;
  const isAdmin = org.myRole === 'admin';
  const myUserId = me.data.user.id;

  return (
    <div className="h-full overflow-y-auto p-8">
      <AppHeader user={me.data.user} />
      <main className="mx-auto mt-8 max-w-4xl space-y-6">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-semibold">{org.name}</h1>
            <p className="text-sm text-neutral-500">
              /{org.slug} · you are {org.myRole}
            </p>
          </div>
          {isAdmin && (
            <Link
              to={`/orgs/${slug}/admin`}
              className="rounded border border-neutral-700 px-3 py-1.5 text-sm hover:bg-neutral-800"
            >
              Org settings →
            </Link>
          )}
        </div>

        <section>
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-neutral-400">
            Members
          </h2>
          {members.isLoading ? (
            <p className="text-sm text-neutral-500">Loading…</p>
          ) : (
            <MembersList
              myUserId={myUserId}
              members={members.data?.members ?? []}
            />
          )}
        </section>

        <section>
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-neutral-400">
            Org-owned layouts
          </h2>
          {layouts.isLoading && <p className="text-sm text-neutral-500">Loading…</p>}
          {layouts.data &&
            (layouts.data.layouts.length === 0 ? (
              <p className="rounded border border-dashed border-neutral-800 p-4 text-sm text-neutral-500">
                No layouts owned by this org yet. Open a personal layout and use{' '}
                <em>Transfer</em> to move it here.
              </p>
            ) : (
              <ul className="divide-y divide-neutral-800 rounded border border-neutral-800">
                {layouts.data.layouts.map((l) => (
                  <li key={l.id} className="flex items-center justify-between px-3 py-2 text-sm">
                    <div>
                      <p>{l.title}</p>
                      <p className="text-xs text-neutral-500">
                        updated {new Date(l.updatedAt).toLocaleString()}
                      </p>
                    </div>
                    <Link
                      to={`/editor/${l.id}`}
                      className="rounded bg-blue-600 px-3 py-1 hover:bg-blue-500"
                    >
                      Open
                    </Link>
                  </li>
                ))}
              </ul>
            ))}
        </section>

        <section>
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-neutral-400">
            Part libraries
          </h2>
          <OrgPartLibraries slug={slug} />
        </section>
      </main>
    </div>
  );
}

function MembersList({
  myUserId,
  members,
}: {
  myUserId: string;
  members: OrgMemberSummary[];
}) {
  return (
    <ul className="divide-y divide-neutral-800 rounded border border-neutral-800">
      {members.map((m) => {
        const isSelf = m.userId === myUserId;
        return (
          <li key={m.userId} className="flex items-center justify-between px-3 py-2 text-sm">
            <div>
              <p>
                {m.displayName} {isSelf && <span className="text-xs text-neutral-500">(you)</span>}
              </p>
              <p className="text-xs text-neutral-500">{m.email}</p>
            </div>
            <span className="rounded bg-neutral-800 px-2 py-1 text-xs text-neutral-300">
              {m.role}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function OrgPartLibraries({ slug }: { slug: string }) {
  const libs = useQuery({
    queryKey: ['org-part-libraries', slug],
    queryFn: () => api.orgLibraries.list(slug),
  });

  if (libs.isLoading) return <p className="text-sm text-neutral-500">Loading…</p>;
  if (!libs.data || libs.data.libraries.length === 0) {
    return (
      <p className="text-sm text-neutral-500">
        No part libraries installed.
      </p>
    );
  }

  return (
    <div className="overflow-auto rounded border border-neutral-800">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-neutral-800 text-left text-xs text-neutral-500">
            <th className="px-3 py-2">Library</th>
            <th className="px-3 py-2">Parts</th>
            <th className="px-3 py-2">Enabled</th>
          </tr>
        </thead>
        <tbody>
          {libs.data.libraries.map((lib: OrgPartLibrary) => (
            <tr key={lib.id} className="border-b border-neutral-900 hover:bg-neutral-900/30">
              <td className="px-3 py-2">
                <span className="font-medium">{lib.name}</span>
                <span className="ml-2 font-mono text-xs text-neutral-500">{lib.slug}</span>
              </td>
              <td className="px-3 py-2 text-neutral-400">{lib.partCount.toLocaleString()}</td>
              <td className="px-3 py-2">
                <span className={lib.enabled ? 'text-emerald-400' : 'text-neutral-600'}>
                  {lib.enabled ? 'Yes' : 'No'}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

import { Link, Navigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api, type OrgMemberSummary, type OrgPartLibrary } from '../api';
import { AppHeader } from '../AppHeader';
import { VenueList } from '../venues/VenueList';

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
    return <div className="grid h-screen place-items-center text-muted">Loading…</div>;
  }
  if (!me.data?.user) return <Navigate to="/login" replace />;
  if (detail.isError) {
    return (
      <div className="grid h-screen place-items-center">
        <div className="rounded-lg border border-red-900 bg-red-950/30 p-4 text-sm">
          <p className="font-semibold text-danger">Organization not found.</p>
          <Link to="/orgs" className="mt-2 inline-block text-accent-text hover:underline">← back</Link>
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
            <p className="text-sm text-muted">
              /{org.slug} · you are {org.myRole}
            </p>
          </div>
          {isAdmin && (
            <Link
              to={`/orgs/${slug}/admin`}
              className="rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-soft"
            >
              Org settings →
            </Link>
          )}
        </div>

        <section>
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted">
            Members
          </h2>
          {members.isLoading ? (
            <p className="text-sm text-muted">Loading…</p>
          ) : (
            <MembersList
              myUserId={myUserId}
              members={members.data?.members ?? []}
            />
          )}
        </section>

        <section>
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted">
            Org-owned layouts
          </h2>
          {layouts.isLoading && <p className="text-sm text-muted">Loading…</p>}
          {layouts.data &&
            (layouts.data.layouts.length === 0 ? (
              <p className="rounded-lg border border-dashed border-line p-4 text-sm text-muted">
                No layouts owned by this org yet. Open a personal layout and use{' '}
                <em>Transfer</em> to move it here.
              </p>
            ) : (
              <ul className="divide-y divide-line rounded-lg border border-line">
                {layouts.data.layouts.map((l) => (
                  <li key={l.id} className="flex items-center justify-between px-3 py-2 text-sm">
                    <div>
                      <p>{l.title}</p>
                      <p className="text-xs text-muted">
                        updated {new Date(l.updatedAt).toLocaleString()}
                      </p>
                    </div>
                    <Link
                      to={`/editor/${l.id}`}
                      className="rounded-lg bg-accent text-accent-ink px-3 py-1 hover:bg-accent-hover"
                    >
                      Open
                    </Link>
                  </li>
                ))}
              </ul>
            ))}
        </section>

        <section>
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted">
            Venues
          </h2>
          <VenueList org={{ id: org.id, slug: org.slug }} canManage={isAdmin} />
        </section>

        <section>
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted">
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
    <ul className="divide-y divide-line rounded-lg border border-line">
      {members.map((m) => {
        const isSelf = m.userId === myUserId;
        return (
          <li key={m.userId} className="flex items-center justify-between px-3 py-2 text-sm">
            <div>
              <p>
                {m.displayName} {isSelf && <span className="text-xs text-muted">(you)</span>}
              </p>
              <p className="text-xs text-muted">{m.email}</p>
            </div>
            <span className="rounded-lg bg-soft px-2 py-1 text-xs text-neutral-300">
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

  if (libs.isLoading) return <p className="text-sm text-muted">Loading…</p>;
  if (!libs.data || libs.data.libraries.length === 0) {
    return (
      <p className="text-sm text-muted">
        No part libraries installed.
      </p>
    );
  }

  return (
    <div className="overflow-auto rounded-lg border border-line">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-line text-left text-xs text-muted">
            <th className="px-3 py-2">Library</th>
            <th className="px-3 py-2">Parts</th>
            <th className="px-3 py-2">Enabled</th>
          </tr>
        </thead>
        <tbody>
          {libs.data.libraries.map((lib: OrgPartLibrary) => (
            <tr key={lib.id} className="border-b border-line hover:bg-panel/30">
              <td className="px-3 py-2">
                <span className="font-medium">{lib.name}</span>
                <span className="ml-2 font-mono text-xs text-muted">{lib.slug}</span>
              </td>
              <td className="px-3 py-2 text-muted">{lib.partCount.toLocaleString()}</td>
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

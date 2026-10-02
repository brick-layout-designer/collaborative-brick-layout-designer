import { Link, Navigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api, type Me, type OrgPartLibrary } from '../api';
import { LeaveClubButton, MembersSection } from './ClubManage';
import { AppHeader } from '../AppHeader';
import { ClubPublicView } from './ClubDirectory';

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

  if (me.isLoading || detail.isLoading) {
    return <div className="grid h-screen place-items-center text-muted">Loading…</div>;
  }
  if (!me.data?.user) return <Navigate to="/login" replace />;
  if (detail.isError) {
    // Not a member: a listed club shows what anyone may see, and the join button.
    return <OutsideView slug={slug} user={me.data.user} />;
  }

  const org = detail.data!;
  const isAdmin = org.myRole === 'admin';
  const myUserId = me.data.user.id;

  return (
    <div className="h-full overflow-y-auto bg-bg p-4 text-ink sm:p-8">
      <AppHeader user={me.data.user} />
      <main className="mx-auto mt-6 max-w-3xl space-y-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <h1 className="break-words text-2xl font-semibold">{org.name}</h1>
            <p className="text-sm text-muted">
              {org.memberCount !== undefined && `${org.memberCount} ${org.memberCount === 1 ? 'member' : 'members'} · `}
              you are {isAdmin ? 'an admin' : 'a member'}
            </p>
            {org.description && <p className="mt-2 whitespace-pre-line text-sm">{org.description}</p>}
          </div>
          {isAdmin && (
            <Link
              to={`/orgs/${slug}/admin`}
              className="tap-target inline-flex shrink-0 items-center justify-center rounded-lg bg-accent px-3 py-1.5 text-sm font-semibold text-accent-ink hover:bg-accent-hover"
            >
              Manage the club
              {(org.pendingRequests ?? 0) > 0 && (
                <span className="ml-2 rounded-full bg-accent-ink px-1.5 text-xs text-accent">{org.pendingRequests}</span>
              )}
            </Link>
          )}
        </div>

        <ClubThings org={org} />

        {members.isLoading ? (
          <p className="text-sm text-muted">Loading…</p>
        ) : (
          <MembersSection slug={slug} myUserId={myUserId} isAdmin={false} members={members.data?.members ?? []} />
        )}

        <section className="space-y-2 rounded-section border border-line bg-panel p-4">
          <h2 className="text-lg font-semibold">Part libraries</h2>
          <OrgPartLibraries slug={slug} />
        </section>

        <LeaveClubButton org={org} myUserId={myUserId} />
      </main>
    </div>
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

/**
 * The club's layouts, venues and modules live in the one list on the home
 * page, next to your own; this sums them up and links there, filtered to
 * the club.
 */
function ClubThings({ org }: { org: { id: string; name: string; slug: string } }) {
  const layouts = useQuery({ queryKey: ['layouts'], queryFn: api.layouts.list });
  const venues = useQuery({ queryKey: ['venues'], queryFn: api.venues.list });
  const modules = useQuery({ queryKey: ['modules'], queryFn: api.modules.list });
  const count = (items: readonly { ownerOrgId: string | null }[] | undefined) =>
    items ? items.filter((i) => i.ownerOrgId === org.id).length : null;
  const tiles = [
    { label: 'Layouts', n: count(layouts.data?.layouts) },
    { label: 'Venues', n: count(venues.data?.venues) },
    { label: 'Modules', n: count(modules.data?.modules) },
  ];
  const to = `/?owner=${encodeURIComponent(org.slug)}`;
  return (
    <section aria-labelledby="club-things" className="space-y-3 rounded-section border border-line bg-panel p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="club-things" className="text-lg font-semibold">
          The club’s things
        </h2>
        <Link
          to={to}
          className="tap-target inline-flex items-center rounded-lg bg-accent px-3 py-1.5 text-sm font-semibold text-accent-ink hover:bg-accent-hover"
        >
          Open the club’s list
        </Link>
      </div>
      <ul className="grid grid-cols-3 gap-2">
        {tiles.map((t) => (
          <li key={t.label}>
            <Link to={to} className="tap-target block rounded-lg border border-line bg-soft px-3 py-2 text-center hover:border-accent">
              <span className="block text-2xl font-bold">{t.n ?? '…'}</span>
              <span className="text-xs text-muted">{t.label}</span>
            </Link>
          </li>
        ))}
      </ul>
      <p className="text-sm text-muted">
        They sit with your own things on the home page, marked “{org.name}”. To add one, choose {org.name} under “Save to”.
      </p>
    </section>
  );
}

/** Someone outside the club: a listed club's summary and join button, else "not found". */
function OutsideView({ slug, user }: { slug: string; user: Me }) {
  const summary = useQuery({ queryKey: ['club-summary', slug], queryFn: () => api.orgs.summary(slug), retry: false });
  return (
    <div className="h-full overflow-y-auto bg-bg p-4 text-ink sm:p-8">
      <AppHeader user={user} />
      <main className="mx-auto mt-6 max-w-3xl space-y-5">
        <p className="text-sm">
          <Link to="/orgs" className="tap-target inline-flex items-center text-accent-text hover:underline">
            ← Clubs
          </Link>
        </p>
        {summary.isLoading && <p className="text-muted">Loading…</p>}
        {summary.isError && (
          <div className="rounded-lg border border-red-900 bg-red-950/30 p-4 text-sm">
            <p className="font-semibold text-danger">Club not found.</p>
            <p className="mt-1 text-muted">It may be private. Ask one of its admins for an invite.</p>
          </div>
        )}
        {summary.data && <ClubPublicView club={summary.data} />}
      </main>
    </div>
  );
}

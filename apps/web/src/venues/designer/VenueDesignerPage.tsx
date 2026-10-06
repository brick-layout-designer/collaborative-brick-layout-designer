// Venue Designer pages for the venue library: /venues/new (?org=<slug> for
// an organisation's venue) and /venues/:id/design. The first save of a new
// venue creates it, and the page moves to its design address.

import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { Venue } from '@cld/bbm';
import { api } from '../../api';
import { normalizeVenue } from '../../editor/venueFile';
import { VenueDesigner } from './VenueDesigner';
import { emptyVenue } from './model';
import { SignInFirst } from '../../auth/signIn';

/** The club's name for "New venue for …" (its address until the list is in). */
function useClubName(org: string | null): string | null {
  const orgs = useQuery({ queryKey: ['orgs'], queryFn: api.orgs.list, enabled: !!org });
  if (!org) return null;
  return orgs.data?.orgs.find((o) => o.slug === org)?.name ?? org;
}

/** Venues are kept in an account: signed out, sign in first and come back. */
function useSignedIn(): 'loading' | boolean {
  const me = useQuery({ queryKey: ['me'], queryFn: api.me });
  return me.isLoading ? 'loading' : !!me.data?.user;
}

function back(navigate: ReturnType<typeof useNavigate>, org: string | null) {
  navigate(org ? `/orgs/${org}` : '/');
}

export function NewVenuePage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [params] = useSearchParams();
  const org = params.get('org');
  const club = useClubName(org);
  const signedIn = useSignedIn();
  if (signedIn === 'loading') return <div className="grid h-full place-items-center text-muted">Loading…</div>;
  if (!signedIn) return <SignInFirst />;
  return (
    <VenueDesigner
      initial={emptyVenue()}
      subtitle={club ? `New venue for ${club}` : 'New venue in your library'}
      onSave={async (v: Venue) => {
        const created = await api.venues.create({ name: v.name.trim() || 'Venue', data: v, ...(org ? { orgSlug: org } : {}) });
        await qc.invalidateQueries({ queryKey: ['venues'] });
        navigate(`/venues/${created.id}/design${org ? `?org=${encodeURIComponent(org)}` : ''}`, { replace: true });
      }}
      onClose={() => back(navigate, org)}
    />
  );
}

export function VenueDesignPage() {
  const { id = '' } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [params] = useSearchParams();
  const org = params.get('org');
  const club = useClubName(org);
  const signedIn = useSignedIn();
  const venue = useQuery({ queryKey: ['venue', id], queryFn: () => api.venues.get(id), enabled: signedIn === true });

  if (signedIn === false) return <SignInFirst />;
  if (signedIn === 'loading' || venue.isLoading) return <div className="grid h-full place-items-center text-muted">Loading venue…</div>;
  if (venue.isError || !venue.data) {
    return (
      <div className="grid h-full place-items-center">
        <div className="rounded-lg border border-red-900 bg-red-950/30 p-4 text-sm">
          <p className="font-semibold text-danger">Could not open this venue.</p>
          <button type="button" onClick={() => back(navigate, org)} className="mt-2 text-accent-text hover:underline">
            ← back
          </button>
        </div>
      </div>
    );
  }
  const initial = { ...normalizeVenue(venue.data.data), name: venue.data.name };
  return (
    <VenueDesigner
      key={id}
      initial={initial}
      subtitle={club ? `Venue of ${club}` : 'Venue in your library'}
      onSave={async (v: Venue) => {
        await api.venues.update(id, v);
        const name = v.name.trim();
        if (name && name !== venue.data.name) await api.venues.rename(id, name);
        await qc.invalidateQueries({ queryKey: ['venues'] });
        await qc.invalidateQueries({ queryKey: ['venue', id] });
      }}
      onClose={() => back(navigate, org)}
    />
  );
}

// "Mine and my clubs' things together": the owner filter on the home
// page (All · Mine · each club), remembered between visits, and the
// owner chip's words. The same filter picks where new things are saved.

import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { OrgSummary, OwnerInfo } from '../api';

/** 'all', 'me', or a club's slug. */
export type OwnerFilter = string;

export const OWNER_FILTER_KEY = 'cld:ownerFilter';

/** What an item needs for the filter and the chip. */
export interface OwnedItem {
  ownerUserId?: string | null;
  ownerOrgId: string | null;
  owner?: OwnerInfo | null;
}

export function readOwnerFilter(): OwnerFilter {
  try {
    return localStorage.getItem(OWNER_FILTER_KEY) || 'all';
  } catch {
    return 'all';
  }
}

function writeOwnerFilter(f: OwnerFilter): void {
  try {
    localStorage.setItem(OWNER_FILTER_KEY, f);
  } catch {
    /* private window: just not remembered */
  }
}

/**
 * A filter that names a club you're no longer in (or a stale value)
 * falls back to All, so the list never comes up empty for no reason.
 */
export function validOwnerFilter(f: OwnerFilter, orgs: readonly Pick<OrgSummary, 'slug'>[] | undefined): OwnerFilter {
  if (f === 'all' || f === 'me') return f;
  if (!orgs) return f; // clubs still loading: keep it
  return orgs.some((o) => o.slug === f) ? f : 'all';
}

/** The club slug that owns `item`, or null for a person. */
export function itemOrgSlug(item: OwnedItem, orgs: readonly Pick<OrgSummary, 'id' | 'slug'>[] | undefined): string | null {
  if (!item.ownerOrgId) return null;
  if (item.owner?.kind === 'org' && item.owner.slug) return item.owner.slug;
  return orgs?.find((o) => o.id === item.ownerOrgId)?.slug ?? null;
}

export function matchesOwnerFilter(
  item: OwnedItem,
  filter: OwnerFilter,
  myUserId: string | undefined,
  orgs: readonly Pick<OrgSummary, 'id' | 'slug'>[] | undefined,
): boolean {
  if (filter === 'all') return true;
  if (filter === 'me') {
    // Items from older servers have no ownerUserId: no club means it's yours or shared with you.
    if (item.ownerOrgId) return false;
    return item.ownerUserId === undefined || item.ownerUserId === myUserId;
  }
  return itemOrgSlug(item, orgs) === filter;
}

/** The chip's words: "Me", the club's name, or who shared it with you. */
export function ownerLabel(
  item: OwnedItem,
  myUserId: string | undefined,
  orgs: readonly Pick<OrgSummary, 'id' | 'name'>[] | undefined,
): { text: string; kind: 'me' | 'club' | 'shared' } {
  if (item.ownerOrgId) {
    const name = item.owner?.kind === 'org' ? item.owner.name : orgs?.find((o) => o.id === item.ownerOrgId)?.name;
    return { text: name ?? 'Club', kind: 'club' };
  }
  if (!item.ownerUserId || item.ownerUserId === myUserId) return { text: 'Me', kind: 'me' };
  return { text: item.owner?.name ? `Shared by ${item.owner.name}` : 'Shared with me', kind: 'shared' };
}

/**
 * The home page's owner filter. `?owner=<all|me|club>` in the address
 * (the club page links here that way) wins and is remembered; otherwise
 * the last one picked.
 */
export function useOwnerFilter(orgs: readonly Pick<OrgSummary, 'slug'>[] | undefined): [OwnerFilter, (f: OwnerFilter) => void] {
  const [params] = useSearchParams();
  const fromUrl = params.get('owner');
  const [filter, setFilterState] = useState<OwnerFilter>(() => fromUrl || readOwnerFilter());
  useEffect(() => {
    if (fromUrl) {
      setFilterState(fromUrl);
      writeOwnerFilter(fromUrl);
    }
  }, [fromUrl]);
  const setFilter = useCallback((f: OwnerFilter) => {
    setFilterState(f);
    writeOwnerFilter(f);
  }, []);
  return [validOwnerFilter(filter, orgs), setFilter];
}

/** Where "Save to" starts: the club being shown, else Me (empty string). */
export function defaultSaveTo(filter: OwnerFilter): string {
  return filter === 'all' || filter === 'me' ? '' : filter;
}

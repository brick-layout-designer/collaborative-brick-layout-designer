// "Mine and my clubs' things together": the owner filter on the home
// page (All · Mine · each club), remembered between visits, and the
// owner chip's words. The same filter picks where new things are saved.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { Credit, OrgSummary, OwnerInfo } from '../api';

/** 'all', 'me', or a club's slug. */
export type OwnerFilter = string;

/** Older builds kept one filter per browser under this key; it's ignored now. */
export const OWNER_FILTER_KEY = 'cld:ownerFilter';

/**
 * Where the last choice is kept: per person and per server, so a shared
 * computer (or a second server) never opens on someone else's club.
 */
export function ownerFilterKey(userId: string, origin: string = currentOrigin()): string {
  return `${OWNER_FILTER_KEY}:${origin}:${userId}`;
}

function currentOrigin(): string {
  try {
    return window.location.origin;
  } catch {
    return '';
  }
}

/** What an item needs for the filter and the chip. */
export interface OwnedItem {
  ownerUserId?: string | null;
  ownerOrgId: string | null;
  owner?: OwnerInfo | null;
}

/** The last choice this person made here, or All on a first visit. */
export function readOwnerFilter(userId: string | undefined): OwnerFilter {
  if (!userId) return 'all';
  try {
    return localStorage.getItem(ownerFilterKey(userId)) || 'all';
  } catch {
    return 'all';
  }
}

export function writeOwnerFilter(userId: string | undefined, f: OwnerFilter): void {
  if (!userId) return;
  try {
    localStorage.setItem(ownerFilterKey(userId), f);
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
 * (the club page links here that way) wins for that visit; otherwise the
 * last one this person picked, and All the first time. Only a pick is
 * remembered, so following a club page's link doesn't change what Home
 * opens on later. A remembered club they've left, or that was deleted,
 * comes back as All (and is forgotten).
 */
export function useOwnerFilter(
  orgs: readonly Pick<OrgSummary, 'slug'>[] | undefined,
  userId: string | undefined,
): [OwnerFilter, (f: OwnerFilter) => void] {
  const [params] = useSearchParams();
  const fromUrl = params.get('owner');
  // What was picked on this page. It counts only for the same person and
  // the same address, so a new ?owner= link wins over an earlier pick.
  const [picked, setPicked] = useState<{ userId: string | undefined; url: string | null; filter: OwnerFilter } | null>(null);
  const stored = useMemo(() => readOwnerFilter(userId), [userId]);
  const live = picked && picked.userId === userId && picked.url === fromUrl ? picked : null;
  const raw = live ? live.filter : fromUrl || stored;
  const filter = validOwnerFilter(raw, orgs);
  useEffect(() => {
    // Forget a remembered club that's gone, so the next visit doesn't try it again.
    if (orgs && userId && !fromUrl && !live && filter !== stored) writeOwnerFilter(userId, filter);
  }, [orgs, userId, fromUrl, live, filter, stored]);
  const setFilter = useCallback(
    (f: OwnerFilter) => {
      setPicked({ userId, url: fromUrl, filter: f });
      writeOwnerFilter(userId, f);
    },
    [userId, fromUrl],
  );
  return [filter, setFilter];
}

/** Where "Save to" starts: the club being shown, else Me (empty string). */
export function defaultSaveTo(filter: OwnerFilter): string {
  return filter === 'all' || filter === 'me' ? '' : filter;
}

/**
 * The credit's words: "by Sam · in ArkLUG" (a club's), "by Sam" (a
 * person's), and for a copy "based on Yard by Sam". Nulls when there is
 * nothing to say (older servers send no credit).
 */
export function creditText(credit: Credit | null | undefined): { line: string | null; basedOn: string | null } {
  if (!credit) return { line: null, basedOn: null };
  const parts = [credit.by ? `by ${credit.by}` : null, credit.club ? `in ${credit.club}` : null].filter((x): x is string => !!x);
  const b = credit.basedOn;
  return {
    line: parts.length ? parts.join(' · ') : null,
    basedOn: b ? `based on ${b.title}${b.by ? ` by ${b.by}` : ''}` : null,
  };
}

/** What a club will be told before something moves into it (both apps say the same). */
export function moveToClubWording(clubName: string): { title: string; removes: string; keeps: string } {
  return {
    title: `Move it to ${clubName}?`,
    removes: `${clubName} will own this. Its admins and managers can change or delete it.`,
    keeps: 'You stay credited as the author, and you can take it back while you’re a member.',
  };
}

// Fetchers and shapes for the admin dashboard (server: routes/adminInsights.ts).
// Lives in the lazily loaded admin chunk, not in the main api.ts.

import { apiGet } from '../../api';

export type RangeId = '7d' | '30d' | '90d' | '12m';

export const RANGES: { id: RangeId; label: string }[] = [
  { id: '7d', label: '7 days' },
  { id: '30d', label: '30 days' },
  { id: '90d', label: '90 days' },
  { id: '12m', label: '12 months' },
];

export type CollectingSince = Record<string, string | null>;
export interface KeyValue {
  key: string;
  value: number;
}

export interface SeriesResponse {
  range: RangeId;
  bucket: 'day' | 'week';
  buckets: number[];
  series: Record<
    | 'newUsers'
    | 'activeUsers'
    | 'wau'
    | 'mau'
    | 'layoutsCreated'
    | 'layoutsEdited'
    | 'liveSessions'
    | 'livePeak'
    | 'customParts'
    | 'modules'
    | 'requests'
    | 'errors5xx'
    | 'slow'
    | 'refused'
    | 'shareViews'
    | 'dbBytes',
    number[]
  >;
  collectingSince: CollectingSince;
}

export interface UsageResponse {
  now: { dau: number; wau: number; mau: number };
  weekAgo: { dau: number; wau: number; mau: number };
  newVsReturning: { newPersonDays: number; returningPersonDays: number };
  avgLiveSessionMinutes: number | null;
  liveSessions: number;
  clients: KeyValue[];
  desktopVersions: KeyValue[];
  /** The desktop versions this server allows and recommends (marks the chart). */
  desktopPolicy?: { minimum: string; recommended: string };
  devices: KeyValue[];
  display: KeyValue[];
  shareViews: number;
  exports: KeyValue[];
  collectingSince: CollectingSince;
}

export interface LayoutRow {
  id: string;
  title: string;
  ownerOrgName: string | null;
  bytes: number;
}

export interface PartUse {
  partNumber: string;
  placements: number;
  layouts: number;
}

export interface ContentResponse {
  totals: {
    layouts: number;
    layoutBytes: number;
    customParts: number;
    customPartBytes: number;
    modules: number;
    rooms: number;
    staleLayouts: number;
  };
  largestLayouts: (LayoutRow & { updatedAt: number; parts: number | null })[];
  staleLayouts: (LayoutRow & { lastTouched: number })[];
  byOwner: {
    personal: { layouts: number; bytes: number };
    clubs: { orgId: string; name: string; slug: string; layouts: number; bytes: number; rooms: number; modules: number; customParts: number }[];
  };
  mostActiveLayouts: { id: string; title: string; ownerOrgName: string | null; edits: number }[];
  topParts: PartUse[];
  missingParts: PartUse[];
  scan: { at: number; scanned: number; total: number };
  reviewQueue: null;
}

export interface PeopleResponse {
  totals: { users: number; clubs: number; unverified: number; dormant6m: number; admins: number };
  /** The demo account (Admin › Settings): on or off, last reset, and what it has now. */
  demo: { enabled: boolean; lastResetAt: number | null; items: number };
  signInMethods: { method: string; users: number }[];
  pending: { clubInvites: number; layoutInvites: number; transfers: number };
  clubs: {
    id: string;
    name: string;
    slug: string;
    createdAt: number;
    members: number;
    layouts: number;
    lastChange: number | null;
    editsInRange: number;
  }[];
  collectingSince: CollectingSince;
}

export interface BackupFile {
  name: string;
  bytes: number;
  at: number;
}

export interface HealthResponse {
  version: string;
  node: string;
  uptimeSeconds: number;
  startedAt: number;
  live: { connections: number; rooms: number };
  requests: {
    total: number;
    errors5xx: number;
    errorRatePct: number;
    slow: number;
    slowThresholdMs: number;
    errorRoutes: KeyValue[];
    slowRoutes: KeyValue[];
    refusedRoutes: KeyValue[];
  };
  disk: {
    databaseBytes: number;
    databaseGrowthBytes: number | null;
    partsBytes: number;
    backupsBytes: number;
    volume: { totalBytes: number; freeBytes: number; usedPct: number } | null;
  };
  parts: { libraries: number; libraryParts: number; customParts: number };
  backups: { enabled: boolean; lastAt: number | null; files: BackupFile[] };
  collectingSince: CollectingSince;
}

export interface Alert {
  level: 'warn' | 'info';
  id: string;
  text: string;
}

export const insightsApi = {
  series: (range: RangeId) => apiGet<SeriesResponse>(`/api/admin/stats/series?range=${range}`),
  usage: (range: RangeId) => apiGet<UsageResponse>(`/api/admin/insights/usage?range=${range}`),
  content: (range: RangeId, refresh = false) =>
    apiGet<ContentResponse>(`/api/admin/insights/content?range=${range}${refresh ? '&refresh=1' : ''}`),
  people: (range: RangeId) => apiGet<PeopleResponse>(`/api/admin/insights/people?range=${range}`),
  health: (range: RangeId) => apiGet<HealthResponse>(`/api/admin/insights/health?range=${range}`),
  alerts: () => apiGet<{ alerts: Alert[] }>('/api/admin/insights/alerts'),
};

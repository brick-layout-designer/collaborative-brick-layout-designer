// Per-owner (user or org) layout count + storage size, for the admin
// Users/Orgs/Layouts tabs. "Size" is the layout's logical byte
// footprint — doc_snapshot + sidecar_snapshot + any layout_updates rows
// not yet folded into the snapshot by daily compaction (see
// workers/index.ts's compaction job and ws/docHub.ts's flushSnapshot,
// which is what actually clears layout_updates). This is a content-size
// number, not raw SQLite page/WAL usage — labelled that way in the UI.
//
// Every query here is bounded to a caller-supplied set of owner ids
// (the current page of users/orgs) rather than aggregating the whole
// table, so list-page cost stays flat regardless of table size. See
// layouts_owner_user_id_idx / layouts_owner_org_id_idx /
// layout_updates_layout_id_idx (schema.ts) — without those this would
// be a full scan per request.

import { inArray, sql } from 'drizzle-orm';
import { db, schema } from '../db/index.js';

export interface OwnerLayoutStats {
  layoutCount: number;
  /** doc_snapshot + sidecar_snapshot + unflushed layout_updates, in bytes. */
  sizeBytes: number;
}

const EMPTY: OwnerLayoutStats = { layoutCount: 0, sizeBytes: 0 };

/**
 * Snapshot-only size + count per owner-user-id, for the given set of
 * user ids. Returns a Map so callers can `.get(id) ?? EMPTY_STATS`-fold
 * into their existing row shape (same pattern as the org member-count
 * fold in adminRoutes).
 */
async function snapshotStatsByOwner(
  column: typeof schema.layouts.ownerUserId | typeof schema.layouts.ownerOrgId,
  ids: readonly string[],
): Promise<Map<string, { layoutIds: string[]; snapshotBytes: number }>> {
  if (ids.length === 0) return new Map();
  const rows = await db
    .select({
      ownerId: column,
      layoutId: schema.layouts.id,
      snapshotBytes: sql<number>`length(${schema.layouts.docSnapshot}) + coalesce(length(${schema.layouts.sidecarSnapshot}), 0)`.mapWith(Number),
    })
    .from(schema.layouts)
    .where(inArray(column, ids));

  const byOwner = new Map<string, { layoutIds: string[]; snapshotBytes: number }>();
  for (const row of rows) {
    if (!row.ownerId) continue;
    const entry = byOwner.get(row.ownerId) ?? { layoutIds: [], snapshotBytes: 0 };
    entry.layoutIds.push(row.layoutId);
    entry.snapshotBytes += row.snapshotBytes;
    byOwner.set(row.ownerId, entry);
  }
  return byOwner;
}

/** Sum of pending (not-yet-compacted) layout_updates bytes, keyed by layout id. */
async function pendingUpdateBytesByLayout(layoutIds: readonly string[]): Promise<Map<string, number>> {
  if (layoutIds.length === 0) return new Map();
  const rows = await db
    .select({
      layoutId: schema.layoutUpdates.layoutId,
      bytes: sql<number>`sum(length(${schema.layoutUpdates.updateBytes}))`.mapWith(Number),
    })
    .from(schema.layoutUpdates)
    .where(inArray(schema.layoutUpdates.layoutId, layoutIds))
    .groupBy(schema.layoutUpdates.layoutId);
  return new Map(rows.map((r) => [r.layoutId, r.bytes]));
}

async function statsByOwner(
  column: typeof schema.layouts.ownerUserId | typeof schema.layouts.ownerOrgId,
  ids: readonly string[],
): Promise<Map<string, OwnerLayoutStats>> {
  const bySnapshot = await snapshotStatsByOwner(column, ids);
  const allLayoutIds = [...bySnapshot.values()].flatMap((v) => v.layoutIds);
  const pendingByLayout = await pendingUpdateBytesByLayout(allLayoutIds);

  const result = new Map<string, OwnerLayoutStats>();
  for (const [ownerId, entry] of bySnapshot) {
    const pending = entry.layoutIds.reduce((sum, id) => sum + (pendingByLayout.get(id) ?? 0), 0);
    result.set(ownerId, { layoutCount: entry.layoutIds.length, sizeBytes: entry.snapshotBytes + pending });
  }
  return result;
}

/** Layout count + size for a set of user ids (e.g. the current admin Users page). */
export function layoutStatsByUser(userIds: readonly string[]): Promise<Map<string, OwnerLayoutStats>> {
  return statsByOwner(schema.layouts.ownerUserId, userIds);
}

/** Layout count + size for a set of org ids (e.g. the current admin Orgs page). */
export function layoutStatsByOrg(orgIds: readonly string[]): Promise<Map<string, OwnerLayoutStats>> {
  return statsByOwner(schema.layouts.ownerOrgId, orgIds);
}

/** Layout count + size for a single owner — used by the user-detail endpoint. */
export async function layoutStatsForSingleUser(userId: string): Promise<OwnerLayoutStats> {
  const map = await layoutStatsByUser([userId]);
  return map.get(userId) ?? EMPTY;
}

/** Per-layout size (snapshot + sidecar + pending updates), for a specific set of layout ids — used by the admin Layouts tab. */
export async function sizeByLayoutId(layoutIds: readonly string[]): Promise<Map<string, number>> {
  if (layoutIds.length === 0) return new Map();
  const rows = await db
    .select({
      id: schema.layouts.id,
      snapshotBytes: sql<number>`length(${schema.layouts.docSnapshot}) + coalesce(length(${schema.layouts.sidecarSnapshot}), 0)`.mapWith(Number),
    })
    .from(schema.layouts)
    .where(inArray(schema.layouts.id, layoutIds));
  const pending = await pendingUpdateBytesByLayout(layoutIds);
  return new Map(rows.map((r) => [r.id, r.snapshotBytes + (pending.get(r.id) ?? 0)]));
}

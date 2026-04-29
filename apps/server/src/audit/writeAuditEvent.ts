// Write a per-layout audit row. Centralised so the event_type strings
// stay consistent and the payload shape is one schema.
//
// Events the editor produces:
//   - 'open' / 'close' (Phase 6 — wired into WS attach/detach)
//   - 'edit' (Phase 6 — once we settle on per-edit granularity)
//   - 'share' / 'unshare' / 'role_change' (Phase 5 — this file's primary
//     callers)
//   - 'transfer' (Phase 6)
//   - 'import' / 'export' (Phase 5+)
//   - 'rename' (could be added now; currently not wired)

import { db, schema } from '../db/index.js';

export type AuditEventType =
  | 'open'
  | 'close'
  | 'edit'
  | 'share'
  | 'unshare'
  | 'role_change'
  | 'transfer'
  | 'import'
  | 'export'
  | 'rename';

export interface AuditEvent {
  layoutId: string;
  /** null for system-driven events (TTL sweep, transfer admin). */
  userId: string | null;
  eventType: AuditEventType;
  payload: Record<string, unknown>;
  /** Snapshot version at the time of the event, when applicable. */
  docVersion?: number;
}

export async function writeAuditEvent(event: AuditEvent): Promise<void> {
  await db.insert(schema.auditEvents).values({
    layoutId: event.layoutId,
    userId: event.userId,
    eventType: event.eventType,
    payload: JSON.stringify(event.payload),
    docVersion: event.docVersion ?? null,
    createdAt: new Date(),
  });
}

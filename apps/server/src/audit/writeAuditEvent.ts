// Write an audit row. Centralised so the event_type strings stay
// consistent and the payload shape is one schema.
//
// Two call shapes:
//
//   writeAuditEvent({ layoutId, ... })        // legacy layout-only audits
//   writeAuditEvent({ resourceKind, resourceId, ... })  // generic
//
// Either layoutId OR (resourceKind+resourceId) must be set; never both.
// The schema column `layout_id` carries the layout-id form for backwards
// compatibility with existing queries; the generic form leaves it null
// and populates (resource_kind, resource_id) instead.

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
  | 'rename'
  | 'create'
  | 'delete'
  // Platform-admin actions. Subject is the resource being modified
  // (`resourceKind: 'user' | 'org' | 'layout' | ...`); the userId
  // field on the event is the admin who performed the action.
  | 'admin_user_patch'
  | 'admin_user_delete'
  | 'admin_revoke_sessions'
  | 'admin_org_delete'
  | 'admin_layout_delete'
  | 'admin_global_part_create'
  | 'admin_global_part_delete'
  | 'admin_part_library_install'
  | 'admin_part_library_patch'
  | 'admin_part_library_update'
  | 'admin_part_library_delete'
  | 'org_part_library_toggle'
  | 'admin_settings_patch';

export type AuditResourceKind =
  | 'layout'
  | 'custom_part'
  | 'module'
  | 'org'
  | 'user'
  | 'part_library'
  | 'platform_settings';

interface CommonAuditFields {
  /** null for system-driven events (TTL sweep, transfer admin). */
  userId: string | null;
  eventType: AuditEventType;
  payload: Record<string, unknown>;
  /** Snapshot version at the time of the event, when applicable. */
  docVersion?: number;
}

interface LayoutAuditEvent extends CommonAuditFields {
  layoutId: string;
}

interface GenericAuditEvent extends CommonAuditFields {
  resourceKind: AuditResourceKind;
  resourceId: string;
}

export type AuditEvent = LayoutAuditEvent | GenericAuditEvent;

export async function writeAuditEvent(event: AuditEvent): Promise<void> {
  const isLayout = 'layoutId' in event;
  await db.insert(schema.auditEvents).values({
    layoutId: isLayout ? event.layoutId : null,
    resourceKind: isLayout ? null : event.resourceKind,
    resourceId: isLayout ? null : event.resourceId,
    userId: event.userId,
    eventType: event.eventType,
    payload: JSON.stringify(event.payload),
    docVersion: event.docVersion ?? null,
    createdAt: new Date(),
  });
}

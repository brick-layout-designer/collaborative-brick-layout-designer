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
  // A club's admin changed its name, address, description or who may add things.
  | 'settings'
  // A club's admin handed the club to another member (they swap roles).
  | 'hand_over'
  // Joining a club without an invite: an open club's one-click join, and
  // an admin approving or declining someone's request to join.
  | 'join'
  | 'join_approve'
  | 'join_decline'
  // A module went back to an earlier version (as a new version).
  | 'restore_version'
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
  | 'admin_settings_patch'
  // Usage limits: global values, a person's or club's override, and
  // suspending or lifting it (subject = the person or club).
  | 'admin_limits_patch'
  | 'admin_limits_override'
  | 'admin_suspend'
  | 'admin_unsuspend'
  // API tokens (desktop sign-in). Subject is the token's owner
  // (`resourceKind: 'user'`); the payload names the token.
  | 'api_token_issue'
  | 'api_token_revoke'
  // Public catalogs: sharing, reviewing and taking items down. Subject is
  // the catalog item (`resourceKind: 'catalog_item'`).
  | 'catalog_submit'
  | 'catalog_approve'
  | 'catalog_decline'
  | 'catalog_unpublish'
  | 'catalog_withdraw'
  | 'catalog_add';

export type AuditResourceKind =
  | 'layout'
  | 'custom_part'
  | 'module'
  | 'org'
  | 'user'
  | 'part_library'
  | 'platform_settings'
  | 'catalog_item';

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

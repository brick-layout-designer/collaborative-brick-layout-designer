import { blob, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';

// All timestamps are unix-millis (Drizzle "timestamp_ms" mode). Kept portable to
// Postgres `timestamptz` later by treating columns as opaque time-ordered ints.

export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  email: text('email').notNull().unique(),
  displayName: text('display_name').notNull(),
  avatarUrl: text('avatar_url'),
  passwordHash: text('password_hash'),
  isDemoAccount: integer('is_demo_account', { mode: 'boolean' }).notNull().default(false),
  isGlobalAdmin: integer('is_global_admin', { mode: 'boolean' }).notNull().default(false),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
});

export const sessions = sqliteTable('sessions', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
});

export const oauthAccounts = sqliteTable(
  'oauth_accounts',
  {
    provider: text('provider').notNull(),
    providerUserId: text('provider_user_id').notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.provider, t.providerUserId] }),
  }),
);

export const orgs = sqliteTable('orgs', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
});

export const orgMembers = sqliteTable(
  'org_members',
  {
    orgId: text('org_id')
      .notNull()
      .references(() => orgs.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: text('role', { enum: ['admin', 'member'] }).notNull(),
    joinedAt: integer('joined_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.orgId, t.userId] }),
  }),
);

// Pending org-membership invites. Same shape as layout_invites but for
// joining an org. Auto-cleared on accept; admins can also revoke.
export const orgInvites = sqliteTable('org_invites', {
  id: text('id').primaryKey(),
  orgId: text('org_id')
    .notNull()
    .references(() => orgs.id, { onDelete: 'cascade' }),
  invitedEmail: text('invited_email').notNull(),
  invitedBy: text('invited_by')
    .notNull()
    .references(() => users.id),
  role: text('role', { enum: ['admin', 'member'] }).notNull(),
  token: text('token').notNull().unique(),
  expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
  acceptedAt: integer('accepted_at', { mode: 'timestamp_ms' }),
});

// ---------------------------------------------------------------------------
// Layouts (Phase 2)
// ---------------------------------------------------------------------------

export const layouts = sqliteTable('layouts', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  // Exactly one of (ownerUserId, ownerOrgId) is non-null. Drizzle/SQLite has
  // no native check-constraint helper here; the resolveResourceRole helper
  // and REST handlers enforce the invariant.
  ownerUserId: text('owner_user_id').references(() => users.id, { onDelete: 'cascade' }),
  ownerOrgId: text('owner_org_id').references(() => orgs.id, { onDelete: 'cascade' }),
  createdBy: text('created_by')
    .notNull()
    .references(() => users.id),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  // For demo-owned layouts (see PLAN.md §3.4). Null otherwise.
  expiresAt: integer('expires_at', { mode: 'timestamp_ms' }),
  // Yjs binary doc snapshot. In Phase 2, populated from a fresh seed (empty
  // Y.Doc) on create OR derived from the imported .bbm. Phase 4's WS server
  // hydrates this on first connect.
  docSnapshot: blob('doc_snapshot').notNull(),
  docVersion: integer('doc_version').notNull().default(0),
  sidecarSnapshot: blob('sidecar_snapshot'),
  // Public-share token. Null = layout is private (default). Non-null
  // = anyone with the token URL can view the layout read-only without
  // signing in. The token is the only secret — owners rotate it by
  // disabling and re-enabling sharing.
  publicShareToken: text('public_share_token').unique(),
});

export const layoutCollaborators = sqliteTable(
  'layout_collaborators',
  {
    layoutId: text('layout_id')
      .notNull()
      .references(() => layouts.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: text('role', { enum: ['viewer', 'editor', 'owner'] }).notNull(),
    addedAt: integer('added_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.layoutId, t.userId] }),
  }),
);

export const layoutInvites = sqliteTable('layout_invites', {
  id: text('id').primaryKey(),
  layoutId: text('layout_id')
    .notNull()
    .references(() => layouts.id, { onDelete: 'cascade' }),
  invitedEmail: text('invited_email').notNull(),
  role: text('role', { enum: ['viewer', 'editor', 'owner'] }).notNull(),
  token: text('token').notNull().unique(),
  expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
  acceptedAt: integer('accepted_at', { mode: 'timestamp_ms' }),
});

// User → user layout transfers (Phase 6 / PLAN.md §3.5). When the new
// owner is a user (not an org), the transfer requires the recipient to
// accept via a token link before ownership flips. Transfers TO an org
// commit immediately and don't use this table.
export const layoutTransfers = sqliteTable('layout_transfers', {
  id: text('id').primaryKey(),
  layoutId: text('layout_id')
    .notNull()
    .references(() => layouts.id, { onDelete: 'cascade' }),
  /** Caller who initiated the transfer. */
  initiatedBy: text('initiated_by')
    .notNull()
    .references(() => users.id),
  /**
   * Email of the recipient. We don't FK to users because the recipient
   * may not yet have an account at invite time — same shape as
   * layout_invites. Email-match enforced at acceptance time.
   */
  recipientEmail: text('recipient_email').notNull(),
  token: text('token').notNull().unique(),
  expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
  acceptedAt: integer('accepted_at', { mode: 'timestamp_ms' }),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
});

// Phase 4 will fill this with y-update binary records between snapshots.
// We declare it now so the migration sticks once and Phase 4 doesn't need
// to alter a populated layouts table.
export const layoutUpdates = sqliteTable('layout_updates', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  layoutId: text('layout_id')
    .notNull()
    .references(() => layouts.id, { onDelete: 'cascade' }),
  doc: text('doc', { enum: ['main', 'sidecar'] }).notNull(),
  updateBytes: blob('update_bytes').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
});

// Per-layout audit log (PLAN.md §3.1 / §4.7). Append-only. payload is a
// JSON string because SQLite has no jsonb; queries on this table read the
// whole row and parse it client-side, which keeps us portable to Postgres
// without a column type change.
export const auditEvents = sqliteTable('audit_events', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  /**
   * Layout-specific audits keep this column populated. New non-layout
   * resource events (custom parts, modules) leave it null and use the
   * generic `(resource_kind, resource_id)` pair below. Kept as a
   * convenience column so existing layout-audit queries keep working
   * without a migration; intentionally NOT a foreign key when null,
   * so generic events don't trigger cascade-on-delete behaviour.
   */
  layoutId: text('layout_id'),
  /**
   * Resource kind for generic audits. Null for legacy layout-only rows
   * (where layout_id is set instead). Either (layout_id) or
   * (resource_kind + resource_id) must be set; never both, never
   * neither. Enforced in the writer, not in the schema.
   */
  resourceKind: text('resource_kind', { enum: ['layout', 'custom_part', 'module', 'org', 'user', 'part_library'] }),
  resourceId: text('resource_id'),
  userId: text('user_id').references(() => users.id, { onDelete: 'set null' }),
  eventType: text('event_type').notNull(),
  payload: text('payload').notNull(), // JSON string
  docVersion: integer('doc_version'),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
});

// ---------------------------------------------------------------------------
// Custom parts + reusable modules (Phase 6.5)
// ---------------------------------------------------------------------------

// User- or org-uploaded part definition. Same shape as a BlueBrickParts
// XML+sprite pair, persisted in the database. The bundled BlueBrickParts
// library is NOT modelled here — those are static, served from /parts/*
// by Fastify. Only USER-uploaded parts hit this table.
export const customParts = sqliteTable('custom_parts', {
  id: text('id').primaryKey(),
  /** Identifier the user picked. Unique within an owner. */
  partNumber: text('part_number').notNull(),
  displayName: text('display_name').notNull(),
  ownerUserId: text('owner_user_id').references(() => users.id, { onDelete: 'cascade' }),
  ownerOrgId: text('owner_org_id').references(() => orgs.id, { onDelete: 'cascade' }),
  createdBy: text('created_by')
    .notNull()
    .references(() => users.id),
  /**
   * When true, this part is visible to ALL users as part of the global
   * catalog and can only be managed by platform admins. ownerUserId and
   * ownerOrgId are null for global parts.
   */
  isGlobal: integer('is_global', { mode: 'boolean' }).notNull().default(false),
  /**
   * Parts-browser category label. Bundled parts derive this from the
   * XML's parent folder name; custom parts let the uploader specify a
   * string (e.g. "My Org Tracks"). Defaults to 'Custom'.
   */
  category: text('category').notNull().default('Custom'),
  /** Full XML payload — same shape as a BlueBrickParts file. */
  xmlBlob: blob('xml_blob').notNull(),
  /** Sprite bytes (gif/png). */
  spriteBlob: blob('sprite_blob').notNull(),
  spriteMime: text('sprite_mime', { enum: ['image/gif', 'image/png'] }).notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
});

export const customPartCollaborators = sqliteTable(
  'custom_part_collaborators',
  {
    customPartId: text('custom_part_id')
      .notNull()
      .references(() => customParts.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: text('role', { enum: ['viewer', 'editor', 'owner'] }).notNull(),
    addedAt: integer('added_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => ({ pk: primaryKey({ columns: [t.customPartId, t.userId] }) }),
);

// Pending custom-part invites for unregistered emails (Phase 7 backlog).
// Once the recipient registers + accepts, accepted_at is set and a
// custom_part_collaborators row is created.
export const customPartInvites = sqliteTable('custom_part_invites', {
  id: text('id').primaryKey(),
  customPartId: text('custom_part_id')
    .notNull()
    .references(() => customParts.id, { onDelete: 'cascade' }),
  invitedEmail: text('invited_email').notNull(),
  role: text('role', { enum: ['viewer', 'editor'] }).notNull(),
  token: text('token').notNull().unique(),
  expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
  acceptedAt: integer('accepted_at', { mode: 'timestamp_ms' }),
});

// Reusable named module: a saved selection of bricks (and their relative
// positions / per-brick metadata) that can be dropped into any layout the
// owner has access to. Mirrors desktop's `Module` but elevates it to a
// first-class shareable asset.
export const modules = sqliteTable('modules', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  ownerUserId: text('owner_user_id').references(() => users.id, { onDelete: 'cascade' }),
  ownerOrgId: text('owner_org_id').references(() => orgs.id, { onDelete: 'cascade' }),
  createdBy: text('created_by')
    .notNull()
    .references(() => users.id),
  /** Y.Doc snapshot bytes — same persistence story as layouts. */
  docSnapshot: blob('doc_snapshot').notNull(),
  docVersion: integer('doc_version').notNull().default(0),
  /** Optional sidecar (subset of layout sidecar — no venue, no rulers). */
  sidecarSnapshot: blob('sidecar_snapshot'),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
});

export const moduleCollaborators = sqliteTable(
  'module_collaborators',
  {
    moduleId: text('module_id')
      .notNull()
      .references(() => modules.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: text('role', { enum: ['viewer', 'editor', 'owner'] }).notNull(),
    addedAt: integer('added_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => ({ pk: primaryKey({ columns: [t.moduleId, t.userId] }) }),
);

// User → user module transfers (mirror of layout_transfers). Org-recipient
// transfers commit immediately and don't write here.
export const moduleTransfers = sqliteTable('module_transfers', {
  id: text('id').primaryKey(),
  moduleId: text('module_id')
    .notNull()
    .references(() => modules.id, { onDelete: 'cascade' }),
  initiatedBy: text('initiated_by')
    .notNull()
    .references(() => users.id),
  recipientEmail: text('recipient_email').notNull(),
  token: text('token').notNull().unique(),
  expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
  acceptedAt: integer('accepted_at', { mode: 'timestamp_ms' }),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
});

// ---------------------------------------------------------------------------
// Part libraries — system-installed, org-selectable.
//
// A `part_library` is a named collection of parts installed by a platform
// admin (uploaded as a zip, or pulled from a URL). Every library's parts are
// served as bundled parts scoped to their library slug.
//
// `org_part_libraries` is a join table: when a row exists, the org has that
// library enabled. Orgs that have no rows default to seeing only the built-in
// parts (same as today). A library marked `default_enabled` is automatically
// made available to all orgs without an explicit row.
// ---------------------------------------------------------------------------
export const partLibraries = sqliteTable('part_libraries', {
  id: text('id').primaryKey(),
  /** Human-readable display name. */
  name: text('name').notNull(),
  /** URL slug — used as the category prefix for parts in this library. */
  slug: text('slug').notNull().unique(),
  /** Source URL if installed from a remote zip; null for manual uploads. */
  sourceUrl: text('source_url'),
  /** Number of parts in the library (denormalised for the UI). */
  partCount: integer('part_count').notNull().default(0),
  /** When true, all orgs see this library without an explicit opt-in. */
  defaultEnabled: integer('default_enabled', { mode: 'boolean' }).notNull().default(false),
  /** When true, org admins cannot disable this library — it is always on for everyone. */
  locked: integer('locked', { mode: 'boolean' }).notNull().default(false),
  installedAt: integer('installed_at', { mode: 'timestamp_ms' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
});

/** Explicit per-org library opt-in/opt-out. */
export const orgPartLibraries = sqliteTable(
  'org_part_libraries',
  {
    orgId: text('org_id')
      .notNull()
      .references(() => orgs.id, { onDelete: 'cascade' }),
    libraryId: text('library_id')
      .notNull()
      .references(() => partLibraries.id, { onDelete: 'cascade' }),
    /** true = explicitly enabled; false = explicitly disabled (overrides defaultEnabled). */
    enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => ({ pk: primaryKey({ columns: [t.orgId, t.libraryId] }) }),
);

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Session = typeof sessions.$inferSelect;
export type OAuthAccount = typeof oauthAccounts.$inferSelect;
export type Layout = typeof layouts.$inferSelect;
export type NewLayout = typeof layouts.$inferInsert;
export type LayoutCollaborator = typeof layoutCollaborators.$inferSelect;
export type AuditEvent = typeof auditEvents.$inferSelect;
export type Org = typeof orgs.$inferSelect;
export type PartLibrary = typeof partLibraries.$inferSelect;
export type OrgMember = typeof orgMembers.$inferSelect;
export type OrgInvite = typeof orgInvites.$inferSelect;
export type LayoutTransfer = typeof layoutTransfers.$inferSelect;
export type CustomPart = typeof customParts.$inferSelect;
export type CustomPartCollaborator = typeof customPartCollaborators.$inferSelect;
export type CustomPartInvite = typeof customPartInvites.$inferSelect;
export type Module = typeof modules.$inferSelect;
export type ModuleCollaborator = typeof moduleCollaborators.$inferSelect;
export type ModuleTransfer = typeof moduleTransfers.$inferSelect;

export const venueLibrary = sqliteTable('venue_library', {
  id: text('id').primaryKey(),
  ownerUserId: text('owner_user_id').references(() => users.id, { onDelete: 'cascade' }),
  ownerOrgId: text('owner_org_id').references(() => orgs.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  /** Serialised Venue JSON. */
  data: text('data').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
});
export type VenueLibraryEntry = typeof venueLibrary.$inferSelect;

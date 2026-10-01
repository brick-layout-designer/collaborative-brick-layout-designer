import { blob, index, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';

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
  /**
   * Password-auth accounts start unverified and must confirm via the
   * emailed link (see email_verifications below) before they can log in.
   * OAuth/OIDC accounts are always created verified — the provider has
   * already proven the email — so this defaults true and password
   * registration explicitly sets it false.
   */
  emailVerified: integer('email_verified', { mode: 'boolean' }).notNull().default(true),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  /**
   * Last time this account made a signed-in request, rounded to a few
   * minutes (metrics/activity.ts throttles the write). Powers the admin
   * DAU/WAU/MAU numbers and "not seen in 6 months". Only the newest
   * time is kept: no history, no pages, no IP. Null until first seen
   * after this column was added.
   */
  lastSeenAt: integer('last_seen_at', { mode: 'timestamp_ms' }),
}, (t) => ({
  // The admin "new users" graph and the active-user counts.
  createdIdx: index('users_created_at_idx').on(t.createdAt),
  lastSeenIdx: index('users_last_seen_at_idx').on(t.lastSeenAt),
}));

export const sessions = sqliteTable(
  'sessions',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => ({
    // "Log out everywhere" / user delete cascade look sessions up by user.
    userIdx: index('sessions_user_id_idx').on(t.userId),
  }),
);

// Personal access tokens for non-browser clients (the desktop app's live
// sync). Only a sha256 of the secret is stored, like sessions; `prefix`
// and `last4` are kept in the clear so the settings page can tell tokens
// apart. `scopes` is a space-separated list (see auth/apiTokens.ts).
// Expiry slides forward on use; revocation keeps the row (revokedAt) so
// the Devices list and audit trail still show it.
export const apiTokens = sqliteTable(
  'api_tokens',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    tokenHash: text('token_hash').notNull().unique(),
    prefix: text('prefix').notNull(),
    last4: text('last4').notNull(),
    scopes: text('scopes').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    lastUsedAt: integer('last_used_at', { mode: 'timestamp_ms' }),
    expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
    revokedAt: integer('revoked_at', { mode: 'timestamp_ms' }),
  },
  (t) => ({
    // The Devices list and "revoke everything for this user".
    userIdx: index('api_tokens_user_id_idx').on(t.userId),
  }),
);

// Pending OAuth 2.0 device-authorization grants (RFC 8628). Both codes
// are stored as sha256 hashes: the device code is a bearer secret, and
// the short user code would otherwise be readable from a DB dump while
// it is still approvable. A row is single use — once its token is
// minted, status becomes 'consumed' and further polls fail.
export const deviceCodes = sqliteTable(
  'device_codes',
  {
    id: text('id').primaryKey(),
    deviceCodeHash: text('device_code_hash').notNull().unique(),
    userCodeHash: text('user_code_hash').notNull().unique(),
    clientName: text('client_name').notNull(),
    scopes: text('scopes').notNull(),
    status: text('status', { enum: ['pending', 'approved', 'denied', 'consumed'] }).notNull(),
    /** The approving (or denying) user; null while pending. */
    userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }),
    /** Current minimum poll interval in seconds (grows on slow_down). */
    interval: integer('interval').notNull(),
    lastPolledAt: integer('last_polled_at', { mode: 'timestamp_ms' }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => ({
    expiresIdx: index('device_codes_expires_at_idx').on(t.expiresAt),
  }),
);

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

// Pending email-verification tokens for password-auth signups. One row
// per outstanding (unconsumed) verification link; a fresh register or
// resend deletes any prior row for the user before inserting a new one,
// so a user has at most one live token at a time.
export const emailVerifications = sqliteTable('email_verifications', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  token: text('token').notNull().unique(),
  expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
});

/**
 * Platform-wide settings, admin-configurable via /api/admin/settings.
 * Singleton table: always exactly one row, id fixed to
 * PLATFORM_SETTINGS_ID (see auth/platformSettings.ts). DB values here
 * take precedence over the equivalent .env vars when set (a null SMTP
 * field falls back to env.smtp) — see auth/platformSettings.ts for the
 * merge logic and the transporter-cache invalidation it triggers.
 */
export const platformSettings = sqliteTable('platform_settings', {
  id: text('id').primaryKey(),
  /**
   * Require clicking an emailed link before a password-auth account can
   * log in. Defaults true (matches pre-existing always-on behaviour).
   * Turning this off does NOT retroactively verify existing unverified
   * accounts in the database — it makes the login/register routes stop
   * checking the flag at all, which has the same practical effect
   * (nothing blocks their login) without an irreversible bulk UPDATE.
   */
  requireEmailVerification: integer('require_email_verification', { mode: 'boolean' }).notNull().default(true),
  /**
   * SMTP override. All fields null = "use env.smtp (or none)". Any
   * non-null smtpHost is treated as "DB config is in use" — see
   * mergeSmtpConfig in auth/platformSettings.ts. smtpPass is stored in
   * plaintext in SQLite (matches SMTP_PASS's own trust model — this DB
   * file already holds password hashes and session tokens) and is
   * NEVER returned by GET /api/admin/settings; the API returns
   * `smtpPassSet: boolean` instead.
   */
  smtpHost: text('smtp_host'),
  smtpPort: integer('smtp_port'),
  smtpUser: text('smtp_user'),
  smtpPass: text('smtp_pass'),
  smtpFrom: text('smtp_from'),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  updatedBy: text('updated_by').references(() => users.id, { onDelete: 'set null' }),
});

export const orgs = sqliteTable('orgs', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  /** A line or two about the club, shown on its page. */
  description: text('description'),
  /**
   * Whether members (not only admins) may add layouts, rooms and modules
   * to the club. On by default.
   */
  membersCanCreate: integer('members_can_create', { mode: 'boolean' }).notNull().default(true),
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
    // "Which orgs am I in" is on every list endpoint; the PK is (org, user).
    userIdx: index('org_members_user_id_idx').on(t.userId),
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

export const layouts = sqliteTable(
  'layouts',
  {
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
    /**
     * Last time anyone opened the layout (REST get or a live editor
     * connection), throttled. Feeds the admin "not opened in 90 days"
     * list. Null until first opened after this column was added.
     */
    lastOpenedAt: integer('last_opened_at', { mode: 'timestamp_ms' }),
  },
  (t) => ({
    // The admin "layouts created / edited" graphs.
    createdIdx: index('layouts_created_at_idx').on(t.createdAt),
    updatedIdx: index('layouts_updated_at_idx').on(t.updatedAt),
    // Both power admin per-owner aggregate queries (layout count + size
    // by user/org) — see routes/admin.ts. Without these, GROUP BY
    // owner_user_id / owner_org_id is a full table scan.
    ownerUserIdx: index('layouts_owner_user_id_idx').on(t.ownerUserId),
    ownerOrgIdx: index('layouts_owner_org_id_idx').on(t.ownerOrgId),
  }),
);

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
    // "Layouts shared with me" — the PK leads with layout_id.
    userIdx: index('layout_collaborators_user_id_idx').on(t.userId),
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
export const layoutUpdates = sqliteTable(
  'layout_updates',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    layoutId: text('layout_id')
      .notNull()
      .references(() => layouts.id, { onDelete: 'cascade' }),
    doc: text('doc', { enum: ['main', 'sidecar'] }).notNull(),
    updateBytes: blob('update_bytes').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => ({
    // Every WS write hits this by layoutId (docHub.ts), and the admin
    // per-owner size aggregate joins through it — see routes/admin.ts.
    layoutIdx: index('layout_updates_layout_id_idx').on(t.layoutId),
  }),
);

// Per-layout audit log (PLAN.md §3.1 / §4.7). Append-only. payload is a
// JSON string because SQLite has no jsonb; queries on this table read the
// whole row and parse it client-side, which keeps us portable to Postgres
// without a column type change.
export const auditEvents = sqliteTable(
  'audit_events',
  {
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
  resourceKind: text('resource_kind', { enum: ['layout', 'custom_part', 'module', 'org', 'user', 'part_library', 'platform_settings'] }),
  resourceId: text('resource_id'),
  userId: text('user_id').references(() => users.id, { onDelete: 'set null' }),
  eventType: text('event_type').notNull(),
  payload: text('payload').notNull(), // JSON string
  docVersion: integer('doc_version'),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => ({
    // The two audit read paths: per-layout and per-(kind, id), newest first.
    layoutCreatedIdx: index('audit_events_layout_id_created_at_idx').on(t.layoutId, t.createdAt),
    resourceCreatedIdx: index('audit_events_resource_created_at_idx').on(
      t.resourceKind,
      t.resourceId,
      t.createdAt,
    ),
  }),
);

// ---------------------------------------------------------------------------
// Custom parts + reusable modules (Phase 6.5)
// ---------------------------------------------------------------------------

// User- or org-uploaded part definition. Same shape as a BlueBrickParts
// XML+sprite pair, persisted in the database. The bundled BlueBrickParts
// library is NOT modelled here — those are static, served from /parts/*
// by Fastify. Only USER-uploaded parts hit this table.
export const customParts = sqliteTable(
  'custom_parts',
  {
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
  },
  (t) => ({
    createdIdx: index('custom_parts_created_at_idx').on(t.createdAt),
    ownerUserIdx: index('custom_parts_owner_user_id_idx').on(t.ownerUserId),
    ownerOrgIdx: index('custom_parts_owner_org_id_idx').on(t.ownerOrgId),
  }),
);

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
  (t) => ({
    pk: primaryKey({ columns: [t.customPartId, t.userId] }),
    userIdx: index('custom_part_collaborators_user_id_idx').on(t.userId),
  }),
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
export const modules = sqliteTable(
  'modules',
  {
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
  },
  (t) => ({
    createdIdx: index('modules_created_at_idx').on(t.createdAt),
    ownerUserIdx: index('modules_owner_user_id_idx').on(t.ownerUserId),
    ownerOrgIdx: index('modules_owner_org_id_idx').on(t.ownerOrgId),
  }),
);

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
  (t) => ({
    pk: primaryKey({ columns: [t.moduleId, t.userId] }),
    userIdx: index('module_collaborators_user_id_idx').on(t.userId),
  }),
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
export type ApiToken = typeof apiTokens.$inferSelect;
export type DeviceCode = typeof deviceCodes.$inferSelect;
export type OAuthAccount = typeof oauthAccounts.$inferSelect;
export type EmailVerification = typeof emailVerifications.$inferSelect;
export type PlatformSettings = typeof platformSettings.$inferSelect;
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

/**
 * Per-account appearance and help settings (theme, colour, bigger text,
 * expert mode, help icons, tours seen). One row per user; `prefs` is a
 * validated JSON object (see routes/preferences.ts) so new keys don't
 * need a migration. `updatedAt` lets clients that cache the settings
 * (the desktop app) decide which copy is newer.
 */
export const userPreferences = sqliteTable('user_preferences', {
  userId: text('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  prefs: text('prefs').notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
});
export type UserPreferencesRow = typeof userPreferences.$inferSelect;

/**
 * Tiny daily rollup for the admin dashboard: things the database keeps
 * no history of (active users, requests, errors, refusals, live
 * sessions, disk size). One row per (UTC day, metric, key); `key`
 * narrows a metric (a route, a client kind, a layout id) and is '' when
 * unused. Aggregate only: never a URL trail, never an IP, and person
 * ids are only ever counted, not stored (see metrics/rollup.ts).
 * Rows older than ROLLUP_RETENTION_DAYS are swept daily.
 */
export const dailyStats = sqliteTable(
  'daily_stats',
  {
    day: text('day').notNull(),
    metric: text('metric').notNull(),
    key: text('key').notNull().default(''),
    value: integer('value').notNull().default(0),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.day, t.metric, t.key] }),
    // "Collecting since" and per-metric range scans.
    metricDayIdx: index('daily_stats_metric_day_idx').on(t.metric, t.day),
  }),
);
export type DailyStat = typeof dailyStats.$inferSelect;

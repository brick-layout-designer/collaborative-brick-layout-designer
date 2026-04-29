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

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Session = typeof sessions.$inferSelect;
export type OAuthAccount = typeof oauthAccounts.$inferSelect;
export type Layout = typeof layouts.$inferSelect;
export type NewLayout = typeof layouts.$inferInsert;
export type LayoutCollaborator = typeof layoutCollaborators.$inferSelect;

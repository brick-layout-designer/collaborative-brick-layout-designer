-- Generalise audit_events for non-layout resources (custom parts, modules,
-- orgs). SQLite can't ALTER a column's NOT NULL or FK in place, so we
-- recreate the table via the standard "rename + create + copy + drop"
-- pattern. All existing rows preserve their layout_id; new generic
-- rows leave layout_id null and populate (resource_kind, resource_id).

PRAGMA foreign_keys = OFF;--> statement-breakpoint

ALTER TABLE `audit_events` RENAME TO `_audit_events_old`;--> statement-breakpoint

CREATE TABLE `audit_events` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `layout_id` text,
  `resource_kind` text,
  `resource_id` text,
  `user_id` text,
  `event_type` text NOT NULL,
  `payload` text NOT NULL,
  `doc_version` integer,
  `created_at` integer NOT NULL,
  FOREIGN KEY (`layout_id`) REFERENCES `layouts`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);--> statement-breakpoint

INSERT INTO `audit_events` (`id`, `layout_id`, `resource_kind`, `resource_id`, `user_id`, `event_type`, `payload`, `doc_version`, `created_at`)
SELECT `id`, `layout_id`, NULL, NULL, `user_id`, `event_type`, `payload`, `doc_version`, `created_at`
FROM `_audit_events_old`;--> statement-breakpoint

DROP TABLE `_audit_events_old`;--> statement-breakpoint

PRAGMA foreign_keys = ON;

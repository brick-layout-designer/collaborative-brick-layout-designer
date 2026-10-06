-- "Delete my account". Additive only.
--   users.deletion_requested_at, users.deletion_due_at
--                                null: no deletion waiting (every existing account)
--   audit_events.actor_label     null: the actor's account still exists
--   erasures                     new table: one row per erased account or club, no personal data
-- The waiting time is a Privacy setting (platform_settings.privacy, default 14 days, 7 to 30).
CREATE TABLE `erasures` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`ref` text NOT NULL,
	`how` text NOT NULL,
	`requested_at` integer,
	`erased_at` integer NOT NULL,
	`counts` text DEFAULT '{}' NOT NULL
);
--> statement-breakpoint
CREATE INDEX `erasures_erased_at_idx` ON `erasures` (`erased_at`);--> statement-breakpoint
ALTER TABLE `audit_events` ADD `actor_label` text;--> statement-breakpoint
ALTER TABLE `users` ADD `deletion_requested_at` integer;--> statement-breakpoint
ALTER TABLE `users` ADD `deletion_due_at` integer;
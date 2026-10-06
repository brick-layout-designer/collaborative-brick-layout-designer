-- "Download my data". Additive only.
--   data_exports                 new table: one row per data download (built in the background)
--   platform_settings.privacy    null: every privacy setting at its built-in default
--                                (one download per 24 hours, at most 1024 MB, kept 7 days)
CREATE TABLE `data_exports` (
	`id` text PRIMARY KEY NOT NULL,
	`subject_kind` text NOT NULL,
	`subject_id` text NOT NULL,
	`requested_by` text,
	`reason` text NOT NULL,
	`status` text NOT NULL,
	`size_bytes` integer,
	`error` text,
	`created_at` integer NOT NULL,
	`ready_at` integer,
	`expires_at` integer,
	`downloaded_at` integer,
	FOREIGN KEY (`requested_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `data_exports_requested_by_idx` ON `data_exports` (`requested_by`,`created_at`);--> statement-breakpoint
CREATE INDEX `data_exports_subject_idx` ON `data_exports` (`subject_kind`,`subject_id`);--> statement-breakpoint
ALTER TABLE `platform_settings` ADD `privacy` text;
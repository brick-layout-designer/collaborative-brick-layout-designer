CREATE TABLE `limit_overrides` (
	`subject_kind` text NOT NULL,
	`subject_id` text NOT NULL,
	`limits` text DEFAULT '{}' NOT NULL,
	`suspended` integer DEFAULT false NOT NULL,
	`suspended_reason` text,
	`updated_at` integer NOT NULL,
	`updated_by` text,
	PRIMARY KEY(`subject_kind`, `subject_id`),
	FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `usage_daily` (
	`day` text NOT NULL,
	`subject_kind` text NOT NULL,
	`subject_id` text NOT NULL,
	`metric` text NOT NULL,
	`value` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`day`, `subject_kind`, `subject_id`, `metric`)
);
--> statement-breakpoint
CREATE INDEX `usage_daily_kind_metric_day_idx` ON `usage_daily` (`subject_kind`,`metric`,`day`);--> statement-breakpoint
CREATE INDEX `usage_daily_subject_idx` ON `usage_daily` (`subject_kind`,`subject_id`,`day`);--> statement-breakpoint
ALTER TABLE `orgs` ADD `created_by` text REFERENCES users(id) ON DELETE set null;--> statement-breakpoint
ALTER TABLE `platform_settings` ADD `limits` text;
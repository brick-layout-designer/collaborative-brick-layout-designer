CREATE TABLE `daily_stats` (
	`day` text NOT NULL,
	`metric` text NOT NULL,
	`key` text DEFAULT '' NOT NULL,
	`value` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`day`, `metric`, `key`)
);
--> statement-breakpoint
CREATE INDEX `daily_stats_metric_day_idx` ON `daily_stats` (`metric`,`day`);--> statement-breakpoint
ALTER TABLE `layouts` ADD `last_opened_at` integer;--> statement-breakpoint
CREATE INDEX `layouts_created_at_idx` ON `layouts` (`created_at`);--> statement-breakpoint
CREATE INDEX `layouts_updated_at_idx` ON `layouts` (`updated_at`);--> statement-breakpoint
ALTER TABLE `users` ADD `last_seen_at` integer;--> statement-breakpoint
CREATE INDEX `users_created_at_idx` ON `users` (`created_at`);--> statement-breakpoint
CREATE INDEX `users_last_seen_at_idx` ON `users` (`last_seen_at`);--> statement-breakpoint
CREATE INDEX `custom_parts_created_at_idx` ON `custom_parts` (`created_at`);--> statement-breakpoint
CREATE INDEX `modules_created_at_idx` ON `modules` (`created_at`);
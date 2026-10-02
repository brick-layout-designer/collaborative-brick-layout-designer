-- Module versions: every save of a module keeps a copy (contents, picture,
-- "What changed" note), the newest 20 per module. Existing modules start
-- with latest_version 0 and no history; their next save is version 1.
CREATE TABLE `module_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`module_id` text NOT NULL,
	`version` integer NOT NULL,
	`doc_snapshot` blob NOT NULL,
	`thumbnail` blob,
	`thumbnail_mime` text,
	`note` text,
	`author_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`module_id`) REFERENCES `modules`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`author_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `module_versions_module_version_idx` ON `module_versions` (`module_id`,`version`);--> statement-breakpoint
ALTER TABLE `modules` ADD `latest_version` integer DEFAULT 0 NOT NULL;
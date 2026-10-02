-- Public module and parts catalogs, with optional moderation.
-- Both catalogs start OFF and review starts at "moderators approve each one",
-- so deploying this changes nothing until an admin turns a catalog on.
-- users.is_moderator starts false for everyone.
CREATE TABLE `catalog_copies` (
	`item_id` text NOT NULL,
	`copy_id` text NOT NULL,
	`version` integer NOT NULL,
	`user_id` text,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`item_id`, `copy_id`),
	FOREIGN KEY (`item_id`) REFERENCES `catalog_items`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `catalog_copies_copy_idx` ON `catalog_copies` (`copy_id`);--> statement-breakpoint
CREATE TABLE `catalog_item_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`item_id` text NOT NULL,
	`version` integer NOT NULL,
	`status` text NOT NULL,
	`submitted_by` text,
	`note` text,
	`reason` text,
	`decided_by` text,
	`decided_at` integer,
	`doc_snapshot` blob,
	`part_number` text,
	`category` text,
	`xml_blob` blob,
	`sprite_blob` blob,
	`sprite_mime` text,
	`thumbnail` blob,
	`thumbnail_mime` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`item_id`) REFERENCES `catalog_items`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`submitted_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`decided_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `catalog_item_versions_item_version_idx` ON `catalog_item_versions` (`item_id`,`version`);--> statement-breakpoint
CREATE TABLE `catalog_items` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`source_id` text NOT NULL,
	`owner_user_id` text,
	`owner_org_id` text,
	`title` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`tags` text DEFAULT '[]' NOT NULL,
	`status` text NOT NULL,
	`reason` text,
	`public_version` integer DEFAULT 0 NOT NULL,
	`uses` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`owner_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`owner_org_id`) REFERENCES `orgs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `catalog_items_source_idx` ON `catalog_items` (`source_id`);--> statement-breakpoint
CREATE INDEX `catalog_items_status_idx` ON `catalog_items` (`kind`,`status`);--> statement-breakpoint
ALTER TABLE `platform_settings` ADD `module_catalog_enabled` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `platform_settings` ADD `parts_catalog_enabled` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `platform_settings` ADD `catalog_review` text DEFAULT 'moderators' NOT NULL;--> statement-breakpoint
ALTER TABLE `platform_settings` ADD `catalog_anonymous_browse` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `is_moderator` integer DEFAULT false NOT NULL;
-- Collection covers. Additive only.
--   catalog_collection_covers               new: uploaded cover pictures (WebP, <=1200 px wide) and a small copy
--   catalog_collections.cover_image_id      null: the uploaded cover showing, if any
--   platform_settings.collection_cover_max_bytes  5242880 (5 MB): biggest upload, Admin > Settings
CREATE TABLE `catalog_collection_covers` (
	`id` text PRIMARY KEY NOT NULL,
	`collection_id` text NOT NULL,
	`image` blob NOT NULL,
	`small` blob NOT NULL,
	`created_by` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`collection_id`) REFERENCES `catalog_collections`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `catalog_collection_covers_collection_idx` ON `catalog_collection_covers` (`collection_id`);--> statement-breakpoint
ALTER TABLE `catalog_collections` ADD `cover_image_id` text;--> statement-breakpoint
ALTER TABLE `platform_settings` ADD `collection_cover_max_bytes` integer DEFAULT 5242880 NOT NULL;
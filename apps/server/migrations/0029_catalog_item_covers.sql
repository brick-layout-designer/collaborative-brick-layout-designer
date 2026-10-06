-- Catalog items (modules, parts) get their own uploaded cover picture, like collections. Additive only.
--   catalog_item_covers                  new table: the pictures (WebP + a small copy), at most two per item
--   catalog_items.cover_image_id         null: the drawn picture (every existing item)
--   catalog_items.pending_cover_image_id null: nothing waiting for review
--   catalog_items.cover_reason           null: no declined picture to explain
CREATE TABLE `catalog_item_covers` (
	`id` text PRIMARY KEY NOT NULL,
	`item_id` text NOT NULL,
	`image` blob NOT NULL,
	`small` blob NOT NULL,
	`created_by` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`item_id`) REFERENCES `catalog_items`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `catalog_item_covers_item_idx` ON `catalog_item_covers` (`item_id`);--> statement-breakpoint
ALTER TABLE `catalog_items` ADD `cover_image_id` text;--> statement-breakpoint
ALTER TABLE `catalog_items` ADD `pending_cover_image_id` text;--> statement-breakpoint
ALTER TABLE `catalog_items` ADD `cover_reason` text;
-- Catalog review: the text sent with each version (it becomes the item's
-- when approved), and who took an item or collection down. Additive only.
ALTER TABLE `catalog_collections` ADD `taken_down_by` text;--> statement-breakpoint
ALTER TABLE `catalog_item_versions` ADD `title` text;--> statement-breakpoint
ALTER TABLE `catalog_item_versions` ADD `description` text;--> statement-breakpoint
ALTER TABLE `catalog_item_versions` ADD `tags` text;--> statement-breakpoint
ALTER TABLE `catalog_items` ADD `taken_down_by` text;
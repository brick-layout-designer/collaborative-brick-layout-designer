-- Moderation pages a page at a time: indexes for the queue (oldest first)
-- and the published / unpublished lists (newest first). Additive only.
CREATE INDEX `catalog_item_versions_status_created_idx` ON `catalog_item_versions` (`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `catalog_items_status_updated_idx` ON `catalog_items` (`status`,`updated_at`);
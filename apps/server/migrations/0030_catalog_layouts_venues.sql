-- Layouts and venues in the public catalog. Additive only.
--   platform_settings.layout_catalog_enabled  false: off until an admin turns it on
--   platform_settings.venue_catalog_enabled   false: off until an admin turns it on
--   catalog_item_versions.summary             null: modules and parts have none
-- catalog_items.kind gains 'layout' and 'venue' (a text column; no change needed).
ALTER TABLE `catalog_item_versions` ADD `summary` text;--> statement-breakpoint
ALTER TABLE `platform_settings` ADD `layout_catalog_enabled` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `platform_settings` ADD `venue_catalog_enabled` integer DEFAULT false NOT NULL;
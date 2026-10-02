-- Club and private collections. Additive only: two new tables and five new
-- nullable or defaulted columns; nothing existing changes meaning.
--   catalog_collections.org_id          null = a person's own (as before); else the club that curates it
--   catalog_collections.audience        'everyone' (as before); 'private' = only its curator, or the club's members
--   catalog_collections.pinned          false; a club pins its own collections to the top
--   catalog_collections.cover_module_id null; the cover may be one of the collection's own modules
--   catalog_collection_modules          a collection's own library modules (the curator's or the club's)
--   catalog_collection_parts            a collection's own custom parts (likewise)
--   modules.copied_from_id              null; what a copy was made from, so "Add all" skips what you have
-- drizzle-kit leaves ON DELETE off ALTER TABLE ... REFERENCES; it's added by
-- hand below so deleting a club or a module still works (foreign_keys = ON).
CREATE TABLE `catalog_collection_modules` (
	`collection_id` text NOT NULL,
	`module_id` text NOT NULL,
	`position` integer NOT NULL,
	PRIMARY KEY(`collection_id`, `module_id`),
	FOREIGN KEY (`collection_id`) REFERENCES `catalog_collections`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`module_id`) REFERENCES `modules`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `catalog_collection_modules_module_idx` ON `catalog_collection_modules` (`module_id`);--> statement-breakpoint
CREATE TABLE `catalog_collection_parts` (
	`collection_id` text NOT NULL,
	`part_id` text NOT NULL,
	`position` integer NOT NULL,
	PRIMARY KEY(`collection_id`, `part_id`),
	FOREIGN KEY (`collection_id`) REFERENCES `catalog_collections`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`part_id`) REFERENCES `custom_parts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `catalog_collection_parts_part_idx` ON `catalog_collection_parts` (`part_id`);--> statement-breakpoint
ALTER TABLE `catalog_collections` ADD `org_id` text REFERENCES orgs(id) ON DELETE cascade;--> statement-breakpoint
ALTER TABLE `catalog_collections` ADD `audience` text DEFAULT 'everyone' NOT NULL;--> statement-breakpoint
ALTER TABLE `catalog_collections` ADD `pinned` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `catalog_collections` ADD `cover_module_id` text REFERENCES modules(id) ON DELETE set null;--> statement-breakpoint
CREATE INDEX `catalog_collections_org_idx` ON `catalog_collections` (`org_id`);--> statement-breakpoint
ALTER TABLE `modules` ADD `copied_from_id` text;
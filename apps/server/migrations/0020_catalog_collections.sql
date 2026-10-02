-- Catalog collections: named, ordered sets of public catalog items. Two new
-- tables only; nothing existing changes. No collections exist until someone
-- makes one, and none is featured unless a moderator says so.
CREATE TABLE `catalog_collection_items` (
	`collection_id` text NOT NULL,
	`item_id` text NOT NULL,
	`position` integer NOT NULL,
	PRIMARY KEY(`collection_id`, `item_id`),
	FOREIGN KEY (`collection_id`) REFERENCES `catalog_collections`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`item_id`) REFERENCES `catalog_items`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `catalog_collection_items_item_idx` ON `catalog_collection_items` (`item_id`);--> statement-breakpoint
CREATE TABLE `catalog_collections` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`cover_item_id` text,
	`owner_user_id` text,
	`official` integer DEFAULT false NOT NULL,
	`featured` integer DEFAULT false NOT NULL,
	`status` text NOT NULL,
	`reason` text,
	`pending` text,
	`pending_at` integer,
	`curator_note` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`cover_item_id`) REFERENCES `catalog_items`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`owner_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `catalog_collections_status_idx` ON `catalog_collections` (`status`,`featured`);--> statement-breakpoint
CREATE INDEX `catalog_collections_owner_idx` ON `catalog_collections` (`owner_user_id`);
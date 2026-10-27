-- Sharing a set by invite brings along the sharer's own custom parts it's
-- made of: which parts each person has only through which shared set, so
-- taking the set back takes those parts back too. Additive only: a new
-- table, empty until a set is shared after this.
CREATE TABLE `custom_part_set_shares` (
	`set_id` text NOT NULL,
	`part_id` text NOT NULL,
	`user_id` text NOT NULL,
	`added_at` integer NOT NULL,
	PRIMARY KEY(`set_id`, `part_id`, `user_id`),
	FOREIGN KEY (`set_id`) REFERENCES `custom_parts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`part_id`) REFERENCES `custom_parts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `custom_part_set_shares_part_user_idx` ON `custom_part_set_shares` (`part_id`,`user_id`);--> statement-breakpoint
CREATE INDEX `custom_part_set_shares_user_id_idx` ON `custom_part_set_shares` (`user_id`);
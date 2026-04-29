CREATE TABLE `custom_part_invites` (
	`id` text PRIMARY KEY NOT NULL,
	`custom_part_id` text NOT NULL,
	`invited_email` text NOT NULL,
	`role` text NOT NULL,
	`token` text NOT NULL,
	`expires_at` integer NOT NULL,
	`accepted_at` integer,
	FOREIGN KEY (`custom_part_id`) REFERENCES `custom_parts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `custom_part_invites_token_unique` ON `custom_part_invites` (`token`);
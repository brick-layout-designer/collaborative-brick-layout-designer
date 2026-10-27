-- Club logos. Additive only.
--   club_logos   new table: one picture per club (WebP, at most 512 px a side), set by its admins
CREATE TABLE `club_logos` (
	`org_id` text PRIMARY KEY NOT NULL,
	`image` blob NOT NULL,
	`updated_by` text,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `orgs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);

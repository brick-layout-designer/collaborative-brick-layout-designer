CREATE TABLE `layout_transfers` (
	`id` text PRIMARY KEY NOT NULL,
	`layout_id` text NOT NULL,
	`initiated_by` text NOT NULL,
	`recipient_email` text NOT NULL,
	`token` text NOT NULL,
	`expires_at` integer NOT NULL,
	`accepted_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`layout_id`) REFERENCES `layouts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`initiated_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `org_invites` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`invited_email` text NOT NULL,
	`invited_by` text NOT NULL,
	`role` text NOT NULL,
	`token` text NOT NULL,
	`expires_at` integer NOT NULL,
	`accepted_at` integer,
	FOREIGN KEY (`org_id`) REFERENCES `orgs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`invited_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `layout_transfers_token_unique` ON `layout_transfers` (`token`);--> statement-breakpoint
CREATE UNIQUE INDEX `org_invites_token_unique` ON `org_invites` (`token`);
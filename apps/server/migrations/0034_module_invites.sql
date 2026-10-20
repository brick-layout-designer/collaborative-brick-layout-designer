-- Invites to a module by an emailed link, like layout invites: accepted
-- by the invited, verified email; single use; expires. Additive only.
CREATE TABLE `module_invites` (
	`id` text PRIMARY KEY NOT NULL,
	`module_id` text NOT NULL,
	`invited_email` text NOT NULL,
	`role` text NOT NULL,
	`token` text NOT NULL,
	`invited_by` text NOT NULL,
	`expires_at` integer NOT NULL,
	`accepted_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`module_id`) REFERENCES `modules`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`invited_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `module_invites_token_unique` ON `module_invites` (`token`);--> statement-breakpoint
CREATE INDEX `module_invites_module_id_idx` ON `module_invites` (`module_id`);
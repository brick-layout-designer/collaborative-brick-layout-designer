CREATE TABLE `module_transfers` (
	`id` text PRIMARY KEY NOT NULL,
	`module_id` text NOT NULL,
	`initiated_by` text NOT NULL,
	`recipient_email` text NOT NULL,
	`token` text NOT NULL,
	`expires_at` integer NOT NULL,
	`accepted_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`module_id`) REFERENCES `modules`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`initiated_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `module_transfers_token_unique` ON `module_transfers` (`token`);
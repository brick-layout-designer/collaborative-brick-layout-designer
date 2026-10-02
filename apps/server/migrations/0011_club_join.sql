CREATE TABLE `org_join_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`user_id` text NOT NULL,
	`message` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `orgs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `org_join_requests_org_user_idx` ON `org_join_requests` (`org_id`,`user_id`);--> statement-breakpoint
CREATE INDEX `org_join_requests_user_id_idx` ON `org_join_requests` (`user_id`);--> statement-breakpoint
ALTER TABLE `orgs` ADD `join_policy` text DEFAULT 'invite' NOT NULL;--> statement-breakpoint
ALTER TABLE `orgs` ADD `listed` integer DEFAULT false NOT NULL;
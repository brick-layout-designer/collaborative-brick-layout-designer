CREATE TABLE `layout_collaborators` (
	`layout_id` text NOT NULL,
	`user_id` text NOT NULL,
	`role` text NOT NULL,
	`added_at` integer NOT NULL,
	PRIMARY KEY(`layout_id`, `user_id`),
	FOREIGN KEY (`layout_id`) REFERENCES `layouts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `layout_invites` (
	`id` text PRIMARY KEY NOT NULL,
	`layout_id` text NOT NULL,
	`invited_email` text NOT NULL,
	`role` text NOT NULL,
	`token` text NOT NULL,
	`expires_at` integer NOT NULL,
	`accepted_at` integer,
	FOREIGN KEY (`layout_id`) REFERENCES `layouts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `layout_updates` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`layout_id` text NOT NULL,
	`doc` text NOT NULL,
	`update_bytes` blob NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`layout_id`) REFERENCES `layouts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `layouts` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`owner_user_id` text,
	`owner_org_id` text,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`expires_at` integer,
	`doc_snapshot` blob NOT NULL,
	`doc_version` integer DEFAULT 0 NOT NULL,
	`sidecar_snapshot` blob,
	FOREIGN KEY (`owner_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`owner_org_id`) REFERENCES `orgs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `layout_invites_token_unique` ON `layout_invites` (`token`);
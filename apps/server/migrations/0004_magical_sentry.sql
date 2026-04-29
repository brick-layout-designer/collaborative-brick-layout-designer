CREATE TABLE `custom_part_collaborators` (
	`custom_part_id` text NOT NULL,
	`user_id` text NOT NULL,
	`role` text NOT NULL,
	`added_at` integer NOT NULL,
	PRIMARY KEY(`custom_part_id`, `user_id`),
	FOREIGN KEY (`custom_part_id`) REFERENCES `custom_parts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `custom_parts` (
	`id` text PRIMARY KEY NOT NULL,
	`part_number` text NOT NULL,
	`display_name` text NOT NULL,
	`owner_user_id` text,
	`owner_org_id` text,
	`created_by` text NOT NULL,
	`xml_blob` blob NOT NULL,
	`sprite_blob` blob NOT NULL,
	`sprite_mime` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`owner_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`owner_org_id`) REFERENCES `orgs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `module_collaborators` (
	`module_id` text NOT NULL,
	`user_id` text NOT NULL,
	`role` text NOT NULL,
	`added_at` integer NOT NULL,
	PRIMARY KEY(`module_id`, `user_id`),
	FOREIGN KEY (`module_id`) REFERENCES `modules`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `modules` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`owner_user_id` text,
	`owner_org_id` text,
	`created_by` text NOT NULL,
	`doc_snapshot` blob NOT NULL,
	`doc_version` integer DEFAULT 0 NOT NULL,
	`sidecar_snapshot` blob,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`owner_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`owner_org_id`) REFERENCES `orgs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);

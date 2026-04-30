CREATE TABLE `audit_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`layout_id` text,
	`resource_kind` text,
	`resource_id` text,
	`user_id` text,
	`event_type` text NOT NULL,
	`payload` text NOT NULL,
	`doc_version` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
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
CREATE TABLE `custom_parts` (
	`id` text PRIMARY KEY NOT NULL,
	`part_number` text NOT NULL,
	`display_name` text NOT NULL,
	`owner_user_id` text,
	`owner_org_id` text,
	`created_by` text NOT NULL,
	`is_global` integer DEFAULT false NOT NULL,
	`category` text DEFAULT 'Custom' NOT NULL,
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
	`public_share_token` text,
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
--> statement-breakpoint
CREATE TABLE `oauth_accounts` (
	`provider` text NOT NULL,
	`provider_user_id` text NOT NULL,
	`user_id` text NOT NULL,
	PRIMARY KEY(`provider`, `provider_user_id`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
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
CREATE TABLE `org_members` (
	`org_id` text NOT NULL,
	`user_id` text NOT NULL,
	`role` text NOT NULL,
	`joined_at` integer NOT NULL,
	PRIMARY KEY(`org_id`, `user_id`),
	FOREIGN KEY (`org_id`) REFERENCES `orgs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `org_part_libraries` (
	`org_id` text NOT NULL,
	`library_id` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`org_id`, `library_id`),
	FOREIGN KEY (`org_id`) REFERENCES `orgs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`library_id`) REFERENCES `part_libraries`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `orgs` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `part_libraries` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`source_url` text,
	`part_count` integer DEFAULT 0 NOT NULL,
	`default_enabled` integer DEFAULT false NOT NULL,
	`locked` integer DEFAULT false NOT NULL,
	`installed_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`expires_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`display_name` text NOT NULL,
	`avatar_url` text,
	`password_hash` text,
	`is_demo_account` integer DEFAULT false NOT NULL,
	`is_global_admin` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `venue_library` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_user_id` text,
	`owner_org_id` text,
	`name` text NOT NULL,
	`data` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`owner_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`owner_org_id`) REFERENCES `orgs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `custom_part_invites_token_unique` ON `custom_part_invites` (`token`);--> statement-breakpoint
CREATE UNIQUE INDEX `layout_invites_token_unique` ON `layout_invites` (`token`);--> statement-breakpoint
CREATE UNIQUE INDEX `layout_transfers_token_unique` ON `layout_transfers` (`token`);--> statement-breakpoint
CREATE UNIQUE INDEX `layouts_public_share_token_unique` ON `layouts` (`public_share_token`);--> statement-breakpoint
CREATE UNIQUE INDEX `module_transfers_token_unique` ON `module_transfers` (`token`);--> statement-breakpoint
CREATE UNIQUE INDEX `org_invites_token_unique` ON `org_invites` (`token`);--> statement-breakpoint
CREATE UNIQUE INDEX `orgs_slug_unique` ON `orgs` (`slug`);--> statement-breakpoint
CREATE UNIQUE INDEX `part_libraries_slug_unique` ON `part_libraries` (`slug`);--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);
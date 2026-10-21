CREATE TABLE `club_roles` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`key` text,
	`name` text NOT NULL,
	`permissions` text NOT NULL,
	`position` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `orgs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `club_roles_org_id_idx` ON `club_roles` (`org_id`);--> statement-breakpoint
CREATE TABLE `member_roles` (
	`org_id` text NOT NULL,
	`user_id` text NOT NULL,
	`role_id` text NOT NULL,
	PRIMARY KEY(`org_id`, `user_id`, `role_id`),
	FOREIGN KEY (`role_id`) REFERENCES `club_roles`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`org_id`,`user_id`) REFERENCES `org_members`(`org_id`,`user_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `member_roles_role_id_idx` ON `member_roles` (`role_id`);--> statement-breakpoint
ALTER TABLE `org_invites` ADD `role_id` text;--> statement-breakpoint
-- Backfill: every club gets Admin, Manager, Member and Viewer, with the
-- permissions that give exactly what the old fixed roles gave (Member
-- follows the club's "members can add things" setting), and each member
-- holds the role matching their old one. org_members.role stays.
INSERT INTO `club_roles` (`id`, `org_id`, `key`, `name`, `permissions`, `position`, `created_at`)
SELECT `id` || ':admin', `id`, 'admin', 'Admin', '["view_items","edit_layouts","start_layouts","edit_modules","add_parts","manage_venues","send_catalog","invite","manage_members","export_data","delete_items"]', 0, CAST(strftime('%s','now') AS integer) * 1000 FROM `orgs`;--> statement-breakpoint
INSERT INTO `club_roles` (`id`, `org_id`, `key`, `name`, `permissions`, `position`, `created_at`)
SELECT `id` || ':manager', `id`, 'manager', 'Manager', '["view_items","edit_layouts","start_layouts","edit_modules","add_parts","manage_venues","send_catalog","invite","delete_items"]', 1, CAST(strftime('%s','now') AS integer) * 1000 FROM `orgs`;--> statement-breakpoint
INSERT INTO `club_roles` (`id`, `org_id`, `key`, `name`, `permissions`, `position`, `created_at`)
SELECT `id` || ':member', `id`, 'member', 'Member',
  CASE WHEN `members_can_create` THEN '["view_items","edit_layouts","start_layouts","edit_modules","add_parts"]' ELSE '["view_items","edit_layouts","add_parts"]' END,
  2, CAST(strftime('%s','now') AS integer) * 1000 FROM `orgs`;--> statement-breakpoint
INSERT INTO `club_roles` (`id`, `org_id`, `key`, `name`, `permissions`, `position`, `created_at`)
SELECT `id` || ':viewer', `id`, 'viewer', 'Viewer', '["view_items"]', 3, CAST(strftime('%s','now') AS integer) * 1000 FROM `orgs`;--> statement-breakpoint
INSERT INTO `member_roles` (`org_id`, `user_id`, `role_id`)
SELECT `org_id`, `user_id`, `org_id` || ':' || `role` FROM `org_members`;
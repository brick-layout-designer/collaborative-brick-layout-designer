ALTER TABLE `orgs` ADD `description` text;--> statement-breakpoint
ALTER TABLE `orgs` ADD `members_can_create` integer DEFAULT true NOT NULL;
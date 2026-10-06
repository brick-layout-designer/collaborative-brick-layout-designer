-- Privacy requests, restriction, record keeping and the privacy page. Additive only.
--   privacy_requests, privacy_request_events   new tables (Admin › Privacy requests)
--   users.restricted_at                       null: not restricted (every existing account)
--   platform_settings.privacy_notice          null: no notice yet (the dashboard nudges)
--   platform_settings.privacy_contact         null: no contact yet (PRIVACY_CONTACT may force one)
-- New Privacy settings (platform_settings.privacy, defaults when absent): a request is due in
-- 30 days; the audit log keeps email addresses 365 days; expired sign-ins, invites and offers
-- are kept 30 days; erasure records and closed requests 1095 days.
CREATE TABLE `privacy_request_events` (
	`id` text PRIMARY KEY NOT NULL,
	`request_id` text NOT NULL,
	`at` integer NOT NULL,
	`by` text,
	`kind` text NOT NULL,
	`text` text DEFAULT '' NOT NULL,
	FOREIGN KEY (`request_id`) REFERENCES `privacy_requests`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `privacy_request_events_request_idx` ON `privacy_request_events` (`request_id`,`at`);--> statement-breakpoint
CREATE TABLE `privacy_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`subject_user_id` text,
	`subject_text` text,
	`received_via` text NOT NULL,
	`received_at` integer NOT NULL,
	`due_at` integer NOT NULL,
	`status` text NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`created_by` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`closed_at` integer,
	FOREIGN KEY (`subject_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `privacy_requests_status_due_idx` ON `privacy_requests` (`status`,`due_at`);--> statement-breakpoint
CREATE INDEX `privacy_requests_subject_idx` ON `privacy_requests` (`subject_user_id`);--> statement-breakpoint
ALTER TABLE `platform_settings` ADD `privacy_notice` text;--> statement-breakpoint
ALTER TABLE `platform_settings` ADD `privacy_contact` text;--> statement-breakpoint
ALTER TABLE `users` ADD `restricted_at` integer;
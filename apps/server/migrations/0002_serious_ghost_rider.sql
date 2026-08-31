CREATE TABLE `platform_settings` (
	`id` text PRIMARY KEY NOT NULL,
	`require_email_verification` integer DEFAULT true NOT NULL,
	`smtp_host` text,
	`smtp_port` integer,
	`smtp_user` text,
	`smtp_pass` text,
	`smtp_from` text,
	`updated_at` integer NOT NULL,
	`updated_by` text,
	FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);

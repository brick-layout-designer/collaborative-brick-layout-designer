CREATE TABLE `audit_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`layout_id` text NOT NULL,
	`user_id` text,
	`event_type` text NOT NULL,
	`payload` text NOT NULL,
	`doc_version` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`layout_id`) REFERENCES `layouts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);

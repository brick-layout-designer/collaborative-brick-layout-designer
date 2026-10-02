CREATE TABLE `warnings` (
	`id` text PRIMARY KEY NOT NULL,
	`scope` text NOT NULL,
	`club_org_id` text,
	`subject_user_id` text,
	`subject_org_id` text,
	`severity` text NOT NULL,
	`reason` text NOT NULL,
	`link` text,
	`issued_by` text,
	`created_at` integer NOT NULL,
	`acknowledged_at` integer,
	`acknowledged_by` text,
	FOREIGN KEY (`club_org_id`) REFERENCES `orgs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`subject_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`subject_org_id`) REFERENCES `orgs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`issued_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`acknowledged_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `warnings_subject_user_idx` ON `warnings` (`subject_user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `warnings_subject_org_idx` ON `warnings` (`subject_org_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `warnings_club_idx` ON `warnings` (`club_org_id`,`created_at`);
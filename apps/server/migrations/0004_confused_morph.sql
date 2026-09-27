CREATE INDEX `audit_events_layout_id_created_at_idx` ON `audit_events` (`layout_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `audit_events_resource_created_at_idx` ON `audit_events` (`resource_kind`,`resource_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `custom_part_collaborators_user_id_idx` ON `custom_part_collaborators` (`user_id`);--> statement-breakpoint
CREATE INDEX `custom_parts_owner_user_id_idx` ON `custom_parts` (`owner_user_id`);--> statement-breakpoint
CREATE INDEX `custom_parts_owner_org_id_idx` ON `custom_parts` (`owner_org_id`);--> statement-breakpoint
CREATE INDEX `layout_collaborators_user_id_idx` ON `layout_collaborators` (`user_id`);--> statement-breakpoint
CREATE INDEX `module_collaborators_user_id_idx` ON `module_collaborators` (`user_id`);--> statement-breakpoint
CREATE INDEX `modules_owner_user_id_idx` ON `modules` (`owner_user_id`);--> statement-breakpoint
CREATE INDEX `modules_owner_org_id_idx` ON `modules` (`owner_org_id`);--> statement-breakpoint
CREATE INDEX `org_members_user_id_idx` ON `org_members` (`user_id`);--> statement-breakpoint
CREATE INDEX `sessions_user_id_idx` ON `sessions` (`user_id`);
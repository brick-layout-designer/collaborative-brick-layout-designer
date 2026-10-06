-- Deleting a club waits first, hidden, and can be restored. Additive only.
--   orgs.deletion_requested_at, orgs.deletion_due_at, orgs.deleted_by, orgs.deletion_plan
--                                null: no deletion waiting (every existing club)
-- The waiting time is the Privacy setting deletionGraceDays (default 14 days, 7 to 30).
ALTER TABLE `orgs` ADD `deletion_requested_at` integer;--> statement-breakpoint
ALTER TABLE `orgs` ADD `deletion_due_at` integer;--> statement-breakpoint
ALTER TABLE `orgs` ADD `deleted_by` text;--> statement-breakpoint
ALTER TABLE `orgs` ADD `deletion_plan` text;
-- Author credit. Additive only; every new column is nullable with no default.
--   layouts.copied_from_id, custom_parts.copied_from_id, venue_library.copied_from_id
--                                        null: what a copy was made from ("based on ‹title› by ‹author›")
--   layouts / modules / custom_parts.deleted_author_id
--                                        null: the author's old id once their account is deleted
--   venue_library.created_by             who made the venue (no FK, so it survives the account)
-- Backfill: the audit log never recorded venues, so a personal venue is credited to its
-- owner (a venue could only become personal by its owner making or copying it); club
-- venues made before this stay null and show no author.
ALTER TABLE `custom_parts` ADD `copied_from_id` text;--> statement-breakpoint
ALTER TABLE `custom_parts` ADD `deleted_author_id` text;--> statement-breakpoint
ALTER TABLE `layouts` ADD `copied_from_id` text;--> statement-breakpoint
ALTER TABLE `layouts` ADD `deleted_author_id` text;--> statement-breakpoint
ALTER TABLE `modules` ADD `deleted_author_id` text;--> statement-breakpoint
ALTER TABLE `venue_library` ADD `created_by` text;--> statement-breakpoint
ALTER TABLE `venue_library` ADD `copied_from_id` text;--> statement-breakpoint
UPDATE `venue_library` SET `created_by` = `owner_user_id` WHERE `owner_user_id` IS NOT NULL;
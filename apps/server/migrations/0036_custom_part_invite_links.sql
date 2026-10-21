-- Custom parts are shared by invite link, like modules (0034): who sent
-- each invite (an invite holds only while its sender still manages the
-- part) and when. Additive only: the table had no writer before, and an
-- invite with no sender never holds.
ALTER TABLE `custom_part_invites` ADD `invited_by` text REFERENCES users(id) ON DELETE cascade;--> statement-breakpoint
ALTER TABLE `custom_part_invites` ADD `created_at` integer;--> statement-breakpoint
CREATE INDEX `custom_part_invites_custom_part_id_idx` ON `custom_part_invites` (`custom_part_id`);
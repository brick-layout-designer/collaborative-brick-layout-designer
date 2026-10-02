-- Trusted clubs. Additive only: two new columns on orgs.
--   orgs.trusted     false; a site admin or moderator turns it on
--   orgs.trusted_at  null; when it was last trusted
-- A trusted club's own admins and managers review what's published under
-- its name. Its review queue is worked out from what's waiting, so
-- untrusting a club moves its queue back to the site's with no data change.
ALTER TABLE `orgs` ADD `trusted` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `orgs` ADD `trusted_at` integer;
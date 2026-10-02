-- Admin › Settings › "Demo account": one demo account an admin switches on,
-- which resets itself. Off by default, so deploying changes nothing.
ALTER TABLE `platform_settings` ADD `demo_enabled` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `platform_settings` ADD `demo_reset_every` text DEFAULT 'daily' NOT NULL;--> statement-breakpoint
ALTER TABLE `platform_settings` ADD `demo_last_reset_at` integer;--> statement-breakpoint
-- The per-person demo flag is gone: from now on only the one demo account
-- has it. Nobody's account or layouts are deleted.
UPDATE `users` SET `is_demo_account` = false WHERE `is_demo_account` = true;--> statement-breakpoint
-- Demo layouts no longer expire (the column stays, unused).
UPDATE `layouts` SET `expires_at` = NULL WHERE `expires_at` IS NOT NULL;

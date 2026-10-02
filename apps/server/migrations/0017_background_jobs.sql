ALTER TABLE `platform_settings` ADD `backups_enabled` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `platform_settings` ADD `daily_compaction_enabled` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `platform_settings` ADD `demo_ttl_sweep_enabled` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `platform_settings` ADD `demo_layout_ttl_days` integer DEFAULT 30 NOT NULL;
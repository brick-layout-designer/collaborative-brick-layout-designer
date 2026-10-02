-- Module pictures: a small PNG/WebP (about 256 px) made by the editor when a
-- module is saved. All three columns start null, so existing modules are
-- unchanged until someone opens or saves them (opening one backfills it).
ALTER TABLE `modules` ADD `thumbnail` blob;--> statement-breakpoint
ALTER TABLE `modules` ADD `thumbnail_mime` text;--> statement-breakpoint
ALTER TABLE `modules` ADD `thumbnail_at` integer;
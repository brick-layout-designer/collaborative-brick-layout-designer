-- Admin › Settings › "Enforce usage limits". On by default, which matches
-- collab today (limits on), so deploying changes nothing. The LIMITS_ENFORCE
-- env var, when set, still overrides it.
ALTER TABLE `platform_settings` ADD `limits_enforced` integer DEFAULT true NOT NULL;
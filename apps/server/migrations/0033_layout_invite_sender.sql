-- Who sent each layout invite, so an invite holds only while its sender
-- still manages the layout's sharing. Additive only: older invites keep
-- a null sender (the audit log names theirs).
ALTER TABLE `layout_invites` ADD `invited_by` text REFERENCES users(id) ON DELETE cascade;

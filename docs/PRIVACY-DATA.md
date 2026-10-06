# Personal data map

What the server stores about people, where, and what happens to it.
Whoever runs a server is the data controller for it: this file is for
them, and for anyone answering a privacy request.

Kept in step with the code: `apps/server/src/privacy/collect.ts` reads
every table marked **Export: yes** for "Download my data", and
`privacyExport.test.ts` fails when a table is added that is neither read
there nor listed in `NO_PERSONAL_DATA`, or when a table is missing here.

Times are stored as Unix milliseconds. Nothing in the database records IP
addresses or browser user agents: the server reads the user agent only to
count browser vs desktop requests (`metrics/activity.ts`, counts only) and
to check the desktop app's version, and its web server log (stdout) is the
host's to keep or not.

## Accounts and sign-in

| Table | Personal data | Export | Notes |
|---|---|---|---|
| `users` | email, display name, avatar URL, password hash, admin/moderator flags, created and last-seen times | yes (no hash) | `last_seen_at` is one time, rounded, no history. |
| `sessions` | which browsers are signed in, until when | yes (no ids) | The id is a hash of the cookie: a secret. |
| `api_tokens` | desktop sign-ins: name, prefix and last 4 characters, scopes, last used | yes (no hash) | Revoked rows are kept so the Devices list can show them. |
| `device_codes` | desktop sign-in codes a person approved or denied | yes (no codes) | Expire after minutes. |
| `oauth_accounts` | the Google / GitHub / OIDC account id linked | yes | |
| `email_verifications` | open "confirm your email" links | yes (no token) | |
| `user_preferences` | theme, text size, help and tour settings | yes | |

## Clubs

| Table | Personal data | Export | Notes |
|---|---|---|---|
| `orgs` | `created_by` (who started it) | as "clubs-started" | The club's own data otherwise. |
| `org_members` | membership and role | yes | |
| `org_invites` | invited email, who invited | yes (no token) | Either side's. |
| `org_join_requests` | request and its note | yes | |
| `org_part_libraries` | none | no | Club settings. |

## Things people make

| Table | Personal data | Export | Notes |
|---|---|---|---|
| `layouts` | owner, creator, title, the layout itself; `deleted_author_id` | yes, own layouts as `.bld-layout` files | Background pictures live on disk in `bgimages/<layout id>.<ext>` and go inside the `.bld-layout`. |
| `layout_updates` | recent edits waiting to be folded in | inside the layout file | |
| `layout_collaborators` | who a layout is shared with, and their role | yes | |
| `layout_invites` | invited email | yes (no token) | |
| `layout_transfers` | who offered a layout to which email | yes (no token) | |
| `modules` | owner, creator, title, the module, its picture | yes, own modules as `.bld-layout` + picture | |
| `module_versions` | who saved each version, and its note | yes (metadata) | |
| `module_collaborators` | shares | yes | |
| `module_transfers` | offers | yes (no token) | |
| `custom_parts` | owner, creator, the part's XML and picture | yes, own parts as XML + picture | The XML may name an author. |
| `custom_part_collaborators` | shares | yes | |
| `custom_part_invites` | invited email | yes (no token) | |
| `venue_library` | owner, creator, the venue | yes, own venues as JSON | |
| `part_libraries` | none | no | Installed by site admins. |

## Public catalog

| Table | Personal data | Export | Notes |
|---|---|---|---|
| `catalog_items` | owner, title, description, tags | yes | Public while published. |
| `catalog_item_versions` | who submitted and who reviewed, notes | yes (metadata) | |
| `catalog_copies` | who added which item | yes | |
| `catalog_collections` | curator, title, description, notes | yes | |
| `catalog_collection_covers` | uploaded cover pictures, uploader | yes, pictures in `covers/` | Re-encoded, no picture metadata. |
| `catalog_collection_items`, `catalog_collection_modules`, `catalog_collection_parts` | none | no | Which things are in a collection. |

## Moderation, limits and records

| Table | Personal data | Export | Notes |
|---|---|---|---|
| `warnings` | warnings and notes to a person, the reason, who sent and read them | yes | Also used for "your download is ready" notes. |
| `limit_overrides` | a person's own limits, suspension and its reason | yes | |
| `usage_daily` | per-person daily counts (requests, uploads, bytes) | yes | Numbers only; swept after `USAGE_RETENTION_DAYS`. |
| `daily_stats` | none | no | Site-wide daily numbers. |
| `audit_events` | who did what to which thing, with a JSON payload; some payloads name an email (invites, admin actions) | yes | No IP addresses or user agents. |
| `platform_settings` | `updated_by` (the admin who last saved) | as "site-settings-changes" | |
| `data_exports` | data downloads: about whom, asked by whom, when | yes | Files in `exports/<id>.zip` next to the database. |

## Files outside the database

| Where | What | Export |
|---|---|---|
| `bgimages/<layout id>.<ext>` | layout background pictures | inside the layout's `.bld-layout` |
| `exports/<id>.zip` | data downloads | n/a (it is the download) |
| `BACKUPS_DIR/cbld-*.sqlite.gz` | nightly database copies (7 daily, 3 weekly, 12 monthly) | no: they are copies of the above |

## The demo account

The one shared demo account (`users.is_demo_account`) holds sample
layouts and resets on a schedule. It belongs to nobody, so it can't
download its data.

## The desktop app

The desktop app keeps its layouts on the computer. On the server it has
only its sign-in (`api_tokens`, and the `device_codes` row it was approved
with) and whatever it publishes, which is stored like anything made on the
website. "Download my data" includes all of it.

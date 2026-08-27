import { db, schema, sqlite } from '../db/index.js';

// TypeScript 7's stricter ArrayBufferLike/SharedArrayBuffer variance made
// `Buffer` no longer structurally satisfy `Uint8Array<ArrayBuffer>` at
// Buffer.prototype.copy's `target` param and Buffer.concat's element type
// — a type-declaration gap, not a real behavior change (both have always
// accepted Buffer targets/elements at runtime). Several test fixtures
// hand-build ZIP archives byte-by-byte and hit this repeatedly; these two
// thin wrappers centralise the cast so it isn't scattered at each site.

/** `nameBytes.copy(target, offset)`, cast past the Buffer/Uint8Array<ArrayBuffer> type gap. */
export function bufCopy(source: Buffer, target: Buffer, targetStart: number): number {
  return source.copy(target as unknown as Uint8Array<ArrayBuffer>, targetStart);
}

/** `Buffer.concat(list)`, cast past the same type gap. */
export function bufConcat(list: readonly Buffer[]): Buffer {
  return Buffer.concat(list as unknown as readonly Uint8Array<ArrayBuffer>[]);
}

/**
 * Truncate everything between tests. Order matters: child rows first.
 * SQLite has no TRUNCATE; DELETE without a WHERE clause is the equivalent.
 */
export function resetDb(): void {
  sqlite.exec(`
    DELETE FROM audit_events;
    DELETE FROM module_transfers;
    DELETE FROM module_collaborators;
    DELETE FROM modules;
    DELETE FROM custom_part_invites;
    DELETE FROM custom_part_collaborators;
    DELETE FROM custom_parts;
    DELETE FROM layout_transfers;
    DELETE FROM layout_updates;
    DELETE FROM layout_invites;
    DELETE FROM layout_collaborators;
    DELETE FROM layouts;
    DELETE FROM oauth_accounts;
    DELETE FROM org_invites;
    DELETE FROM org_members;
    DELETE FROM orgs;
    DELETE FROM sessions;
    DELETE FROM users;
  `);
}

export { db, schema };

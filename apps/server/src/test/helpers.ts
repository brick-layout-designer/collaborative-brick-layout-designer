import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
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
    DELETE FROM warnings;
    DELETE FROM daily_stats;
    DELETE FROM usage_daily;
    DELETE FROM limit_overrides;
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
    DELETE FROM org_join_requests;
    DELETE FROM org_members;
    DELETE FROM orgs;
    DELETE FROM sessions;
    DELETE FROM api_tokens;
    DELETE FROM device_codes;
    DELETE FROM email_verifications;
    DELETE FROM platform_settings;
    DELETE FROM user_preferences;
    DELETE FROM users;
  `);
}

/**
 * Register + verify a password account through the real routes (the app
 * must have `passwordRoutes` registered) and return its session cookie
 * and user id. Verification is what issues the first session cookie.
 */
export async function loginAs(
  app: FastifyInstance,
  email: string,
): Promise<{ cookie: string; id: string }> {
  await app.inject({
    method: 'POST',
    url: '/api/auth/password/register',
    payload: { email, password: 'correct horse battery', displayName: email },
  });
  const user = await db.select().from(schema.users).where(eq(schema.users.email, email)).get();
  if (!user) throw new Error(`loginAs: registration failed for ${email}`);
  const v = await db
    .select()
    .from(schema.emailVerifications)
    .where(eq(schema.emailVerifications.userId, user.id))
    .get();
  if (!v) throw new Error(`loginAs: no verification token for ${email}`);
  const res = await app.inject({ method: 'POST', url: `/api/auth/password/verify-email/${v.token}` });
  const sc = res.headers['set-cookie'];
  return { cookie: Array.isArray(sc) ? sc.join('; ') : (sc ?? ''), id: user.id };
}

/**
 * Run the device-code flow (the app must have `deviceRoutes`) as the
 * user behind `cookieStr` and return the minted `bld_pat_…` token.
 */
export async function issueToken(app: FastifyInstance, cookieStr: string, scope?: string): Promise<string> {
  const code = await app.inject({
    method: 'POST',
    url: '/api/auth/device/code',
    payload: { client_name: 'Brick Layout Designer (test)', ...(scope === undefined ? {} : { scope }) },
  });
  const { device_code, user_code } = code.json() as { device_code: string; user_code: string };
  const approve = await app.inject({
    method: 'POST',
    url: '/api/auth/device/approve',
    headers: { cookie: cookieStr },
    payload: { user_code },
  });
  if (approve.statusCode !== 200) throw new Error(`issueToken: approve → ${approve.statusCode}`);
  const res = await app.inject({ method: 'POST', url: '/api/auth/device/token', payload: { device_code } });
  const token = (res.json() as { access_token?: string }).access_token;
  if (!token) throw new Error(`issueToken: token → ${res.body}`);
  return token;
}

export { db, schema };

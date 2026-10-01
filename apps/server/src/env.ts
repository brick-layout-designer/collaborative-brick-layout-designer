function bool(value: string | undefined, fallback = false): boolean {
  if (value === undefined) return fallback;
  return value === '1' || value.toLowerCase() === 'true';
}

function int(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * TRUST_PROXY → Fastify's `trustProxy`. Unset / "false" / "0": don't
 * trust X-Forwarded-* (req.ip is the socket peer). "true": trust any
 * proxy chain. Anything else: a comma-separated list of proxy IPs /
 * CIDRs. A bare hop count is rejected: Fastify dropped hop-count trust
 * because it lets direct clients spoof X-Forwarded-For.
 */
export function parseTrustProxy(value: string | undefined): boolean | string {
  const v = value?.trim() ?? '';
  if (v === '' || v === '0' || v.toLowerCase() === 'false') return false;
  if (v.toLowerCase() === 'true') return true;
  if (/^\d+$/.test(v)) {
    throw new Error('TRUST_PROXY hop counts are not supported; use "true" or proxy IPs/CIDRs');
  }
  return v;
}

export const env = {
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: int(process.env.HTTP_PORT ?? process.env.PORT, 3000),
  dbPath: process.env.DB_PATH ?? './data/cbld.sqlite',
  publicUrl: process.env.PUBLIC_URL ?? 'http://localhost:3000',
  cookieSecure: bool(process.env.COOKIE_SECURE, process.env.NODE_ENV === 'production'),
  partsDir: process.env.PARTS_DIR ?? './data/parts',
  trustProxy: parseTrustProxy(process.env.TRUST_PROXY),
  // LIMITS_ENFORCE=off: usage limits are counted and shown to admins but
  // nothing is refused (no limit_reached, no 429, no read-only suspension).
  // For trying limits out on a live site before turning them on.
  limitsEnforce: !['off', 'false', '0', 'no'].includes((process.env.LIMITS_ENFORCE ?? 'on').trim().toLowerCase()),

  enablePasswordAuth: bool(process.env.ENABLE_PASSWORD_AUTH, false),
  demoMode: bool(process.env.DEMO_MODE, false),
  demoLayoutTtlDays: int(process.env.DEMO_LAYOUT_TTL_DAYS, 30),

  bootstrapAdminEmail: process.env.BOOTSTRAP_ADMIN_EMAIL ?? null,
  bootstrapAdminPassword: process.env.BOOTSTRAP_ADMIN_PASSWORD ?? null,

  google: providerEnv('GOOGLE'),
  github: providerEnv('GITHUB'),
  oidc: oidcEnv(),

  smtp: smtpEnv(),

  // Phase 7 background workers — all on by default in production.
  backupsEnabled: bool(process.env.BACKUPS_ENABLED, true),
  backupsDir: process.env.BACKUPS_DIR ?? '/backups',
  demoTtlSweepEnabled: bool(process.env.DEMO_TTL_SWEEP_ENABLED, true),
  dailyCompactionEnabled: bool(process.env.DAILY_COMPACTION_ENABLED, true),
};

function providerEnv(prefix: string): { clientId: string; clientSecret: string } | null {
  const clientId = process.env[`${prefix}_CLIENT_ID`];
  const clientSecret = process.env[`${prefix}_CLIENT_SECRET`];
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret };
}

function oidcEnv(): { issuerUrl: string; clientId: string; clientSecret: string } | null {
  const issuerUrl = process.env.OIDC_ISSUER_URL;
  const clientId = process.env.OIDC_CLIENT_ID;
  const clientSecret = process.env.OIDC_CLIENT_SECRET;
  if (!issuerUrl || !clientId || !clientSecret) return null;
  return { issuerUrl, clientId, clientSecret };
}

function smtpEnv():
  | { host: string; port: number; user: string | null; pass: string | null; from: string }
  | null {
  const host = process.env.SMTP_HOST;
  const from = process.env.SMTP_FROM;
  if (!host || !from) return null;
  return {
    host,
    port: int(process.env.SMTP_PORT, 587),
    user: process.env.SMTP_USER ?? null,
    pass: process.env.SMTP_PASS ?? null,
    from,
  };
}

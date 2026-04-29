function bool(value: string | undefined, fallback = false): boolean {
  if (value === undefined) return fallback;
  return value === '1' || value.toLowerCase() === 'true';
}

function int(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
}

export const env = {
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: int(process.env.PORT, 3000),
  dbPath: process.env.DB_PATH ?? './data/cld.sqlite',
  publicUrl: process.env.PUBLIC_URL ?? 'http://localhost:3000',
  cookieSecure: bool(process.env.COOKIE_SECURE, process.env.NODE_ENV === 'production'),
  partsDir: process.env.PARTS_DIR ?? '../../parts-library',

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

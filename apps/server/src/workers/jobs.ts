// Background jobs and the demo layout lifetime: switched in Admin ›
// Settings (platform_settings), unless the server's own env var forces
// one (then the page says "Forced by the server setting X"). Read at each
// use, so a change applies without a restart.

import { getPlatformSettings } from '../auth/platformSettings.js';
import { env } from '../env.js';

export interface JobSetting<T> {
  /** What applies now. */
  value: T;
  /** The admin's switch, kept even while forced. */
  setting: T;
  /** The env var forcing it, or null when the switch decides. */
  forcedBy: string | null;
}

export interface BackgroundJobs {
  backups: JobSetting<boolean>;
  dailyCompaction: JobSetting<boolean>;
  demoTtlSweep: JobSetting<boolean>;
  demoLayoutTtlDays: JobSetting<number>;
}

function pick<T>(setting: T, forced: T | null, name: string): JobSetting<T> {
  return forced === null ? { value: setting, setting, forcedBy: null } : { value: forced, setting, forcedBy: name };
}

export async function backgroundJobs(): Promise<BackgroundJobs> {
  const s = await getPlatformSettings();
  return {
    backups: pick(s.backupsEnabled, env.backupsEnabledForced, 'BACKUPS_ENABLED'),
    dailyCompaction: pick(s.dailyCompactionEnabled, env.dailyCompactionEnabledForced, 'DAILY_COMPACTION_ENABLED'),
    demoTtlSweep: pick(s.demoTtlSweepEnabled, env.demoTtlSweepEnabledForced, 'DEMO_TTL_SWEEP_ENABLED'),
    demoLayoutTtlDays: pick(s.demoLayoutTtlDays, env.demoLayoutTtlDaysForced, 'DEMO_LAYOUT_TTL_DAYS'),
  };
}

/** When a demo account's new layout is deleted. */
export async function demoExpiry(now: Date): Promise<Date> {
  const days = (await backgroundJobs()).demoLayoutTtlDays.value;
  return new Date(now.getTime() + days * 86400_000);
}

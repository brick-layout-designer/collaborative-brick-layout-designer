// Background jobs: switched in Admin ›
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
}

function pick<T>(setting: T, forced: T | null, name: string): JobSetting<T> {
  return forced === null ? { value: setting, setting, forcedBy: null } : { value: forced, setting, forcedBy: name };
}

export async function backgroundJobs(): Promise<BackgroundJobs> {
  const s = await getPlatformSettings();
  return {
    backups: pick(s.backupsEnabled, env.backupsEnabledForced, 'BACKUPS_ENABLED'),
    dailyCompaction: pick(s.dailyCompactionEnabled, env.dailyCompactionEnabledForced, 'DAILY_COMPACTION_ENABLED'),
  };
}

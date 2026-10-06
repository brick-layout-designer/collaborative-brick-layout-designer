// The privacy clean-up: runs every hour (workers/index.ts) and always,
// since keeping personal data longer than promised isn't a choice the
// site can switch off. Each step is safe to run again; tests call it with
// a fake "now".
//
//   - data downloads past their keep-by date: file and row deleted

import { purgeExpiredExports } from './exports.js';

export interface PrivacyTickResult {
  exportsPurged: number;
}

export async function privacyTick(now: Date = new Date()): Promise<PrivacyTickResult> {
  const exportsPurged = await purgeExpiredExports(now);
  return { exportsPurged };
}

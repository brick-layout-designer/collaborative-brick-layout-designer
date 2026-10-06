// The privacy clean-up: runs every hour (workers/index.ts) and always,
// since keeping personal data longer than promised isn't a choice the
// site can switch off. Each step is safe to run again; tests call it with
// a fake "now".
//
//   - data downloads past their keep-by date: file and row deleted
//   - accounts whose waiting time is over: erased (accountDeletion.ts)

import { purgeExpiredExports } from './exports.js';
import { eraseDueAccounts } from './accountDeletion.js';

export interface PrivacyTickResult {
  exportsPurged: number;
  accountsErased: number;
}

export async function privacyTick(now: Date = new Date()): Promise<PrivacyTickResult> {
  const accountsErased = await eraseDueAccounts(now);
  const exportsPurged = await purgeExpiredExports(now);
  return { exportsPurged, accountsErased };
}

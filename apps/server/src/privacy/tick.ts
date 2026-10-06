// The privacy clean-up: runs every hour (workers/index.ts) and always,
// since keeping personal data longer than promised isn't a choice the
// site can switch off. Each step is safe to run again; tests call it with
// a fake "now".
//
//   - data downloads past their keep-by date: file and row deleted
//   - accounts whose waiting time is over: erased (accountDeletion.ts)
//   - old sign-ins, invites, audit addresses, records (retention.ts)

import { purgeExpiredExports } from './exports.js';
import { eraseDueAccounts } from './accountDeletion.js';
import { purgeRetention, type RetentionResult } from './retention.js';

export interface PrivacyTickResult {
  exportsPurged: number;
  accountsErased: number;
  retention: RetentionResult;
}

export async function privacyTick(now: Date = new Date()): Promise<PrivacyTickResult> {
  const accountsErased = await eraseDueAccounts(now);
  const exportsPurged = await purgeExpiredExports(now);
  const retention = await purgeRetention(now);
  return { exportsPurged, accountsErased, retention };
}

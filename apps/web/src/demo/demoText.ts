// Words for the demo account's timer, shared by the banner demo visitors
// see and Admin › Settings › Demo account.

import type { DemoResetEvery } from '../api';

/** "every hour", "every 6 hours", "every day". */
export const RESET_EVERY_TEXT: Record<DemoResetEvery, string> = {
  '1h': 'every hour',
  '6h': 'every 6 hours',
  daily: 'every day',
};

/** The admin's choices, in order. */
export const RESET_CHOICES: Array<[DemoResetEvery, string]> = [
  ['1h', '1 hour'],
  ['6h', '6 hours'],
  ['daily', 'Daily'],
];

/** How long until `at`: "less than a minute", "25 min", "3 h 12 min", or "soon" once it's due. */
export function timeUntil(at: number, now: number): string {
  const ms = at - now;
  if (ms <= 0) return 'soon';
  const min = Math.floor(ms / 60_000);
  if (min < 1) return 'less than a minute';
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

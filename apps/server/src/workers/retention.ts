// Pure helpers for the backup-worker retention policy. Extracted from
// `workers/index.ts` so they can be unit-tested without spinning up
// the full daily-tick machinery.
//
// Policy (PLAN.md §4.6):
//   - daily   bucket: keep last 7 days
//   - weekly  bucket: 1 per ISO week for the last 3 weeks
//   - monthly bucket: 1 per calendar month for the last 12 months
// Each bucket keeps the YOUNGEST snapshot in that interval.

const DAY_MS = 24 * 60 * 60 * 1000;

/** Filename pattern emitted by the backup worker. */
const BACKUP_RE = /^cbld-(\d{4})-(\d{2})-(\d{2})\.sqlite\.gz$/;

export function parseBackupDate(filename: string): Date | null {
  const m = BACKUP_RE.exec(filename);
  if (!m) return null;
  return new Date(`${m[1]}-${m[2]}-${m[3]}T00:00:00Z`);
}

export function isoWeekKey(date: Date): string {
  // ISO week-numbering year (Monday-start). Standard Mon-based formula.
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((+d - +yearStart) / DAY_MS + 1) / 7);
  return `${d.getUTCFullYear()}-W${weekNo}`;
}

/**
 * Given a list of backup filenames + a "now" timestamp, decide which to
 * keep and which to delete. Returns both lists so the caller (an fs
 * deleter) can act and log.
 */
export function classifyBackups(
  files: string[],
  now: number,
): { keep: string[]; delete: string[] } {
  // Sort newest first by filename — the backup worker uses ISO-date
  // names so lexical descending == chronological descending.
  const sorted = [...files].filter((f) => BACKUP_RE.test(f)).sort().reverse();

  const dailyCutoff = now - 7 * DAY_MS;
  const weeklyCutoff = now - 21 * DAY_MS;
  const monthlyCutoff = now - 365 * DAY_MS;

  const keep = new Set<string>();
  const seenWeek = new Set<string>();
  const seenMonth = new Set<string>();

  for (const file of sorted) {
    const date = parseBackupDate(file);
    if (!date) continue;
    const ts = date.getTime();

    if (ts >= dailyCutoff) {
      keep.add(file);
      continue;
    }
    if (ts >= weeklyCutoff) {
      const week = isoWeekKey(date);
      if (!seenWeek.has(week)) {
        keep.add(file);
        seenWeek.add(week);
      }
      continue;
    }
    if (ts >= monthlyCutoff) {
      const month = `${date.getUTCFullYear()}-${date.getUTCMonth()}`;
      if (!seenMonth.has(month)) {
        keep.add(file);
        seenMonth.add(month);
      }
      continue;
    }
    // Older than 365d → drop.
  }

  return {
    keep: sorted.filter((f) => keep.has(f)),
    delete: sorted.filter((f) => !keep.has(f)),
  };
}

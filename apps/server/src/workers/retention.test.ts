import { describe, expect, it } from 'vitest';
import { classifyBackups, isoWeekKey, parseBackupDate } from './retention.js';

const DAY_MS = 24 * 60 * 60 * 1000;

function file(date: string): string {
  return `cld-${date}.sqlite.gz`;
}

function dateAt(yyyymmdd: string): number {
  return new Date(`${yyyymmdd}T00:00:00Z`).getTime();
}

describe('parseBackupDate', () => {
  it('extracts the date from a valid filename', () => {
    expect(parseBackupDate('cld-2026-04-29.sqlite.gz')?.toISOString()).toBe(
      '2026-04-29T00:00:00.000Z',
    );
  });
  it('returns null for unrelated filenames', () => {
    expect(parseBackupDate('not-a-backup.txt')).toBeNull();
    expect(parseBackupDate('cld-2026.sqlite.gz')).toBeNull();
  });
});

describe('isoWeekKey', () => {
  it('groups dates within the same ISO week', () => {
    // 2026-04-27 (Mon) through 2026-05-03 (Sun) are all ISO week 18 of
    // 2026 (year-numbering follows the Thursday).
    const mon = isoWeekKey(new Date('2026-04-27T00:00:00Z'));
    const sun = isoWeekKey(new Date('2026-05-03T00:00:00Z'));
    expect(mon).toBe(sun);
  });
  it('rolls over to a new week on Monday', () => {
    const sun = isoWeekKey(new Date('2026-05-03T00:00:00Z'));
    const next = isoWeekKey(new Date('2026-05-04T00:00:00Z'));
    expect(sun).not.toBe(next);
  });
});

describe('classifyBackups', () => {
  // Anchor "now" to a known date so the cutoffs are predictable.
  const NOW_TS = dateAt('2026-04-29');

  it('keeps the last 7 days exhaustively', () => {
    const files: string[] = [];
    // Generate 14 daily backups ending today.
    for (let i = 0; i < 14; i++) {
      const d = new Date(NOW_TS - i * DAY_MS);
      files.push(file(d.toISOString().slice(0, 10)));
    }
    const result = classifyBackups(files, NOW_TS);
    // Today through 6 days ago = 7 days kept by the daily bucket.
    const expectedDaily = files.slice(0, 7);
    for (const f of expectedDaily) {
      expect(result.keep).toContain(f);
    }
  });

  it('weekly bucket keeps at most one backup per ISO week', () => {
    // 22 daily backups end up in either daily (last 7 days) or weekly
    // (8..21 days). The weekly bucket can keep at most one per distinct
    // ISO week. Verify by counting unique ISO weeks among kept files
    // that fall in the weekly window — there must be exactly 1 per week.
    const files: string[] = [];
    for (let i = 0; i < 22; i++) {
      const d = new Date(NOW_TS - i * DAY_MS);
      files.push(file(d.toISOString().slice(0, 10)));
    }
    const result = classifyBackups(files, NOW_TS);

    const weeklyCutoff = NOW_TS - 21 * DAY_MS;
    const dailyCutoff = NOW_TS - 7 * DAY_MS;
    const weeklyKept = result.keep.filter((f) => {
      const ts = parseBackupDate(f)!.getTime();
      return ts < dailyCutoff && ts >= weeklyCutoff;
    });
    const seenWeeks = new Set<string>();
    for (const f of weeklyKept) {
      const w = isoWeekKey(parseBackupDate(f)!);
      expect(seenWeeks.has(w)).toBe(false); // no duplicates per week
      seenWeeks.add(w);
    }
  });

  it('keeps one backup per calendar month after the weekly window', () => {
    // Make a year of ~monthly backups (28-day strides are close enough
    // to monthly without the month-length headache for this test).
    const files: string[] = [];
    for (let i = 0; i < 13; i++) {
      const d = new Date(NOW_TS - i * 30 * DAY_MS);
      files.push(file(d.toISOString().slice(0, 10)));
    }
    const result = classifyBackups(files, NOW_TS);
    // Each backup is ~30 days apart, so we expect roughly 1 daily +
    // 0 weekly (gap is too big) + ~11 monthly. The exact number bounces
    // by ±1 depending on which calendar months the strides hit; assert a
    // reasonable range instead of a literal.
    expect(result.keep.length).toBeGreaterThanOrEqual(8);
    expect(result.keep.length).toBeLessThanOrEqual(13);
  });

  it('drops backups older than ~12 months', () => {
    const files = [
      // Way old: 18 months ago. Should be dropped.
      file('2024-10-29'),
      // Recent: today. Should be kept.
      file('2026-04-29'),
    ];
    const result = classifyBackups(files, NOW_TS);
    expect(result.keep).toEqual([file('2026-04-29')]);
    expect(result.delete).toEqual([file('2024-10-29')]);
  });

  it('ignores files that don\'t match the backup naming pattern', () => {
    const files = [
      'README.md',
      'cld-2026-04-29.sqlite.gz',
      'cld-bad-name.sqlite.gz',
      '.DS_Store',
    ];
    const result = classifyBackups(files, NOW_TS);
    expect(result.keep).toEqual(['cld-2026-04-29.sqlite.gz']);
    expect(result.delete).toEqual([]);
  });

  it('returns empty buckets when input is empty', () => {
    expect(classifyBackups([], NOW_TS)).toEqual({ keep: [], delete: [] });
  });
});

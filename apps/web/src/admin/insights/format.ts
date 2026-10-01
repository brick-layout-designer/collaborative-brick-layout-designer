// Pure helpers for the admin dashboard: number and date text, a plain
// sentence that sums up a graph (its accessible summary), and CSV.

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i++;
  }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[i]}`;
}

/** 1,284 · 12.9K · 4.2M — compact for tiles and axis ticks. */
export function formatCompact(n: number): string {
  const abs = Math.abs(n);
  if (abs < 10_000) return Math.round(n).toLocaleString('en-US');
  if (abs < 1_000_000) return `${(n / 1000).toFixed(abs < 100_000 ? 1 : 0)}K`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "3 Sep" (UTC, like the server's buckets). */
export function formatDay(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

/** "3 Sep 2026" */
export function formatDate(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** "3 days" / "5 hours" / "12 minutes" */
export function formatDuration(seconds: number): string {
  if (seconds >= 2 * 86400) return `${Math.floor(seconds / 86400)} days`;
  if (seconds >= 2 * 3600) return `${Math.floor(seconds / 3600)} hours`;
  return `${Math.max(1, Math.floor(seconds / 60))} minutes`;
}

/** "2 hours ago" / "3 days ago" */
export function formatAgo(ms: number, now: number = Date.now()): string {
  return `${formatDuration(Math.max(60, (now - ms) / 1000))} ago`;
}

/**
 * One plain sentence describing a time series, used as the graph's
 * text summary (shown under it and read by screen readers).
 */
export function describeSeries(
  name: string,
  values: readonly number[],
  starts: readonly number[],
  bucket: 'day' | 'week',
  format: (n: number) => string = formatCompact,
  how: 'total' | 'level' = 'total',
): string {
  if (values.length === 0 || values.every((v) => v === 0)) return `${name}: nothing recorded in this period.`;
  let peak = 0;
  for (let i = 1; i < values.length; i++) if (values[i]! > values[peak]!) peak = i;
  const when = bucket === 'week' ? `the week of ${formatDay(starts[peak]!)}` : formatDay(starts[peak]!);
  const last = values[values.length - 1]!;
  if (how === 'level') {
    const first = values.find((v) => v > 0) ?? 0;
    const trend = last > first ? 'up' : last < first ? 'down' : 'flat';
    return `${name}: ${format(last)} now, ${trend} from ${format(first)}; highest ${format(values[peak]!)} on ${when}.`;
  }
  const total = values.reduce((a, b) => a + b, 0);
  return `${name}: ${format(total)} in total; busiest ${bucket === 'week' ? '' : 'day '}${when} with ${format(values[peak]!)}; ${bucket === 'week' ? 'this week' : 'today'} ${format(last)}.`;
}

/** Quote a CSV cell when it needs it (RFC 4180), and defuse spreadsheet formulas. */
export function csvCell(v: unknown): string {
  let s = v === null || v === undefined ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s) && !/^-?\d/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(header: readonly string[], rows: readonly (readonly unknown[])[]): string {
  return [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

/** Offer `csv` as a file download named `<name>.csv`. */
export function downloadCsv(name: string, csv: string): void {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${name.replace(/[^a-z0-9-]+/gi, '-').toLowerCase()}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Ticks for a 0-based y axis: clean round steps covering `max`. */
export function niceTicks(max: number, count = 4): number[] {
  if (max <= 0) return [0, 1];
  const raw = max / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  // Counts never get fractional ticks (2.5 would print as "3").
  const step = [1, 2, 2.5, 5, 10]
    .map((m) => m * mag)
    .filter((s) => s >= 1 && Number.isInteger(s))
    .find((s) => s >= raw) ?? Math.max(1, 10 * mag);
  const ticks: number[] = [];
  for (let i = 0; i * step <= max + step * 0.001; i++) ticks.push(Math.round(i * step * 1000) / 1000);
  if (ticks[ticks.length - 1]! < max) ticks.push(ticks[ticks.length - 1]! + step);
  return ticks;
}

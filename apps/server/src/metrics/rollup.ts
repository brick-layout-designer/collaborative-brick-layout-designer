// A tiny daily rollup for the admin dashboard (daily_stats in schema.ts).
//
// The database already has timestamps for what gets created (users,
// layouts, parts, modules), so those graphs are built straight from it.
// This module covers what has no history of its own: active people,
// requests, errors, refused requests, live sessions, disk size. Counts
// are kept in memory and written once a minute (and on shutdown), so a
// request costs a Map update, never a database write.
//
// Privacy: aggregate only. `distinct()` holds person ids in memory just
// long enough to count them for the current day; only the count is ever
// written. Keys are route patterns (`/api/layouts/:id`), client kinds or
// layout ids — never a URL with its values, never an IP address.

import { statSync } from 'node:fs';
import { and, gte, lt, sql } from 'drizzle-orm';
import { db, schema, sqlite } from '../db/index.js';
import { env } from '../env.js';
import { usage } from './usage.js';

/** Rollup rows older than this many days are swept by the daily worker. */
export const ROLLUP_RETENTION_DAYS = 400;

const DAY_MS = 24 * 60 * 60 * 1000;

/** UTC calendar day, `YYYY-MM-DD`. Every rollup row is keyed by one. */
export function dayKey(ms: number = Date.now()): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Start of the UTC day containing `ms`. */
export function startOfDay(ms: number): number {
  return Math.floor(ms / DAY_MS) * DAY_MS;
}

function slot(day: string, metric: string, key: string): string {
  return `${day}\u0000${metric}\u0000${key}`;
}

function unslot(s: string): [string, string, string] {
  const [day, metric, key] = s.split('\u0000') as [string, string, string];
  return [day, metric, key];
}

/**
 * The most distinct keys one metric may hold per day. Route patterns,
 * client kinds and desktop versions stay far below this; the cap only
 * stops a bug (or a hostile User-Agent) from growing the table without
 * bound. Further keys fold into "(other)".
 */
const MAX_KEYS_PER_METRIC = 500;

export class Rollup {
  private adds = new Map<string, number>();
  private maxes = new Map<string, number>();
  private gauges = new Map<string, number>();
  private members = new Map<string, Set<string>>();
  private keysSeen = new Map<string, Set<string>>();

  private boundedKey(day: string, metric: string, key: string): string {
    const id = `${day}\u0000${metric}`;
    let keys = this.keysSeen.get(id);
    if (!keys) {
      keys = new Set();
      this.keysSeen.set(id, keys);
    }
    if (keys.has(key)) return key;
    if (keys.size >= MAX_KEYS_PER_METRIC) return '(other)';
    keys.add(key);
    return key;
  }

  /** Add `n` to a counter for today. */
  count(metric: string, key = '', n = 1, now: number = Date.now()): void {
    const day = dayKey(now);
    const s = slot(day, metric, this.boundedKey(day, metric, key));
    this.adds.set(s, (this.adds.get(s) ?? 0) + n);
  }

  /** Count `member` once per day (e.g. a person using the desktop app). Only the count is stored. */
  distinct(metric: string, key: string, member: string, now: number = Date.now()): void {
    const day = dayKey(now);
    const s = slot(day, metric, this.boundedKey(day, metric, key));
    let set = this.members.get(s);
    if (!set) {
      set = new Set();
      this.members.set(s, set);
    }
    set.add(member);
  }

  /** Keep the highest value seen today (e.g. peak live connections). */
  peak(metric: string, key: string, value: number, now: number = Date.now()): void {
    const s = slot(dayKey(now), metric, key);
    this.maxes.set(s, Math.max(this.maxes.get(s) ?? 0, value));
  }

  /** Replace today's value (e.g. database size). */
  gauge(metric: string, key: string, value: number, now: number = Date.now()): void {
    this.gauges.set(slot(dayKey(now), metric, key), value);
  }

  /**
   * Write everything gathered so far. Counters are added to what is
   * stored; distinct counts and peaks keep the larger of stored and
   * in-memory (so a restart mid-day never lowers a number); gauges
   * replace. Runs in one transaction.
   */
  flush(now: number = Date.now()): void {
    const add = sqlite.prepare(
      `INSERT INTO daily_stats (day, metric, key, value) VALUES (?, ?, ?, ?)
       ON CONFLICT (day, metric, key) DO UPDATE SET value = value + excluded.value`,
    );
    const max = sqlite.prepare(
      `INSERT INTO daily_stats (day, metric, key, value) VALUES (?, ?, ?, ?)
       ON CONFLICT (day, metric, key) DO UPDATE SET value = max(value, excluded.value)`,
    );
    const set = sqlite.prepare(
      `INSERT INTO daily_stats (day, metric, key, value) VALUES (?, ?, ?, ?)
       ON CONFLICT (day, metric, key) DO UPDATE SET value = excluded.value`,
    );
    const today = dayKey(now);
    sqlite.transaction(() => {
      for (const [s, v] of this.adds) add.run(...unslot(s), v);
      for (const [s, v] of this.maxes) max.run(...unslot(s), v);
      for (const [s, m] of this.members) max.run(...unslot(s), m.size);
      for (const [s, v] of this.gauges) set.run(...unslot(s), v);
    })();
    this.adds.clear();
    this.gauges.clear();
    // Distinct sets and peaks carry on through the day; drop past days.
    for (const map of [this.members, this.maxes] as Map<string, unknown>[]) {
      for (const s of map.keys()) if (unslot(s)[0] !== today) map.delete(s);
    }
    for (const id of this.keysSeen.keys()) if (!id.startsWith(today)) this.keysSeen.delete(id);
  }

  /** Forget everything not yet written (tests). */
  reset(): void {
    this.adds.clear();
    this.maxes.clear();
    this.gauges.clear();
    this.members.clear();
    this.keysSeen.clear();
  }
}

export const rollup = new Rollup();

/**
 * Today's active-people numbers, from users.last_seen_at: who was seen
 * today (DAU), in the last 7 days (WAU) and 30 days (MAU), and how many
 * of today's were new accounts. Restart-safe because it reads the
 * database rather than in-memory sets.
 */
export function recordActiveUsers(now: number = Date.now()): void {
  const dayStart = new Date(startOfDay(now));
  const since = (ms: number) =>
    db
      .select({ n: sql<number>`count(*)` })
      .from(schema.users)
      .where(gte(schema.users.lastSeenAt, new Date(ms)))
      .get()?.n ?? 0;
  rollup.peak('dau', '', since(dayStart.getTime()), now);
  rollup.peak('wau', '', since(now - 7 * DAY_MS), now);
  rollup.peak('mau', '', since(now - 30 * DAY_MS), now);
  const fresh =
    db
      .select({ n: sql<number>`count(*)` })
      .from(schema.users)
      .where(and(gte(schema.users.lastSeenAt, dayStart), gte(schema.users.createdAt, dayStart)))
      .get()?.n ?? 0;
  rollup.peak('dau_new', '', fresh, now);
}

/** Bytes used by the SQLite file and its write-ahead log. */
export function databaseBytes(): number {
  let total = 0;
  for (const suffix of ['', '-wal', '-shm']) {
    try {
      total += statSync(env.dbPath + suffix).size;
    } catch {
      /* not there */
    }
  }
  return total;
}

/** One rollup pass: today's gauges, then write. Never throws. */
export function flushRollup(now: number = Date.now()): void {
  try {
    recordActiveUsers(now);
    rollup.gauge('db_bytes', '', databaseBytes(), now);
    rollup.flush(now);
    usage.flush();
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[metrics] rollup flush failed:', err);
  }
}

/** Delete rollup rows past the retention window. Returns how many went. */
export function sweepRollup(now: number = Date.now()): number {
  const cutoff = dayKey(now - ROLLUP_RETENTION_DAYS * DAY_MS);
  const res = db.delete(schema.dailyStats).where(lt(schema.dailyStats.day, cutoff)).run();
  return res.changes;
}

let timer: ReturnType<typeof setInterval> | null = null;

/** Write the rollup once a minute. Not started in tests. */
export function startRollup(): void {
  if (env.nodeEnv === 'test' || timer) return;
  timer = setInterval(() => flushRollup(), 60_000);
  timer.unref();
}

export function stopRollup(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  flushRollup();
}


// Background workers (Phase 7).
//
// Two daily jobs share a single `setInterval` driver:
//
//   1. dailyCompaction — full Yjs snapshot rewrite per active doc.
//                       Runs daily; complements the per-active-doc
//                       30s snapshot worker in docHub.ts (which only
//                       runs while clients are connected).
//   2. backupWorker    — `VACUUM INTO` snapshot of the SQLite file
//                       to /backups, gzipped, with retention buckets:
//                       last 7 days + 1/week × 3 weeks + 1/month × 12
//                       months. Runs daily.
//
// Operators can disable either one via env vars (BACKUPS_ENABLED,
// DAILY_COMPACTION_ENABLED).
//
// The demo account (Admin › Settings › Demo account) has its own timer,
// checked every few minutes: it resets the account when a reset is due.
//
// Tests skip the whole worker stack (NODE_ENV=test).

import { eq, and } from 'drizzle-orm';
import { existsSync, mkdirSync, readdirSync, unlinkSync } from 'node:fs';
import { resolve } from 'node:path';
import { createGzip } from 'node:zlib';
import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import * as Y from 'yjs';
import { db, schema, sqlite } from '../db/index.js';
import { env } from '../env.js';
import { classifyBackups } from './retention.js';
import { backgroundJobs } from './jobs.js';
import { docHub } from '../ws/docHub.js';
import { sweepRollup } from '../metrics/rollup.js';
import { sweepUsage } from '../metrics/usage.js';
import { getPlatformSettings } from '../auth/platformSettings.js';
import { demoResetDue } from '../demo/demoAccount.js';
import { runDemoReset } from '../demo/reset.js';
import { privacyTick } from '../privacy/tick.js';

const DAY_MS = 24 * 60 * 60 * 1000;

let timer: ReturnType<typeof setInterval> | null = null;
let demoTimer: ReturnType<typeof setInterval> | null = null;
let privacyTimer: ReturnType<typeof setInterval> | null = null;
/** How often the privacy clean-up runs (expired downloads, and the rest of privacy/tick.ts). */
const PRIVACY_CHECK_MS = 60 * 60 * 1000;
/** How often the demo timer looks whether a reset is due. */
const DEMO_CHECK_MS = 5 * 60 * 1000;

export function startWorkers(): void {
  if (env.nodeEnv === 'test') return;
  if (timer) return;
  demoTimer = setInterval(() => void safeRun('demoReset', async () => void (await demoTick())), DEMO_CHECK_MS);
  privacyTimer = setInterval(() => void safeRun('privacy', async () => void (await privacyTick())), PRIVACY_CHECK_MS);
  setTimeout(() => void safeRun('privacy', async () => void (await privacyTick())), 90_000);
  // Run on first tick after 60s (so a server crash-restart loop doesn't
  // hammer the DB) and every 24h thereafter.
  setTimeout(() => {
    void tick();
    timer = setInterval(() => void tick(), DAY_MS);
  }, 60_000);
}

export function stopWorkers(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  if (demoTimer) {
    clearInterval(demoTimer);
    demoTimer = null;
  }
  if (privacyTimer) {
    clearInterval(privacyTimer);
    privacyTimer = null;
  }
}

/** Reset the demo account when it's on and its reset is due. */
export async function demoTick(now = new Date()): Promise<boolean> {
  if (!demoResetDue(await getPlatformSettings(), now)) return false;
  await runDemoReset(now);
  return true;
}

async function tick(): Promise<void> {
  // Admin › Settings › Background jobs, read now so a change needs no restart.
  const jobs = await backgroundJobs();
  if (jobs.dailyCompaction.value) await safeRun('dailyCompaction', dailyCompaction);
  if (jobs.backups.value) await safeRun('backupWorker', backupWorker);
  // Admin dashboard rollup: keep ROLLUP_RETENTION_DAYS (about 13 months).
  await safeRun('rollupRetention', async () => {
    sweepRollup();
    sweepUsage();
  });
}

async function safeRun(name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (err) {
    // Workers must never crash the process. Log and move on; the next
    // tick will retry.
     
    console.error(`[workers] ${name} failed:`, err);
  }
}

// ---------------------------------------------------------------------------
// 1. Daily compaction
// ---------------------------------------------------------------------------

export async function dailyCompaction(): Promise<void> {
  // For every layout that has unflushed updates in `layout_updates`,
  // materialise a fresh snapshot from snapshot+updates and truncate.
  // Same logic as docHub's flushSnapshot but doc-hub-independent (so
  // it works on layouts no one is currently editing).
  //
  // Only layouts that actually have pending updates are visited, and
  // each snapshot is loaded one at a time (this used to load every
  // layout's snapshot blob into memory at once). Layouts with a live
  // editor session are skipped: the session flushes itself, and
  // truncating the log underneath it could drop updates it persisted
  // after we read the log.
  const pending = await db
    .selectDistinct({ id: schema.layoutUpdates.layoutId })
    .from(schema.layoutUpdates)
    .where(eq(schema.layoutUpdates.doc, 'main'));
  let compacted = 0;
  for (const { id } of pending) {
    if (docHub.has(id)) continue;
    const layout = await db
      .select({ id: schema.layouts.id, snapshot: schema.layouts.docSnapshot })
      .from(schema.layouts)
      .where(eq(schema.layouts.id, id))
      .get();
    if (!layout) continue;
    const updates = await db
      .select({ updateBytes: schema.layoutUpdates.updateBytes })
      .from(schema.layoutUpdates)
      .where(
        and(
          eq(schema.layoutUpdates.layoutId, layout.id),
          eq(schema.layoutUpdates.doc, 'main'),
        ),
      );
    if (updates.length === 0) continue;

    const doc = new Y.Doc();
    Y.applyUpdate(doc, layout.snapshot as Uint8Array);
    for (const u of updates) {
      try {
        Y.applyUpdate(doc, u.updateBytes as Uint8Array);
      } catch {
        /* corrupt update — skip */
      }
    }
    const fresh = Y.encodeStateAsUpdate(doc);
    await db
      .update(schema.layouts)
      .set({ docSnapshot: Buffer.from(fresh), updatedAt: new Date() })
      .where(eq(schema.layouts.id, layout.id));
    await db
      .delete(schema.layoutUpdates)
      .where(
        and(
          eq(schema.layoutUpdates.layoutId, layout.id),
          eq(schema.layoutUpdates.doc, 'main'),
        ),
      );
    doc.destroy();
    compacted += 1;
  }
  if (compacted > 0) {
     
    console.log(`[dailyCompaction] compacted ${compacted} layouts`);
  }
}

// ---------------------------------------------------------------------------
// 2. Backup worker
// ---------------------------------------------------------------------------

async function backupWorker(): Promise<void> {
  const dir = env.backupsDir;
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  // VACUUM INTO produces a consistent .sqlite file even with concurrent
  // writers (better-sqlite3's WAL mode handles this). The output is
  // bigger than the live DB because no WAL checkpoint is needed first.
  const tag = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const tmpPath = resolve(dir, `cbld-${tag}.sqlite.tmp`);
  const finalPath = resolve(dir, `cbld-${tag}.sqlite.gz`);

  if (existsSync(finalPath)) return; // already ran today

  if (existsSync(tmpPath)) unlinkSync(tmpPath);
  // VACUUM INTO requires a path literal; use a prepared statement with
  // a parameter binding so we don't have to manually escape.
  sqlite.prepare('VACUUM INTO ?').run(tmpPath);

  // Gzip + cleanup.
  const { createReadStream } = await import('node:fs');
  // @types/node 26's PipelineSource requires an async iterator matching
  // ReadableStream's exactOptionalPropertyTypes-aware shape, which even
  // Node's own `Readable`/`WriteStream` classes don't structurally
  // satisfy in these types — a type-declaration gap, not a real
  // behavior mismatch (these are genuinely valid pipeline streams at
  // runtime). Casting `pipeline` itself to a permissive signature keeps
  // the escape hatch to one line without TS reinterpreting the
  // argument list against the wrong overload.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pipelineAny = pipeline as (...streams: any[]) => Promise<void>;
  await pipelineAny(createReadStream(tmpPath), createGzip(), createWriteStream(finalPath));
  unlinkSync(tmpPath);

  applyRetentionPolicy(dir);
}

/**
 * Retention buckets (PLAN.md §4.6):
 *   - daily:   keep last 7 days
 *   - weekly:  keep one snapshot per ISO week for the last 3 weeks
 *   - monthly: keep one snapshot per calendar month for the last 12
 *
 * Anything older OR not matching one of those buckets is deleted.
 * Snapshots within a week/month are deduped by keeping the YOUNGEST.
 */
function applyRetentionPolicy(dir: string): void {
  const files = readdirSync(dir);
  const { delete: toDelete } = classifyBackups(files, Date.now());
  for (const file of toDelete) {
    try {
      unlinkSync(resolve(dir, file));
    } catch {
      /* best-effort */
    }
  }
}

// `Readable` is imported above only because TS will tree-shake it
// otherwise; the gzip pipeline uses it transitively.
void Readable;

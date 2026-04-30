// Background workers (Phase 7).
//
// Three jobs share a single `setInterval` driver:
//
//   1. demoTtlSweep   — delete demo-owned layouts past their expires_at
//                       Runs daily.
//   2. dailyCompaction — full Yjs snapshot rewrite per active doc.
//                       Runs daily; complements the per-active-doc
//                       30s snapshot worker in docHub.ts (which only
//                       runs while clients are connected).
//   3. backupWorker    — `VACUUM INTO` snapshot of the SQLite file
//                       to /backups, gzipped, with retention buckets:
//                       last 7 days + 1/week × 3 weeks + 1/month × 12
//                       months. Runs daily.
//
// Operators can disable any job individually via env vars
// (BACKUPS_ENABLED, DEMO_TTL_SWEEP_ENABLED, DAILY_COMPACTION_ENABLED).
// Tests skip the whole worker stack (NODE_ENV=test).

import { lt, eq, isNotNull, and } from 'drizzle-orm';
import { existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { resolve } from 'node:path';
import { createGzip } from 'node:zlib';
import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import * as Y from 'yjs';
import { db, schema, sqlite } from '../db/index.js';
import { env } from '../env.js';
import { classifyBackups } from './retention.js';

const DAY_MS = 24 * 60 * 60 * 1000;

let timer: ReturnType<typeof setInterval> | null = null;

export function startWorkers(): void {
  if (env.nodeEnv === 'test') return;
  if (timer) return;
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
}

async function tick(): Promise<void> {
  if (env.demoTtlSweepEnabled) await safeRun('demoTtlSweep', demoTtlSweep);
  if (env.dailyCompactionEnabled) await safeRun('dailyCompaction', dailyCompaction);
  if (env.backupsEnabled) await safeRun('backupWorker', backupWorker);
}

async function safeRun(name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (err) {
    // Workers must never crash the process. Log and move on; the next
    // tick will retry.
    // eslint-disable-next-line no-console
    console.error(`[workers] ${name} failed:`, err);
  }
}

// ---------------------------------------------------------------------------
// 1. Demo TTL sweep
// ---------------------------------------------------------------------------

async function demoTtlSweep(): Promise<void> {
  const now = new Date();
  // Delete every layout whose expires_at is in the past. This is a
  // hard delete; the .bbm export endpoint is the user's only path to
  // recover the data, so we expect them to export before the TTL
  // expires (the editor warns when expires_at is set).
  const expired = await db
    .select({ id: schema.layouts.id })
    .from(schema.layouts)
    .where(
      and(
        isNotNull(schema.layouts.expiresAt),
        lt(schema.layouts.expiresAt, now),
      ),
    );
  for (const { id } of expired) {
    await db.delete(schema.layouts).where(eq(schema.layouts.id, id));
  }
  if (expired.length > 0) {
    // eslint-disable-next-line no-console
    console.log(`[demoTtlSweep] deleted ${expired.length} expired demo-owned layouts`);
  }
}

// ---------------------------------------------------------------------------
// 2. Daily compaction
// ---------------------------------------------------------------------------

async function dailyCompaction(): Promise<void> {
  // For every layout that has unflushed updates in `layout_updates`,
  // materialise a fresh snapshot from snapshot+updates and truncate.
  // Same logic as docHub's flushSnapshot but doc-hub-independent (so
  // it works on layouts no one is currently editing).
  const layouts = await db
    .select({ id: schema.layouts.id, snapshot: schema.layouts.docSnapshot })
    .from(schema.layouts);
  let compacted = 0;
  for (const layout of layouts) {
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
    // eslint-disable-next-line no-console
    console.log(`[dailyCompaction] compacted ${compacted} layouts`);
  }
}

// ---------------------------------------------------------------------------
// 3. Backup worker
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
  await pipeline(createReadStream(tmpPath), createGzip(), createWriteStream(finalPath));
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

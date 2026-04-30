// Hub for actively-edited Y.Docs. One DocSession per layout id, shared by
// every connected WebSocket client of that layout. Encapsulates:
//   - hydrating from layouts.docSnapshot + replaying layout_updates
//   - persistent append on every Yjs update (durability)
//   - in-memory awareness state
//   - connection bookkeeping (close last → flush + evict)
//
// Phase 5 will replace LRU eviction with explicit close-after-N-minutes;
// Phase 7 adds the daily compaction worker. For now the design is the
// simplest correct shape.

import * as Y from 'yjs';
import { Awareness } from 'y-protocols/awareness';
import { eq, and } from 'drizzle-orm';
import { db, schema } from '../db/index.js';

export class DocSession {
  readonly doc: Y.Doc;
  readonly awareness: Awareness;
  /** Connected WS clients. The hub closes the session when this is empty. */
  readonly clients = new Set<unknown>();
  /** Counter of unflushed updates since last snapshot. Drives compaction. */
  pendingUpdates = 0;
  /** True while a snapshot rewrite is in flight. */
  flushing = false;
  /** Idle timer id; clearTimeout on the next attached client. */
  idleTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(public readonly layoutId: string) {
    this.doc = new Y.Doc();
    this.awareness = new Awareness(this.doc);
  }

  /**
   * Hydrate the doc from its persisted snapshot + replay any updates that
   * arrived between the last snapshot and a server restart. Idempotent.
   */
  async hydrate(): Promise<void> {
    const layout = await db
      .select({
        docSnapshot: schema.layouts.docSnapshot,
      })
      .from(schema.layouts)
      .where(eq(schema.layouts.id, this.layoutId))
      .get();
    if (!layout) throw new Error(`layout ${this.layoutId} not found`);

    const snapshot = layout.docSnapshot as Uint8Array;
    if (snapshot && snapshot.length > 0) {
      Y.applyUpdate(this.doc, snapshot);
    }

    const updates = await db
      .select({ updateBytes: schema.layoutUpdates.updateBytes })
      .from(schema.layoutUpdates)
      .where(
        and(
          eq(schema.layoutUpdates.layoutId, this.layoutId),
          eq(schema.layoutUpdates.doc, 'main'),
        ),
      );
    for (const u of updates) {
      try {
        Y.applyUpdate(this.doc, u.updateBytes as Uint8Array);
      } catch {
        // Corrupt updates are ignored — the snapshot is the source of truth.
      }
    }
  }

  /**
   * Append a y-update to layout_updates. Durable record of every change
   * between snapshot rewrites. The compaction worker periodically writes
   * a fresh snapshot and DELETEs the rows it has consumed.
   */
  async persistUpdate(update: Uint8Array): Promise<void> {
    await db.insert(schema.layoutUpdates).values({
      layoutId: this.layoutId,
      doc: 'main',
      updateBytes: Buffer.from(update),
      createdAt: new Date(),
    });
    this.pendingUpdates += 1;
  }

  /**
   * Materialise a fresh snapshot from the in-memory doc and truncate the
   * append-log. Idempotent and safe to call concurrently with peer
   * updates because Y.encodeStateAsUpdate is a pure read.
   */
  async flushSnapshot(): Promise<void> {
    if (this.flushing) return;
    this.flushing = true;
    try {
      const bytes = Y.encodeStateAsUpdate(this.doc);
      await db
        .update(schema.layouts)
        .set({
          docSnapshot: Buffer.from(bytes),
          docVersion: (await this.currentVersion()) + 1,
          updatedAt: new Date(),
        })
        .where(eq(schema.layouts.id, this.layoutId));
      // Crash-safe ordering: snapshot commits BEFORE deletes. If we crash
      // between the two, replay will re-apply already-included updates,
      // which is a no-op for Yjs (idempotent merge).
      await db
        .delete(schema.layoutUpdates)
        .where(
          and(
            eq(schema.layoutUpdates.layoutId, this.layoutId),
            eq(schema.layoutUpdates.doc, 'main'),
          ),
        );
      this.pendingUpdates = 0;
    } finally {
      this.flushing = false;
    }
  }

  private async currentVersion(): Promise<number> {
    const row = await db
      .select({ docVersion: schema.layouts.docVersion })
      .from(schema.layouts)
      .where(eq(schema.layouts.id, this.layoutId))
      .get();
    return row?.docVersion ?? 0;
  }
}

/**
 * Hub keyed by layout id. Sessions are lazy-loaded and evicted IDLE_MS
 * after the last client disconnects (giving brief reconnect grace before
 * we drop the in-memory doc).
 */
const IDLE_MS = 60_000;
const SNAPSHOT_INTERVAL_MS = 30_000;
const SNAPSHOT_MAX_PENDING = 100;

class DocHub {
  private sessions = new Map<string, Promise<DocSession>>();
  private snapshotTimer: ReturnType<typeof setInterval> | null = null;

  startSnapshotWorker(): void {
    if (this.snapshotTimer) return;
    this.snapshotTimer = setInterval(() => {
      void this.tickSnapshot();
    }, SNAPSHOT_INTERVAL_MS);
  }

  stopSnapshotWorker(): void {
    if (this.snapshotTimer) {
      clearInterval(this.snapshotTimer);
      this.snapshotTimer = null;
    }
  }

  /** Get-or-hydrate the session for a layout id. Concurrency-safe. */
  async getOrCreate(layoutId: string): Promise<DocSession> {
    const existing = this.sessions.get(layoutId);
    if (existing) return existing;
    const promise = (async () => {
      const session = new DocSession(layoutId);
      await session.hydrate();
      return session;
    })();
    this.sessions.set(layoutId, promise);
    try {
      return await promise;
    } catch (err) {
      // Hydration failed — drop the entry so the next request can retry.
      this.sessions.delete(layoutId);
      throw err;
    }
  }

  /** Mark a client as connected; cancels any pending eviction. */
  attach(session: DocSession, client: unknown): void {
    if (session.idleTimer) {
      clearTimeout(session.idleTimer);
      session.idleTimer = null;
    }
    session.clients.add(client);
  }

  /** Mark a client as disconnected; schedule eviction if last. */
  async detach(session: DocSession, client: unknown): Promise<void> {
    session.clients.delete(client);
    if (session.clients.size === 0) {
      // Final flush so a server restart doesn't lose the last few seconds.
      await session.flushSnapshot();
      session.idleTimer = setTimeout(() => {
        this.sessions.delete(session.layoutId);
        session.doc.destroy();
        session.awareness.destroy();
      }, IDLE_MS);
    }
  }

  /** Snapshot worker tick — flush any session past the per-doc threshold. */
  private async tickSnapshot(): Promise<void> {
    for (const [, p] of this.sessions) {
      try {
        const session = await p;
        if (session.pendingUpdates >= SNAPSHOT_MAX_PENDING) {
          await session.flushSnapshot();
        }
      } catch {
        // ignore — getOrCreate already cleaned up on hydration failure
      }
    }
  }
}

export const docHub = new DocHub();

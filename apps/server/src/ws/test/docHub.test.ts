// Unit tests for ws/docHub.ts — DocSession and DocHub.
// These run as plain Node tests (no WebSocket infrastructure needed).
// DocSession reads/writes directly to the in-process SQLite via db/index.ts.

import * as Y from 'yjs';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db, schema } from '../../db/index.js';
import { resetDb } from '../../test/helpers.js';
import { DocSession, docHub } from '../docHub.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function createLayout(userId: string, title = 'Test'): Promise<string> {
  const id = `layout-${Math.random().toString(36).slice(2)}`;
  const now = new Date();
  // Seed an empty snapshot (as the real route does).
  const emptyDoc = new Y.Doc();
  const snapshot = Buffer.from(Y.encodeStateAsUpdate(emptyDoc));
  await db.insert(schema.layouts).values({
    id,
    title,
    ownerUserId: userId,
    ownerOrgId: null,
    createdBy: userId,
    createdAt: now,
    updatedAt: now,
    expiresAt: null,
    docSnapshot: snapshot,
    docVersion: 0,
  });
  return id;
}

async function createUser(): Promise<string> {
  const id = `user-${Math.random().toString(36).slice(2)}`;
  await db.insert(schema.users).values({
    id,
    email: `${id}@test.com`,
    displayName: 'Tester',
    passwordHash: null,
    createdAt: new Date(),
    isDemoAccount: false,
    isGlobalAdmin: false,
  });
  return id;
}

// ---------------------------------------------------------------------------
// DocSession
// ---------------------------------------------------------------------------

describe('DocSession — hydrate', () => {
  beforeEach(() => { resetDb(); });

  it('throws when the layout does not exist', async () => {
    const session = new DocSession('no-such-layout');
    await expect(session.hydrate()).rejects.toThrow('no-such-layout');
  });

  it('hydrates an empty snapshot without error', async () => {
    const userId = await createUser();
    const layoutId = await createLayout(userId);
    const session = new DocSession(layoutId);
    await expect(session.hydrate()).resolves.toBeUndefined();
  });

  it('replays layout_updates after the snapshot', async () => {
    const userId = await createUser();
    const layoutId = await createLayout(userId);

    // Write a Yjs update into layout_updates.
    const doc = new Y.Doc();
    doc.getMap('meta').set('testKey', 'hello');
    const update = Y.encodeStateAsUpdate(doc);
    await db.insert(schema.layoutUpdates).values({
      layoutId,
      doc: 'main',
      updateBytes: Buffer.from(update),
      createdAt: new Date(),
    });

    const session = new DocSession(layoutId);
    await session.hydrate();
    expect(session.doc.getMap('meta').get('testKey')).toBe('hello');
  });

  it('ignores corrupt update bytes gracefully', async () => {
    const userId = await createUser();
    const layoutId = await createLayout(userId);

    // Insert corrupt bytes.
    await db.insert(schema.layoutUpdates).values({
      layoutId,
      doc: 'main',
      updateBytes: Buffer.from([0xff, 0xfe, 0xfd]),
      createdAt: new Date(),
    });

    const session = new DocSession(layoutId);
    await expect(session.hydrate()).resolves.toBeUndefined();
  });
});

describe('DocSession — persistUpdate', () => {
  beforeEach(() => { resetDb(); });

  it('appends a row to layout_updates and increments pendingUpdates', async () => {
    const userId = await createUser();
    const layoutId = await createLayout(userId);
    const session = new DocSession(layoutId);
    await session.hydrate();

    expect(session.pendingUpdates).toBe(0);
    const update = Y.encodeStateAsUpdate(session.doc);
    await session.persistUpdate(update);
    expect(session.pendingUpdates).toBe(1);

    const rows = await db.select().from(schema.layoutUpdates);
    expect(rows.length).toBe(1);
    expect(rows[0]?.layoutId).toBe(layoutId);
  });

  it('accumulates pendingUpdates on multiple calls', async () => {
    const userId = await createUser();
    const layoutId = await createLayout(userId);
    const session = new DocSession(layoutId);
    await session.hydrate();

    for (let i = 0; i < 5; i++) {
      await session.persistUpdate(Y.encodeStateAsUpdate(session.doc));
    }
    expect(session.pendingUpdates).toBe(5);
  });
});

describe('DocSession — flushSnapshot', () => {
  beforeEach(() => { resetDb(); });

  it('writes a new snapshot and clears layout_updates', async () => {
    const userId = await createUser();
    const layoutId = await createLayout(userId);
    const session = new DocSession(layoutId);
    await session.hydrate();

    // Persist a few updates.
    session.doc.getMap('meta').set('v', 42);
    const update = Y.encodeStateAsUpdate(session.doc);
    await session.persistUpdate(update);
    expect(session.pendingUpdates).toBe(1);

    await session.flushSnapshot();

    expect(session.pendingUpdates).toBe(0);
    const updates = await db.select().from(schema.layoutUpdates);
    expect(updates.length).toBe(0);

    // Snapshot row should have been updated.
    const row = await db
      .select({ docVersion: schema.layouts.docVersion })
      .from(schema.layouts)
      .where(eq(schema.layouts.id, layoutId))
      .get();
    // docVersion incremented from 0 → 1.
    expect(row?.docVersion).toBe(1);
  });

  it('is idempotent — concurrent flushes are serialised by the flushing flag', async () => {
    const userId = await createUser();
    const layoutId = await createLayout(userId);
    const session = new DocSession(layoutId);
    await session.hydrate();

    // Start two flushes simultaneously.
    const [r1, r2] = await Promise.all([session.flushSnapshot(), session.flushSnapshot()]);
    expect(r1).toBeUndefined();
    expect(r2).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// DocHub
// ---------------------------------------------------------------------------

describe('DocHub — getOrCreate', () => {
  beforeEach(() => { resetDb(); });

  it('returns a hydrated DocSession for an existing layout', async () => {
    const userId = await createUser();
    const layoutId = await createLayout(userId);
    const session = await docHub.getOrCreate(layoutId);
    expect(session).toBeInstanceOf(DocSession);
    expect(session.layoutId).toBe(layoutId);
  });

  it('throws and removes the entry on hydration failure (no such layout)', async () => {
    await expect(docHub.getOrCreate('nonexistent-layout-xyz')).rejects.toThrow();
    // A subsequent call should also reject (not return a failed promise).
    await expect(docHub.getOrCreate('nonexistent-layout-xyz')).rejects.toThrow();
  });

  it('returns the same instance on repeated calls (concurrency-safe)', async () => {
    const userId = await createUser();
    const layoutId = await createLayout(userId);
    const [s1, s2] = await Promise.all([
      docHub.getOrCreate(layoutId),
      docHub.getOrCreate(layoutId),
    ]);
    expect(s1).toBe(s2);
  });
});

describe('DocHub — attach / detach', () => {
  beforeEach(() => { resetDb(); });
  afterEach(() => { vi.useRealTimers(); });

  it('adds the client to the session and cancels any idle timer', async () => {
    const userId = await createUser();
    const layoutId = await createLayout(userId);
    const session = await docHub.getOrCreate(layoutId);
    const client = {};

    docHub.attach(session, client);
    expect(session.clients.has(client)).toBe(true);
    expect(session.idleTimer).toBeNull();
  });

  it('removes client and starts idle timer when last client detaches', async () => {
    vi.useFakeTimers();
    const userId = await createUser();
    const layoutId = await createLayout(userId);
    const session = await docHub.getOrCreate(layoutId);
    const client = {};

    docHub.attach(session, client);
    await docHub.detach(session, client);

    expect(session.clients.size).toBe(0);
    expect(session.idleTimer).not.toBeNull();
  });

  it('cancels idle timer when a new client attaches before eviction', async () => {
    vi.useFakeTimers();
    const userId = await createUser();
    const layoutId = await createLayout(userId);
    const session = await docHub.getOrCreate(layoutId);
    const c1 = {};
    const c2 = {};

    docHub.attach(session, c1);
    await docHub.detach(session, c1);
    expect(session.idleTimer).not.toBeNull();

    // New client arrives before eviction fires.
    docHub.attach(session, c2);
    expect(session.idleTimer).toBeNull();
    expect(session.clients.has(c2)).toBe(true);
  });
});

describe('DocHub — startSnapshotWorker / stopSnapshotWorker', () => {
  afterEach(() => { vi.useRealTimers(); });

  it('can be started and stopped without error', () => {
    docHub.startSnapshotWorker();
    docHub.stopSnapshotWorker();
  });

  it('is idempotent — calling start twice does not create two timers', () => {
    docHub.startSnapshotWorker();
    docHub.startSnapshotWorker();
    docHub.stopSnapshotWorker();
  });

  it('tickSnapshot fires when interval elapses and flushes sessions above threshold', async () => {
    resetDb();
    vi.useFakeTimers();
    const userId = await createUser();
    const layoutId = await createLayout(userId);
    const session = await docHub.getOrCreate(layoutId);

    // Load the session with enough pending updates to exceed SNAPSHOT_MAX_PENDING (100).
    for (let i = 0; i < 101; i++) {
      await session.persistUpdate(Y.encodeStateAsUpdate(session.doc));
    }
    expect(session.pendingUpdates).toBe(101);

    docHub.startSnapshotWorker();
    // Advance past SNAPSHOT_INTERVAL_MS (30_000ms) so the interval fires.
    await vi.advanceTimersByTimeAsync(31_000);
    docHub.stopSnapshotWorker();

    // The flush should have reset pendingUpdates.
    expect(session.pendingUpdates).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Regression: session lifecycle hardening
// ---------------------------------------------------------------------------

interface FakePeer {
  readyState: number;
  OPEN: number;
  sent: Uint8Array[];
  closedWith: number | null;
  send(b: Uint8Array): void;
  close(code?: number): void;
}

function fakePeer(): FakePeer {
  return {
    readyState: 1,
    OPEN: 1,
    sent: [],
    closedWith: null,
    send(b) { this.sent.push(b); },
    close(code) { this.closedWith = code ?? 1000; this.readyState = 3; },
  };
}

describe('DocHub — lifecycle hardening', () => {
  beforeEach(() => { resetDb(); });
  afterEach(() => { vi.useRealTimers(); });

  it('a double detach of the same client arms only one idle timer and never evicts a re-attached session', async () => {
    vi.useFakeTimers();
    const userId = await createUser();
    const layoutId = await createLayout(userId);
    const session = await docHub.getOrCreate(layoutId);
    const c1 = {};
    docHub.attach(session, c1);
    // 'error' then 'close' on the same socket.
    await docHub.detach(session, c1);
    const firstTimer = session.idleTimer;
    await docHub.detach(session, c1);
    expect(session.idleTimer).toBe(firstTimer);

    const c2 = {};
    docHub.attach(session, c2);
    await vi.advanceTimersByTimeAsync(120_000);
    // Still the live session for this layout, doc not destroyed.
    expect(await docHub.getOrCreate(layoutId)).toBe(session);
    expect(docHub.peek(layoutId)).toBe(session);
  });

  it('persists and broadcasts each doc update exactly once regardless of client count', async () => {
    const userId = await createUser();
    const layoutId = await createLayout(userId);
    const session = await docHub.getOrCreate(layoutId);
    const peers = [fakePeer(), fakePeer(), fakePeer()];
    for (const p of peers) docHub.attach(session, p, userId);

    const other = new Y.Doc();
    other.getMap('m').set('k', 'v');
    Y.applyUpdate(session.doc, Y.encodeStateAsUpdate(other), peers[0]);
    await new Promise((r) => setTimeout(r, 20));

    expect(peers[0]!.sent.length).toBe(0); // origin is skipped
    expect(peers[1]!.sent.length).toBe(1);
    expect(peers[2]!.sent.length).toBe(1);
    const rows = await db.select().from(schema.layoutUpdates).where(eq(schema.layoutUpdates.layoutId, layoutId));
    expect(rows.length).toBe(1);
  });

  it('close() shuts attached sockets with 4404 and evicts the session', async () => {
    const userId = await createUser();
    const layoutId = await createLayout(userId);
    const session = await docHub.getOrCreate(layoutId);
    const peer = fakePeer();
    docHub.attach(session, peer, userId);

    await docHub.close(layoutId);
    expect(peer.closedWith).toBe(4404);
    expect(session.closed).toBe(true);
    expect(session.clients.size).toBe(0);
    expect(docHub.peek(layoutId)).toBeUndefined();
  });

  it('a persist failure (layout deleted under a live session) is caught, not an unhandled rejection', async () => {
    const userId = await createUser();
    const layoutId = await createLayout(userId);
    const session = await docHub.getOrCreate(layoutId);
    const peer = fakePeer();
    docHub.attach(session, peer, userId);

    const unhandled: unknown[] = [];
    const onUnhandled = (r: unknown) => { unhandled.push(r); };
    process.on('unhandledRejection', onUnhandled);
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      // Delete the row without going through a route (as an ON DELETE
      // CASCADE from the owner would).
      await db.delete(schema.layouts).where(eq(schema.layouts.id, layoutId));
      const other = new Y.Doc();
      other.getMap('m').set('k', 1);
      Y.applyUpdate(session.doc, Y.encodeStateAsUpdate(other), 'remote');
      await new Promise((r) => setTimeout(r, 50));
    } finally {
      process.off('unhandledRejection', onUnhandled);
      errSpy.mockRestore();
    }
    expect(unhandled).toEqual([]);
    // The fallback noticed the row is gone and closed the session.
    expect(peer.closedWith).toBe(4404);
    expect(docHub.peek(layoutId)).toBeUndefined();
  });
});

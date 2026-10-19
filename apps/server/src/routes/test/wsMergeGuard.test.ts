// The live route refuses an update that would merge another layout into
// this one (ws/mergeGuard.ts), over a real socket: the old desktop's merge
// closes with 1008 layout_merge_refused, leaves the layout as it was and
// writes a layout_merge_refused audit event; ordinary edits still apply.

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocket } from 'ws';
import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import * as Y from 'yjs';
import * as syncProtocol from 'y-protocols/sync';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db, loginAs, resetDb, schema } from '../../test/helpers.js';
import { attachUser } from '../../auth/cookie.js';
import { passwordRoutes } from '../auth/password.js';
import { layoutRoutes } from '../layouts.js';
import { wsRoutes } from '../ws.js';
import { docHub } from '../../ws/docHub.js';

const FIXTURES = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../../packages/bbm/tests/fixtures');

/** A y-websocket peer on one doc: answers the server's step 1, applies what arrives. */
class Peer {
  readonly ws: WebSocket;
  readonly closed: Promise<[number, string]>;
  /** Resolves once the server's step 2 (the layout) has been read. */
  readonly synced: Promise<void>;

  constructor(port: number, layoutId: string, cookieStr: string, readonly doc: Y.Doc, userAgent = 'BrickLayoutDesigner/1.3.0 (desktop)') {
    this.ws = new WebSocket(`ws://127.0.0.1:${port}/ws/layout/${layoutId}`, { headers: { cookie: cookieStr, 'user-agent': userAgent } });
    this.ws.on('error', () => {});
    this.closed = new Promise((r) => this.ws.once('close', (code, reason) => r([code, reason.toString()])));
    let done!: () => void;
    this.synced = new Promise((r) => (done = r));
    this.ws.on('open', () => {
      const enc = encoding.createEncoder();
      encoding.writeVarUint(enc, 0);
      syncProtocol.writeSyncStep1(enc, doc);
      this.ws.send(encoding.toUint8Array(enc));
    });
    this.ws.on('message', (data: Buffer) => {
      const dec = decoding.createDecoder(new Uint8Array(data));
      if (decoding.readVarUint(dec) !== 0) return;
      const enc = encoding.createEncoder();
      encoding.writeVarUint(enc, 0);
      const type = syncProtocol.readSyncMessage(dec, enc, doc, 'server');
      if (encoding.length(enc) > 1) this.ws.send(encoding.toUint8Array(enc));
      if (type === syncProtocol.messageYjsSyncStep2) done();
    });
    // Local edits go out as updates, like y-websocket.
    doc.on('update', (u: Uint8Array, origin: unknown) => {
      if (origin === 'server' || this.ws.readyState !== WebSocket.OPEN) return;
      const enc = encoding.createEncoder();
      encoding.writeVarUint(enc, 0);
      syncProtocol.writeUpdate(enc, u);
      this.ws.send(encoding.toUint8Array(enc));
    });
  }

  async leave(): Promise<void> {
    this.ws.close();
    await this.closed;
  }
}

function layerIds(doc: Y.Doc): string[] {
  return doc.getArray<string>('layers').toArray();
}

describe('WS merge guard', () => {
  let app: FastifyInstance;
  let port: number;
  let cookieStr: string;
  let userId: string;

  beforeEach(async () => {
    resetDb();
    app = Fastify();
    await app.register(cookie);
    app.addHook('preHandler', attachUser);
    await app.register(passwordRoutes);
    await app.register(layoutRoutes);
    await app.register(wsRoutes);
    await app.listen({ port: 0, host: '127.0.0.1' });
    port = (app.server.address() as { port: number }).port;
    const u = await loginAs(app, 'merge-guard@example.com');
    cookieStr = u.cookie;
    userId = u.id;
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await app.close();
  });

  async function create(payload: Record<string, unknown>): Promise<string> {
    const res = await app.inject({ method: 'POST', url: '/api/layouts', headers: { cookie: cookieStr }, payload });
    expect(res.statusCode).toBe(201);
    return (res.json() as { id: string }).id;
  }

  it('refuses the old desktop merging the layout it had open into the next one', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const a = await create({ title: 'Fordyce', bbm: readFileSync(join(FIXTURES, 'fordyce-2026.bbm'), 'utf8') });
    const b = await create({ title: 'New layout' });
    const stored = await db.select({ snap: schema.layouts.docSnapshot }).from(schema.layouts).where(eq(schema.layouts.id, b)).get();
    const original = new Y.Doc();
    Y.applyUpdate(original, stored!.snap as Uint8Array);

    // One doc kept across both (the desktop before #171).
    const doc = new Y.Doc();
    const first = new Peer(port, a, cookieStr, doc);
    await first.synced;
    const aLayers = layerIds(doc).length;
    expect(aLayers).toBeGreaterThan(2);
    await first.leave();

    const second = new Peer(port, b, cookieStr, doc);
    expect(await second.closed).toEqual([1008, 'layout_merge_refused']);

    // B is as it was: only its own layers, nothing of A's.
    const session = await docHub.getOrCreate(b);
    expect(Y.encodeStateVector(session.doc)).toEqual(Y.encodeStateVector(original));
    expect(layerIds(session.doc)).toEqual(layerIds(original));
    const rows = await db.select().from(schema.layoutUpdates).where(eq(schema.layoutUpdates.layoutId, b));
    expect(rows).toEqual([]);

    // The audit says who, what and how big; the log warns.
    await vi.waitFor(async () => {
      const audit = await db.select().from(schema.auditEvents).where(eq(schema.auditEvents.eventType, 'layout_merge_refused'));
      expect(audit).toHaveLength(1);
      expect(audit[0]).toMatchObject({ layoutId: b, userId });
      expect(JSON.parse(audit[0]!.payload)).toMatchObject({
        client: 'BrickLayoutDesigner/1.3.0 (desktop)',
        via: 'session',
        foreignLayers: aLayers,
      });
    });
    expect(warn.mock.calls.some(([m]) => String(m).includes(`refused an update to layout ${b}`))).toBe(true);
    await docHub.close(b);
    await docHub.close(a);
  });

  it('still applies ordinary edits and a reconnect with offline edits', async () => {
    const b = await create({ title: 'Edited' });
    const doc = new Y.Doc();
    const peer = new Peer(port, b, cookieStr, doc, 'Mozilla/5.0');
    await peer.synced;
    doc.transact(() => {
      const l = new Y.Map<unknown>();
      l.set('id', 'added');
      l.set('type', 'brick');
      doc.getMap('layerData').set('added', l);
      doc.getArray<string>('layers').push(['added']);
    });
    const session = await docHub.getOrCreate(b);
    await vi.waitFor(() => expect(layerIds(session.doc)).toContain('added'));
    await peer.leave();

    // Offline: edits made while away go out with the next connection.
    doc.getArray<string>('layers').insert(0, ['offline']);
    doc.getMap('layerData').set('offline', new Y.Map());
    const again = new Peer(port, b, cookieStr, doc, 'Mozilla/5.0');
    await again.synced;
    await vi.waitFor(() => expect(layerIds(session.doc)).toContain('offline'));
    const audit = await db.select().from(schema.auditEvents).where(eq(schema.auditEvents.eventType, 'layout_merge_refused'));
    expect(audit).toEqual([]);
    await again.leave();
    await docHub.close(b);
  });
});

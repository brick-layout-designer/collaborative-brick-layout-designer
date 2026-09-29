// The realtime WebSocket with desktop (API token) auth: Bearer on the
// upgrade request, scope enforcement, revocation / expiry closing the
// socket with 1008, the cookie-handshake Origin check, and docs from
// before text-cell ids being upgraded on hydrate.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocket } from 'ws';
import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import * as Y from 'yjs';
import * as syncProtocol from 'y-protocols/sync';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readBbm, writeBbm } from '@cld/bbm';
import { decodeDoc, docToBbm, encodeDoc, seedFromBbm } from '@cld/ydoc';
import { db, issueToken, loginAs, resetDb, schema } from '../../test/helpers.js';
import { attachUser } from '../../auth/cookie.js';
import { passwordRoutes } from '../auth/password.js';
import { sessionRoutes } from '../auth/session.js';
import { deviceRoutes } from '../auth/device.js';
import { tokenRoutes } from '../tokens.js';
import { layoutRoutes } from '../layouts.js';
import { collaboratorRoutes } from '../collaborators.js';
import { wsRoutes } from '../ws.js';
import { wsTiming } from '../../ws/handler.js';
import { docHub } from '../../ws/docHub.js';

const MESSAGE_SYNC = 0;

const FORDYCE_BBM = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../../../../../packages/bbm/tests/fixtures/fordyce-2026.bbm'),
  'utf-8',
);

async function buildApp(): Promise<{ app: FastifyInstance; port: number }> {
  const app = Fastify({ logger: false, bodyLimit: 20 * 1024 * 1024 });
  await app.register(cookie);
  app.addHook('preHandler', attachUser);
  await app.register(passwordRoutes);
  await app.register(sessionRoutes);
  await app.register(deviceRoutes);
  await app.register(tokenRoutes);
  await app.register(layoutRoutes);
  await app.register(collaboratorRoutes);
  await app.register(wsRoutes);
  await app.listen({ port: 0, host: '127.0.0.1' });
  const addr = app.server.address();
  return { app, port: typeof addr === 'object' && addr ? addr.port : 0 };
}

/** A y-websocket peer that buffers every sync message it receives. */
class Peer {
  readonly ws: WebSocket;
  readonly closed: Promise<number>;
  /** Resolves with the HTTP status when the upgrade is refused. */
  readonly refused: Promise<number>;
  readonly opened: Promise<void>;
  private syncMsgs: Uint8Array[] = [];
  private waiters: Array<() => void> = [];

  constructor(port: number, layoutId: string, headers: Record<string, string>, query = '') {
    this.ws = new WebSocket(`ws://127.0.0.1:${port}/ws/layout/${layoutId}${query}`, { headers });
    this.ws.on('error', () => {});
    this.closed = new Promise((r) => this.ws.once('close', (code) => r(code)));
    this.refused = new Promise((r) => this.ws.once('unexpected-response', (_req, res) => r(res.statusCode ?? 0)));
    this.opened = new Promise((r) => this.ws.once('open', () => r()));
    this.ws.on('message', (data: Buffer) => {
      const msg = new Uint8Array(data);
      if (decoding.readVarUint(decoding.createDecoder(msg)) !== MESSAGE_SYNC) return;
      this.syncMsgs.push(msg);
      this.waiters.shift()?.();
    });
  }

  /** Next sync message's (subtype, decoder positioned at its payload). */
  async nextSync(timeoutMs = 3000): Promise<{ type: number; dec: decoding.Decoder }> {
    if (this.syncMsgs.length === 0) {
      await withTimeout(new Promise<void>((r) => this.waiters.push(r)), timeoutMs, 'sync message');
    }
    const dec = decoding.createDecoder(this.syncMsgs.shift()!);
    decoding.readVarUint(dec);
    return { type: decoding.readVarUint(dec), dec };
  }

  send(write: (enc: encoding.Encoder) => void): void {
    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, MESSAGE_SYNC);
    write(enc);
    this.ws.send(encoding.toUint8Array(enc));
  }

  /** Sync step 1 from `doc`, answered by the server's sync step 2. */
  async syncFrom(doc: Y.Doc): Promise<Uint8Array> {
    this.send((enc) => syncProtocol.writeSyncStep1(enc, doc));
    for (;;) {
      const { type, dec } = await this.nextSync();
      if (type === syncProtocol.messageYjsSyncStep2) return decoding.readVarUint8Array(dec);
    }
  }
}

async function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  let t: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    t = setTimeout(() => reject(new Error(`timed out waiting for ${what}`)), ms);
  });
  try {
    return await Promise.race([p, timeout]);
  } finally {
    clearTimeout(t!);
  }
}

describe('WebSocket with API tokens', () => {
  let app: FastifyInstance;
  let port: number;
  let user: { cookie: string; id: string };
  let layoutId: string;
  const defaultRevalidate = wsTiming.revalidateMs;

  beforeEach(async () => {
    resetDb();
    ({ app, port } = await buildApp());
    user = await loginAs(app, 'ws-token@x.com');
    layoutId = (
      await app.inject({ method: 'POST', url: '/api/layouts', headers: { cookie: user.cookie }, payload: {} })
    ).json().id;
  });
  afterEach(async () => {
    wsTiming.revalidateMs = defaultRevalidate;
    await app.close();
  });

  const bearer = (t: string) => ({ authorization: `Bearer ${t}` });

  it('accepts the Bearer header on the upgrade and serves the doc (sync step 2)', async () => {
    const token = await issueToken(app, user.cookie);
    const peer = new Peer(port, layoutId, bearer(token));
    await withTimeout(peer.opened, 3000, 'open');
    const local = new Y.Doc();
    Y.applyUpdate(local, await peer.syncFrom(local));
    expect(local.getMap('meta').get('schemaVersion')).toBe(1);
    peer.ws.close();
  });

  it('a write-scoped token can edit', async () => {
    const token = await issueToken(app, user.cookie, 'layouts:read layouts:write');
    const peer = new Peer(port, layoutId, bearer(token));
    await withTimeout(peer.opened, 3000, 'open');
    const local = new Y.Doc();
    Y.applyUpdate(local, await peer.syncFrom(local));
    const before = Y.encodeStateVector(local);
    local.getMap('meta').set('author', 'desktop');
    peer.send((enc) => syncProtocol.writeUpdate(enc, Y.encodeStateAsUpdate(local, before)));
    await peer.syncFrom(local); // round trip: the update above was handled first
    expect(docHub.peek(layoutId)!.doc.getMap('meta').get('author')).toBe('desktop');
    peer.ws.close();
  });

  it('a read-only token is a viewer even for the owner: its updates are dropped', async () => {
    const token = await issueToken(app, user.cookie, 'layouts:read');
    const peer = new Peer(port, layoutId, bearer(token));
    await withTimeout(peer.opened, 3000, 'open');
    const local = new Y.Doc();
    Y.applyUpdate(local, await peer.syncFrom(local));
    const before = Y.encodeStateVector(local);
    local.getMap('meta').set('author', 'desktop');
    const update = Y.encodeStateAsUpdate(local, before);
    peer.send((enc) => syncProtocol.writeUpdate(enc, update));
    peer.send((enc) => syncProtocol.writeSyncStep2(enc, local));
    await peer.syncFrom(new Y.Doc()); // still answered: reads are allowed
    expect(docHub.peek(layoutId)!.doc.getMap('meta').get('author')).toBe('');
    peer.ws.close();
  });

  it('revoking the token closes its sockets with 1008 (and leaves cookie sockets open)', async () => {
    const token = await issueToken(app, user.cookie);
    const tokenPeer = new Peer(port, layoutId, bearer(token));
    const cookiePeer = new Peer(port, layoutId, { cookie: user.cookie });
    await withTimeout(Promise.all([tokenPeer.opened, cookiePeer.opened]), 3000, 'open');
    const id = (await db.select().from(schema.apiTokens).get())!.id;
    const res = await app.inject({ method: 'DELETE', url: `/api/tokens/${id}`, headers: { cookie: user.cookie } });
    expect(res.statusCode).toBe(200);
    expect(await withTimeout(tokenPeer.closed, 2000, 'close')).toBe(1008);
    expect(cookiePeer.ws.readyState).toBe(WebSocket.OPEN);
    cookiePeer.ws.close();
  });

  it('an expired token is dropped by the periodic revalidation with 1008', async () => {
    wsTiming.revalidateMs = 100;
    const token = await issueToken(app, user.cookie);
    const peer = new Peer(port, layoutId, bearer(token));
    await withTimeout(peer.opened, 3000, 'open');
    await db.update(schema.apiTokens).set({ expiresAt: new Date(Date.now() - 1000) });
    expect(await withTimeout(peer.closed, 2000, 'close')).toBe(1008);
  });

  it('refuses an invalid token at the handshake (401) and never reads ?access_token=', async () => {
    const bad = new Peer(port, layoutId, bearer('bld_pat_nope'));
    expect(await withTimeout(bad.refused, 2000, 'refusal')).toBe(401);

    const token = await issueToken(app, user.cookie);
    const viaQuery = new Peer(port, layoutId, {}, `?access_token=${token}`);
    expect(await withTimeout(viaQuery.closed, 2000, 'close')).toBe(1008);
  });

  it('keeps the per-user socket cap across tokens and cookies', async () => {
    const token = await issueToken(app, user.cookie);
    const peers = Array.from({ length: 8 }, (_, i) =>
      new Peer(port, layoutId, i % 2 ? bearer(token) : { cookie: user.cookie }),
    );
    await withTimeout(Promise.all(peers.map((p) => p.opened)), 3000, 'open');
    const ninth = new Peer(port, layoutId, bearer(token));
    expect(await withTimeout(ninth.closed, 2000, 'close')).toBe(4429);
    for (const p of peers) p.ws.close();
  });
});

describe('WebSocket Origin check', () => {
  let app: FastifyInstance;
  let port: number;
  let user: { cookie: string; id: string };
  let layoutId: string;

  beforeEach(async () => {
    resetDb();
    ({ app, port } = await buildApp());
    user = await loginAs(app, 'ws-origin@x.com');
    layoutId = (
      await app.inject({ method: 'POST', url: '/api/layouts', headers: { cookie: user.cookie }, payload: {} })
    ).json().id;
  });
  afterEach(async () => {
    await app.close();
  });

  it('refuses a cookie handshake from a foreign origin with 403', async () => {
    const peer = new Peer(port, layoutId, { cookie: user.cookie, origin: 'https://evil.example' });
    expect(await withTimeout(peer.refused, 2000, 'refusal')).toBe(403);
  });

  it('accepts the PUBLIC_URL origin and origin-less (non-browser) cookie handshakes', async () => {
    // Test setup: PUBLIC_URL=http://localhost:3000.
    const same = new Peer(port, layoutId, { cookie: user.cookie, origin: 'http://localhost:3000' });
    const none = new Peer(port, layoutId, { cookie: user.cookie });
    await withTimeout(Promise.all([same.opened, none.opened]), 3000, 'open');
    same.ws.close();
    none.ws.close();
  });

  it('does not apply to token handshakes', async () => {
    const token = await issueToken(app, user.cookie);
    const peer = new Peer(port, layoutId, { authorization: `Bearer ${token}`, origin: 'app://desktop' });
    await withTimeout(peer.opened, 3000, 'open');
    peer.ws.close();
  });
});

describe('docs from before text-cell ids', () => {
  let app: FastifyInstance;
  let port: number;
  let user: { cookie: string; id: string };

  beforeEach(async () => {
    resetDb();
    ({ app, port } = await buildApp());
    user = await loginAs(app, 'old-doc@x.com');
  });
  afterEach(async () => {
    await app.close();
  });

  function textCells(doc: Y.Doc): Y.Map<unknown>[] {
    const out: Y.Map<unknown>[] = [];
    for (const l of doc.getMap<Y.Map<unknown>>('layerData').values()) {
      const cells = l.get('textCells');
      if (cells instanceof Y.Array) out.push(...(cells.toArray() as Y.Map<unknown>[]));
    }
    return out;
  }

  it('export tolerates missing ids; opening the doc live assigns them', async () => {
    // Build a pre-schemaVersion doc: no text-cell ids, no schemaVersion.
    const old = seedFromBbm(readBbm(FORDYCE_BBM).map);
    for (const c of textCells(old)) c.delete('id');
    old.getMap('meta').delete('schemaVersion');
    const id = (
      await app.inject({ method: 'POST', url: '/api/layouts', headers: { cookie: user.cookie }, payload: {} })
    ).json().id;
    await db.update(schema.layouts).set({ docSnapshot: Buffer.from(encodeDoc(old)) }).where(eq(schema.layouts.id, id));

    const exported = await app.inject({ method: 'GET', url: `/api/layouts/${id}/export.bbm`, headers: { cookie: user.cookie } });
    expect(exported.statusCode).toBe(200);
    expect(exported.body).toBe(FORDYCE_BBM);

    const token = await issueToken(app, user.cookie, 'layouts:read');
    const peer = new Peer(port, id, { authorization: `Bearer ${token}` });
    await withTimeout(peer.opened, 3000, 'open');
    const local = new Y.Doc();
    Y.applyUpdate(local, await peer.syncFrom(local));
    const cells = textCells(local);
    expect(cells.length).toBeGreaterThan(0);
    for (const c of cells) expect(c.get('id')).toMatch(/^\d+$/);
    expect(local.getMap('meta').get('schemaVersion')).toBe(1);
    // Minted ids stay out of the .bbm.
    expect(writeBbm(docToBbm(local))).toBe(FORDYCE_BBM);
    peer.ws.close();
    await withTimeout(peer.closed, 2000, 'close');

    // The upgrade is persisted by the final flush.
    await new Promise((r) => setTimeout(r, 100));
    const row = await db.select().from(schema.layouts).where(eq(schema.layouts.id, id)).get();
    const persisted = decodeDoc(row!.docSnapshot as Uint8Array);
    expect(textCells(persisted).map((c) => c.get('id'))).toEqual(cells.map((c) => c.get('id')));
  });
});

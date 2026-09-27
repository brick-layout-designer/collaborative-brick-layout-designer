// Regression tests for multi-client WebSocket sessions:
//   - one doc update is persisted and fanned out once, not once per socket
//   - viewers get the document in answer to their sync step 1
//   - deleting a layout closes its open sockets instead of crashing Node
//   - a socket that emits both 'error' and 'close' detaches once

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

const MESSAGE_SYNC = 0;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Client {
  ws: WebSocket;
  msgs: Uint8Array[];
  closed: Promise<number>;
}

function connect(port: number, layoutId: string, cookieStr: string): Promise<Client> {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/layout/${layoutId}`, {
    headers: { cookie: cookieStr },
  });
  const msgs: Uint8Array[] = [];
  ws.on('message', (d: Buffer) => msgs.push(new Uint8Array(d)));
  ws.on('error', () => {});
  const closed = new Promise<number>((r) => ws.once('close', (code) => r(code)));
  return new Promise((resolve, reject) => {
    ws.once('open', () => resolve({ ws, msgs, closed }));
    ws.once('error', reject);
  });
}

function updateMessage(mutate: (doc: Y.Doc) => void): Uint8Array {
  const d = new Y.Doc();
  mutate(d);
  const enc = encoding.createEncoder();
  encoding.writeVarUint(enc, MESSAGE_SYNC);
  syncProtocol.writeUpdate(enc, Y.encodeStateAsUpdate(d));
  return encoding.toUint8Array(enc);
}

/** Apply every sync message a client has received to a fresh doc. */
function replay(msgs: Uint8Array[]): Y.Doc {
  const doc = new Y.Doc();
  for (const m of msgs) {
    const dec = decoding.createDecoder(m);
    if (decoding.readVarUint(dec) !== MESSAGE_SYNC) continue;
    syncProtocol.readSyncMessage(dec, encoding.createEncoder(), doc, null);
  }
  return doc;
}

function countSyncUpdates(msgs: Uint8Array[]): number {
  let n = 0;
  for (const m of msgs) {
    const dec = decoding.createDecoder(m);
    if (decoding.readVarUint(dec) !== MESSAGE_SYNC) continue;
    if (decoding.readVarUint(dec) === syncProtocol.messageYjsUpdate) n++;
  }
  return n;
}

async function buildApp(): Promise<{ app: FastifyInstance; port: number }> {
  const app = Fastify({ logger: false });
  await app.register(cookie);
  app.addHook('preHandler', attachUser);
  await app.register(passwordRoutes);
  await app.register(layoutRoutes);
  await app.register(wsRoutes);
  await app.listen({ port: 0, host: '127.0.0.1' });
  const addr = app.server.address();
  return { app, port: typeof addr === 'object' && addr ? addr.port : 0 };
}

describe('WS sessions — multi-client hardening', () => {
  let app: FastifyInstance;
  let port: number;
  let owner: { cookie: string; id: string };
  let layoutId: string;
  const open: Client[] = [];

  beforeEach(async () => {
    resetDb();
    ({ app, port } = await buildApp());
    owner = await loginAs(app, 'owner@x.com');
    const res = await app.inject({
      method: 'POST',
      url: '/api/layouts',
      headers: { cookie: owner.cookie },
      payload: { title: 't' },
    });
    layoutId = (res.json() as { id: string }).id;
  });

  afterEach(async () => {
    for (const c of open.splice(0)) c.ws.terminate();
    await sleep(50);
    await app.close();
    vi.restoreAllMocks();
  });

  async function client(cookieStr = owner.cookie): Promise<Client> {
    const c = await connect(port, layoutId, cookieStr);
    open.push(c);
    return c;
  }

  it('fans out and persists one update once, however many sockets are open', async () => {
    const a = await client();
    const b = await client();
    await client();
    await sleep(150);
    const before = b.msgs.length;
    const rowsBefore = (await db.select().from(schema.layoutUpdates)).length;

    a.ws.send(updateMessage((d) => d.getMap('m').set('k', 'v')));
    await sleep(200);

    expect(countSyncUpdates(b.msgs.slice(before))).toBe(1);
    const rowsAfter = (await db.select().from(schema.layoutUpdates)).length;
    expect(rowsAfter - rowsBefore).toBe(1);
  });

  it('answers a viewer sync step 1 with the document, but drops viewer updates', async () => {
    const viewer = await loginAs(app, 'viewer@x.com');
    await db.insert(schema.layoutCollaborators).values({
      layoutId,
      userId: viewer.id,
      role: 'viewer',
      addedAt: new Date(),
    });
    const editor = await client();
    await sleep(100);
    editor.ws.send(updateMessage((d) => d.getMap('m').set('k', 'from-owner')));
    await sleep(150);

    const v = await client(viewer.cookie);
    await sleep(100);
    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, MESSAGE_SYNC);
    syncProtocol.writeSyncStep1(enc, new Y.Doc());
    v.ws.send(encoding.toUint8Array(enc));
    await sleep(200);
    expect(replay(v.msgs).getMap('m').get('k')).toBe('from-owner');

    // A viewer's update must not reach the shared doc.
    v.ws.send(updateMessage((d) => d.getMap('m').set('evil', true)));
    await sleep(150);
    const session = docHub.peek(layoutId)!;
    expect(session.doc.getMap('m').get('evil')).toBeUndefined();
  });

  it('closes open sockets with 4404 when the layout is deleted, without an unhandled rejection', async () => {
    const a = await client();
    const b = await client();
    await sleep(100);

    const unhandled: unknown[] = [];
    const onUnhandled = (r: unknown) => { unhandled.push(r); };
    process.on('unhandledRejection', onUnhandled);
    try {
      const del = await app.inject({
        method: 'DELETE',
        url: `/api/layouts/${layoutId}`,
        headers: { cookie: owner.cookie },
      });
      expect(del.statusCode).toBe(200);
      expect(await a.closed).toBe(4404);
      expect(await b.closed).toBe(4404);
      await sleep(100);
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
    expect(unhandled).toEqual([]);
    expect(docHub.peek(layoutId)).toBeUndefined();
  });

  it("detaches once when a socket emits both 'error' and 'close'", async () => {
    const detachSpy = vi.spyOn(docHub, 'detach');
    const c = await client();
    await sleep(100);
    // An invalid UTF-8 text frame makes the server socket emit 'error'
    // and then 'close'.
    c.ws.send(Buffer.from([0xff, 0xfe, 0xfd]), { binary: false });
    await c.closed;
    await sleep(200);
    expect(detachSpy).toHaveBeenCalledTimes(1);

    // The session keeps working for the next client.
    const next = await client();
    await sleep(100);
    next.ws.send(updateMessage((d) => d.getMap('m').set('after', 1)));
    await sleep(100);
    const row = await db.select().from(schema.layouts).where(eq(schema.layouts.id, layoutId)).get();
    expect(row).toBeDefined();
    expect(docHub.peek(layoutId)?.doc.getMap('m').get('after')).toBe(1);
  });
});

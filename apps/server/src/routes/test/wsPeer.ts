// A y-websocket peer for the live-route tests: sends its sync step 1 on
// open, answers the server's step 1 with its step 2 (everything the server
// lacks, like y-websocket on every (re)connect), applies what arrives, and
// sends its own edits as updates while connected. Edits made while
// disconnected stay in the doc and go out with the next connection's step 2.

import { WebSocket } from 'ws';
import * as Y from 'yjs';
import * as syncProtocol from 'y-protocols/sync';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';

export class Peer {
  readonly ws: WebSocket;
  readonly closed: Promise<[number, string]>;
  /** Resolves once the server's step 2 (the layout) has been read. */
  readonly synced: Promise<void>;
  /** Byte sizes of the sync messages this peer sent (step 1, step 2, updates). */
  readonly sent: { kind: 'step1' | 'step2' | 'update'; bytes: number }[] = [];
  private readonly onUpdate: (u: Uint8Array, origin: unknown) => void;

  constructor(
    port: number,
    layoutId: string,
    cookieStr: string,
    readonly doc: Y.Doc,
    userAgent = 'BrickLayoutDesigner/1.3.0 (desktop)',
  ) {
    this.ws = new WebSocket(`ws://127.0.0.1:${port}/ws/layout/${layoutId}`, {
      headers: { cookie: cookieStr, 'user-agent': userAgent },
    });
    this.ws.on('error', () => {});
    this.closed = new Promise((r) =>
      this.ws.once('close', (code, reason) => {
        doc.off('update', this.onUpdate);
        r([code, reason.toString()]);
      }),
    );
    let done!: () => void;
    this.synced = new Promise((r) => (done = r));
    this.ws.on('open', () => {
      const enc = encoding.createEncoder();
      encoding.writeVarUint(enc, 0);
      syncProtocol.writeSyncStep1(enc, doc);
      this.send(enc, 'step1');
    });
    this.ws.on('message', (data: Buffer) => {
      const dec = decoding.createDecoder(new Uint8Array(data));
      if (decoding.readVarUint(dec) !== 0) return;
      const enc = encoding.createEncoder();
      encoding.writeVarUint(enc, 0);
      const type = syncProtocol.readSyncMessage(dec, enc, doc, 'server');
      if (encoding.length(enc) > 1) this.send(enc, 'step2');
      if (type === syncProtocol.messageYjsSyncStep2) done();
    });
    // Local edits go out as updates, like y-websocket.
    this.onUpdate = (u, origin) => {
      if (origin === 'server' || this.ws.readyState !== WebSocket.OPEN) return;
      const enc = encoding.createEncoder();
      encoding.writeVarUint(enc, 0);
      syncProtocol.writeUpdate(enc, u);
      this.send(enc, 'update');
    };
    doc.on('update', this.onUpdate);
  }

  private send(enc: encoding.Encoder, kind: 'step1' | 'step2' | 'update'): void {
    const bytes = encoding.toUint8Array(enc);
    this.sent.push({ kind, bytes: bytes.length });
    this.ws.send(bytes);
  }

  /** The largest step 2 this peer sent: its offline work, in one message. */
  largestStep2(): number {
    return Math.max(0, ...this.sent.filter((s) => s.kind === 'step2').map((s) => s.bytes));
  }

  async leave(): Promise<void> {
    this.ws.close();
    await this.closed;
  }
}

export function layerIds(doc: Y.Doc): string[] {
  return doc.getArray<string>('layers').toArray();
}

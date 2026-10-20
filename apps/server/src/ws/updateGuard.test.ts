// The update guard: the shared vectors (fixtures/contracts/update-guard.json,
// the same file the desktop's UpdateGuard checks), every layout fixture as
// the server seeds it, and the updates the web writes while editing (moves,
// a paste of 1000 parts, deletions, unicode and emoji names, long names)
// all read as the apps read them.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as Y from 'yjs';
import { describe, expect, it } from 'vitest';
import { readBbm, readSidecar } from '@cld/bbm';
import { encodeDoc, seedFromBbm } from '@cld/ydoc';
import { MAX_NESTING, MAX_UPDATE_BYTES, checkStateVector, checkUpdate } from './updateGuard.js';
import { readZip } from '../test/zip.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../../..');
const FIXTURES = join(ROOT, 'packages/bbm/tests/fixtures');

interface Vector {
  what: string;
  kind: 'update' | 'stateVector';
  hex: string;
  refused: boolean;
  contains?: string;
}
const contract = JSON.parse(readFileSync(join(ROOT, 'fixtures/contracts/update-guard.json'), 'utf8')) as {
  maxUpdateBytes: number;
  maxNesting: number;
  vectors: Vector[];
};

const check = (kind: Vector['kind'], bytes: Uint8Array) => (kind === 'update' ? checkUpdate(bytes) : checkStateVector(bytes));

/** Every file under `dir` ending in one of `exts`. */
function filesIn(dir: string, exts: string[]): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...filesIn(p, exts));
    else if (exts.some((e) => name.endsWith(e))) out.push(p);
  }
  return out.sort();
}

/** A layout file as the server's create route seeds it (POST /api/layouts with bbm + sidecar). */
function seedLayoutFile(path: string): Y.Doc {
  const zip = readZip(readFileSync(path));
  const doc = seedFromBbm(readBbm(zip.get('layout.bbm')!.toString('utf8')).map);
  const sidecar = zip.get('sidecar.json');
  if (sidecar) doc.getMap('meta').set('cache', readSidecar(sidecar.toString('utf8')) as unknown as Record<string, unknown>);
  return doc;
}

function expectReadable(doc: Y.Doc, what: string): void {
  expect(checkUpdate(Y.encodeStateAsUpdate(doc)), what).toBeNull();
  expect(checkStateVector(Y.encodeStateVector(doc)), what).toBeNull();
  expect(checkUpdate(Y.encodeStateAsUpdate(doc, new Uint8Array([0]))), what).toBeNull();
}

describe('the update guard', () => {
  it('uses the limits the desktop uses', () => {
    expect(MAX_UPDATE_BYTES).toBe(contract.maxUpdateBytes);
    expect(MAX_NESTING).toBe(contract.maxNesting);
  });

  it('gives every shared vector the answer the desktop gives it', () => {
    expect(contract.vectors.length).toBeGreaterThanOrEqual(30);
    for (const v of contract.vectors) {
      const why = check(v.kind, Buffer.from(v.hex, 'hex'));
      if (v.refused) {
        expect(why, v.what).not.toBeNull();
        if (v.contains) expect(why, v.what).toContain(v.contains);
      } else {
        expect(why, v.what).toBeNull();
      }
    }
  });

  it('passes vectors the web Yjs reads, and they apply', () => {
    for (const v of contract.vectors.filter((x) => !x.refused && x.kind === 'update')) {
      expect(() => Y.applyUpdate(new Y.Doc(), Buffer.from(v.hex, 'hex')), v.what).not.toThrow();
    }
  });

  it('refuses anything over the size limit, quickly', () => {
    const big = new Uint8Array(MAX_UPDATE_BYTES + 1);
    expect(checkUpdate(big)).toContain('limit');
    expect(checkStateVector(big)).toContain('limit');
    // A value nested 100 000 deep is refused without recursing.
    // (meta.x = [[[…null…]]]: one client, one block of values, as in the vectors.)
    const head = Buffer.concat([Buffer.from([1, 1, 7, 0, 8 | 0x20, 1, 4]), Buffer.from('meta'), Buffer.from([1, 0x78, 1])]);
    const deep = Buffer.concat([head, Buffer.from('\x75\x01'.repeat(100_000), 'latin1'), Buffer.from([0x7e, 0])]);
    const t = performance.now();
    expect(checkUpdate(deep)).not.toBeNull();
    expect(performance.now() - t).toBeLessThan(1000);
  });

  it('passes every layout fixture as the server seeds it (.bbm, .bld-layout)', () => {
    const bbms = filesIn(FIXTURES, ['.bbm']);
    const files = filesIn(FIXTURES, ['.bld-layout']);
    expect(bbms.length).toBeGreaterThanOrEqual(15);
    expect(files.length).toBeGreaterThanOrEqual(6);
    for (const path of bbms) expectReadable(seedFromBbm(readBbm(readFileSync(path, 'utf8')).map), path);
    for (const path of files) expectReadable(seedLayoutFile(path), path);
  });

  it('passes the updates the web writes while editing a large layout', () => {
    const doc = new Y.Doc();
    Y.applyUpdate(doc, encodeDoc(seedFromBbm(readBbm(readFileSync(join(FIXTURES, 'fordyce-2026.bbm'), 'utf8')).map)));
    const updates: Uint8Array[] = [];
    doc.on('update', (u: Uint8Array) => updates.push(u));
    const before = Y.encodeStateVector(doc);
    const layerData = doc.getMap<Y.Map<unknown>>('layerData');
    const bricks = [...layerData.values()]
      .map((l) => l.get('bricks'))
      .filter((b): b is Y.Array<Y.Map<unknown>> => b instanceof Y.Array)
      .sort((a, b) => b.length - a.length)[0]!;
    expect(bricks.length).toBeGreaterThan(300);
    // Moves and turns.
    for (let i = 0; i < 50; i++) {
      doc.transact(() => {
        const b = bricks.get(i);
        b.set('displayArea', { x: i * 8, y: 16.5, width: 32, height: 32 });
        b.set('orientation', (i * 22.5) % 360);
      });
    }
    // A paste of 1000 parts with unicode, emoji and long names.
    doc.transact(() => {
      const pasted: Y.Map<unknown>[] = [];
      for (let i = 0; i < 1000; i++) {
        const y = new Y.Map<unknown>();
        y.set('id', `pasted-${i}-ü✓😀日本`);
        y.set('displayArea', { x: i, y: -i, width: 8, height: 16 });
        y.set('myGroup', null);
        y.set('partNumber', i % 2 ? '3001.1' : 'custom:Zürich-Bahnhof-🚂');
        y.set('orientation', 0);
        y.set('activeConnectionPointIndex', 0);
        y.set('altitude', 0);
        y.set('connexions', [{ id: `c${i}`, linkedTo: null }]);
        pasted.push(y);
      }
      bricks.push(pasted);
    });
    const meta = doc.getMap('meta');
    meta.set('event', 'Fordyce 2026 — Großer Bahnhof 🚉 مرحبا '.repeat(100));
    meta.set('comment', 'x'.repeat(100_000));
    // Deletions (and an undo of them).
    const undo = new Y.UndoManager(bricks);
    bricks.delete(10, 200);
    undo.undo();
    expect(updates.length).toBeGreaterThan(50);
    for (const u of updates) expect(checkUpdate(u)).toBeNull();
    // What an offline session sends on reconnect (one step 2), and a merged backlog.
    expect(checkUpdate(Y.encodeStateAsUpdate(doc, before))).toBeNull();
    expect(checkUpdate(Y.mergeUpdates(updates))).toBeNull();
    expectReadable(doc, 'the edited layout');
  });
});

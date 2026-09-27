import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { readBbm, writeBbm } from '@cld/bbm';
import { bbmToDoc, docToBbm } from './projection.js';
import { DOC_SCHEMA_VERSION, makeId, upgradeDoc } from './ids.js';
import { createDefaultLayoutDoc, createLayoutDoc, decodeDoc, encodeDoc } from './index.js';

const BBM_FIXTURES = resolve(dirname(fileURLToPath(import.meta.url)), '../../bbm/tests/fixtures');
const fordyce = readFileSync(resolve(BBM_FIXTURES, 'fordyce-2026.bbm'), 'utf8');

function yCells(doc: Y.Doc): Y.Map<unknown>[] {
  const out: Y.Map<unknown>[] = [];
  for (const layer of doc.getMap<Y.Map<unknown>>('layerData').values()) {
    const cells = layer.get('textCells');
    if (cells instanceof Y.Array) out.push(...(cells.toArray() as Y.Map<unknown>[]));
  }
  return out;
}

describe('makeId', () => {
  it('mints distinct ulong-parseable decimal ids', () => {
    const ids = new Set(Array.from({ length: 500 }, makeId));
    expect(ids.size).toBe(500);
    for (const id of ids) {
      expect(id).toMatch(/^[1-9]\d*$/);
      expect(BigInt(id) < 2n ** 63n).toBe(true);
    }
  });
});

describe('text cell ids', () => {
  it('mints an id for every cell of an id-less file without changing its export', () => {
    const doc = new Y.Doc();
    bbmToDoc(readBbm(fordyce).map, doc);
    const cells = yCells(doc);
    expect(cells.length).toBeGreaterThan(0);
    const ids = cells.map((c) => c.get('id'));
    for (const id of ids) expect(typeof id).toBe('string');
    expect(new Set(ids).size).toBe(ids.length);
    expect(writeBbm(docToBbm(doc))).toBe(fordyce);
  });

  it('round-trips a .bbm id through bbm → ydoc → bbm', () => {
    let n = 0;
    const xml = fordyce.replace(/<TextCell>/g, () => `<TextCell id="${++n}23">`);
    const doc = decodeDoc(encodeDoc(seed(xml)));
    expect(yCells(doc).map((c) => c.get('id'))).toEqual(
      Array.from({ length: n }, (_, i) => `${i + 1}23`),
    );
    expect(writeBbm(docToBbm(doc))).toBe(xml);
  });

  it('projects docs written before ids existed (no id on the cells)', () => {
    const doc = seed(fordyce);
    for (const c of yCells(doc)) {
      c.delete('id');
      c.delete('idInBbm');
    }
    doc.getMap('meta').delete('schemaVersion');
    expect(writeBbm(docToBbm(doc))).toBe(fordyce);
  });

  it('projects legacy plain-object cells', () => {
    const doc = seed(fordyce);
    const layer = [...doc.getMap<Y.Map<unknown>>('layerData').values()].find(
      (l) => l.get('type') === 'text',
    )!;
    const cells = layer.get('textCells') as Y.Array<unknown>;
    const plain = (cells.get(0) as Y.Map<unknown>).toJSON();
    delete plain.id;
    cells.delete(0, 1);
    cells.insert(0, [plain]);
    expect(writeBbm(docToBbm(doc))).toBe(fordyce);
  });
});

describe('upgradeDoc', () => {
  it('assigns missing ids and stamps schemaVersion, keeping existing ids', () => {
    const doc = seed(fordyce);
    const cells = yCells(doc);
    const kept = cells[0]!.get('id');
    cells[1]!.delete('id');
    doc.getMap('meta').delete('schemaVersion');

    expect(upgradeDoc(doc)).toBe(true);
    expect(cells[0]!.get('id')).toBe(kept);
    expect(typeof cells[1]!.get('id')).toBe('string');
    expect(doc.getMap('meta').get('schemaVersion')).toBe(DOC_SCHEMA_VERSION);
  });

  it('is a no-op (no update emitted) on an up-to-date doc', () => {
    const doc = seed(fordyce);
    let updates = 0;
    doc.on('update', () => updates++);
    expect(upgradeDoc(doc)).toBe(false);
    expect(updates).toBe(0);
  });

  it('leaves unseeded docs alone', () => {
    const doc = new Y.Doc();
    expect(upgradeDoc(doc)).toBe(false);
    expect(doc.getMap('meta').size).toBe(0);
  });
});

describe('meta.schemaVersion', () => {
  it('is written when a doc is created', () => {
    expect(createDefaultLayoutDoc().getMap('meta').get('schemaVersion')).toBe(DOC_SCHEMA_VERSION);
    expect(seed(fordyce).getMap('meta').get('schemaVersion')).toBe(DOC_SCHEMA_VERSION);
    expect(createLayoutDoc().getMap('meta').get('schemaVersion')).toBe(DOC_SCHEMA_VERSION);
  });
});

function seed(xml: string): Y.Doc {
  const doc = new Y.Doc();
  bbmToDoc(readBbm(xml).map, doc);
  return doc;
}

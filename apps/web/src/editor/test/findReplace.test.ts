// Find & Replace logic (desktop FindDialog.cpp): search, part-number and
// text replacement, single vs all, one undo step.

import { describe, expect, it } from 'vitest';
import type * as Y from 'yjs';
import { createDefaultLayoutDoc, docToBbm } from '@cld/ydoc';
import { addTextCell, ensureTextLayer, placeBrick } from '../mutations';
import { findHits, replaceHits, replaceInString } from '../findReplace';
import { createUndoManager } from '../useUndoManager';

function brickLayerId(doc: Y.Doc): string {
  return docToBbm(doc).layers.find((l) => l.type === 'brick')!.id;
}

function partNumbers(doc: Y.Doc): string[] {
  return docToBbm(doc).layers.flatMap((l) => (l.type === 'brick' ? l.bricks.map((b) => b.partNumber) : []));
}

function texts(doc: Y.Doc): string[] {
  return docToBbm(doc).layers.flatMap((l) => (l.type === 'text' ? l.textCells.map((c) => c.text) : []));
}

function seed(): Y.Doc {
  const doc = createDefaultLayoutDoc();
  const lid = brickLayerId(doc);
  placeBrick(doc, lid, { partNumber: '3001.1', x: 0, y: 0, width: 4, height: 2 });
  placeBrick(doc, lid, { partNumber: '3001.1', x: 10, y: 0, width: 4, height: 2, orientation: 90 });
  placeBrick(doc, lid, { partNumber: '3003.1', x: 20, y: 0, width: 2, height: 2 });
  const tl = ensureTextLayer(doc);
  const font = { family: 'Arial', size: 12, style: 'Regular' };
  const fontColor = { kind: 'known' as const, name: 'Black' };
  addTextCell(doc, tl, { centreX: 0, centreY: 0, widthStuds: 4, heightStuds: 2, text: 'Station North', font, fontColor });
  addTextCell(doc, tl, { centreX: 0, centreY: 9, widthStuds: 4, heightStuds: 2, text: 'north yard', font, fontColor });
  return doc;
}

describe('replaceInString', () => {
  it('replaces every occurrence, case-insensitively by default', () => {
    expect(replaceInString('Aa-aA', 'a', 'x', false)).toBe('xx-xx');
    expect(replaceInString('Aa-aA', 'a', 'x', true)).toBe('Ax-xA');
  });

  it('treats needle and replacement literally', () => {
    expect(replaceInString('3001.1', '.', '$&!', false)).toBe('3001$&!1');
    expect(replaceInString('a(b)', '(b)', '[c]', true)).toBe('a[c]');
  });
});

describe('findHits', () => {
  it('matches part numbers in part scope and text in text scope', () => {
    const map = docToBbm(seed());
    expect(findHits(map, '3001', 'part', false)).toHaveLength(2);
    expect(findHits(map, 'north', 'text', false)).toHaveLength(2);
    expect(findHits(map, 'north', 'text', true)).toHaveLength(1);
    expect(findHits(map, '   ', 'part', false)).toHaveLength(0);
  });
});

describe('replaceHits', () => {
  it('replaces within part numbers (3001.1 → 3001.5), keeping position and orientation', () => {
    const doc = seed();
    const before = docToBbm(doc).layers.find((l) => l.type === 'brick')!;
    const hits = findHits(docToBbm(doc), '3001.1', 'part', false);
    expect(replaceHits(doc, hits, '3001.1', '3001.5', false)).toBe(2);
    expect(partNumbers(doc)).toEqual(['3001.5', '3001.5', '3003.1']);
    const after = docToBbm(doc).layers.find((l) => l.type === 'brick')!;
    if (before.type !== 'brick' || after.type !== 'brick') throw new Error('not a brick layer');
    expect(after.bricks.map((b) => [b.displayArea.x, b.displayArea.y, b.orientation])).toEqual(
      before.bricks.map((b) => [b.displayArea.x, b.displayArea.y, b.orientation]),
    );
  });

  it('replacing a sub-string rewrites it inside every matching part number', () => {
    const doc = seed();
    const hits = findHits(docToBbm(doc), '.1', 'part', false);
    replaceHits(doc, hits, '.1', '.5', false);
    expect(partNumbers(doc)).toEqual(['3001.5', '3001.5', '3003.5']);
  });

  it('single replace only touches the given match', () => {
    const doc = seed();
    const hits = findHits(docToBbm(doc), '3001', 'part', false);
    expect(replaceHits(doc, [hits[1]!], '3001', '3002', false)).toBe(1);
    expect(partNumbers(doc)).toEqual(['3001.1', '3002.1', '3003.1']);
  });

  it('replaces text in text scope, honouring match case', () => {
    const doc = seed();
    const hits = findHits(docToBbm(doc), 'north', 'text', true);
    replaceHits(doc, hits, 'north', 'south', true);
    expect(texts(doc)).toEqual(['Station North', 'south yard']);
    replaceHits(doc, findHits(docToBbm(doc), 'NORTH', 'text', false), 'NORTH', 'East', false);
    expect(texts(doc)).toEqual(['Station East', 'south yard']);
  });

  it('never blanks a part number', () => {
    const doc = seed();
    const hits = findHits(docToBbm(doc), '3003.1', 'part', false);
    expect(replaceHits(doc, hits, '3003.1', '', false)).toBe(0);
    expect(partNumbers(doc)).toContain('3003.1');
  });

  it('a replace-all is one undo step', () => {
    const doc = seed();
    const um = createUndoManager(doc);
    replaceHits(doc, findHits(docToBbm(doc), '3001', 'part', false), '3001', '3010', false);
    expect(partNumbers(doc)).toEqual(['3010.1', '3010.1', '3003.1']);
    um.undo();
    expect(partNumbers(doc)).toEqual(['3001.1', '3001.1', '3003.1']);
  });
});

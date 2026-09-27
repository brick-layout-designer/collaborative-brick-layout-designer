// Text cells written by the web editor must stay projectable: the doc
// projection reads cells as Y.Maps, and a plain object used to make
// docToBbm throw (the editor then rendered an empty canvas).

import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { docToBbm } from '@cld/ydoc';
import { addTextCell, deleteTextCell, editTextCell, editTextCellFull, ensureBrickLayer, ensureTextLayer } from '../mutations';

const spec = {
  centreX: 10, centreY: 10, widthStuds: 8, heightStuds: 4, text: 'Hello',
  font: { family: 'Arial', size: 12, style: 'Regular' },
  fontColor: { kind: 'known' as const, name: 'Black' },
};

function cells(doc: Y.Doc) {
  const layer = docToBbm(doc).layers.find((l) => l.type === 'text');
  return layer && layer.type === 'text' ? layer.textCells : [];
}

describe('text cells round-trip through the projection', () => {
  it('add / edit / delete keep the doc projectable', () => {
    const doc = new Y.Doc();
    ensureBrickLayer(doc); // seeds the map meta
    const l = ensureTextLayer(doc);
    addTextCell(doc, l, spec);
    expect(cells(doc).map((c) => c.text)).toEqual(['Hello']);
    editTextCell(doc, l, 0, 'Hi');
    editTextCellFull(doc, l, 0, { orientation: 90 });
    expect(cells(doc)[0]).toMatchObject({ text: 'Hi', orientation: 90, displayArea: { x: 6, y: 8 } });
    deleteTextCell(doc, l, 0);
    expect(cells(doc)).toEqual([]);
  });

  it('reads and upgrades legacy plain-object cells', () => {
    const doc = new Y.Doc();
    ensureBrickLayer(doc); // seeds the map meta
    const l = ensureTextLayer(doc);
    const yCells = (doc.getMap('layerData').get(l) as Y.Map<unknown>).get('textCells') as Y.Array<unknown>;
    yCells.push([{
      displayArea: { x: 0, y: 0, width: 4, height: 2 }, myGroup: '', text: 'old', orientation: 0,
      fontColor: { kind: 'known', name: 'Black' }, font: spec.font, textAlignment: 'Center',
    }]);
    expect(cells(doc)[0]!.text).toBe('old');
    editTextCell(doc, l, 0, 'new');
    expect(yCells.get(0)).toBeInstanceOf(Y.Map);
    expect(cells(doc)[0]!.text).toBe('new');
    expect((yCells.get(0) as Y.Map<unknown>).get('id')).toMatch(/^\d+$/);
  });
});

describe('text cell ids', () => {
  function yCell(doc: Y.Doc, l: string, i: number): Y.Map<unknown> {
    const yCells = (doc.getMap('layerData').get(l) as Y.Map<unknown>).get('textCells') as Y.Array<unknown>;
    return yCells.get(i) as Y.Map<unknown>;
  }

  it('new cells get a distinct stable id that survives edits', () => {
    const doc = new Y.Doc();
    ensureBrickLayer(doc);
    const l = ensureTextLayer(doc);
    addTextCell(doc, l, spec);
    addTextCell(doc, l, spec);
    const a = yCell(doc, l, 0).get('id');
    expect(a).toMatch(/^\d+$/);
    expect(yCell(doc, l, 1).get('id')).not.toBe(a);
    editTextCellFull(doc, l, 0, { text: 'x', orientation: 45 });
    expect(yCell(doc, l, 0).get('id')).toBe(a);
    // Minted ids are sync-only: they never leak into the .bbm export.
    expect(cells(doc)[0]).not.toHaveProperty('id');
  });

  it('an id-less Y.Map cell from an old doc gets an id on first edit', () => {
    const doc = new Y.Doc();
    ensureBrickLayer(doc);
    const l = ensureTextLayer(doc);
    addTextCell(doc, l, spec);
    yCell(doc, l, 0).delete('id');
    expect(cells(doc)[0]!.text).toBe('Hello');
    editTextCell(doc, l, 0, 'edited');
    expect(yCell(doc, l, 0).get('id')).toMatch(/^\d+$/);
  });
});

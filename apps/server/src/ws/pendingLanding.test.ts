// What a room holds waiting for changes it doesn't have (pending.ts) lands
// only with an update of a client it waits for. The grid guard works out
// on a copy only the updates it may land with (gridGuard.ts): every other
// edit in the room is checked from the keys it touches, as in a room with
// nothing waiting, and gets the same answer as the copy would give.

import { readFileSync } from 'node:fs';
import * as Y from 'yjs';
import * as encoding from 'lib0/encoding';
import { describe, expect, it } from 'vitest';
import { readBbm } from '@cld/bbm';
import { seedFromBbm } from '@cld/ydoc';
import { checkGridSizes, checkGridSizesOnCopy } from './gridGuard.js';
import { decodeIncoming, guardWork } from './decoded.js';
import { pendingMayLand } from './pending.js';

const bbm = readFileSync(new URL('../../../../packages/bbm/tests/fixtures/fordyce-2026.bbm', import.meta.url), 'utf8');

/** The room, and an editor in sync with it. */
function room(): { doc: Y.Doc; editor: Y.Doc; grid: () => Y.Map<unknown> } {
  const doc = seedFromBbm(readBbm(bbm).map);
  const editor = new Y.Doc();
  editor.clientID = 555;
  Y.applyUpdate(editor, Y.encodeStateAsUpdate(doc));
  const grid = () => [...editor.getMap<Y.Map<unknown>>('layerData').values()].find((l) => l.get('type') === 'grid')!;
  return { doc, editor, grid };
}

/** What `d` did since `sv`. */
const since = (d: Y.Doc, sv: Uint8Array) => Y.encodeStateAsUpdate(d, sv);

/** A deletion of `n` clocks of `client`, which the room doesn't have yet. */
function deletes(client: number, n: number): Uint8Array {
  const e = encoding.createEncoder();
  encoding.writeVarUint(e, 0);
  encoding.writeVarUint(e, 1);
  encoding.writeVarUint(e, client);
  encoding.writeVarUint(e, 1);
  encoding.writeVarUint(e, 0);
  encoding.writeVarUint(e, n);
  return encoding.toUint8Array(e);
}

/** Both ways of working an update out, and how many copies it took. */
function verdicts(doc: Y.Doc, update: Uint8Array): { live: string | null; copy: string | null; copies: number } {
  const before = guardWork.docCopies;
  const live = checkGridSizes(doc, update);
  const copies = guardWork.docCopies - before;
  return { live, copy: checkGridSizesOnCopy(doc, update), copies };
}

describe('changes a room holds waiting', () => {
  it('land only with an update of a client they wait for', () => {
    const { doc, editor } = room();
    const other = new Y.Doc();
    other.clientID = 777;
    Y.applyUpdate(other, Y.encodeStateAsUpdate(doc));
    const sv0 = Y.encodeStateVector(other);
    other.getMap('meta').set('first', 1); // never sent yet
    const sv1 = Y.encodeStateVector(other);
    other.getMap('meta').set('second', 2);
    Y.applyUpdate(doc, since(other, sv1)); // waits for 777's first change
    expect(doc.store.pendingStructs).not.toBeNull();

    const sv = Y.encodeStateVector(editor);
    editor.getMap('meta').set('comment', 'hello');
    expect(pendingMayLand(doc, decodeIncoming(since(editor, sv))!)).toBe(false);
    const first = Y.encodeStateAsUpdate(other, sv0);
    expect(pendingMayLand(doc, decodeIncoming(first)!)).toBe(true);
  });

  it('don’t send every other edit in the room to a copy', () => {
    const { doc, editor, grid } = room();
    Y.applyUpdate(doc, deletes(888, 3)); // waits for 888's changes
    const other = new Y.Doc();
    other.clientID = 777;
    Y.applyUpdate(other, Y.encodeStateAsUpdate(doc));
    other.getMap('meta').set('first', 1);
    const sv1 = Y.encodeStateVector(other);
    other.getMap('meta').set('second', 2);
    Y.applyUpdate(doc, since(other, sv1));
    expect(doc.store.pendingStructs).not.toBeNull();
    expect(doc.store.pendingDs).not.toBeNull();

    for (const [what, edit, refused] of [
      ['a comment', () => editor.getMap('meta').set('comment', 'x'), false],
      ['a grid line thickness', () => grid().set('gridThickness', 3), false],
      ['sub-divisions out of range', () => grid().set('subDivisionNumber', 1_000_000), true],
    ] as const) {
      const sv = Y.encodeStateVector(editor);
      edit();
      const update = since(editor, sv);
      const v = verdicts(doc, update);
      expect(v.copies, what).toBe(0);
      expect(v.live === null, what).toBe(!refused);
      expect(v.live, what).toBe(v.copy);
      if (!refused) Y.applyUpdate(doc, update);
      else editor.transact(() => grid().set('subDivisionNumber', 4));
    }
  });

  it('that would leave a setting out of range are refused when the change they wait for arrives', () => {
    const { doc } = room();
    const other = new Y.Doc();
    other.clientID = 777;
    Y.applyUpdate(other, Y.encodeStateAsUpdate(doc));
    const sv0 = Y.encodeStateVector(other);
    other.getMap('meta').set('first', 1);
    const sv1 = Y.encodeStateVector(other);
    const grid = [...other.getMap<Y.Map<unknown>>('layerData').values()].find((l) => l.get('type') === 'grid')!;
    grid.set('subDivisionNumber', 1_000_000);
    // Waiting, it changes nothing: taken (it is checked again when it can land).
    const waits = since(other, sv1);
    expect(checkGridSizes(doc, waits)).toBeNull();
    Y.applyUpdate(doc, waits);
    // The change it waits for would let it land: refused, as on a copy.
    const first = since(other, sv0);
    const v = verdicts(doc, first);
    expect(v.copies).toBe(1);
    expect(v.live).toMatch(/subDivisionNumber/);
    expect(v.live).toBe(v.copy);
  });

  it('as deletions land with an update of the client they delete from', () => {
    const { doc, grid, editor } = room();
    // 556 will write the grid's size; a deletion of it waits first.
    const writer = new Y.Doc();
    writer.clientID = 556;
    Y.applyUpdate(writer, Y.encodeStateAsUpdate(editor));
    Y.applyUpdate(doc, deletes(556, 1));
    expect(doc.store.pendingDs).not.toBeNull();
    const sv = Y.encodeStateVector(writer);
    [...writer.getMap<Y.Map<unknown>>('layerData').values()].find((l) => l.get('type') === 'grid')!.set('gridSizeInStud', 48);
    const update = since(writer, sv);
    expect(pendingMayLand(doc, decodeIncoming(update)!)).toBe(true);
    const v = verdicts(doc, update);
    expect(v.copies).toBe(1);
    // The size it writes is deleted as it lands: the grid is left without one.
    expect(v.live).toMatch(/gridSizeInStud|cell size/);
    expect(v.live).toBe(v.copy);
    expect(grid().get('gridSizeInStud')).not.toBeUndefined();
  });
});

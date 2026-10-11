// Modules and anchored labels are kept one per key, so two people changing
// different ones at once both keep their change; meta.cache stays whole for
// apps that only read it, and a write by such an app is still honoured.
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { readSidecarCache, removeDuplicateBricks, repairSidecarCache, writeSidecarCache } from './index.js';

const base = { schemaVersion: 1, bbmHashSha256: '', modules: [{ id: 'm0', name: 'Yard', members: [] }] };
const sync = (a: Y.Doc, b: Y.Doc) => {
  const sa = Y.encodeStateVector(a);
  const sb = Y.encodeStateVector(b);
  Y.applyUpdate(a, Y.encodeStateAsUpdate(b, sa));
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a, sb));
};
const names = (d: Y.Doc) => ((readSidecarCache(d)?.modules ?? []) as { name: string }[]).map((m) => m.name);

describe('sidecar items', () => {
  it('two people adding and renaming different modules at once both keep their change', () => {
    const a = new Y.Doc();
    a.transact(() => writeSidecarCache(a, base));
    const b = new Y.Doc();
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
    const ca = readSidecarCache(a)!;
    a.transact(() => writeSidecarCache(a, { ...ca, modules: [...(ca.modules as object[]), { id: 'ma', name: 'Harbour', members: [] }] }));
    const cb = readSidecarCache(b)!;
    b.transact(() => writeSidecarCache(b, { ...cb, modules: [{ id: 'm0', name: 'Rail yard', members: [] }, { id: 'mb', name: 'Town', members: [] }] }));
    sync(a, b);
    for (const d of [a, b]) expect(names(d).sort()).toEqual(['Harbour', 'Rail yard', 'Town']);
    // meta.cache lags until a client repairs it; then apps reading only it agree.
    expect(repairSidecarCache(a, 'repair') || repairSidecarCache(b, 'repair')).toBe(true);
    sync(a, b);
    const blob = a.getMap('meta').get('cache') as { modules: { name: string }[] };
    expect(blob.modules.map((m) => m.name).sort()).toEqual(['Harbour', 'Rail yard', 'Town']);
    expect(repairSidecarCache(a, 'repair')).toBe(false);
    expect(repairSidecarCache(b, 'repair')).toBe(false);
  });

  it('a removed module stays removed, and labels merge the same way', () => {
    const a = new Y.Doc();
    a.transact(() => writeSidecarCache(a, { ...base, anchoredLabels: [{ id: 'l1', text: 'A' }] }));
    const b = new Y.Doc();
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
    a.transact(() => writeSidecarCache(a, { ...readSidecarCache(a)!, modules: [] }));
    const cb = readSidecarCache(b)!;
    b.transact(() => writeSidecarCache(b, { ...cb, anchoredLabels: [...(cb.anchoredLabels as object[]), { id: 'l2', text: 'B' }] }));
    sync(a, b);
    expect(names(a)).toEqual([]);
    expect(((readSidecarCache(a)!.anchoredLabels) as { id: string }[]).map((l) => l.id)).toEqual(['l1', 'l2']);
  });

  it('an app that only writes meta.cache (the desktop) is read as it wrote it', () => {
    const a = new Y.Doc();
    a.transact(() => writeSidecarCache(a, base));
    a.transact(() => a.getMap('meta').set('cache', { ...base, modules: [{ id: 'm9', name: 'Desk', members: [] }] }));
    expect(names(a)).toEqual(['Desk']);
    expect(repairSidecarCache(a, 'repair')).toBe(false);
    // The next write here takes it up.
    a.transact(() => writeSidecarCache(a, readSidecarCache(a)!));
    expect(names(a)).toEqual(['Desk']);
  });

  it('a doc without items reads meta.cache as before', () => {
    const a = new Y.Doc();
    a.getMap('meta').set('cache', base);
    expect(names(a)).toEqual(['Yard']);
  });
});

describe('removeDuplicateBricks', () => {
  it('two people moving the same part at once: every client keeps the same single copy', () => {
    const a = new Y.Doc();
    a.transact(() => {
      a.getArray<string>('layers').push(['L']);
      const layer = new Y.Map<unknown>();
      layer.set('type', 'brick');
      const bricks = new Y.Array<Y.Map<unknown>>();
      for (const id of ['p', 'q', 'r']) {
        const m = new Y.Map<unknown>();
        m.set('id', id);
        bricks.push([m]);
      }
      layer.set('bricks', bricks);
      a.getMap('layerData').set('L', layer);
    });
    const b = new Y.Doc();
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
    // Both "move" p to the end: delete it and insert a copy.
    for (const [d, tag] of [[a, 'A'], [b, 'B']] as const) {
      d.transact(() => {
        const arr = (d.getMap('layerData').get('L') as Y.Map<unknown>).get('bricks') as Y.Array<Y.Map<unknown>>;
        arr.delete(0, 1);
        const m = new Y.Map<unknown>();
        m.set('id', 'p');
        m.set('by', tag);
        arr.push([m]);
      });
    }
    sync(a, b);
    const ids = (d: Y.Doc) => ((d.getMap('layerData').get('L') as Y.Map<unknown>).get('bricks') as Y.Array<Y.Map<unknown>>).toArray().map((m) => m.get('id'));
    expect(ids(a).filter((x) => x === 'p')).toHaveLength(2);
    // Both tidy at the same time, before seeing each other's tidy.
    expect(removeDuplicateBricks(a, 'tidy')).toBe(1);
    expect(removeDuplicateBricks(b, 'tidy')).toBe(1);
    sync(a, b);
    for (const d of [a, b]) expect(ids(d).sort()).toEqual(['p', 'q', 'r']);
    const by = (d: Y.Doc) => ((d.getMap('layerData').get('L') as Y.Map<unknown>).get('bricks') as Y.Array<Y.Map<unknown>>).toArray().find((m) => m.get('id') === 'p')!.get('by');
    expect(by(a)).toBe(by(b));
  });
});

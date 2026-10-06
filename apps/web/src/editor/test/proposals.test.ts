// Aaron's approved proposals (2026-10-06): module copies, Delete that
// deletes a module's parts, Undo that picks what it brings back, and the
// "(partly hidden)" hover name.

import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { createDefaultLayoutDoc, docToBbm, readSidecarFromDoc } from '@cld/ydoc';
import type { SidecarModule } from '@cld/bbm';
import { moduleCopy, wholeModule } from '../moduleCopy';
import { addSidecarModule, cloneModuleBricks, deleteBricks, deleteModuleWithParts, placeBrick } from '../mutations';
import { createUndoManager, undoAndPick } from '../useUndoManager';
import { useEditorStore } from '../editorStore';
import { moduleHoverName } from '../render/moduleLabels';

const mod = (over: Partial<SidecarModule> = {}): SidecarModule => ({
  id: 'm1',
  name: 'Harbour',
  members: ['a', 'b'],
  transform: [1, 0, 0, 0, 1, 0, 0, 0, 1],
  outlineColor: '#ff0000',
  nameColor: '#00ff00',
  sameColor: false,
  showName: false,
  pinned: true,
  libraryModuleId: 'lib-1',
  libraryVersion: 3,
  sourceFile: 'harbour.bbm',
  ...over,
});

function twoParts() {
  const doc = createDefaultLayoutDoc();
  const layerId = docToBbm(doc).layers.find((l) => l.type === 'brick')!.id;
  const a = placeBrick(doc, layerId, { partNumber: 'x.1', x: 0, y: 0, width: 2, height: 2 });
  const b = placeBrick(doc, layerId, { partNumber: 'x.1', x: 4, y: 0, width: 2, height: 2 });
  return { doc, layerId, a, b };
}

describe('module copies', () => {
  it('a selection that is exactly one module is that module; anything more or less is not', () => {
    const m = mod();
    expect(wholeModule([m], ['b', 'a'])?.id).toBe('m1');
    expect(wholeModule([m], ['a'])).toBeNull();
    expect(wholeModule([m], ['a', 'b', 'c'])).toBeNull();
    expect(wholeModule([m], [])).toBeNull();
  });

  it('a copy is "X (copy)" with the same look, unlinked and unpinned', () => {
    const c = moduleCopy(mod(), ['c', 'd'], () => 'new');
    expect(c).toEqual({
      id: 'new', name: 'Harbour (copy)', members: ['c', 'd'], transform: [1, 0, 0, 0, 1, 0, 0, 0, 1],
      outlineColor: '#ff0000', nameColor: '#00ff00', sameColor: false, showName: false,
    });
  });

  it("the Modules panel's Duplicate keeps the look too", () => {
    const { doc, a, b } = twoParts();
    addSidecarModule(doc, mod({ members: [a, b] }));
    cloneModuleBricks(doc, readSidecarFromDoc(doc)!.modules![0]!);
    const copy = readSidecarFromDoc(doc)!.modules![1]!;
    expect(copy.name).toBe('Harbour (copy)');
    expect(copy.outlineColor).toBe('#ff0000');
    expect(copy.libraryModuleId).toBeUndefined();
    expect(copy.pinned).toBeUndefined();
  });
});

describe("the Modules panel's Delete", () => {
  it('deletes the module and its parts in one undo step', () => {
    const { doc, a, b } = twoParts();
    const keep = placeBrick(doc, docToBbm(doc).layers.find((l) => l.type === 'brick')!.id, { partNumber: 'x.1', x: 9, y: 0, width: 2, height: 2 });
    addSidecarModule(doc, mod({ members: [a, b] }));
    const um = createUndoManager(doc);
    deleteModuleWithParts(doc, 'm1');
    const ids = () => docToBbm(doc).layers.flatMap((l) => (l.type === 'brick' ? l.bricks.map((x) => x.id) : []));
    expect(ids()).toEqual([keep]);
    expect(readSidecarFromDoc(doc)?.modules ?? []).toEqual([]);
    um.undo();
    expect(ids().sort()).toEqual([a, b, keep].sort());
    expect(readSidecarFromDoc(doc)!.modules!.map((m) => m.id)).toEqual(['m1']);
  });
});

describe('undo picks what it brings back', () => {
  it('after Delete then Undo the parts are picked again; an undo that brings nothing back leaves the pick alone', () => {
    const { doc, layerId, a, b } = twoParts();
    const um = createUndoManager(doc);
    useEditorStore.getState().setSelection([]);
    deleteBricks(doc, layerId, [a, b]);
    undoAndPick(doc, um, 'undo');
    expect([...useEditorStore.getState().selection].sort()).toEqual([a, b].sort());
    um.stopCapturing();
    placeBrick(doc, layerId, { partNumber: 'x.1', x: 20, y: 0, width: 2, height: 2 });
    useEditorStore.getState().setSelection([a]);
    undoAndPick(doc, um, 'undo');
    expect(useEditorStore.getState().selection).toEqual([a]);
    void Y;
  });
});

describe('the hover name', () => {
  const text = { x: 0, y: 0, rotation: 0, width: 10, height: 10, fontPx: 16, lines: ['Har…'], truncated: true };
  it('says "(partly hidden)" when parts are on a hidden sheet, else the whole name when cut short', () => {
    expect(moduleHoverName({ name: 'Harbour', partlyHidden: true, text: { ...text, truncated: false } })).toBe('Harbour (partly hidden)');
    expect(moduleHoverName({ name: 'Harbour', partlyHidden: false, text })).toBe('Harbour');
    expect(moduleHoverName({ name: 'Harbour', partlyHidden: false, text: { ...text, truncated: false } })).toBeNull();
    expect(moduleHoverName({ name: 'Harbour', partlyHidden: true })).toBeNull();
  });
});

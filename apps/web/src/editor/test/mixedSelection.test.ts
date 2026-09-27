import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { docToBbm, readSidecarFromDoc } from '@cld/ydoc';
import type { AnchoredLabel } from '@cld/bbm';
import {
  addAnchoredLabel,
  addLinearRuler,
  addTextCell,
  ensureBrickLayer,
  ensureRulerLayer,
  ensureTextLayer,
  placeBrick,
  setActiveConnectionPoint,
} from '../mutations';
import {
  annotationsInMarquee,
  buildLabelIndex,
  clickAnno,
  deleteMixedSelection,
  labelAnchorStuds,
  labelsToOffset,
  mergeAnno,
  parseTextKey,
  textKey,
  toggleId,
  translateMixedSelection,
} from '../mixedSelection';
import { createUndoManager } from '../useUndoManager';
import type { AnnoSelection } from '../editorStore';

const NONE: AnnoSelection = { rulers: [], labels: [], texts: [] };

function label(overrides: Partial<AnchoredLabel>): AnchoredLabel {
  return {
    id: 'l',
    text: 'Hello',
    font: { family: 'Arial', size: 16, style: '' },
    color: { known: true, argb: 0, name: 'Black' },
    kind: 0,
    targetId: '',
    offset: { x: 0, y: 0 },
    rot: 0,
    minZoom: 0,
    ...overrides,
  };
}

/** Doc with one brick at (0,0) 8×8, a ruler (20,0)-(30,0), a text cell centred (50,4) and two labels. */
function seed() {
  const doc = new Y.Doc();
  const brickLayer = ensureBrickLayer(doc);
  const brick = placeBrick(doc, brickLayer, { partNumber: 'p.1', x: 0, y: 0, width: 8, height: 8 });
  const rulerLayer = ensureRulerLayer(doc);
  const ruler = addLinearRuler(doc, rulerLayer, { x: 20, y: 0 }, { x: 30, y: 0 });
  const textLayer = ensureTextLayer(doc);
  addTextCell(doc, textLayer, {
    centreX: 50, centreY: 4, widthStuds: 4, heightStuds: 2, text: 'T',
    font: { family: 'Arial', size: 10, style: 'Regular' }, fontColor: { kind: 'known', name: 'Black' },
  });
  addTextCell(doc, textLayer, {
    centreX: 60, centreY: 4, widthStuds: 4, heightStuds: 2, text: 'U',
    font: { family: 'Arial', size: 10, style: 'Regular' }, fontColor: { kind: 'known', name: 'Black' },
  });
  addAnchoredLabel(doc, label({ id: 'world', offset: { x: 70, y: 0 } }));
  addAnchoredLabel(doc, label({ id: 'onBrick', kind: 1, targetId: brick, offset: { x: 1, y: 1 } }));
  return { doc, brick, brickLayer, ruler, rulerLayer, textLayer };
}

function labels(doc: Y.Doc): AnchoredLabel[] {
  return readSidecarFromDoc(doc)?.anchoredLabels ?? [];
}

describe('selection helpers', () => {
  it('round-trips text keys', () => {
    expect(parseTextKey(textKey('12', 3))).toEqual({ layerId: '12', cellIndex: 3 });
    expect(parseTextKey('nohash')).toBeNull();
    expect(parseTextKey('L#x')).toBeNull();
  });

  it('toggles and merges ids', () => {
    expect(toggleId(['a', 'b'], 'a')).toEqual(['b']);
    expect(toggleId(['a'], 'b')).toEqual(['a', 'b']);
    expect(mergeAnno({ ...NONE, rulers: ['r1'] }, { ...NONE, rulers: ['r1', 'r2'], labels: ['l'] }))
      .toEqual({ rulers: ['r1', 'r2'], labels: ['l'], texts: [] });
  });

  it('plain click selects only the annotation; Shift/Ctrl toggles and keeps bricks', () => {
    expect(clickAnno(['b1'], { ...NONE, labels: ['l1'] }, 'rulers', 'r1', false))
      .toEqual({ bricks: [], anno: { rulers: ['r1'], labels: [], texts: [] } });
    expect(clickAnno(['b1'], { ...NONE, labels: ['l1'] }, 'rulers', 'r1', true))
      .toEqual({ bricks: ['b1'], anno: { rulers: ['r1'], labels: ['l1'], texts: [] } });
    expect(clickAnno(['b1'], { ...NONE, rulers: ['r1'] }, 'rulers', 'r1', true).anno.rulers).toEqual([]);
  });
});

describe('label geometry', () => {
  it('anchors World labels at the origin and Brick labels at the brick centre', () => {
    const { doc, brick } = seed();
    const map = docToBbm(doc);
    const index = buildLabelIndex(map, []);
    const [world, onBrick] = labels(doc);
    expect(labelAnchorStuds(world!, index)).toEqual({ x: 0, y: 0 });
    expect(labelAnchorStuds(onBrick!, index)).toEqual({ x: 4, y: 4 });
    expect(labelAnchorStuds(label({ kind: 1, targetId: 'gone' }), index)).toBeNull();
    void brick;
  });

  it('skips labels whose anchor bricks all move with the selection', () => {
    const { doc, brick } = seed();
    const index = buildLabelIndex(docToBbm(doc), []);
    expect(labelsToOffset(['world', 'onBrick'], labels(doc), index, new Set([brick]))).toEqual(['world']);
    expect(labelsToOffset(['world', 'onBrick'], labels(doc), index, new Set())).toEqual(['world', 'onBrick']);
  });
});

describe('annotationsInMarquee', () => {
  it('collects rulers, labels and text cells touched by the band', () => {
    const { doc, ruler, textLayer } = seed();
    const map = docToBbm(doc);
    const all = annotationsInMarquee({ x0: -10, y0: -10, x1: 100, y1: 20 }, map, labels(doc), [], 1);
    expect(all.rulers).toEqual([ruler]);
    expect(all.texts).toEqual([textKey(textLayer, 0), textKey(textLayer, 1)]);
    expect(all.labels.sort()).toEqual(['onBrick', 'world']);
    // Only the first text cell.
    const some = annotationsInMarquee({ x0: 45, y0: 0, x1: 53, y1: 8 }, map, labels(doc), [], 1);
    expect(some).toEqual({ rulers: [], labels: [], texts: [textKey(textLayer, 0)] });
  });

  it('ignores labels hidden by minZoom', () => {
    const doc = new Y.Doc();
    ensureBrickLayer(doc);
    addAnchoredLabel(doc, label({ id: 'far', minZoom: 2, offset: { x: 5, y: 5 } }));
    const hit = annotationsInMarquee({ x0: 0, y0: 0, x1: 10, y1: 10 }, docToBbm(doc), labels(doc), [], 1);
    expect(hit.labels).toEqual([]);
  });
});

describe('translateMixedSelection', () => {
  it('moves bricks, rulers and labels (not text) in one undo step', () => {
    const { doc, brick, ruler, textLayer } = seed();
    const um = createUndoManager(doc);
    const map = docToBbm(doc);
    translateMixedSelection(doc, map, labels(doc), [], {
      bricks: [brick],
      anno: { rulers: [ruler], labels: ['world', 'onBrick'], texts: [textKey(textLayer, 0)] },
      dx: 2,
      dy: 3,
    });
    const after = docToBbm(doc);
    const b = after.layers.flatMap((l) => (l.type === 'brick' ? l.bricks : []))[0]!;
    expect(b.displayArea.x).toBe(2);
    expect(b.displayArea.y).toBe(3);
    const r = after.layers.flatMap((l) => (l.type === 'ruler' ? l.rulerItems : []))[0]!;
    expect(r.kind === 'linear' && r.point1).toEqual({ x: 22, y: 3 });
    const ls = labels(doc);
    expect(ls.find((l) => l.id === 'world')!.offset).toEqual({ x: 72, y: 3 });
    // Anchored to a moving brick → follows it, offset unchanged.
    expect(ls.find((l) => l.id === 'onBrick')!.offset).toEqual({ x: 1, y: 1 });
    const t = after.layers.find((l) => l.type === 'text');
    expect(t?.type === 'text' && t.textCells[0]!.displayArea.x).toBe(48);
    expect(um.undoStack.length).toBe(1);
    um.undo();
    expect(labels(doc).find((l) => l.id === 'world')!.offset).toEqual({ x: 70, y: 0 });
  });

  it('applies a separate brick delta (grid snap) and honours movedBricks', () => {
    const { doc, brick } = seed();
    translateMixedSelection(doc, docToBbm(doc), labels(doc), [], {
      bricks: [brick],
      anno: { ...NONE, labels: ['world'] },
      dx: 1.3,
      dy: 0,
      brickDx: 1,
      brickDy: 0,
    });
    const b = docToBbm(doc).layers.flatMap((l) => (l.type === 'brick' ? l.bricks : []))[0]!;
    expect(b.displayArea.x).toBe(1);
    expect(labels(doc).find((l) => l.id === 'world')!.offset.x).toBeCloseTo(71.3);

    translateMixedSelection(doc, docToBbm(doc), labels(doc), [], {
      bricks: [],
      anno: { ...NONE, labels: ['onBrick'] },
      dx: 5,
      dy: 5,
      movedBricks: [brick],
    });
    expect(labels(doc).find((l) => l.id === 'onBrick')!.offset).toEqual({ x: 1, y: 1 });
  });
});

describe('deleteMixedSelection', () => {
  it('deletes bricks, rulers, labels and text cells in one undo step', () => {
    const { doc, brick, ruler, textLayer } = seed();
    const um = createUndoManager(doc);
    deleteMixedSelection(doc, docToBbm(doc), [brick], {
      rulers: [ruler],
      labels: ['world'],
      texts: [textKey(textLayer, 0), textKey(textLayer, 1)],
    });
    const after = docToBbm(doc);
    expect(after.layers.flatMap((l) => (l.type === 'brick' ? l.bricks : []))).toHaveLength(0);
    expect(after.layers.flatMap((l) => (l.type === 'ruler' ? l.rulerItems : []))).toHaveLength(0);
    expect(after.layers.flatMap((l) => (l.type === 'text' ? l.textCells : []))).toHaveLength(0);
    expect(labels(doc).map((l) => l.id)).toEqual(['onBrick']);
    expect(um.undoStack.length).toBe(1);
  });

  it('deletes the right text cells when several share a layer', () => {
    const { doc, textLayer } = seed();
    deleteMixedSelection(doc, docToBbm(doc), [], { ...NONE, texts: [textKey(textLayer, 0)] });
    const t = docToBbm(doc).layers.find((l) => l.type === 'text');
    expect(t?.type === 'text' && t.textCells.map((c) => c.text)).toEqual(['U']);
  });
});

describe('setActiveConnectionPoint (grab anchor)', () => {
  it('persists the index without adding an undo step', () => {
    const { doc, brick, brickLayer } = seed();
    const um = createUndoManager(doc);
    setActiveConnectionPoint(doc, brickLayer, brick, 2);
    const b = docToBbm(doc).layers.flatMap((l) => (l.type === 'brick' ? l.bricks : []))[0]!;
    expect(b.activeConnectionPointIndex).toBe(2);
    expect(um.undoStack.length).toBe(0);
  });
});

// Connectivity write-back in the editor: links and the handed-over active
// connection (BlueBrick onLinked) reach the doc, outside the undo stack.

import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { createDefaultLayoutDoc, docToBbm } from '@cld/ydoc';
import type { PartWire } from '../../api';
import { placeBrick } from '../mutations';
import { catalogFromParts, recomputeConnectivity } from '../useConnectivity';
import { LOCAL_ORIGIN } from '../useLayoutDoc';

// 2865.8-style straight: connection 0 prefers 1 next, 1 prefers 0.
const STRAIGHT = {
  key: 'straight.8',
  partNumber: 'straight',
  colorCode: '8',
  kind: 'leaf',
  pxPerStud: 8,
  hullPts: [],
  connections: [
    { type: '1', x: -8, y: 0, angle: 180, electricPlug: 1, nextConnexionPreference: 1 },
    { type: '1', x: 8, y: 0, angle: 0, electricPlug: -1, nextConnexionPreference: 0 },
  ],
  subparts: [],
} as unknown as PartWire;

describe('connectivity write-back', () => {
  it('catalogFromParts keeps nextConnexionPreference for the hand-over', () => {
    const meta = catalogFromParts([STRAIGHT]).get('straight.8')!;
    expect(meta.connections.map((c) => c.nextConnexionPreference)).toEqual([1, 0]);
  });

  it('writes links and the handed-over active connection, not as an undo step', () => {
    const doc = createDefaultLayoutDoc();
    const layerId = docToBbm(doc).layers.find((l) => l.type === 'brick')!.id;
    const um = new Y.UndoManager([doc.getMap('layerData')], { trackedOrigins: new Set([LOCAL_ORIGIN]) });
    // b sits right of a; a's active connection is its right end (1), which gets linked.
    const a = placeBrick(doc, layerId, { partNumber: 'straight.8', x: 0, y: 0, width: 16, height: 8, activeConnectionPointIndex: 1 });
    const b = placeBrick(doc, layerId, { partNumber: 'straight.8', x: 16, y: 0, width: 16, height: 8 });
    const undoSteps = um.undoStack.length;

    recomputeConnectivity(doc, catalogFromParts([STRAIGHT]));

    const bricks = docToBbm(doc).layers.flatMap((l) => (l.type === 'brick' ? l.bricks : []));
    const A = bricks.find((x) => x.id === a)!;
    const B = bricks.find((x) => x.id === b)!;
    expect(A.connexions[1]!.linkedTo).toBe(B.connexions[0]!.id);
    // Each brick's active end got linked, so it moves to that end's
    // preference: the other, free end.
    expect(A.activeConnectionPointIndex).toBe(0);
    expect(B.activeConnectionPointIndex).toBe(1);
    expect(um.undoStack.length).toBe(undoSteps);
  });
});

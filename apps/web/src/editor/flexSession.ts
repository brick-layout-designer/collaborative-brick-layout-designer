// Flex move in the editor — desktop MapView::startFlexMove / updateFlexItems
// / finishFlexMove (MapView.cpp:600-613, 1692-1776): the second press of a
// double-click on a brick of a selected hinged chain (PFS flex track,
// magnet couplings...) bends the chain while the mouse moves, and the
// release commits every changed brick as one undo step. A double-click
// without moving changes nothing (the brick's properties open as usual).

import * as Y from 'yjs';
import type Konva from 'konva';
import type { BbmMap, LayerBrick } from '@cld/model';
import { FlexMove, imageOffset, type FlexState } from '@cld/parts-catalog/browser';
import type { PartWire } from '../api';
import { useEditorStore } from './editorStore';
import { catalogFromParts } from './useConnectivity';
import { LOCAL_ORIGIN } from './useLayoutDoc';
import { liveSnapReach } from './liveSnapReach';
import { snapBypassed } from './snapFeel';

const PX = 8;

/** Write the chain's new poses into the doc as one undo step. */
export function commitFlex(doc: Y.Doc, layerId: string, states: readonly FlexState[]): void {
  if (states.length === 0) return;
  doc.transact(() => {
    const layer = doc.getMap('layerData').get(layerId);
    if (!(layer instanceof Y.Map)) return;
    const bricks = layer.get('bricks');
    if (!(bricks instanceof Y.Array)) return;
    const byId = new Map<unknown, Y.Map<unknown>>();
    bricks.forEach((b) => {
      if (b instanceof Y.Map) byId.set(b.get('id'), b);
    });
    for (const s of states) {
      const y = byId.get(s.id);
      if (!y) continue;
      y.set('displayArea', { ...s.displayArea });
      y.set('orientation', s.orientation);
    }
  }, LOCAL_ORIGIN);
}

/**
 * Start a flex move of `grabbedId` if the selection holds a flexible chain
 * through it. Returns false (and does nothing) otherwise.
 */
export function startFlexSession(opts: {
  stage: Konva.Stage;
  doc: Y.Doc;
  map: BbmMap;
  layerId: string;
  grabbedId: string;
  /** Selection from before the double-click, when it held the grabbed brick. */
  pressSelection?: readonly string[];
  mouseStuds: { x: number; y: number };
  partsByKey: ReadonlyMap<string, PartWire>;
  onEnd: (moved: boolean) => void;
}): boolean {
  const { stage, doc, map, layerId, grabbedId, pressSelection = [], mouseStuds, partsByKey, onEnd } = opts;
  const source = map.layers.find((l): l is LayerBrick => l.id === layerId && l.type === 'brick');
  if (!source) return false;
  // The move edits bricks in place: work on a copy of the layer.
  const layer = structuredClone(source);
  const st = useEditorStore.getState();
  // The chain is the current selection (the double-click's first click
  // selected the brick), as in BlueBrick.
  const selection = new Set([...st.selection, ...pressSelection, grabbedId]);
  const flex = FlexMove.start(layer, selection, grabbedId, mouseStuds, catalogFromParts([...new Set(partsByKey.values())]));
  if (!flex) return false;

  const chainIds = flex.initialState().map((s) => s.id);
  st.setSelection(chainIds);
  let moved = false;

  const pointerStuds = () => {
    const p = stage.getPointerPosition();
    if (!p) return null;
    const w = stage.getAbsoluteTransform().copy().invert().point(p);
    return { x: w.x / PX, y: w.y / PX };
  };
  const draw = () => {
    for (const s of flex.currentState()) {
      const node = stage.findOne(`.brick-${s.id}`);
      if (!node) continue;
      const b = layer.bricks.find((x) => x.id === s.id);
      const part = b ? partsByKey.get(b.partNumber.toLowerCase()) : undefined;
      const off = part ? imageOffset(part, s.orientation) : { x: 0, y: 0 };
      node.rotation(s.orientation);
      node.position({
        x: (s.displayArea.x + s.displayArea.width / 2 + off.x) * PX,
        y: (s.displayArea.y + s.displayArea.height / 2 + off.y) * PX,
      });
    }
    stage.batchDraw();
  };
  const onMove = (e?: { evt?: { altKey?: boolean } }) => {
    const m = pointerStuds();
    if (!m) return;
    // The editor's connection-snap reach; Alt bends without snapping.
    const snapped = flex.moveTo(m, liveSnapReach(), !snapBypassed(e?.evt));
    moved = true;
    useEditorStore.getState().setLiveSnap(snapped ? { studX: snapped.x, studY: snapped.y } : null);
    draw();
  };
  let done = false;
  const onUp = () => {
    if (done) return;
    done = true;
    stage.off('mousemove.flex touchmove.flex');
    stage.off('mouseup.flex touchend.flex');
    window.removeEventListener('mouseup', onUp);
    useEditorStore.getState().setLiveSnap(null);
    if (moved) {
      commitFlex(doc, layerId, flex.currentState());
      useEditorStore.getState().showStatusMessage('Flex move', 1500);
    }
    onEnd(moved);
  };
  stage.on('mousemove.flex touchmove.flex', onMove);
  stage.on('mouseup.flex touchend.flex', onUp);
  // A release outside the stage still ends the move.
  window.addEventListener('mouseup', onUp, { once: true });
  return true;
}

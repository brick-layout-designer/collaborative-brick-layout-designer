// Where the parts being dragged are right now, before the drop writes them
// to the layout. The canvas moves the parts' own nodes every frame; the
// things drawn from the layout (module outlines and names, and anything
// else that follows parts) read this pose so they move with the drag too,
// instead of waiting for the release. One shared source for every overlay
// (the desktop's MapView::liveDragPose is the same).
//
// The pose is rigid: a part's point p (studs, where it was when the drag
// started) is now R(degrees) · (p − about) + to.

import { useMemo } from 'react';
import { create } from 'zustand';
import type { BbmMap } from '@cld/model';

export interface DragPose {
  /** The parts being dragged. */
  ids: ReadonlySet<string>;
  /** Each dragged part's display area when the drag started (studs): the pose applies while the layout still has them there. */
  startAreas: ReadonlyMap<string, { x: number; y: number; width: number; height: number }>;
  about: { x: number; y: number };
  to: { x: number; y: number };
  degrees: number;
}

interface PoseState {
  pose: DragPose | null;
  setPose: (pose: DragPose | null) => void;
}

export const useLiveDragPose = create<PoseState>((set) => ({
  pose: null,
  setPose: (pose) => set({ pose }),
}));

/** Where a start-of-drag point (studs) is now. */
export function posedPoint(pose: DragPose, x: number, y: number): { x: number; y: number } {
  const r = (pose.degrees * Math.PI) / 180;
  const c = Math.cos(r), s = Math.sin(r);
  const dx = x - pose.about.x, dy = y - pose.about.y;
  return { x: pose.to.x + dx * c - dy * s, y: pose.to.y + dx * s + dy * c };
}

/**
 * The layout with the dragged parts where the drag has them now (their
 * areas moved and turned, their orientations turned), for everything drawn
 * from the layout that follows parts. Unchanged (the same object) when
 * nothing is being dragged, or once the drop is in the layout.
 */
export function posedMap(map: BbmMap, pose: DragPose | null): BbmMap {
  if (!pose) return map;
  let changed = false;
  const layers = map.layers.map((layer) => {
    if (layer.type !== 'brick') return layer;
    let touched = false;
    const bricks = layer.bricks.map((b) => {
      if (!pose.ids.has(b.id)) return b;
      const was = pose.startAreas.get(b.id);
      const a = b.displayArea;
      if (!was || was.x !== a.x || was.y !== a.y || was.width !== a.width || was.height !== a.height) return b;
      touched = true;
      const c = posedPoint(pose, a.x + a.width / 2, a.y + a.height / 2);
      // A turned area's box: the old box's corners, turned.
      const r = (pose.degrees * Math.PI) / 180;
      const w = Math.abs(a.width * Math.cos(r)) + Math.abs(a.height * Math.sin(r));
      const h = Math.abs(a.width * Math.sin(r)) + Math.abs(a.height * Math.cos(r));
      const round = (v: number) => Math.round(v * 1e9) / 1e9;
      return {
        ...b,
        displayArea: { x: c.x - round(w) / 2, y: c.y - round(h) / 2, width: round(w), height: round(h) },
        orientation: b.orientation + pose.degrees,
      };
    });
    if (!touched) return layer;
    changed = true;
    return { ...layer, bricks };
  });
  return changed ? { ...map, layers } : map;
}

/** `map` with the live drag applied (see posedMap); re-renders the caller as the drag moves. */
export function usePosedMap(map: BbmMap): BbmMap;
export function usePosedMap(map: BbmMap | null): BbmMap | null;
export function usePosedMap(map: BbmMap | null): BbmMap | null {
  const pose = useLiveDragPose((s) => s.pose);
  return useMemo(() => (map ? posedMap(map, pose) : map), [map, pose]);
}

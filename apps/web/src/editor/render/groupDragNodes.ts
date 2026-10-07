// Live-drag bookkeeping for a mixed selection: every selected item that
// the cursor is NOT dragging is shifted by hand each frame, the way Qt
// moves every selected movable item together (MapViewDrag.cpp:124-153).
// Nodes are found by the names the renderers give them:
//   brick-<id> (BrickLayer), ruler-<id> (RulerLayer), label-<id> (AnchoredLabels).

import type Konva from 'konva';
import type { AnnoSelection } from '../editorStore';

export interface NodeSnap {
  node: Konva.Node;
  x0: number;
  y0: number;
}

/** Konva node names of the movable annotations (text cells don't move). */
export function annoNodeNames(anno: AnnoSelection): string[] {
  return [...anno.rulers.map((id) => `ruler-${id}`), ...anno.labels.map((id) => `label-${id}`)];
}

/** Snapshot the named nodes (one scene walk), skipping `exclude`. */
export function collectNodes(
  stage: Konva.Stage | null | undefined,
  names: readonly string[],
  exclude?: Konva.Node,
): NodeSnap[] {
  if (!stage || names.length === 0) return [];
  const want = new Set(names);
  const seen = new Set<string>();
  const out: NodeSnap[] = [];
  for (const node of stage.find((n: Konva.Node) => want.has(n.name()))) {
    if (node === exclude || seen.has(node.name())) continue;
    seen.add(node.name());
    out.push({ node, x0: node.x(), y0: node.y() });
  }
  return out;
}

export function shiftNodes(snaps: readonly NodeSnap[], dxPx: number, dyPx: number): void {
  for (const s of snaps) s.node.position({ x: s.x0 + dxPx, y: s.y0 + dyPx });
}

export function restoreNodes(snaps: readonly NodeSnap[]): void {
  for (const s of snaps) s.node.position({ x: s.x0, y: s.y0 });
}

/**
 * Drag callbacks for rulers and labels. The renderer makes the item's
 * root Group draggable and forwards its own drag events (not bubbled
 * ones from child handles) here; the editor moves the rest of the
 * selection with it and commits everything as one undo step.
 */
export interface AnnoDragHandlers {
  start: (kind: 'rulers' | 'labels', id: string, node: Konva.Node) => void;
  /** `evt`: the drag's pointer event (Alt held frees a ruler or label from the grid). */
  move: (node: Konva.Node, evt?: { altKey?: boolean }) => void;
  end: (node: Konva.Node) => void;
}

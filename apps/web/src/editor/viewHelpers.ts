// Small pure helpers for the editor view: the view centre in studs, the
// status-bar drop-target hint and header-dropdown placement.

import type { Layer } from '@cld/model';
import { useEditorStore } from './editorStore';
import { pxToStud } from './render/coords';

/**
 * World-stud position under the centre of a `width` × `height` stage —
 * desktop `mapToScene(viewport()->rect().center())`. Pan/zoom default to
 * the live store values.
 */
export function viewCentreStuds(
  size: { width: number; height: number },
  view: { panX: number; panY: number; zoom: number } = useEditorStore.getState(),
): { x: number; y: number } {
  const { panX, panY, zoom } = view;
  return { x: pxToStud((size.width / 2 - panX) / zoom), y: pxToStud((size.height / 2 - panY) / zoom) };
}

/**
 * Status-bar hint naming the layer a dropped part lands on: the active
 * layer when it is a brick layer, else the first brick layer (the same
 * pick as the canvas's placement). Port of MapView::showDropTargetHint
 * (MapView.cpp:1653-1683); the web creates a brick layer when there is none.
 */
export function dropTargetHint(layers: readonly Pick<Layer, 'id' | 'type' | 'name'>[], activeLayerId: string | null): string {
  const active = layers.find((l) => l.id === activeLayerId && l.type === 'brick');
  const target = active ?? layers.find((l) => l.type === 'brick');
  if (!target) return 'No brick layer — dropping creates one';
  const name = target.name || 'unnamed';
  return active
    ? `Drop onto: ${name} (active layer)`
    : `Drop onto: ${name} (active layer is not a brick layer)`;
}

/**
 * Viewport position for a header dropdown: right-aligned under `button`.
 * Menus use `position: fixed` so the horizontally scrolling header row
 * can't clip them.
 */
export function dropdownAnchor(
  button: Pick<HTMLElement, 'getBoundingClientRect'>,
  viewportWidth: number = window.innerWidth,
): { top: number; right: number } {
  const r = button.getBoundingClientRect();
  return { top: r.bottom + 4, right: Math.max(4, viewportWidth - r.right) };
}

/**
 * Multiplicative zoom step for an accumulated wheel `deltaY` — desktop
 * MapView::wheelEvent (MapView.cpp:354-390): 1.0015^delta with the delta
 * capped at ±480 per event (~2×). The wheel-zoom-factor preference scales
 * the exponent (1.0015^(delta·factor)), never the base: a base of
 * 1.0015·factor would blow through the whole zoom range for any factor ≠ 1.
 * Browser deltaY is positive for wheel-down (zoom out), the opposite sign
 * of Qt's angleDelta, hence the negation.
 */
export function wheelZoomStep(deltaY: number, wheelZoomFactor = 1): number {
  const clamped = Math.max(-480, Math.min(480, deltaY));
  return Math.pow(1.0015, -clamped * wheelZoomFactor);
}

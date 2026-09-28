// Fit to View — desktop MainWindow::onFitToView: fitInView of every item's
// bounding rect grown by 50 scene px, aspect kept (QGraphicsView leaves a
// 2 px margin inside the viewport).

import type { StudRect } from './exportRender';

const PX_PER_STUD = 8;
const MARGIN_SCENE_PX = 50;
const VIEW_MARGIN_PX = 2;

/** Zoom and pan that fit `bounds` (studs) into a `width` x `height` view, or null when nothing fits. */
export function fitView(
  bounds: StudRect | null,
  width: number,
  height: number,
  zoomRange: { min: number; max: number },
): { zoom: number; panX: number; panY: number } | null {
  if (!bounds) return null;
  const w = bounds.width * PX_PER_STUD + 2 * MARGIN_SCENE_PX;
  const h = bounds.height * PX_PER_STUD + 2 * MARGIN_SCENE_PX;
  const vw = width - 2 * VIEW_MARGIN_PX;
  const vh = height - 2 * VIEW_MARGIN_PX;
  if (!(w > 0 && h > 0 && vw > 0 && vh > 0)) return null;
  const zoom = Math.max(zoomRange.min, Math.min(zoomRange.max, Math.min(vw / w, vh / h)));
  const cx = (bounds.x + bounds.width / 2) * PX_PER_STUD;
  const cy = (bounds.y + bounds.height / 2) * PX_PER_STUD;
  return { zoom, panX: width / 2 - cx * zoom, panY: height / 2 - cy * zoom };
}

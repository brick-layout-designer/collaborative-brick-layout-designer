// Drag-to-resize divider used between dock columns + between stacked
// panels in a column. Captures pointer events globally so the cursor
// stays in resize mode even when it leaves the divider's hit-box.
//
// Mirrors the desktop's QSplitter handle: 4px-wide visual, generous
// hit-box, persists the new size on release via the parent's `onChange`
// callback.

import { useCallback } from 'react';

interface Props {
  /**
   * `column` = a vertical bar between two side-by-side columns (drag
   *            horizontally; reports `clientX`).
   * `row`    = a horizontal bar between two stacked panels (drag
   *            vertically; reports `clientY`).
   */
  axis: 'column' | 'row';
  /**
   * Called continuously while dragging with the new pixel measurement.
   * The parent decides what that measurement means (column width,
   * panel height) and clamps to its own min/max — Resizer is just
   * the input device.
   */
  onResize: (clientPx: number) => void;
  /** Optional className for the visible track. */
  className?: string;
}

export function Resizer({ axis, onResize, className }: Props) {
  const isColumn = axis === 'column';
  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      // Ensure the moves stay tracked even if the cursor leaves the
      // handle. setPointerCapture is the standard primitive for this.
      const target = e.currentTarget;
      target.setPointerCapture(e.pointerId);
      const document = target.ownerDocument;
      const prevCursor = document.body.style.cursor;
      document.body.style.cursor = isColumn ? 'col-resize' : 'row-resize';

      function onMove(ev: PointerEvent) {
        onResize(isColumn ? ev.clientX : ev.clientY);
      }
      function onUp() {
        document.body.style.cursor = prevCursor;
        target.removeEventListener('pointermove', onMove as EventListener);
        target.removeEventListener('pointerup', onUp as EventListener);
        target.removeEventListener('pointercancel', onUp as EventListener);
      }
      target.addEventListener('pointermove', onMove as EventListener);
      target.addEventListener('pointerup', onUp as EventListener);
      target.addEventListener('pointercancel', onUp as EventListener);
    },
    [isColumn, onResize],
  );

  // Visual: 4px line in neutral-700 with a 6px transparent hit-box on
  // either side so the user doesn't have to hit a 4px target.
  return (
    <div
      role="separator"
      aria-orientation={isColumn ? 'vertical' : 'horizontal'}
      onPointerDown={onPointerDown}
      className={
        (isColumn
          ? 'w-1 cursor-col-resize hover:bg-blue-500/40 active:bg-blue-500/70'
          : 'h-1 cursor-row-resize hover:bg-blue-500/40 active:bg-blue-500/70') +
        ' shrink-0 bg-neutral-800 ' +
        (className ?? '')
      }
    />
  );
}

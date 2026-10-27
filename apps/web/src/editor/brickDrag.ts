// The part being dragged on the map, so a turn (R, Shift+R, the Rotate
// buttons) pressed in the middle of a drag can act on it.
//
// A drag moves the parts on screen only; the layout gets them on the drop.
// Turning the layout's parts mid-drag left the drag going on with where
// they were before the turn: the drop put the turned parts back at their
// old angles on screen (a set's other parts never turned there) while the
// layout had them turned. So a turn in mid-drag drops the parts where they
// are first (one undo step, as letting go there would), turns them, and
// picks the drag up again when the turned parts are drawn: the mouse is
// still down, so they go on following it.

import type Konva from 'konva';

interface Drag {
  node: Konva.Node;
  id: string;
  /** A mouse drag picks up again after a turn; a finger's ends with it. */
  mouse: boolean;
}

let dragging: Drag | null = null;
let resume: { id: string; until: number } | null = null;

/** How long a turned part waits to be drawn before the drag gives up picking up again (ms). */
const RESUME_MS = 1000;

export const brickDrag = {
  /** A part's drag began (BrickLayer's drag start). */
  started(node: Konva.Node, id: string, mouse: boolean): void {
    dragging = { node, id, mouse };
  },
  /** A part's drag ended, however it ended. */
  ended(node: Konva.Node): void {
    if (dragging?.node === node) dragging = null;
  },
  /** Whether a part is being dragged now. */
  active(): boolean {
    return dragging !== null;
  },
  /**
   * A turn is about to change the dragged parts: drop them where they are
   * now (the drag's own drop, so the move is kept), and remember to pick
   * the drag up again once they're drawn turned. False when nothing was
   * being dragged.
   */
  dropForTurn(): boolean {
    const d = dragging;
    if (!d) return false;
    // No event: one from the keyboard has no pointer, and Konva would take
    // the pointer's place from it (nowhere), losing it for the drag after.
    d.node.stopDrag();
    dragging = null;
    resume = d.mouse ? { id: d.id, until: performance.now() + RESUME_MS } : null;
    // Let go before the turned parts were drawn: nothing to pick up again.
    if (resume && typeof window !== 'undefined')
      window.addEventListener(
        'mouseup',
        () => {
          resume = null;
        },
        { once: true, capture: true },
      );
    return true;
  },
  /** Called when part `id` is drawn: true once, when its drag should start again now. */
  takeResume(id: string): boolean {
    if (!resume || resume.id !== id) return false;
    const due = performance.now() <= resume.until;
    resume = null;
    return due;
  },
};

// Where a dropdown and its submenus go so they stay inside the window.

export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface Placed {
  left: number;
  top: number;
  /** The list scrolls past this. */
  maxHeight: number;
}

const MARGIN = 4;

/** The top-level list: under its button, left edges lined up, moved in from the right edge. */
export function placeDropdown(button: Box, w: number, vw: number, vh: number): Placed {
  const top = button.bottom + MARGIN;
  const left = Math.max(MARGIN, Math.min(button.left, vw - w - MARGIN));
  return { left, top, maxHeight: Math.max(120, vh - top - 2 * MARGIN) };
}

/**
 * A submenu: beside its item, to the right, or to the left when the right
 * has no room (it flips); level with the item, moved up when it would run
 * off the bottom.
 */
export function placeSubmenu(item: Box, w: number, h: number, vw: number, vh: number): Placed & { flipped: boolean } {
  const OVERLAP = 2;
  const PAD = 4; // the list's own top padding, so the first entry lines up with the item
  let left = item.right - OVERLAP;
  let flipped = false;
  if (left + w > vw - MARGIN) {
    left = item.left - w + OVERLAP;
    flipped = true;
  }
  left = Math.max(MARGIN, Math.min(left, vw - w - MARGIN));
  const maxHeight = vh - 2 * MARGIN;
  const top = Math.max(MARGIN, Math.min(item.top - PAD, vh - Math.min(h, maxHeight) - MARGIN));
  return { left, top, maxHeight, flipped };
}

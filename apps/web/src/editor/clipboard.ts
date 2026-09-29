// Clipboard for bricks — port of MapViewClipboard.cpp.
//
// Differences from desktop:
//   - Uses the BROWSER clipboard (navigator.clipboard) so paste survives
//     across tabs and reloads. The desktop's in-process clipboard works
//     fine because it's a single window; the web port's natural multi-
//     tab use case wants a real shared buffer.
//   - Falls back to a module-level in-memory store when the browser
//     clipboard API is unavailable or denied (e.g. http:// localhost
//     contexts in Firefox without permission). Same data shape so
//     paste-from-self always works.
//
// Wire format: a JSON object tagged with a fixed `kind` discriminator
// so we can refuse foreign clipboard payloads.

import type { Brick, RectangleF } from '@cld/model';

const CLIPBOARD_KIND = 'cbld-bricks/v1';

interface ClipboardEntry {
  /** Source layer NAME (not id) so paste finds-or-creates the same name. */
  sourceLayerName: string;
  /** Verbatim copy of the brick's serialisable fields. */
  brick: Pick<Brick, 'partNumber' | 'displayArea' | 'orientation' | 'altitude' | 'activeConnectionPointIndex'>;
}

interface ClipboardPayload {
  kind: typeof CLIPBOARD_KIND;
  version: 1;
  entries: ClipboardEntry[];
}

let memoryFallback: ClipboardPayload | null = null;

/** Serialise a snapshot of `entries` into the OS clipboard + memory fallback. */
export async function writeBricksToClipboard(entries: ClipboardEntry[]): Promise<void> {
  const payload: ClipboardPayload = {
    kind: CLIPBOARD_KIND,
    version: 1,
    entries,
  };
  memoryFallback = payload;
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(JSON.stringify(payload));
    } catch {
      /* permission denied / unsupported → memory fallback wins */
    }
  }
}

/** Read previously-written bricks. Returns null if clipboard is empty/foreign. */
export async function readBricksFromClipboard(): Promise<ClipboardEntry[] | null> {
  if (typeof navigator !== 'undefined' && navigator.clipboard?.readText) {
    try {
      const raw = await navigator.clipboard.readText();
      const parsed = JSON.parse(raw) as Partial<ClipboardPayload>;
      if (parsed && parsed.kind === CLIPBOARD_KIND && Array.isArray(parsed.entries)) {
        return parsed.entries as ClipboardEntry[];
      }
    } catch {
      /* fall through to memory fallback */
    }
  }
  return memoryFallback?.entries ?? null;
}

/**
 * Whether this session has bricks to paste, for the context menu's Paste
 * entry (desktop lists it only when the clipboard has content). The system
 * clipboard can't be checked without a permission prompt, so this knows
 * only this tab's copies; Ctrl+V still reads the system clipboard.
 */
export function hasClipboardBricks(): boolean {
  return (memoryFallback?.entries.length ?? 0) > 0;
}

export type { ClipboardEntry };

type Point = { x: number; y: number };

/**
 * Where a paste lands, in studs: under the cursor, or the centre of the
 * visible view when the cursor isn't over it (MapViewClipboard.cpp:64-69).
 * `view` is the stage size in px with its pan and zoom.
 */
export function pasteTarget(
  pointer: Point | null,
  view: { width: number; height: number; panX: number; panY: number; zoom: number },
  pxPerStud = 8,
): Point {
  if (pointer) return pointer;
  return {
    x: (view.width / 2 - view.panX) / view.zoom / pxPerStud,
    y: (view.height / 2 - view.panY) / view.zoom / pxPerStud,
  };
}

/**
 * The move that puts the average of the boxes' centres on `target` —
 * computed over the whole clipboard, before the budget leaves any out
 * (MapViewClipboard.cpp:70-73).
 */
export function pasteOffset(areas: readonly RectangleF[], target: Point): { dx: number; dy: number } {
  if (areas.length === 0) return { dx: 0, dy: 0 };
  let cx = 0;
  let cy = 0;
  for (const a of areas) {
    cx += a.x + a.width / 2;
    cy += a.y + a.height / 2;
  }
  return { dx: target.x - cx / areas.length, dy: target.y - cy / areas.length };
}

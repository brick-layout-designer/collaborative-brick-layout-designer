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

import type { Brick } from '@cld/model';

const CLIPBOARD_KIND = 'cld-bricks/v1';

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

export type { ClipboardEntry };

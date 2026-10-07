// Map formats besides .bbm that BlueBrick also opens and saves — desktop
// MainWindowFileIO.cpp: LDraw (.ldr / .mpd), TrackDesigner (.tdl) and
// 4DBrix nControl (.ncp). The website saves all four (Download as…) but
// opens only TrackDesigner and 4DBrix: LDraw models are imported in the
// desktop app, which saves them to the server (open/openFiles.ts).
// Opening converts the file to .bbm XML in the browser (then it's
// created like any .bbm); saving converts the layout. Both need the
// parts catalog for each part's remap and geometry.

import type { BbmMap } from '@cld/model';
import type { PartWire } from './api';
import { sanitizeFilename, type MapConverter } from './bbmFiles';
import { catalogFromParts } from './editor/catalogFromParts';

export type MapFormat = 'ldr' | 'mpd' | 'tdl' | 'ncp';

export const MAP_FORMATS: readonly { format: MapFormat; label: string }[] = [
  { format: 'ldr', label: 'LDraw (.ldr)' },
  { format: 'mpd', label: 'LDraw multi-part (.mpd)' },
  { format: 'tdl', label: 'TrackDesigner (.tdl)' },
  { format: 'ncp', label: '4DBrix nControl (.ncp)' },
];

/** The map formats the website opens. */
export type OpenMapFormat = 'tdl' | 'ncp';

/** File names the website's map-format readers take. */
export const MAP_FORMAT_FILE = /\.(tdl|ncp)$/i;

/** `accept` for file pickers that open layouts. */
export const LAYOUT_ACCEPT = '.bld-layout,.bbm,.tdl,.ncp';

/** The desktop's Save As warning for formats that can't hold a whole layout. */
export const LOSSY_FORMAT_WARNING =
  "This format can't store everything in the map: text, area and grid sheets, " +
  'module / label / venue data and parts the format has no equivalent for are lost, ' +
  'and sheet names may change. Keep a .bbm copy if you need them.';

/** The map format the website opens this file as, if any. */
export function mapFormatOf(fileName: string): OpenMapFormat | null {
  const m = MAP_FORMAT_FILE.exec(fileName);
  return m ? (m[1]!.toLowerCase() as OpenMapFormat) : null;
}

/**
 * Read a TrackDesigner / 4DBrix file as .bbm XML, with the reader's
 * warnings (unmapped parts). Throws when the file can't be read.
 */
export async function mapFileToBbm(
  fileName: string,
  bytes: Uint8Array,
  parts: readonly PartWire[],
): Promise<{ bbm: string; warnings: string[] }> {
  const format = mapFormatOf(fileName);
  if (!format) throw new Error(`${fileName} is not a TrackDesigner or 4DBrix map`);
  // Loaded on demand, like the .bbm codec.
  const [pc, { writeBbm }] = await Promise.all([import('@cld/parts-catalog/browser'), import('@cld/bbm/browser')]);
  const lib = new pc.MapLibrary(catalogFromParts(parts));
  const result =
    format === 'tdl' ? pc.readTrackDesignerMap(bytes, lib) : pc.readFourDBrixMap(new TextDecoder().decode(bytes), lib);
  return { bbm: writeBbm(result.map), warnings: result.warnings };
}

/** A converter for layoutsFromFiles that loads the parts catalog only when a map file shows up. */
export function catalogMapConverter(loadParts: () => Promise<readonly PartWire[]>): MapConverter {
  let parts: Promise<readonly PartWire[]> | undefined;
  return async (name, bytes) => mapFileToBbm(name, bytes, await (parts ??= loadParts()));
}

/** What the editor shows after a file was opened into a new layout (router state). */
export interface OpenedMapState {
  openWarnings?: string[];
  /** The opened file's name, for the "Opened ‹name›: N parts" summary. */
  openedFile?: string;
}

/** The layout as a download in another map format. */
export async function mapDownload(
  map: BbmMap,
  parts: readonly PartWire[],
  format: MapFormat,
  title: string,
): Promise<{ filename: string; type: string; data: Uint8Array }> {
  const pc = await import('@cld/parts-catalog/browser');
  const lib = new pc.MapLibrary(catalogFromParts(parts));
  const filename = `${sanitizeFilename(title)}.${format}`;
  const enc = new TextEncoder();
  if (format === 'tdl') return { filename, type: 'application/octet-stream', data: pc.writeTrackDesignerMap(map, lib) };
  if (format === 'ncp') return { filename, type: 'application/xml', data: enc.encode(pc.writeFourDBrixMap(map, lib)) };
  return { filename, type: 'text/plain', data: enc.encode(pc.writeLDrawMap(map, lib, filename)) };
}

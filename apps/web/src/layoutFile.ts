// The layout file (.bld-layout): a whole layout in one file, as the desktop
// saves it (references/LAYOUT-FILE.md, desktop src/import/LayoutFile.cpp).
// A zip holding
//   manifest.json      {"format":"bld-layout","version":1,"generator":...,
//                       "source":{...}} (source: the server layout it was saved
//                       from, when it was; see LayoutSource)
//   layout.bbm         the map as a .bbm holds it
//   sidecar.json       labels, modules, venue, background, if any
//   background.<ext>   the background image, named by sidecar.json's
//                      backgroundImage.file
//   parts/<file>       the parts it uses that aren't bundled (layoutParts.ts)
// .bbm is still a download, with what BlueBrick supports.

import { buildZip, deflatedEntry, readZip, sanitizeFilename, type ZipEntry } from './bbmFiles';

/** A file name a layout file may carry under parts/ (desktop isLayoutPartFileName). */
export function isLayoutPartFileName(name: string): boolean {
  // eslint-disable-next-line no-control-regex
  return /^[^./\\:*?"<>|\x00-\x1F][^/\\:*?"<>|\x00-\x1F]{0,199}\.(xml|png|gif|jpe?g)$/i.test(name) && !name.includes('..');
}

export const LAYOUT_FILE_VERSION = 1;
export const LAYOUT_FILE = /\.bld-layout$/i;
const FORMAT = 'bld-layout';

const IMAGE_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
};

function extensionOf(type: string): string | undefined {
  return Object.entries(IMAGE_TYPES).find(([, t]) => t === type)?.[0];
}

/**
 * The server layout a file was saved from: written by the web's downloads
 * (every web layout is a server layout) and by the desktop when it saves a
 * live layout, or a file that already had one. Purely local layouts have
 * none. Optional and additive: readers that don't know it ignore it.
 */
export interface LayoutSource {
  /** The server's base address, e.g. https://collab.aronwk.com (no trailing slash). */
  server: string;
  layoutId: string;
  /** The layout's title when the file was saved. */
  title: string;
  /** When the file was saved, as an ISO 8601 time. */
  exportedAt: string;
}

/** The base address of a server: scheme, host and port, without a trailing slash. */
export function serverBase(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return u.origin;
  } catch {
    return null;
  }
}

/** Layout `layoutId` on the server this page came from, as a file's source. */
export function layoutSourceHere(layoutId: string, title: string, now = new Date(), here = window.location.origin): LayoutSource {
  return { server: serverBase(here) ?? here, layoutId, title, exportedAt: now.toISOString() };
}

/** A manifest's `source`, when it is a whole, sensible one. */
export function parseLayoutSource(value: unknown): LayoutSource | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const v = value as Record<string, unknown>;
  const server = typeof v.server === 'string' && v.server.length <= 2048 ? serverBase(v.server) : null;
  const layoutId = typeof v.layoutId === 'string' ? v.layoutId.trim() : '';
  if (!server || !layoutId || layoutId.length > 200) return undefined;
  return {
    server,
    layoutId,
    title: typeof v.title === 'string' ? v.title.slice(0, 500) : '',
    exportedAt: typeof v.exportedAt === 'string' ? v.exportedAt.slice(0, 64) : '',
  };
}

export interface LayoutImage {
  type: string;
  data: Uint8Array;
}

export interface LayoutFileContents {
  bbm: string;
  /** Sidecar JSON for the server; a background image travels beside it. */
  sidecar?: string;
  background?: LayoutImage;
  /** The parts the file carries, by file name (without `parts/`). */
  parts?: Record<string, Uint8Array>;
  /** Read, but with something left out. */
  warnings: string[];
  /** The server layout the file was saved from, when it says. */
  source?: LayoutSource;
  /** The whole manifest as read, so a re-save can keep what it doesn't know. */
  manifest: Record<string, unknown>;
}

/** Read a .bld-layout. Throws when it isn't one. */
export async function readLayoutFile(bytes: Uint8Array): Promise<LayoutFileContents> {
  let entries: ZipEntry[];
  try {
    entries = await readZip(bytes);
  } catch {
    throw new Error('This is not a Brick Layout Designer layout file.');
  }
  const dec = new TextDecoder();
  const entry = (name: string) => entries.find((e) => e.name === name)?.data;
  let manifest: Record<string, unknown> = {};
  try {
    manifest = JSON.parse(dec.decode(entry('manifest.json') ?? new Uint8Array())) as Record<string, unknown>;
  } catch {
    /* refused below */
  }
  if (manifest.format !== FORMAT) throw new Error('This is not a Brick Layout Designer layout file.');
  const layout = entry('layout.bbm');
  if (!layout) throw new Error('The layout file has no layout in it.');

  const out: LayoutFileContents = { bbm: dec.decode(layout), warnings: [], manifest };
  const source = parseLayoutSource(manifest.source);
  if (source) out.source = source;
  if (typeof manifest.version === 'number' && manifest.version > LAYOUT_FILE_VERSION) {
    out.warnings.push(
      "The file was made by a newer version of Brick Layout Designer; anything this version doesn't know is left out.",
    );
  }
  const sidecarBytes = entry('sidecar.json');
  if (sidecarBytes) {
    let sidecar: Record<string, unknown> | undefined;
    try {
      sidecar = JSON.parse(dec.decode(sidecarBytes)) as Record<string, unknown>;
    } catch {
      out.warnings.push('The labels, modules, venue and background could not be read.');
    }
    if (sidecar) {
      const bg = sidecar.backgroundImage as Record<string, unknown> | undefined;
      if (bg && typeof bg.file === 'string') {
        const data = entry(bg.file);
        const type = IMAGE_TYPES[bg.file.split('.').pop()?.toLowerCase() ?? ''];
        if (data && type) out.background = { type, data };
        else out.warnings.push('The background image could not be read.');
        delete bg.file;
      }
      out.sidecar = JSON.stringify(sidecar);
    }
  }
  for (const e of entries) {
    if (!e.name.startsWith('parts/') || e.name.endsWith('/')) continue;
    const name = e.name.slice('parts/'.length);
    if (isLayoutPartFileName(name)) (out.parts ??= {})[name] = e.data;
    else out.warnings.push(`The part file ${name} in the layout could not be read.`);
  }
  return out;
}

export interface LayoutFileInput {
  bbm: string;
  /** writeSidecar's JSON, or null when the layout has no labels, modules, venue or background. */
  sidecar: string | null;
  /** The background image's bytes, when there is one to carry. */
  background?: LayoutImage;
  /** Part files to carry under parts/ (layoutPartFiles). */
  parts?: Record<string, Uint8Array>;
  /** The server layout this is, when it is one; left out for local layouts. */
  source?: LayoutSource;
  /**
   * A manifest read earlier (LayoutFileContents.manifest): fields this
   * version doesn't know are kept. Its own format, version, generator and
   * source are always replaced.
   */
  keepManifest?: Record<string, unknown>;
}

/** manifest.json: what the file is, what made it, and where it came from. */
function manifestFor(input: LayoutFileInput): Record<string, unknown> {
  const { format: _f, version: _v, generator: _g, source: _s, ...kept } = input.keepManifest ?? {};
  const manifest: Record<string, unknown> = {
    format: FORMAT,
    generator: 'Brick Layout Designer (web)',
    version: LAYOUT_FILE_VERSION,
    ...kept,
  };
  if (input.source) {
    manifest.source = {
      server: serverBase(input.source.server) ?? input.source.server,
      layoutId: input.source.layoutId,
      title: input.source.title,
      exportedAt: input.source.exportedAt,
    };
  }
  return manifest;
}

/** The .bld-layout bytes. */
export async function buildLayoutFile(input: LayoutFileInput): Promise<Uint8Array> {
  const enc = new TextEncoder();
  const entries: ZipEntry[] = [
    // First and stored, so the file says what it is from its first bytes.
    {
      name: 'manifest.json',
      data: enc.encode(JSON.stringify(manifestFor(input))),
    },
    await deflatedEntry({ name: 'layout.bbm', data: enc.encode(input.bbm) }),
  ];
  if (input.sidecar !== null) {
    const sidecar = JSON.parse(input.sidecar) as Record<string, unknown>;
    delete sidecar.bbmHashSha256; // the layout is in the same file
    const bg = sidecar.backgroundImage as Record<string, unknown> | undefined;
    const ext = input.background && extensionOf(input.background.type);
    if (bg && input.background && ext) {
      const name = `background.${ext}`;
      delete bg.url; // a server's, and
      delete bg.path; // a machine's: the image is in the file
      bg.file = name;
      entries.push({ name, data: input.background.data }); // images are compressed already
    }
    entries.push(await deflatedEntry({ name: 'sidecar.json', data: enc.encode(JSON.stringify(sidecar, null, 2)) }));
  }
  for (const name of Object.keys(input.parts ?? {}).sort()) {
    if (!isLayoutPartFileName(name)) continue;
    const entry = { name: `parts/${name}`, data: input.parts![name]! };
    entries.push(/\.xml$/i.test(name) ? await deflatedEntry(entry) : entry); // images are compressed already
  }
  return buildZip(entries);
}

/** The layout as a .bld-layout download. */
export async function layoutFileDownload(
  title: string,
  input: LayoutFileInput,
): Promise<{ filename: string; type: string; data: Uint8Array }> {
  return {
    filename: `${sanitizeFilename(title)}.bld-layout`,
    type: 'application/x-brick-layout-designer-layout',
    data: await buildLayoutFile(input),
  };
}

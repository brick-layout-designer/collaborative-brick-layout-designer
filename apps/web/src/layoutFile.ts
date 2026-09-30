// The layout file (.bld-layout): a whole layout in one file, as the desktop
// saves it (references/LAYOUT-FILE.md, desktop src/import/LayoutFile.cpp).
// A zip holding
//   manifest.json      {"format":"bld-layout","version":1,"generator":...}
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

  const out: LayoutFileContents = { bbm: dec.decode(layout), warnings: [] };
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
}

/** The .bld-layout bytes. */
export async function buildLayoutFile(input: LayoutFileInput): Promise<Uint8Array> {
  const enc = new TextEncoder();
  const entries: ZipEntry[] = [
    // First and stored, so the file says what it is from its first bytes.
    {
      name: 'manifest.json',
      data: enc.encode(JSON.stringify({ format: FORMAT, generator: 'Brick Layout Designer (web)', version: LAYOUT_FILE_VERSION })),
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

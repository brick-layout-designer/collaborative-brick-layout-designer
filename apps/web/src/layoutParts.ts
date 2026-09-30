// The parts a .bld-layout carries (references/LAYOUT-FILE.md `parts/`):
// the ones the layout uses that aren't in the bundled library. On the web
// those are the custom parts; opening a file uploads the ones this server
// lacks as the user's own custom parts, as the desktop's Upload My Parts
// does (desktop PartsUpload.cpp).

import type { BbmMap } from '@cld/model';
import { api, toBase64, type PartWire } from './api';
import { isLayoutPartFileName } from './layoutFile';

/** The custom part a brick's part number names, if it is one. */
function customPartFor(partNumber: string, parts: readonly PartWire[]): PartWire | undefined {
  const pn = partNumber.toLowerCase();
  // A bundled part of that key wins, as in the editor.
  if (parts.some((p) => p.source === 'bundled' && p.key.toLowerCase() === pn)) return undefined;
  return parts.find((p) => p.source === 'custom' && p.partNumber.toLowerCase() === pn);
}

export interface PartFetcher {
  xml: (customPartId: string) => Promise<Uint8Array>;
  sprite: (customPartId: string) => Promise<{ type: string; data: Uint8Array }>;
}

const fetchBytes = async (url: string) => {
  const res = await fetch(url, { credentials: 'include' });
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return { type: res.headers.get('Content-Type') ?? '', data: new Uint8Array(await res.arrayBuffer()) };
};

export const serverParts: PartFetcher = {
  xml: async (id) => (await fetchBytes(api.customParts.xmlUrl(id))).data,
  sprite: (id) => fetchBytes(api.customParts.spriteUrl(id)),
};

/**
 * The files of the custom parts `map` uses, by file name: each part's
 * `<PartNumber>.xml` (`.set.xml` for a set) and its sprite beside it.
 */
export async function layoutPartFiles(
  map: BbmMap,
  parts: readonly PartWire[],
  fetcher: PartFetcher = serverParts,
): Promise<Record<string, Uint8Array>> {
  const used = new Map<string, PartWire>();
  for (const layer of map.layers) {
    if (layer.type !== 'brick') continue;
    for (const b of layer.bricks) {
      const part = customPartFor(b.partNumber, parts);
      if (part) used.set(part.partNumber.toLowerCase(), part);
    }
  }
  const files: Record<string, Uint8Array> = {};
  for (const part of used.values()) {
    const stem = part.kind === 'group' ? `${part.partNumber}.set` : part.partNumber;
    const [xml, sprite] = await Promise.all([fetcher.xml(part.customPartId!), fetcher.sprite(part.customPartId!)]);
    if (!isLayoutPartFileName(`${stem}.xml`)) continue;
    files[`${stem}.xml`] = xml;
    files[`${stem}.${sprite.type === 'image/gif' ? 'gif' : 'png'}`] = sprite.data;
  }
  return files;
}

export interface PartUpload {
  partNumber: string;
  displayName: string;
  xml: Uint8Array;
  sprite: Uint8Array;
  spriteMime: 'image/gif' | 'image/png';
}

export interface PartsPlan {
  upload: PartUpload[];
  /** Parts the server has already: its own are used. */
  known: string[];
  /** Parts that can't become custom parts (no .png or .gif sprite). */
  skipped: string[];
}

function descriptionOf(xml: Uint8Array, fallback: string): string {
  const text = new TextDecoder().decode(xml);
  const en = /<Description>[\s\S]*?<en>([^<]*)<\/en>/i.exec(text)?.[1]?.trim();
  return en || fallback;
}

/** Which of a file's parts to upload: the ones the catalog lacks. */
export function planLayoutParts(files: Record<string, Uint8Array>, parts: readonly PartWire[]): PartsPlan {
  const have = new Set<string>();
  for (const p of parts) {
    have.add(p.key.toLowerCase());
    if (p.source === 'custom') have.add(p.partNumber.toLowerCase());
  }
  const plan: PartsPlan = { upload: [], known: [], skipped: [] };
  for (const name of Object.keys(files).sort()) {
    if (!/\.xml$/i.test(name) || !isLayoutPartFileName(name)) continue;
    const stem = name.slice(0, -4);
    const partNumber = stem.replace(/\.set$/i, '');
    if (have.has(partNumber.toLowerCase())) {
      plan.known.push(partNumber);
      continue;
    }
    const png = files[`${stem}.png`];
    const gif = files[`${stem}.gif`];
    const sprite = png ?? gif;
    if (!sprite) {
      plan.skipped.push(partNumber);
      continue;
    }
    plan.upload.push({
      partNumber,
      displayName: descriptionOf(files[name]!, partNumber),
      xml: files[name]!,
      sprite,
      spriteMime: png ? 'image/png' : 'image/gif',
    });
  }
  return plan;
}

/**
 * Upload the parts a layout file carries that the server lacks, as the
 * user's (or `orgSlug`'s) custom parts. Returns what to tell the user.
 */
export async function uploadLayoutParts(
  files: Record<string, Uint8Array> | undefined,
  loadCatalog: () => Promise<readonly PartWire[]>,
  orgSlug?: string,
): Promise<string[]> {
  if (!files || Object.keys(files).length === 0) return [];
  const plan = planLayoutParts(files, await loadCatalog());
  const failed: string[] = [];
  for (const p of plan.upload) {
    try {
      await api.customParts.create({
        partNumber: p.partNumber,
        displayName: p.displayName,
        xmlBase64: toBase64(p.xml),
        spriteBase64: toBase64(p.sprite),
        spriteMime: p.spriteMime,
        ...(orgSlug ? { orgSlug } : {}),
      });
    } catch {
      failed.push(p.partNumber);
    }
  }
  const notes: string[] = [];
  const added = plan.upload.length - failed.length;
  if (added > 0) notes.push(`${added} part${added === 1 ? '' : 's'} from the layout added to your custom parts`);
  if (plan.skipped.length) notes.push(`no sprite the server takes for ${plan.skipped.join(', ')}`);
  if (failed.length) notes.push(`could not upload ${failed.join(', ')}`);
  return notes;
}

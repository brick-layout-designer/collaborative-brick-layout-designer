// Parse a single BlueBrickParts XML file into a PartMetadata.
//
// XML shape: see survey notes / desktop's `src/parts/PartsLibrary.cpp`.
// Root is `<part>` (leaf) or `<group>` (composite). French spelling
// `<connexion>` retained from upstream.

import { XMLParser } from 'fast-xml-parser';
import type { ConnectionPoint, PartKind, PartMetadata, SubPart } from './types.js';

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@',
  parseAttributeValue: false,
  parseTagValue: false,
  trimValues: true,
});

export interface ParseInput {
  /**
   * Library key parts: from the filename `TS_CURVE_R56.8.xml` we get
   * `partNumber="TS_CURVE_R56"`, `colorCode="8"`. The .set suffix on
   * groups is stripped before this is called.
   */
  partNumber: string;
  colorCode: string;
  /** Path of the matching sprite (already discovered by caller), or '' if none. */
  spritePath: string;
  /**
   * Library-relative path of the XML this part came from. Optional
   * because the test suite calls `parsePartXml` directly without a
   * filesystem path — the catalog scanner always passes one.
   */
  xmlRelPath?: string;
}

type RawNode = Record<string, unknown>;

export function parsePartXml(xml: string, input: ParseInput): PartMetadata {
  const tree = parser.parse(xml) as RawNode;

  let kind: PartKind;
  let root: RawNode;
  if ('part' in tree) {
    kind = 'leaf';
    root = tree.part as RawNode;
  } else if ('group' in tree) {
    kind = 'group';
    root = tree.group as RawNode;
  } else {
    throw new Error('expected root <part> or <group> in parts XML');
  }

  const author = stringField(root, 'Author', '');
  const sortingKey = stringField(root, 'SortingKey', '');
  const descriptions = readDescriptions(root.Description);
  const pxPerStud = Number.parseInt(stringField(root, 'PixelsPerStud', '8'), 10);
  const canUngroup = stringField(root, 'CanUngroup', 'true').toLowerCase() === 'true';

  const connections = kind === 'leaf' ? readConnexionList(root.ConnexionList) : [];
  const subparts = kind === 'group' ? readSubPartList(root.SubPartList) : [];
  const hullPts = readHull(root.hull);

  // Match desktop's PartsLibrary::scanFile (PartsLibrary.cpp:173-175):
  // when colorCode is empty, key is bare partNumber, no trailing dot.
  const key = (input.colorCode
    ? `${input.partNumber}.${input.colorCode}`
    : input.partNumber
  ).toLowerCase();
  return {
    key,
    partNumber: input.partNumber,
    colorCode: input.colorCode,
    kind,
    descriptions,
    author,
    sortingKey,
    spritePath: input.spritePath,
    xmlRelPath: input.xmlRelPath ?? '',
    pxPerStud: Number.isFinite(pxPerStud) && pxPerStud > 0 ? pxPerStud : 8,
    connections,
    subparts,
    canUngroup,
    hullPts,
  };
}

function readDescriptions(node: unknown): Record<string, string> {
  // `<Description><en>...</en><fr>...</fr></Description>`. fast-xml-parser
  // collapses single-text children to a string; multi-key dicts come back
  // as objects. Walk both shapes defensively.
  if (!node || typeof node !== 'object') return {};
  const out: Record<string, string> = {};
  for (const [lang, value] of Object.entries(node as RawNode)) {
    if (lang.startsWith('@')) continue;
    if (typeof value === 'string') out[lang] = value;
    else if (value && typeof value === 'object' && '#text' in (value as RawNode)) {
      out[lang] = String((value as RawNode)['#text']);
    }
  }
  return out;
}

function readConnexionList(node: unknown): ConnectionPoint[] {
  if (!node || typeof node !== 'object') return [];
  const raw = (node as RawNode).connexion;
  if (raw === undefined) return [];
  const list = Array.isArray(raw) ? raw : [raw];
  return list.map((c) => readConnexion(c as RawNode));
}

function readConnexion(n: RawNode): ConnectionPoint {
  const pos = n.position as RawNode | undefined;
  const x = pos ? Number.parseFloat(stringField(pos, 'x', '0')) : 0;
  const y = pos ? Number.parseFloat(stringField(pos, 'y', '0')) : 0;
  // type is *required* but we accept missing/empty as the no-connect case.
  const type = stringField(n, 'type', '').trim();
  const out: ConnectionPoint = {
    type,
    x,
    y,
    angle: Number.parseFloat(stringField(n, 'angle', '0')),
    electricPlug: Number.parseInt(stringField(n, 'electricPlug', '-1'), 10),
  };
  const nextPref = optionalNumber(n, 'nextConnexionPreference');
  if (nextPref !== undefined) out.nextConnexionPreference = nextPref;
  const ap = optionalNumber(n, 'angleToPrev');
  if (ap !== undefined) out.angleToPrev = ap;
  const an = optionalNumber(n, 'angleToNext');
  if (an !== undefined) out.angleToNext = an;
  return out;
}

function readSubPartList(node: unknown): SubPart[] {
  if (!node || typeof node !== 'object') return [];
  const raw = (node as RawNode).SubPart;
  if (raw === undefined) return [];
  const list = Array.isArray(raw) ? raw : [raw];
  return list.map((s) => readSubPart(s as RawNode));
}

function readSubPart(n: RawNode): SubPart {
  const id = stringAttr(n, 'id', '').toLowerCase();
  const pos = n.position as RawNode | undefined;
  return {
    subKey: id,
    x: pos ? Number.parseFloat(stringField(pos, 'x', '0')) : 0,
    y: pos ? Number.parseFloat(stringField(pos, 'y', '0')) : 0,
    angle: Number.parseFloat(stringField(n, 'angle', '0')),
  };
}

function stringField(node: RawNode, key: string, fallback: string): string {
  const v = node[key];
  if (v === undefined || v === null) return fallback;
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (typeof v === 'object' && '#text' in (v as RawNode)) {
    return String((v as RawNode)['#text']);
  }
  return fallback;
}

function stringAttr(node: RawNode, attr: string, fallback: string): string {
  const v = node[`@${attr}`];
  return v === undefined ? fallback : String(v);
}

function optionalNumber(node: RawNode, key: string): number | undefined {
  const v = node[key];
  if (v === undefined || v === null || v === '') return undefined;
  const n = Number.parseFloat(String(v));
  return Number.isFinite(n) ? n : undefined;
}

function readHull(node: unknown): { x: number; y: number }[] {
  if (!node || typeof node !== 'object') return [];
  const raw = (node as RawNode).point;
  if (raw === undefined) return [];
  const list = Array.isArray(raw) ? raw : [raw];
  const pts: { x: number; y: number }[] = [];
  for (const p of list) {
    const n = p as RawNode;
    const x = Number.parseFloat(stringField(n, 'x', '0'));
    const y = Number.parseFloat(stringField(n, 'y', '0'));
    if (Number.isFinite(x) && Number.isFinite(y)) pts.push({ x, y });
  }
  return pts;
}

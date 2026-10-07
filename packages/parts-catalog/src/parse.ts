// Parse a single BlueBrickParts XML file into a PartMetadata.
//
// XML shape: see survey notes / desktop's `src/parts/PartsLibrary.cpp`.
// Root is `<part>` (leaf) or `<group>` (composite). French spelling
// `<connexion>` retained from upstream.

import { XMLParser } from 'fast-xml-parser';
import type {
  ConnectionPoint,
  FourDBrixRemap,
  LDrawRemap,
  PartKind,
  PartMetadata,
  SnapMargin,
  SubPart,
  TrackDesignerRemap,
} from './types.js';

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
  const groupNextPreferred = kind === 'group' ? readGroupNextPreferred(root.GroupConnectionPreferenceList) : undefined;
  const hullPts = readHull(root.hull);
  const snapMargin = readSnapMargin(root.SnapMargin);
  const oldNames = readOldNames(root.OldNameList);
  const ldraw = readLDraw(root.LDraw);
  const trackDesigner = readTrackDesigner(root.TrackDesigner);
  const fourDBrix = readFourDBrix(root.FourDBrix);

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
    // The desktop's range (PartsLibrary.cpp parsePartXml): 4 to 256, else 8.
    pxPerStud: Number.isFinite(pxPerStud) && pxPerStud >= 4 && pxPerStud <= 256 ? pxPerStud : 8,
    connections,
    subparts,
    canUngroup,
    ...(groupNextPreferred ? { groupNextPreferred } : {}),
    hullPts,
    ...(snapMargin ? { snapMargin } : {}),
    oldNames,
    ...(ldraw ? { ldraw } : {}),
    ...(trackDesigner ? { trackDesigner } : {}),
    ...(fourDBrix ? { fourDBrix } : {}),
  };
}

const num = (v: unknown): number => {
  const n = Number.parseFloat(String(v ?? ''));
  return Number.isFinite(n) ? n : 0;
};
const int = (v: unknown): number => {
  const n = Number.parseInt(String(v ?? '').trim(), 10);
  return Number.isFinite(n) ? n : 0;
};
const text = (v: unknown): string =>
  v === undefined || v === null ? '' : typeof v === 'object' ? String((v as RawNode)['#text'] ?? '') : String(v);
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : v === undefined ? [] : [v]);

/** `<LDraw>` (PartsLibrary.cpp readLDrawRemap). */
function readLDraw(node: unknown): LDrawRemap | undefined {
  if (!node || typeof node !== 'object') return undefined;
  const n = node as RawNode;
  const t = (n.Translation ?? {}) as RawNode;
  let sleeper = text(n.SleeperID).trim().toUpperCase();
  // Vanilla: a sleeper without a colour is black.
  if (sleeper && !sleeper.includes('.')) sleeper += '.0';
  return {
    angle: num(text(n.Angle)),
    translation: { x: num(text(t.x)), y: num(text(t.y)) },
    preferredHeight: num(text(n.PreferredHeight)),
    sleeper,
    alias: text(n.Alias).trim().toUpperCase(),
  };
}

/** `<TrackDesigner>` (PartsLibrary.cpp readTrackDesigner); undefined without an id. */
function readTrackDesigner(node: unknown): TrackDesignerRemap | undefined {
  if (!node || typeof node !== 'object') return undefined;
  const n = node as RawNode;
  const td: TrackDesignerRemap = { defaultId: 0, registryIds: {}, flags: 0, hasSeveralPorts: false, ports: [] };
  const ids = [...list(n.ID), ...list((n.IDList as RawNode | undefined)?.ID)];
  for (const raw of ids) {
    const registry = typeof raw === 'object' && raw ? String((raw as RawNode)['@registry'] ?? '') : '';
    const id = int(text(raw));
    if (registry === '' || registry === 'default') td.defaultId = id;
    else {
      td.registryIds[registry] = id;
      if (td.defaultId === 0) td.defaultId = id;
    }
  }
  td.flags = int(text(n.Flag));
  td.hasSeveralPorts = text(n.HasSeveralGeometries).trim() === 'true';
  for (const raw of list((n.TDBitmapList as RawNode | undefined)?.TDBitmap)) {
    const b = (raw ?? {}) as RawNode;
    td.ports.push({
      bbConnectionIndex: int(text(b.BBConnexionPointIndex)),
      type: b.Type === undefined ? 20 : int(text(b.Type)),
      angleDifference: Math.fround(num(text(b.AngleBetweenTDandBB))),
    });
  }
  return td.defaultId !== 0 || Object.keys(td.registryIds).length > 0 ? td : undefined;
}

/** `<FourDBrix>` (PartsLibrary.cpp readFourDBrix). */
function readFourDBrix(node: unknown): FourDBrixRemap | undefined {
  if (!node || typeof node !== 'object') return undefined;
  const n = node as RawNode;
  const t = text(n.PartType).trim().toUpperCase();
  return {
    type: t === 'TABLE' ? 'table' : t === 'BASEPLATE' ? 'baseplate' : t === 'STRUCTURE' ? 'structure' : 'segment',
    partName: text(n.PartName).trim(),
    orientationDifference: Math.fround(num(text(n.OrientationDifference))),
    originConnection: int(text(n.ConnectionIndexUsedAsOrigin)),
  };
}

/** `<OldNameList><OldName>4186P01</OldName>…</OldNameList>` (PartsLibrary.cpp readOldNames). */
function readOldNames(node: unknown): string[] {
  if (!node || typeof node !== 'object') return [];
  const raw = (node as RawNode).OldName;
  const list = Array.isArray(raw) ? raw : raw === undefined ? [] : [raw];
  return list.map((v) => String(v).trim()).filter((v) => v !== '');
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
    electricPlug: Number.parseInt(stringField(n, 'electricPlug', '0'), 10) || 0,
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

/**
 * A set's `<GroupConnectionPreferenceList>` (BlueBrick's
 * readGroupConnectionPreferenceListTag): `<nextIndex from="i">j</nextIndex>`.
 * Undefined when there is none.
 */
function readGroupNextPreferred(node: unknown): Record<number, number> | undefined {
  if (!node || typeof node !== 'object') return undefined;
  const raw = (node as RawNode).nextIndex;
  if (raw === undefined) return undefined;
  const out: Record<number, number> = {};
  for (const n of Array.isArray(raw) ? raw : [raw]) {
    const from = Number.parseInt(stringAttr(n as RawNode, 'from', ''), 10);
    const to = Number.parseInt(typeof n === 'object' && n ? String((n as RawNode)['#text'] ?? '') : String(n), 10);
    if (from >= 0 && to >= 0) out[from] = to;
  }
  return Object.keys(out).length > 0 ? out : undefined;
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

/** `<SnapMargin>` in studs; undefined when absent or all zero. */
function readSnapMargin(node: unknown): SnapMargin | undefined {
  if (!node || typeof node !== 'object') return undefined;
  const n = node as RawNode;
  const m = { left: num(n.left), right: num(n.right), top: num(n.top), bottom: num(n.bottom) };
  return m.left || m.right || m.top || m.bottom ? m : undefined;
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

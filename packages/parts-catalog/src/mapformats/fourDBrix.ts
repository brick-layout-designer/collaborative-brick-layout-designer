// 4DBrix nControl (.ncp) maps — port of desktop import/mapformats/
// FourDBrixMap.cpp (from BlueBrick's SaveLoadManager). Parts map through
// their <FourDBrix> remap. Track segments are placed by their origin
// node; tables, baseplates and structures by their image corner or
// centre. On load they go to "Tables", "Baseplates", "Tracks" and
// "Structures" layers, and segment groups are kept. 4DBrix names with no
// remap are listed in the warnings. Arithmetic is single precision where
// BlueBrick's is, so positions match vanilla's.

import { XMLParser } from 'fast-xml-parser';
import type { BbmMap, Brick, Group, LayerBrick } from '@cld/model';
import { formatNumber } from '@cld/bbm/browser';
import { rebuildConnectivity } from '../connectivity.js';
import type { PartMetadata } from '../types.js';
import { MapLibrary, makeId, newBrickLayer, newGridLayer, newMap, type MapReadResult } from './library.js';

const f = Math.fround;
type Raw = Record<string, unknown>;

// BlueBrick un-escapes attribute values once more after the XML parser has.
function unescape(s: string): string {
  return s.replaceAll('&quot;', '"').replaceAll('&apos;', "'").replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&amp;', '&');
}

function escape(s: string): string {
  return s.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll("'", '&apos;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

// BlueBrick's ConnectionTypeList.xml <FourDBrixName>s.
function nodeTypeName(connectionType: string): string {
  if (connectionType === 'mono') return 'NT_MONORAIL';
  if (connectionType === 'mono45') return 'NT_MONORAIL45';
  if (connectionType === 'monoramp') return 'NT_MONORAILRAMP';
  return 'NT_UNDEFINED';
}

const fmt = (v: number) => formatNumber(v, 'g7');
const asList = (v: unknown): Raw[] => (Array.isArray(v) ? v : v === undefined || v === null || v === '' ? [] : [v]) as Raw[];
const attr = (n: unknown, name: string): string => {
  if (!n || typeof n !== 'object') return '';
  const v = (n as Raw)[`@${name}`];
  return v === undefined ? '' : String(v);
};
// QString::toFloat / toInt: 0 for anything unparseable, and (like the
// .bbm reader) for numbers out of range, so the map can be saved.
const toFloat = (s: string): number => {
  const t = s.trim();
  const v = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(t) ? f(Number(t)) : 0;
  return Number.isFinite(v) ? v : 0;
};
const toInt = (s: string): number | undefined => {
  const t = s.trim();
  return /^[+-]?\d+$/.test(t) ? Number(t) : undefined;
};

interface Segment {
  /** nControl uses integers, BlueBrick writes brick ids. */
  id: string;
  partName: string;
  angle: number;
  originNode: number;
  brick?: Brick;
  grouped: boolean;
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@',
  parseAttributeValue: false,
  parseTagValue: false,
  trimValues: false,
});

/** Read a .ncp file's text into a map. */
export function readFourDBrixMap(xml: string, lib: MapLibrary): MapReadResult {
  const tree = parser.parse(xml) as Raw;
  const data = (tree.data ?? {}) as Raw;
  const map = newMap();
  const unmapped: string[] = [];

  const metaFor = (name: string): PartMetadata | undefined => {
    const meta = lib.partForFourDBrixName(name);
    if (!meta?.fourDBrix) {
      if (!unmapped.includes(name)) unmapped.push(name);
      return undefined;
    }
    return meta;
  };

  const project = (data.project ?? {}) as Raw;
  const value = (key: string) => unescape(attr(project[key], 'value'));
  map.event = value('title');
  map.author = value('author');
  map.lug = value('lug');
  map.comment = value('info');

  const nodes = asList(data.node).map((n) => {
    const c = n.coordinates;
    return { x: toFloat(attr(c, 'x')), y: toFloat(attr(c, 'y')), z: toFloat(attr(c, 'z')) };
  });

  const segments: Segment[] = [];
  for (const raw of asList(data.segment)) {
    const s: Segment = {
      id: attr(raw.index, 'value').trim(),
      partName: attr(raw.type, 'value'),
      angle: toFloat(attr(raw.angle, 'value')),
      originNode: toInt(attr(raw.origin, 'value')) ?? 0,
      grouped: false,
    };
    const own: number[] = [];
    for (const [key, v] of Object.entries(raw)) {
      if (!key.startsWith('node') || key === 'nodes') continue;
      for (const n of asList(v)) {
        const index = toInt(attr(n, 'value'));
        if (index !== undefined) own.push(index);
      }
    }
    if (!s.partName) continue;
    // The origin is local to the segment's own node list.
    if (s.originNode >= 0 && s.originNode < own.length) s.originNode = own[s.originNode]!;
    segments.push(s);
  }

  const generic = (list: unknown, coordInCentre: boolean): Brick[] => {
    const out: Brick[] = [];
    for (const raw of asList(list)) {
      const c = raw[coordInCentre ? 'center' : 'coordinates'];
      const x = toFloat(attr(c, 'x'));
      const y = toFloat(attr(c, 'y'));
      const angle = toFloat(attr(raw.angle, 'value'));
      const name = attr(raw.svgfile, 'value');
      if (!name) continue;
      const meta = metaFor(name);
      if (!meta) continue;
      const b = lib.newBrick(meta);
      b.orientation = angle;
      const pos = { x: f(x * 0.125), y: f(y * 0.125) };
      if (coordInCentre) {
        lib.placeByImageCentre(b, pos);
      } else {
        const fp = lib.footprint(b.partNumber, angle);
        const size = fp ? fp.size : { w: 2, h: 2 };
        const corner = fp ? fp.imageCorner : { x: 0, y: 0 };
        b.displayArea = { x: pos.x - corner.x, y: pos.y - corner.y, width: size.w, height: size.h };
      }
      const diff = meta.fourDBrix!.orientationDifference;
      if (diff !== 0) {
        // BlueBrick's Orientation setter keeps the displayArea's corner.
        b.orientation = f(angle - diff);
        const fp = lib.footprint(b.partNumber, b.orientation);
        if (fp) b.displayArea = { ...b.displayArea, width: fp.size.w, height: fp.size.h };
      }
      out.push(b);
    }
    return out;
  };
  const tables = generic(data.table, false);
  const baseplates = generic(data.baseplate, false);
  const structures = generic(data.structure, true);

  const groupIds: string[][] = [];
  for (const raw of asList(data.group)) {
    const ids = attr(raw.segments, 'list').split(',').map((s) => s.trim()).filter((s) => s !== '');
    if (ids.length > 0) groupIds.push(ids);
  }

  const tracks: Brick[] = [];
  for (const s of segments) {
    const meta = metaFor(s.partName);
    if (!meta) continue;
    const fd = meta.fourDBrix!;
    const b = lib.newBrick(meta);
    b.orientation = f(s.angle - fd.orientationDifference);
    const fp = lib.footprint(b.partNumber, b.orientation);
    b.displayArea = { x: 0, y: 0, width: fp ? fp.size.w : 2, height: fp ? fp.size.h : 2 };
    const n = s.originNode >= 0 ? nodes[s.originNode] : undefined;
    if (n) {
      if (meta.connections.length > 0) {
        b.activeConnectionPointIndex = Math.min(Math.max(fd.originConnection, 0), meta.connections.length - 1);
        lib.placeByConnection(b, b.activeConnectionPointIndex, { x: f(n.x * 0.125), y: f(n.y * 0.125) });
      }
      b.altitude = f(n.z * 2.5);
    }
    tracks.push(b);
    s.brick = b;
  }

  const trackLayer = newBrickLayer('Tracks', tracks);
  map.layers.push(newGridLayer(), newBrickLayer('Tables', tables), newBrickLayer('Baseplates', baseplates), trackLayer, newBrickLayer('Structures', structures));
  map.selectedLayerIndex = 3;
  rebuildConnectivity(map, lib.catalog);
  // BlueBrick groups the segments after linking them (grouped bricks hand
  // over their active connection differently); each segment joins the
  // first group that lists it.
  for (const ids of groupIds) {
    const g: Group = { id: makeId(), partNumber: '', myGroup: '' };
    let any = false;
    for (const id of ids) {
      const s = segments.find((x) => x.id === id && !x.grouped && x.brick);
      if (!s) continue;
      s.brick!.myGroup = g.id;
      s.grouped = true;
      any = true;
    }
    if (any) trackLayer.groups.push(g);
  }
  // Array.prototype.sort is stable.
  trackLayer.bricks.sort((a, b) => a.altitude - b.altitude);

  const warnings = unmapped.length ? [`No part is mapped to these 4DBrix parts: ${unmapped.join(', ')}`] : [];
  return { map, warnings };
}

export interface FourDBrixWriteOptions {
  /** When the file was first created; defaults to `now`. */
  created?: Date;
  now?: Date;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad2 = (n: number) => String(n).padStart(2, '0');
/** QLocale::c() "d-MMM-yyyy, HH:mm:ss". */
function ncpDate(d: Date): string {
  return `${d.getDate()}-${MONTHS[d.getMonth()]}-${d.getFullYear()}, ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

interface Part {
  brick: Brick;
  meta: PartMetadata;
}

type Rect = { x: number; y: number; width: number; height: number };
/** QRectF |= : a null rect (0x0) is skipped. */
function unite(a: Rect | null, b: Rect): Rect | null {
  if (b.width === 0 && b.height === 0) return a;
  if (!a) return { ...b };
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, width: Math.max(a.x + a.width, b.x + b.width) - x, height: Math.max(a.y + a.height, b.y + b.height) - y };
}

/** Write a map as .ncp text (CRLF lines). */
export function writeFourDBrixMap(map: BbmMap, lib: MapLibrary, opts: FourDBrixWriteOptions = {}): string {
  const lines: string[] = [];
  const line = (s: string) => lines.push(s);
  const now = opts.now ?? new Date();

  // Map.getTotalAreaInStud(true): visible brick layers only.
  let area: Rect | null = null;
  for (const layer of map.layers) {
    if (layer.type !== 'brick' || !layer.visible) continue;
    for (const b of layer.bricks) area = unite(area, b.displayArea);
  }
  const a = area ?? { x: 0, y: 0, width: 0, height: 0 };
  const tag = (name: string, v: string) => line(`      <${name} value="${v}"/>`);
  line('<?xml version="1.0"?>');
  line('<data type="nControl" version="1">');
  line('   <project>');
  line('      <ncontrol version="2020.0"/>');
  tag('title', escape(map.event));
  tag('author', escape(map.author));
  tag('lug', escape(map.lug));
  tag('created', ncpDate(opts.created ?? now));
  tag('modified', ncpDate(now));
  tag('description', ncpDate(new Date(map.date.year, map.date.month - 1, map.date.day)));
  tag('info', escape(map.comment));
  line(`      <tracklayout width="${Math.trunc(f(a.x + a.width))}" height="${Math.trunc(f(a.y + a.height))}" scale="0.25"/>`);
  line('      <tilepanel rows="1" columns="6"/>');
  line('   </project>');
  for (const script of ['ST_ACTIVATION', 'ST_DEACTIVATION']) {
    line(`   <script type="${script}">`);
    line('      <action value=""/>');
    line('   </script>');
  }

  const owner = new Map<string, Brick>();
  const tables: Part[] = [];
  const tracks: Part[] = [];
  const baseplates: Part[] = [];
  const structures: Part[] = [];
  const topGroups: { layer: LayerBrick; top: string }[] = [];
  for (const layer of map.layers) {
    if (layer.type !== 'brick') continue;
    for (const b of layer.bricks) {
      for (const c of b.connexions) owner.set(c.id, b);
      if (b.myGroup) {
        const top = topGroup(layer, b.myGroup);
        if (!topGroups.some((t) => t.layer === layer && t.top === top)) topGroups.push({ layer, top });
      }
      const meta = lib.meta(b.partNumber);
      if (!meta?.fourDBrix) continue;
      const p = { brick: b, meta };
      ({ segment: tracks, table: tables, baseplate: baseplates, structure: structures })[meta.fourDBrix.type].push(p);
    }
  }

  // One node per junction: a linked connection shares its partner's node.
  const nodeOf = new Map<string, number>();
  let nodes = 0;
  for (const { brick: b, meta } of tracks) {
    for (let i = 0; i < b.connexions.length && i < meta.connections.length; i++) {
      const cp = b.connexions[i]!;
      const shared = cp.linkedTo ? nodeOf.get(cp.linkedTo) : undefined;
      if (shared !== undefined) {
        nodeOf.set(cp.id, shared);
        continue;
      }
      nodeOf.set(cp.id, nodes++);
      const world = lib.connectionWorld(b, i);
      const other = cp.linkedTo ? owner.get(cp.linkedTo) : undefined;
      line('   <node>');
      line(`      <coordinates x="${fmt(f(f(world.x) * 8))}" y="${fmt(f(f(world.y) * 8))}" z="${fmt(f(f(b.altitude) * f(0.4)))}"/>`);
      line(`      <segments a="${b.id}" b="${other ? other.id : 'None'}"/>`);
      line('      <anchor value="no"/>');
      line(`      <type value="${nodeTypeName(meta.connections[i]!.type)}"/>`);
      line('   </node>');
    }
  }
  for (const { brick: b, meta } of tracks) {
    const fd = meta.fourDBrix!;
    line('   <segment>');
    line(`      <index value="${b.id}"/>`);
    line(`      <type value="${fd.partName}"/>`);
    line('      <label value=""/>');
    const count = Math.min(b.connexions.length, meta.connections.length);
    const hasConnection = meta.connections.some((c) => c.type !== '');
    if (hasConnection && count > 0) {
      line(`      <nodes value="${count}"/>`);
      const origin = Math.min(Math.max(fd.originConnection, 0), count - 1);
      let local = 1;
      let i = origin;
      do {
        line(`      <node${local++} value="${nodeOf.get(b.connexions[i]!.id) ?? 0}"/>`);
        if (++i === count) i = 0;
      } while (i !== origin);
    }
    line(`      <angle value="${fmt(f(b.orientation + fd.orientationDifference))}"/>`);
    line('      <origin value="0"/>');
    line('      <slope value="0"/>');
    line('   </segment>');
  }

  const genericParts = (parts: Part[], tagName: string, coordInCentre: boolean) => {
    const coordTag = coordInCentre ? 'center' : 'coordinates';
    for (const { brick: b, meta } of parts) {
      const fd = meta.fourDBrix!;
      // BlueBrick turns the brick by the difference (keeping its
      // displayArea's corner) and reads the position from that.
      const orientation = f(b.orientation + fd.orientationDifference);
      const fp = lib.footprint(b.partNumber, orientation);
      const w = fp ? fp.size.w : b.displayArea.width;
      const h = fp ? fp.size.h : b.displayArea.height;
      const pos = coordInCentre
        ? { x: b.displayArea.x + w / 2, y: b.displayArea.y + h / 2 }
        : { x: b.displayArea.x + (fp?.imageCorner.x ?? 0), y: b.displayArea.y + (fp?.imageCorner.y ?? 0) };
      line(`   <${tagName}>`);
      line(`      <${coordTag} x ="${fmt(f(f(pos.x) * 8))}" y="${fmt(f(f(pos.y) * 8))}"/>`);
      line(`      <angle value="${fmt(orientation)}"/>`);
      line(`      <svgfile value="${fd.partName}"/>`);
      if (tagName !== 'table') {
        const s = meta.spriteSize ?? { w: 0, h: 0 };
        line(`      <size height="${s.h}" width="${s.w}"/>`);
      }
      line(`   </${tagName}>`);
    }
  };
  genericParts(tables, 'table', false);
  genericParts(baseplates, 'baseplate', false);
  genericParts(structures, 'structure', true);

  for (const { layer, top } of topGroups) {
    const ids: string[] = [];
    const box = { r: null as Rect | null };
    leaves(layer, top, ids, box, 0);
    const r = box.r ?? { x: 0, y: 0, width: 0, height: 0 };
    line('   <group>');
    line(`      <segments list="${ids.join(',')}"/>`);
    line(`      <boundingbox x="${fmt(f(f(r.x) * 8))}" y="${fmt(f(f(r.y) * 8))}" w="${fmt(f(f(r.width) * 8))}" h="${fmt(f(f(r.height) * 8))}"/>`);
    line('   </group>');
  }
  line('</data>');
  return lines.map((l) => `${l}\r\n`).join('');
}

function topGroup(layer: LayerBrick, id: string): string {
  for (let depth = 0; depth < 64; depth++) {
    const g = layer.groups.find((x) => x.id === id);
    if (!g?.myGroup) break;
    id = g.myGroup;
  }
  return id;
}

// Group.getAllLeafItems(): a group's own bricks (in layer order) come
// before its sub-groups (in <Groups> order), as BlueBrick loads them.
function leaves(layer: LayerBrick, id: string, ids: string[], box: { r: Rect | null }, depth: number): void {
  if (depth > 64) return;
  for (const b of layer.bricks) {
    if (b.myGroup !== id) continue;
    ids.push(b.id);
    box.r = unite(box.r, b.displayArea);
  }
  for (const g of layer.groups) if (g.myGroup === id && g.id !== id) leaves(layer, g.id, ids, box, depth + 1);
}

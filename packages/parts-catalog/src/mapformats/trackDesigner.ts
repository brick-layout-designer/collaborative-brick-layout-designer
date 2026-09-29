// TrackDesigner (.tdl, file version 20) maps — port of desktop
// import/mapformats/TrackDesignerMap.cpp (from BlueBrick's
// SaveLoadManager). Each TD piece maps to a BlueBrickParts part through
// the part's <TrackDesigner> remap (TD id, per-port connection and angle).
// On load, bricks go to "Baseplate", "Rail" and "Monorail" layers by their
// connection type; TD ids without a remap are listed in the warnings.
//
// BlueBrick picks TD part ids for the TrackDesigner "registry" configured
// in Windows; here it is always the default registry. Connection polarity
// is written as "unassigned", and the TD options (short cuts, underground,
// steps, slope mismatch) as off.

import type { BbmMap, Brick } from '@cld/model';
import { rebuildConnectivity } from '../connectivity.js';
import type { PartMetadata } from '../types.js';
import { MapLibrary, newBrickLayer, newMap, partNumberOf, rotated, type MapReadResult } from './library.js';

const f = Math.fround;
const FILE_VERSION = 20;
const MONORAIL_UP_RAMP = 232677;
const MONORAIL_DOWN_RAMP = 232678; // not a TD part: the up ramp's second geometry

/** Little-endian reader mirroring .NET's BinaryReader (ReadChar decodes UTF-8). */
class Reader {
  private pos = 0;
  ok = true;
  private readonly view: DataView;
  constructor(private readonly d: Uint8Array) {
    this.view = new DataView(d.buffer, d.byteOffset, d.byteLength);
  }
  get atEnd() {
    return this.pos >= this.d.length;
  }
  get remaining() {
    return this.d.length - this.pos;
  }
  private need(n: number): boolean {
    if (this.pos + n > this.d.length) this.ok = false;
    return this.ok;
  }
  skip(n: number) {
    if (this.need(n)) this.pos += n;
  }
  i16(): number {
    if (!this.need(2)) return 0;
    const v = this.view.getInt16(this.pos, true);
    this.pos += 2;
    return v;
  }
  i32(): number {
    if (!this.need(4)) return 0;
    const v = this.view.getInt32(this.pos, true);
    this.pos += 4;
    return v;
  }
  f64(): number {
    if (!this.need(8)) return 0;
    const v = this.view.getFloat64(this.pos, true);
    this.pos += 8;
    return v;
  }
  /** One UTF-8 character, as BinaryReader.ReadChar. */
  char(): number {
    if (!this.need(1)) return 0;
    const lead = this.d[this.pos]!;
    const len = lead < 0x80 ? 1 : lead >> 5 === 0x6 ? 2 : lead >> 4 === 0xe ? 3 : lead >> 3 === 0x1e ? 4 : 1;
    if (!this.need(len)) return 0;
    const s = new TextDecoder().decode(this.d.subarray(this.pos, this.pos + len));
    this.pos += len;
    return s.length ? s.charCodeAt(0) : 0;
  }
  chars(count: number): string {
    let out = '';
    for (let i = 0; i < count && this.ok; i++) out += String.fromCharCode(this.char());
    return out;
  }
}

class Writer {
  private chunks: number[] = [];
  private readonly scratch = new DataView(new ArrayBuffer(8));
  private push(n: number) {
    for (let i = 0; i < n; i++) this.chunks.push(this.scratch.getUint8(i));
  }
  i16(v: number) {
    this.scratch.setInt16(0, v, true);
    this.push(2);
  }
  u16(v: number) {
    this.scratch.setUint16(0, v, true);
    this.push(2);
  }
  i32(v: number) {
    this.scratch.setInt32(0, v, true);
    this.push(4);
  }
  f64(v: number) {
    this.scratch.setFloat64(0, v, true);
    this.push(8);
  }
  /** .NET BinaryWriter.Write(char[]) / Write(char): UTF-8. */
  chars(s: string) {
    for (const b of new TextEncoder().encode(s)) this.chunks.push(b);
  }
  char(c: number) {
    this.chars(String.fromCharCode(c));
  }
  get size() {
    return this.chunks.length;
  }
  bytes(): Uint8Array {
    return Uint8Array.from(this.chunks);
  }
}

/**
 * The part for a TD id — desktop PartsLibrary::partForTrackDesignerId:
 * the last part with it as its default id, else the last with it for a
 * registry. The desktop's "last" follows its directory scan; here it is
 * the last by key, so the choice doesn't depend on the filesystem (e.g.
 * 3867.7 and 3867.25 share an id).
 */
export function partForTrackDesignerId(lib: MapLibrary, id: number): PartMetadata | undefined {
  let fallback: PartMetadata | undefined;
  let other: PartMetadata | undefined;
  for (const meta of lib.partsForTrackDesignerId(id)) {
    if (meta.trackDesigner!.defaultId === id) fallback = meta;
    else other = meta;
  }
  return fallback ?? other;
}

const connectionAngle = (meta: PartMetadata, index: number) => f(meta.connections[index]?.angle ?? 0);

// BrickLibrary.getConnectionAngleDifference / AddConnectBrick orientation.
function connectedOrientation(fixed: Brick, fixedMeta: PartMetadata, attachMeta: PartMetadata, attachIndex: number): number {
  let diff = f(f(connectionAngle(fixedMeta, fixed.activeConnectionPointIndex) + 180) - connectionAngle(attachMeta, attachIndex));
  if (diff >= 360) diff = f(diff - 360);
  if (diff < 0) diff = f(diff + 360);
  let o = f(fixed.orientation + diff);
  if (o >= 360) o = f(o - 360);
  if (o < 0) o = f(o + 360);
  return o;
}

export function readTrackDesignerMap(data: Uint8Array, lib: MapLibrary): MapReadResult {
  const r = new Reader(data);
  const map = newMap();

  // ---- header
  r.skip(8); // origin
  r.i32(); // piece count
  if (r.i32() !== FILE_VERSION) throw new Error(`Only TrackDesigner files of version ${FILE_VERSION} can be read.`);
  r.skip(16); // bounds
  r.skip(32); // cursor x, y, z, angle
  r.skip(16); // selected port, part, document size
  r.chars(r.char()); // old empty CString
  r.skip(5 * 4); // short cuts, slope, underground, steps, slope mismatch
  map.event = r.chars(r.char());
  map.comment = r.chars(r.char());
  const pieceList = r.i16();
  if (pieceList > 0) r.skip(12 + pieceList * 40);
  r.i16(); // CTrackPiece count
  r.skip(17); // CTrackPiece list header
  if (!r.ok) throw new Error('Truncated TrackDesigner file.');

  // ---- pieces
  const baseplate: Brick[] = [];
  const rail: Brick[] = [];
  const monorail: Brick[] = [];
  const unmapped: number[] = [];
  let end = r.atEnd;
  while (!end) {
    let tdId = r.i32();
    r.i32(); // instance pointer
    const angle = r.f64();
    const x = r.f64();
    const y = r.f64();
    r.f64(); // z
    r.i32(); // piece type
    const port = r.i32();
    // 4 x (instance, port, polarity), flags, slope, and the next piece's
    // separator word; the last piece has no separator.
    if (r.remaining >= 58) r.skip(58);
    else end = true;
    if (!r.ok) break;

    if (tdId === MONORAIL_UP_RAMP && port === 1) tdId = MONORAIL_DOWN_RAMP;
    const meta = partForTrackDesignerId(lib, tdId);
    if (!meta) {
      if (!unmapped.includes(tdId)) unmapped.push(tdId);
      continue;
    }

    const b = lib.newBrick(meta);
    let layer = baseplate;
    if (meta.connections.length > 0) {
      // BlueBrick numbers connection types by their order in its
      // ConnectionTypeList.xml ("1" = 1, "narrow" = 2, "2" = 3,
      // "mono" = 4) and files types 1 as rail, 3 and 4 as monorail.
      const type = meta.connections[0]!.type;
      if (type === '1') layer = rail;
      else if (type === '2' || type === 'mono') layer = monorail;
    }

    let diff = 0;
    const ports = meta.trackDesigner!.ports;
    if (port >= 0 && port < ports.length) {
      b.activeConnectionPointIndex = ports[port]!.bbConnectionIndex;
      diff = ports[port]!.angleDifference;
    }
    b.orientation = f(f(angle) + diff);
    if (meta.connections.length > 0) {
      // Parts with connections are positioned by their active one.
      lib.placeByConnection(b, b.activeConnectionPointIndex, { x, y });
    } else {
      // Otherwise TD's origin is the middle of the part's left edge.
      const fpTd = lib.footprint(b.partNumber, diff);
      const width = fpTd ? fpTd.size.w : 2;
      const toCentre = rotated({ x: width / 2, y: 0 }, angle);
      const fp = lib.footprint(b.partNumber, b.orientation);
      const size = fp ? fp.size : { w: 2, h: 2 };
      const c = { x: x + toCentre.x, y: y + toCentre.y };
      b.displayArea = { x: c.x - size.w / 2, y: c.y - size.h / 2, width: size.w, height: size.h };
    }

    // TD's monorail ramp is one piece; BlueBrick has an up and a down half.
    if (tdId === MONORAIL_UP_RAMP || tdId === MONORAIL_DOWN_RAMP) {
      const up = tdId === MONORAIL_UP_RAMP;
      const rampMeta = lib.meta(up ? '2678.7' : '2677.7');
      b.activeConnectionPointIndex = up ? 1 : 0;
      if (rampMeta) {
        const ramp = lib.newBrick(rampMeta);
        ramp.activeConnectionPointIndex = up ? 0 : 1;
        ramp.orientation = connectedOrientation(b, meta, rampMeta, ramp.activeConnectionPointIndex);
        lib.placeByConnection(ramp, ramp.activeConnectionPointIndex, lib.connectionWorld(b, b.activeConnectionPointIndex));
        layer.push(b, ramp);
        continue;
      }
    }
    layer.push(b);
  }

  for (const [bricks, name] of [
    [baseplate, 'Baseplate'],
    [rail, 'Rail'],
    [monorail, 'Monorail'],
  ] as const) {
    if (bricks.length) map.layers.push(newBrickLayer(name, bricks));
  }
  rebuildConnectivity(map, lib.catalog);
  const warnings = unmapped.length ? [`No part is mapped to these TrackDesigner ids: ${unmapped.join(', ')}`] : [];
  return { map, warnings };
}

type Rect = { x: number; y: number; width: number; height: number };

/** std::round: halves away from zero. */
const roundAway = (v: number) => Math.sign(v) * Math.round(Math.abs(v));

export function writeTrackDesignerMap(map: BbmMap, lib: MapLibrary): Uint8Array {
  // Instance ids (BlueBrick uses object hash codes) and connection owners.
  const instance = new Map<Brick, number>();
  const owner = new Map<string, { brick: Brick; index: number }>();
  let nbItems = 0;
  let bounds: Rect | null = null;
  let left = Number.MAX_VALUE;
  let top = Number.MAX_VALUE;
  for (const layer of map.layers) {
    if (layer.type !== 'brick') continue;
    for (const b of layer.bricks) {
      instance.set(b, ++nbItems);
      b.connexions.forEach((c, index) => owner.set(c.id, { brick: b, index }));
      const a = b.displayArea;
      if (layer.visible && !(a.width === 0 && a.height === 0)) {
        if (!bounds) bounds = { ...a };
        else {
          const x = Math.min(bounds.x, a.x);
          const y = Math.min(bounds.y, a.y);
          bounds = { x, y, width: Math.max(bounds.x + bounds.width, a.x + a.width) - x, height: Math.max(bounds.y + bounds.height, a.y + a.height) - y };
        }
      }
      left = Math.min(left, a.x);
      top = Math.min(top, a.y);
    }
  }
  if (nbItems === 0) left = top = 0;
  const bb = bounds ?? { x: 0, y: 0, width: 0, height: 0 };

  const w = new Writer();
  // ---- header
  const margin = 5;
  // Clamped so bricks at absurd (or NaN) positions from a damaged file
  // can't overflow the header's 32-bit fields.
  const studs = (v: number) => (!(v > -1e8) ? -100000000 : !(v < 1e8) ? 100000000 : roundAway(v));
  const bx = studs(bb.x) - margin;
  const by = studs(bb.y) - margin;
  const bw = studs(bb.width) + margin * 2;
  const bh = studs(bb.height) + margin * 2;
  w.i32(-bx);
  w.i32(-by);
  w.i32(nbItems);
  w.i32(FILE_VERSION);
  w.i32(bx);
  w.i32(by);
  w.i32(bx + bw);
  w.i32(by + bh);
  w.f64(left); // cursor: BlueBrick uses the selection, or the top-left brick
  w.f64(top);
  w.f64(0);
  w.f64(0);
  w.i32(0); // selected port
  w.i32(0); // selected part
  w.i32(bw);
  w.i32(bh);
  w.char(0); // old empty CString
  for (let i = 0; i < 5; i++) w.i32(0); // short cuts, slope, underground, steps, slope mismatch
  // Strings are length-prefixed by one character; TrackDesigner reads that
  // as a byte, so keep them under 128 characters.
  const shortString = (s: string) => {
    const t = s.slice(0, 127);
    w.char(t.length);
    w.chars(t);
  };
  shortString(map.event);
  shortString(map.comment);
  w.i16(0); // piece list
  const countPos = w.size;
  w.i16(nbItems);

  let written = 0;
  if (nbItems > 0) {
    w.i32(0x14ffff);
    w.i16(0x0b);
    w.chars('CTrackPiece');
    for (const layer of map.layers) {
      if (layer.type !== 'brick') continue;
      for (const b of layer.bricks) {
        const meta = lib.meta(b.partNumber);
        const td = meta?.trackDesigner;
        if (!meta || !td) continue;
        if (td.defaultId === MONORAIL_DOWN_RAMP) continue; // merged into the up ramp in TD
        if (written > 0) w.u16(0x8001);
        w.i32(td.defaultId);
        w.i32(instance.get(b) ?? 0);

        const connectionIndex = td.hasSeveralPorts ? b.activeConnectionPointIndex : 0;
        let port = -1;
        let type = 0;
        let diff = 0;
        for (const p of td.ports) {
          port++;
          if (p.bbConnectionIndex === connectionIndex) {
            type = p.type;
            diff = p.angleDifference;
            break;
          }
        }
        let orientation = f(b.orientation - diff);
        let position: { x: number; y: number };
        if (meta.connections.length > 0 && connectionIndex < meta.connections.length) {
          position = lib.connectionWorld(b, connectionIndex);
        } else {
          const a = b.displayArea;
          const fpTd = lib.footprint(b.partNumber, diff);
          const width = fpTd ? fpTd.size.w : a.width;
          const r = rotated({ x: width / 2, y: 0 }, orientation);
          position = { x: a.x + a.width / 2 - r.x, y: a.y + a.height / 2 - r.y };
        }
        orientation %= 360; // [0, 360); no loop on absurd angles
        if (orientation < 0) orientation += 360;
        w.f64(orientation);
        w.f64(position.x);
        w.f64(position.y);
        w.f64(b.altitude);
        w.i32(type);
        w.i32(port);

        for (let i = 0; i < 4; i++) {
          let otherInstance = 0;
          let otherPort = 0;
          if (i < td.ports.length) {
            const bbIndex = td.ports[i]!.bbConnectionIndex;
            let linked = bbIndex < b.connexions.length ? owner.get(b.connexions[bbIndex]!.linkedTo) : undefined;
            // The down ramp doesn't exist in TD: step through it.
            // Bounded: damaged links can form a ring of down ramps.
            for (let hop = 0; linked && linked.brick.partNumber.startsWith('2678.'); hop++) {
              if (hop > nbItems) {
                linked = undefined;
                break;
              }
              const next = linked.index === 0 ? 1 : 0;
              const c = linked.brick.connexions[next];
              linked = c ? owner.get(c.linkedTo) : undefined;
            }
            if (linked) {
              otherInstance = instance.get(linked.brick) ?? 0;
              const otherPorts = lib.meta(linked.brick.partNumber)?.trackDesigner?.ports ?? [];
              const j = otherPorts.findIndex((p) => p.bbConnectionIndex === linked!.index);
              if (j >= 0) otherPort = j;
            }
          }
          w.i32(otherInstance);
          w.i32(otherPort);
          w.i32(0); // polarity: unassigned
        }
        w.i32(td.flags);
        w.i32(0); // slope
        written++;
      }
    }
  }
  const bytes = w.bytes();
  if (written < nbItems) {
    // Pieces without a TrackDesigner remap were skipped.
    const view = new DataView(bytes.buffer);
    view.setInt32(8, written, true);
    view.setInt16(countPos, written, true);
  }
  return bytes;
}

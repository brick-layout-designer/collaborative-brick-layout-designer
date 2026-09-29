// Electric-circuit geometry — pure port of SceneBuilderElectric.cpp, drawn
// by ElectricCircuitLayer.
//
//   - A part's circuits join two of its connection points whose electric
//     plugs are opposite (+1 / -1, +2 / -2); 0 means no plug
//     (PartsLibrary.cpp buildElectricCircuits).
//   - Polarity is propagated across linked bricks by the BlueBrick BFS
//     stamp walk (SceneBuilderElectric.cpp:99-205). `linkedTo` names the
//     partner's *connection*, so the walk maps connection ids to
//     (brick, index) to enter the partner at the right end.
//   - Every circuit draws a red rail on its +plug side and a cyan rail on
//     its -plug side; a connection whose two sides end up with the same
//     polarity gets a short-circuit diamond.

import type { BbmMap, Brick } from '@cld/model';
import type { PartWire } from '../../api';
import { pivotOf } from '../brickGeometry';

const PX = 8; // studs → pixels (standard pxPerStud)
const HALF_OFFSET = 2; // world-px perpendicular offset per rail (matches desktop)

export const K_RED = 'rgba(255,69,0,0.85)'; // OrangeRed
export const K_BLUE = 'rgba(0,255,255,0.85)'; // Cyan

export interface Circuit {
  index1: number;
  index2: number;
}

/** Circuits of a part: pairs of connections with opposite, non-zero plugs. */
export function deriveCircuits(connections: PartWire['connections']): Circuit[] {
  const out: Circuit[] = [];
  for (let i = 0; i < connections.length - 1; i++) {
    const plug = connections[i]!.electricPlug;
    if (!plug) continue;
    for (let j = i + 1; j < connections.length; j++) {
      if (connections[j]!.electricPlug === -plug) out.push({ index1: i, index2: j });
    }
  }
  return out;
}

interface BrickEntry {
  brick: Brick;
  part: PartWire;
  connections: PartWire['connections'];
  circuits: Circuit[];
  // polarity[i]: 0 = unvisited, ±stamp = visited in the current walk
  polarity: number[];
  shortcut: boolean[];
}

/** World-pixel position of a connection point on a placed brick. */
function connWorldPx(brick: Brick, part: PartWire, cx: number, cy: number): { x: number; y: number } {
  const r = (brick.orientation * Math.PI) / 180;
  const cos = Math.cos(r);
  const sin = Math.sin(r);
  // Connection points hang off the sprite centre (BlueBrick's pivot).
  const { x: centreX, y: centreY } = pivotOf(brick, part);
  return {
    x: (centreX + cx * cos - cy * sin) * PX,
    y: (centreY + cx * sin + cy * cos) * PX,
  };
}

export interface ElectricOverlay {
  lines: { x1: number; y1: number; x2: number; y2: number; color: string }[];
  diamonds: { x: number; y: number }[];
}

export function electricOverlay(map: BbmMap, partsByKey: Map<string, PartWire>): ElectricOverlay {
  // 1. Bricks with at least one circuit.
  const entries = new Map<string, BrickEntry>();
  for (const layer of map.layers) {
    if (layer.type !== 'brick') continue;
    for (const brick of layer.bricks) {
      const part = partsByKey.get(brick.partNumber.toLowerCase());
      if (!part) continue;
      const circuits = deriveCircuits(part.connections);
      if (circuits.length === 0) continue;
      entries.set(brick.id, {
        brick,
        part,
        connections: part.connections,
        circuits,
        polarity: new Array<number>(part.connections.length).fill(0),
        shortcut: new Array<boolean>(part.connections.length).fill(false),
      });
    }
  }
  if (entries.size === 0) return { lines: [], diamonds: [] };

  // Connection id → the brick and index that own it.
  const connOwner = new Map<string, { brickId: string; index: number }>();
  for (const [brickId, e] of entries) {
    e.brick.connexions.forEach((c, index) => {
      if (c.id) connOwner.set(c.id, { brickId, index });
    });
  }
  const partnerOf = (e: BrickEntry, idx: number): { entry: BrickEntry; brickId: string; index: number } | null => {
    const linked = e.brick.connexions[idx]?.linkedTo;
    if (!linked) return null;
    const ref = connOwner.get(linked);
    if (!ref) return null;
    const entry = entries.get(ref.brickId)!;
    if (ref.index >= entry.polarity.length) return null;
    return { entry, brickId: ref.brickId, index: ref.index };
  };

  // 2. BFS polarity propagation.
  let stamp = 1;
  const propagate = (startId: string) => {
    const startEntry = entries.get(startId)!;
    stamp = stamp + 1 >= 0x7fff ? 1 : stamp + 1;

    const toExplore: string[] = [startId];
    const seed = startEntry.circuits[0]!.index1;
    startEntry.polarity[seed] = stamp;
    const p0 = partnerOf(startEntry, seed);
    if (p0) {
      p0.entry.polarity[p0.index] = -stamp;
      toExplore.push(p0.brickId);
    }

    while (toExplore.length > 0) {
      const guid = toExplore.shift()!;
      const entry = entries.get(guid)!;
      let needReexplore = false;

      for (const circuit of entry.circuits) {
        let startIdx = circuit.index1;
        let endIdx = circuit.index2;
        // Make start the end that carries the incoming electricity.
        if (Math.abs(entry.polarity[endIdx]!) === stamp) [startIdx, endIdx] = [endIdx, startIdx];

        if (Math.abs(entry.polarity[startIdx]!) !== stamp) {
          needReexplore = true;
          continue;
        }
        const startPol = entry.polarity[startIdx]!;
        if (entry.polarity[endIdx] === startPol) {
          entry.shortcut[startIdx] = true;
          continue;
        }
        if (entry.polarity[endIdx] !== -startPol) {
          const endPol = -startPol;
          entry.polarity[endIdx] = endPol;
          if (needReexplore) {
            toExplore.unshift(guid);
            needReexplore = false;
          }
          const p = partnerOf(entry, endIdx);
          if (p) {
            if (p.entry.polarity[p.index] === endPol) {
              entry.shortcut[endIdx] = true;
            } else if (p.entry.polarity[p.index] !== -endPol) {
              p.entry.polarity[p.index] = -endPol;
              toExplore.push(p.brickId);
            }
          }
        }
      }
    }
  };

  for (const [id, e] of entries) {
    if (Math.abs(e.polarity[e.circuits[0]!.index1]!) !== stamp) propagate(id);
  }

  // 3. Rails and short-circuit diamonds.
  const lines: ElectricOverlay['lines'] = [];
  const diamonds: ElectricOverlay['diamonds'] = [];
  for (const e of entries.values()) {
    for (const { index1, index2 } of e.circuits) {
      const posIdx = e.connections[index1]!.electricPlug > 0 ? index1 : index2;
      const negIdx = posIdx === index1 ? index2 : index1;
      const pPos = connWorldPx(e.brick, e.part, e.connections[posIdx]!.x, e.connections[posIdx]!.y);
      const pNeg = connWorldPx(e.brick, e.part, e.connections[negIdx]!.x, e.connections[negIdx]!.y);
      const dx = pNeg.x - pPos.x;
      const dy = pNeg.y - pPos.y;
      const len = Math.hypot(dx, dy);
      if (len < 0.5) continue;
      const normX = (-dy / len) * HALF_OFFSET;
      const normY = (dx / len) * HALF_OFFSET;
      lines.push({ x1: pPos.x + normX, y1: pPos.y + normY, x2: pNeg.x + normX, y2: pNeg.y + normY, color: K_RED });
      lines.push({ x1: pPos.x - normX, y1: pPos.y - normY, x2: pNeg.x - normX, y2: pNeg.y - normY, color: K_BLUE });
    }
    for (const { index1, index2 } of e.circuits) {
      for (const idx of [index1, index2]) {
        if (!e.shortcut[idx]) continue;
        const c = e.connections[idx]!;
        diamonds.push(connWorldPx(e.brick, e.part, c.x, c.y));
      }
    }
  }
  return { lines, diamonds };
}

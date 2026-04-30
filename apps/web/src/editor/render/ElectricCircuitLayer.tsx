// Electric-circuit overlay — port of SceneBuilderElectric.cpp.
//
// Visual model (matches desktop / BlueBrick):
//   - Each part with two connection points where electricPlug != -1 defines
//     an in-part "circuit". Pairs are matched by absolute electricPlug value:
//     index of +N is paired with index of -N on the same part.
//   - Within a part, the +1 plug draws an OrangeRed line and the -1 plug
//     draws a Cyan line, each offset 2 world-px perpendicular to the
//     circuit centreline (matching desktop's ELECTRIC_WIDTH / halfOffset).
//   - Polarity is propagated across connected bricks via BFS so the
//     red/cyan assignment stays consistent across an entire wired track run.
//   - Short circuits (same polarity on both ends after BFS) get an orange
//     diamond marker at the offending connection point.
//   - Lines use strokeScaleEnabled={false} (cosmetic pen, desktop-equivalent).
//
// Port notes:
//   - connWorldPx(): connection points in catalog are in LOCAL part coords
//     (studs, relative to part centre). We rotate by brick.orientation, add
//     brick.displayArea.center, then multiply by pxPerStud.
//   - electricCircuits[] is not stored explicitly in the web catalog; we
//     derive the pairs at render time by grouping connections by
//     abs(electricPlug) value.
//   - The BFS stamp approach is ported 1-to-1 from SceneBuilderElectric.cpp
//     lines 99-192.

import { useMemo } from 'react';
import { Group, Line, RegularPolygon } from 'react-konva';
import type { BbmMap, Brick } from '@cld/model';
import type { PartWire } from '../../api';

const PX = 8; // studs → pixels (standard pxPerStud)
const HALF_OFFSET = 2; // world-px perpendicular offset per rail (matches desktop)
const STROKE_W = 3; // screen px, cosmetic
const SHORTCUT_R = 8; // diamond half-size in screen px

const K_RED = 'rgba(255,69,0,0.85)';   // OrangeRed
const K_BLUE = 'rgba(0,255,255,0.85)'; // Cyan
const K_SHORT = 'rgba(255,165,0,0.9)'; // Orange

interface Circuit {
  posIdx: number; // connection index with electricPlug > 0
  negIdx: number; // connection index with electricPlug < 0
}

/** Derive (posIdx, negIdx) circuit pairs from a list of connections. */
function deriveCircuits(connections: PartWire['connections']): Circuit[] {
  // Group indices by abs(electricPlug). plug=-1 means "no plug".
  const byPlug = new Map<number, { posIdx: number | null; negIdx: number | null }>();
  connections.forEach((c, i) => {
    if (c.electricPlug < 0) return;
    const key = c.electricPlug;
    const entry = byPlug.get(key) ?? { posIdx: null, negIdx: null };
    // electricPlug > 0 is positive rail; = 0 is treated as positive
    // (matches desktop convention where plug=0 and plug=1 are distinct values
    // paired by the XML author into circuits). We use the sign convention:
    // the desktop stores +1 / -1; a value of 0 in the XML is also valid but
    // rare. Treat 0 as positive rail for pairing purposes.
    if (c.electricPlug >= 0) {
      if (entry.posIdx === null) entry.posIdx = i;
      else if (entry.negIdx === null) entry.negIdx = i;
    }
    byPlug.set(key, entry);
  });

  const circuits: Circuit[] = [];
  for (const [, e] of byPlug) {
    if (e.posIdx !== null && e.negIdx !== null) {
      circuits.push({ posIdx: e.posIdx, negIdx: e.negIdx });
    }
  }
  return circuits;
}

/** World-pixel position of a connection point on a placed brick. */
function connWorldPx(
  brick: Brick,
  cx: number,
  cy: number,
): { x: number; y: number } {
  const r = (brick.orientation * Math.PI) / 180;
  const cos = Math.cos(r);
  const sin = Math.sin(r);
  const centreX = (brick.displayArea.x + brick.displayArea.width / 2);
  const centreY = (brick.displayArea.y + brick.displayArea.height / 2);
  return {
    x: (centreX + cx * cos - cy * sin) * PX,
    y: (centreY + cx * sin + cy * cos) * PX,
  };
}

interface BrickEntry {
  brick: Brick;
  connections: PartWire['connections'];
  circuits: Circuit[];
  // polarity[i]: 0=unvisited, +stamp=positive, -stamp=negative
  polarity: number[];
  shortcut: boolean[];
}

interface Props {
  map: BbmMap;
  partsByKey: Map<string, PartWire>;
}

export function ElectricCircuitLayer({ map, partsByKey }: Props) {
  const segments = useMemo(() => {
    // ----------------------------------------------------------------
    // 1. Collect bricks that have at least one electric circuit.
    // ----------------------------------------------------------------
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
          connections: part.connections,
          circuits,
          polarity: new Array<number>(part.connections.length).fill(0),
          shortcut: new Array<boolean>(part.connections.length).fill(false),
        });
      }
    }
    if (entries.size === 0) return { lines: [], diamonds: [] };

    // ----------------------------------------------------------------
    // 2. BFS polarity propagation (port of SceneBuilderElectric.cpp:99-192).
    // ----------------------------------------------------------------
    // Build connexion lookup: brickId → connexions array from the Yjs doc.
    const connexionsById = new Map<string, Brick['connexions']>();
    for (const layer of map.layers) {
      if (layer.type !== 'brick') continue;
      for (const b of layer.bricks) connexionsById.set(b.id, b.connexions);
    }

    let stamp: number = 0;

    const propagate = (startId: string) => {
      const startEntry = entries.get(startId);
      if (!startEntry) return;
      stamp = (stamp + 1) & 0x7fff || 1;

      const toExplore: string[] = [startId];
      const seed1 = startEntry.circuits[0]!.posIdx;
      startEntry.polarity[seed1] = stamp;

      // Seed partner if already linked.
      const partnerConn = startEntry.brick.connexions[seed1];
      if (partnerConn?.linkedTo && entries.has(partnerConn.linkedTo)) {
        const pEntry = entries.get(partnerConn.linkedTo)!;
        pEntry.polarity[seed1] = -stamp;
        toExplore.push(partnerConn.linkedTo);
      }

      while (toExplore.length > 0) {
        const guid = toExplore.shift()!;
        const entry = entries.get(guid)!;
        let needReexplore = false;

        for (const circuit of entry.circuits) {
          const i1 = circuit.posIdx;
          const i2 = circuit.negIdx;
          let startIdx = i1, endIdx = i2;

          // Ensure start carries the incoming electricity.
          if (Math.abs(entry.polarity[i2] ?? 0) === stamp) {
            [startIdx, endIdx] = [i2, i1];
          }

          if (Math.abs(entry.polarity[startIdx] ?? 0) !== stamp) {
            needReexplore = true;
            continue;
          }

          const startPol = entry.polarity[startIdx] ?? 0;
          // Short circuit: end already same polarity.
          if ((entry.polarity[endIdx] ?? 0) === startPol) {
            entry.shortcut[startIdx] = true;
            continue;
          }

          if ((entry.polarity[endIdx] ?? 0) !== -startPol) {
            entry.polarity[endIdx] = -startPol;
            if (needReexplore) { toExplore.unshift(guid); needReexplore = false; }

            // Propagate to linked neighbor.
            const neighborConn = entry.brick.connexions[endIdx];
            if (neighborConn?.linkedTo && entries.has(neighborConn.linkedTo)) {
              const nEntry = entries.get(neighborConn.linkedTo)!;
              if ((nEntry.polarity[endIdx] ?? 0) === -startPol) {
                entry.shortcut[endIdx] = true;
              } else if ((nEntry.polarity[endIdx] ?? 0) !== startPol) {
                nEntry.polarity[endIdx] = startPol;
                toExplore.push(neighborConn.linkedTo);
              }
            }
          }
        }
      }
    };

    for (const [id, e] of entries) {
      if (e.circuits.length > 0) {
        const i0 = e.circuits[0]!.posIdx;
        if (Math.abs(e.polarity[i0] ?? 0) !== stamp) propagate(id);
      }
    }

    // ----------------------------------------------------------------
    // 3. Collect line segments and shortcut diamonds.
    // ----------------------------------------------------------------
    const lines: { x1: number; y1: number; x2: number; y2: number; color: string }[] = [];
    const diamonds: { x: number; y: number }[] = [];

    for (const [, e] of entries) {
      for (const circuit of e.circuits) {
        const { posIdx, negIdx } = circuit;
        const cPos = e.connections[posIdx]!;
        const cNeg = e.connections[negIdx]!;
        const pPos = connWorldPx(e.brick, cPos.x, cPos.y);
        const pNeg = connWorldPx(e.brick, cNeg.x, cNeg.y);

        const dx = pNeg.x - pPos.x;
        const dy = pNeg.y - pPos.y;
        const len = Math.hypot(dx, dy);
        if (len < 0.5) continue;

        const dirX = dx / len, dirY = dy / len;
        const normX = -dirY * HALF_OFFSET;
        const normY = dirX * HALF_OFFSET;

        // Red line on +1 side.
        lines.push({
          x1: pPos.x + normX, y1: pPos.y + normY,
          x2: pNeg.x + normX, y2: pNeg.y + normY,
          color: K_RED,
        });
        // Cyan line on -1 side.
        lines.push({
          x1: pPos.x - normX, y1: pPos.y - normY,
          x2: pNeg.x - normX, y2: pNeg.y - normY,
          color: K_BLUE,
        });
      }

      // Shortcut diamonds.
      for (const circuit of e.circuits) {
        for (const idx of [circuit.posIdx, circuit.negIdx]) {
          if (!e.shortcut[idx]) continue;
          const c = e.connections[idx]!;
          const p = connWorldPx(e.brick, c.x, c.y);
          diamonds.push(p);
        }
      }
    }

    return { lines, diamonds };
  }, [map, partsByKey]);

  if (segments.lines.length === 0 && segments.diamonds.length === 0) return null;

  return (
    <Group listening={false}>
      {segments.lines.map((l, i) => (
        <Line
          key={i}
          points={[l.x1, l.y1, l.x2, l.y2]}
          stroke={l.color}
          strokeWidth={STROKE_W}
          strokeScaleEnabled={false}
          listening={false}
          perfectDrawEnabled={false}
        />
      ))}
      {segments.diamonds.map((d, i) => (
        <RegularPolygon
          key={`d-${i}`}
          x={d.x}
          y={d.y}
          sides={4}
          radius={SHORTCUT_R}
          rotation={45}
          stroke={K_SHORT}
          strokeWidth={2}
          strokeScaleEnabled={false}
          fill="transparent"
          listening={false}
          perfectDrawEnabled={false}
        />
      ))}
    </Group>
  );
}

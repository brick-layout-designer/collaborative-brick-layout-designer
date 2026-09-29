// Render `.bbm.cld` sidecar venue (outline edges + obstacles + labels)
// — port of SceneBuilder::addVenue (rendering/SceneBuilderSidecar.cpp:46-193).
//
// Each edge is a polyline with a kind (Wall/Door/Open), drawn with the
// pen the desktop uses:
//   - Wall: solid 7px dark grey
//   - Door: dashed 5px green
//   - Open: dotted 4px blue
// Obstacles render as semi-transparent grey hashed polygons.
//
// Venue model v2 parts (references/VENUE-MODEL.md, "Drawing"; geometry in
// venueDraw.ts, mirrored by the desktop's rendering/VenueDraw.cpp):
// obstacles styled by kind (stairs with treads and a way-up arrow,
// elevators crossed), power points, notes and measurements; estimated
// edges, notes and measurements are drawn faded and marked "(est.)".
//
// This stays a passive overlay until the venue editing tools land
// (drawing, dimensions dialog). The data round-trips through the
// sidecar regardless.

import type { JSX } from 'react';
import { Circle, Group, Line, Text } from 'react-konva';
import type { Venue, VenueDimension, VenueNote, VenueObstacle as VenueObstacleT, VenuePower } from '@cld/bbm';
import { studToPx } from './coords';
import {
  DIMENSION_COLOR,
  dimensionGeometry,
  elevatorCross,
  ESTIMATE_COLOR,
  estimatedText,
  obstacleStyle,
  POWER_COLOR,
  POWER_RADIUS_STUDS,
  powerText,
  stairMarks,
  type Seg,
} from './venueDraw';

interface Props {
  venue: Venue | null | undefined;
  /** Font size for edge distance labels in px. Default 28 (matches desktop). */
  labelFontPx?: number;
  onDoubleClick?: () => void;
}

export function VenueOverlay({ venue, labelFontPx = 28, onDoubleClick }: Props) {
  if (!venue || !venue.enabled) return null;
  const groupProps = onDoubleClick ? { listening: true, onDblClick: onDoubleClick } : { listening: false };
  return (
    <Group {...groupProps}>
      {venue.edges.map((edge, i) => (
        <VenueEdge key={`edge-${i}`} edge={edge} minWalkwayStuds={venue.minWalkwayStuds} labelFontPx={labelFontPx} />
      ))}
      {venue.obstacles.map((ob, i) => (
        <VenueObstacle key={`ob-${i}`} obstacle={ob} />
      ))}
      {(venue.dimensions ?? []).map((d, i) => (
        <VenueDimensionMark key={`dim-${i}`} dimension={d} fontPx={labelFontPx * 0.8} />
      ))}
      {(venue.power ?? []).map((p, i) => (
        <VenuePowerMark key={`pow-${i}`} power={p} fontPx={labelFontPx * 0.6} />
      ))}
      {(venue.notes ?? []).map((n, i) => (
        <VenueNoteMark key={`note-${i}`} note={n} fontPx={labelFontPx * 0.8} />
      ))}
    </Group>
  );
}

function VenueEdge({
  edge,
  minWalkwayStuds,
  labelFontPx,
}: {
  edge: Venue['edges'][number];
  minWalkwayStuds: number;
  labelFontPx: number;
}) {
  if (!edge.poly || edge.poly.length < 2) return null;
  const px = studToPx();
  const flatPoints: number[] = [];
  for (const p of edge.poly) {
    flatPoints.push(p.x * px, p.y * px);
  }

  // Pen per kind — desktop uses cosmetic pens (zoom-invariant width);
  // we use Konva `strokeScaleEnabled={false}` for the same effect.
  let stroke = 'rgb(30,30,30)';
  let strokeWidth = 7;
  let dash: number[] | undefined;
  if (edge.kind === 1 /* Door */) {
    stroke = 'rgb(0,160,0)';
    strokeWidth = 5;
    dash = [12, 8];
  } else if (edge.kind === 2 /* Open */) {
    stroke = 'rgb(0,0,200)';
    strokeWidth = 4;
    dash = [3, 6];
  }

  // Walkway buffer for non-Wall edges — translucent orange band on the
  // INSIDE (left-hand normal) of every segment.
  const showWalk = edge.kind !== 0 && minWalkwayStuds > 0;

  // Distance label on the OUTSIDE midpoint of the polyline (using only
  // first→last point for simplicity, matching desktop behaviour).
  const a = edge.poly[0]!;
  const b = edge.poly[edge.poly.length - 1]!;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenStuds = Math.hypot(dx, dy);
  let labelEl: JSX.Element | null = null;
  if (lenStuds > 0.5) {
    const lenFt = lenStuds * 0.026248; // matches desktop conversion
    const lenIn = lenFt * 12;
    const distance = lenFt < 1 ? `${lenIn.toFixed(1)}"` : `${lenFt.toFixed(2)} ft`;
    const base = edge.label ? `${edge.label} — ${distance}` : distance;
    const txt = edge.estimated ? estimatedText(base) : base;
    const ux = dx / lenStuds;
    const uy = dy / lenStuds;
    // Right-hand normal: positive 90° rotation of segment direction.
    const nx = -uy;
    const ny = ux;
    const offsetPx = 16;
    const mid = { x: ((a.x + b.x) / 2) * px, y: ((a.y + b.y) / 2) * px };
    const lblX = mid.x + nx * offsetPx;
    const lblY = mid.y + ny * offsetPx;
    let angleDeg = (Math.atan2(dy, dx) * 180) / Math.PI;
    if (angleDeg > 90 || angleDeg < -90) angleDeg += 180;
    labelEl = (
      <Text
        x={lblX}
        y={lblY}
        text={txt}
        fontFamily="sans-serif"
        fontStyle="bold"
        fontSize={labelFontPx}
        fill="rgb(20,20,20)"
        rotation={angleDeg}
        offsetX={0}
        offsetY={14}
        listening={false}
        perfectDrawEnabled={false}
      />
    );
  }

  return (
    <Group>
      {showWalk && <WalkwayBand poly={edge.poly} widthStuds={minWalkwayStuds} />}
      <Line
        points={flatPoints}
        stroke={stroke}
        strokeWidth={strokeWidth}
        strokeScaleEnabled={false}
        {...(dash ? { dash } : {})}
        {...(edge.estimated ? { opacity: 0.45 } : {})}
        listening={false}
        perfectDrawEnabled={false}
      />
      {labelEl}
    </Group>
  );
}

function WalkwayBand({
  poly,
  widthStuds,
}: {
  poly: { x: number; y: number }[];
  widthStuds: number;
}) {
  const px = studToPx();
  // Each segment becomes a quad on the LEFT-hand normal side (matches
  // SceneBuilderSidecar.cpp:67-73 which uses the left-hand normal as
  // "inside" by polygon convention).
  const quads: number[][] = [];
  for (let i = 1; i < poly.length; i++) {
    const a = poly[i - 1]!;
    const b = poly[i]!;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    if (len < 0.001) continue;
    const nx = -dy / len;
    const ny = dx / len;
    const off = widthStuds;
    const aIn = { x: a.x + nx * off, y: a.y + ny * off };
    const bIn = { x: b.x + nx * off, y: b.y + ny * off };
    quads.push([
      a.x * px,
      a.y * px,
      b.x * px,
      b.y * px,
      bIn.x * px,
      bIn.y * px,
      aIn.x * px,
      aIn.y * px,
    ]);
  }
  return (
    <Group listening={false}>
      {quads.map((q, i) => (
        <Line
          key={i}
          points={q}
          closed
          fill="rgba(255, 170, 0, 0.25)"
          stroke="rgba(255, 170, 0, 0.4)"
          strokeWidth={1}
          listening={false}
          perfectDrawEnabled={false}
        />
      ))}
    </Group>
  );
}

function Segs({ segs, stroke, width = 1, dash }: { segs: Seg[]; stroke: string; width?: number; dash?: number[] }) {
  const px = studToPx();
  return (
    <>
      {segs.map((s, i) => (
        <Line
          key={i}
          points={s.map((v) => v * px)}
          stroke={stroke}
          strokeWidth={width}
          strokeScaleEnabled={false}
          {...(dash ? { dash } : {})}
          listening={false}
          perfectDrawEnabled={false}
        />
      ))}
    </>
  );
}

function VenueObstacle({ obstacle }: { obstacle: VenueObstacleT }) {
  if (!obstacle.poly || obstacle.poly.length < 3) return null;
  const px = studToPx();
  const flat: number[] = [];
  for (const p of obstacle.poly) flat.push(p.x * px, p.y * px);
  const style = obstacleStyle(obstacle.kind);
  const stairs = obstacle.kind === 'stairs' ? stairMarks(obstacle) : null;
  return (
    <Group listening={false}>
      <Line
        points={flat}
        closed
        {...(style.fill ? { fill: style.fill } : {})}
        stroke={style.stroke}
        strokeWidth={style.strokeWidth}
        strokeScaleEnabled={false}
        listening={false}
        perfectDrawEnabled={false}
      />
      {stairs && <Segs segs={stairs.treads} stroke={style.stroke} />}
      {stairs && <Segs segs={stairs.arrow} stroke="rgb(30,30,30)" width={2} />}
      {obstacle.kind === 'elevator' && <Segs segs={elevatorCross(obstacle.poly)} stroke={style.stroke} />}
    </Group>
  );
}

function VenuePowerMark({ power, fontPx }: { power: VenuePower; fontPx: number }) {
  const px = studToPx();
  const r = POWER_RADIUS_STUDS * px;
  const text = powerText(power);
  return (
    <Group listening={false}>
      <Circle
        x={power.x * px}
        y={power.y * px}
        radius={r}
        fill={power.kind === 'floor' ? POWER_COLOR : 'white'}
        stroke={POWER_COLOR}
        strokeWidth={2}
        strokeScaleEnabled={false}
        listening={false}
        perfectDrawEnabled={false}
      />
      {text && (
        <Text
          x={power.x * px + r * 1.4}
          y={power.y * px - fontPx / 2}
          text={text}
          fontSize={fontPx}
          fontFamily="sans-serif"
          fill={POWER_COLOR}
          listening={false}
          perfectDrawEnabled={false}
        />
      )}
    </Group>
  );
}

function VenueNoteMark({ note, fontPx }: { note: VenueNote; fontPx: number }) {
  const px = studToPx();
  return (
    <Text
      x={note.x * px}
      y={note.y * px}
      text={note.estimated ? estimatedText(note.text) : note.text}
      fontSize={fontPx}
      fontFamily="sans-serif"
      fontStyle={note.estimated ? 'italic' : 'normal'}
      fill={note.estimated ? ESTIMATE_COLOR : 'rgb(30,30,30)'}
      listening={false}
      perfectDrawEnabled={false}
    />
  );
}

function VenueDimensionMark({ dimension, fontPx }: { dimension: VenueDimension; fontPx: number }) {
  const g = dimensionGeometry(dimension);
  if (!g) return null;
  const px = studToPx();
  const color = dimension.estimated ? ESTIMATE_COLOR : DIMENSION_COLOR;
  const dash = dimension.estimated ? [8, 6] : undefined;
  const label = dimension.label ?? '';
  return (
    <Group listening={false}>
      <Segs segs={[g.line]} stroke={color} width={1.5} {...(dash ? { dash } : {})} />
      <Segs segs={g.ticks} stroke={color} width={1.5} />
      {label && (
        <Text
          x={g.label.x * px}
          y={g.label.y * px}
          text={dimension.estimated ? estimatedText(label) : label}
          fontSize={fontPx}
          fontFamily="sans-serif"
          fill={color}
          rotation={g.angleDeg}
          width={2000}
          align="center"
          offsetX={1000}
          offsetY={fontPx / 2}
          listening={false}
          perfectDrawEnabled={false}
        />
      )}
    </Group>
  );
}

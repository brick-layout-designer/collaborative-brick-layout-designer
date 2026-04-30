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
// This stays a passive overlay until the venue editing tools land
// (drawing, dimensions dialog). The data round-trips through the
// sidecar regardless.

import { Group, Line, Rect, Text } from 'react-konva';
import type { Venue } from '@cld/bbm';
import { studToPx } from './coords';

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
    const txt = edge.label ? `${edge.label} — ${distance}` : distance;
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

function VenueObstacle({
  obstacle,
}: {
  obstacle: { label: string; poly: { x: number; y: number }[] };
}) {
  if (!obstacle.poly || obstacle.poly.length < 3) return null;
  const px = studToPx();
  const flat: number[] = [];
  for (const p of obstacle.poly) flat.push(p.x * px, p.y * px);
  return (
    <Line
      points={flat}
      closed
      fill="rgba(120, 120, 120, 0.4)"
      stroke="rgb(90, 90, 90)"
      strokeWidth={1}
      strokeScaleEnabled={false}
      listening={false}
      perfectDrawEnabled={false}
    />
  );
}

// Suppress the unused import warning when nothing draws walkways.
void Rect;

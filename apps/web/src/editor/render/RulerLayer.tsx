// Render LayerRuler items — port of SceneBuilder ruler rendering at
// rendering/SceneBuilder.cpp:498-748 (linear) and 718-746 (circular).
//
// Faithful coverage of the desktop's behaviour:
//   - resolves attached endpoints to the attached brick's CURRENT
//     world centre, so a ruler "follows" its bricks when they move
//   - honours `AllowOffset` + `OffsetDistance` by translating the
//     visible measure line perpendicular to the anchor pair
//   - splits the main line around the centred distance label so the
//     text doesn't overlap the line
//   - rotates the label to the line angle and 180-flips it when it
//     would render upside-down
//   - draws perpendicular dashed guidelines from each anchor to the
//     offset endpoints when `AllowOffset` fires
//   - draws orange/green anchor dots at attached / free anchor points
//   - draws perpendicular end caps for short rulers without distance
//   - clickable so the editor can wire double-click → Edit Ruler
//
// Inputs are in stud-space; everything multiplies by `studToPx()` (8)
// at the leaves.

import { useEffect, useMemo, useRef, useState } from 'react';
import { useEditorStore } from '../editorStore';
import {
  Group,
  Circle as KonvaCircle,
  Line,
  Text as KonvaText,
} from 'react-konva';
import type Konva from 'konva';
import type {
  BbmMap,
  Brick,
  CircularRulerItem,
  ColorSpec,
  LayerRuler,
  LinearRulerItem,
} from '@cld/model';
import { studToPx, COLOR_DEFAULT } from './coords';

interface Props {
  map: BbmMap;
  /** When set, render the live snap ring + halo for that ruler id. */
  selectedRulerId?: string | null;
  onRulerClick?: (rulerId: string) => void;
  onRulerDoubleClick?: (rulerId: string) => void;
  /**
   * Called continuously while the user drags a linear-ruler endpoint
   * handle and on release. The first call carries `which` = 0 / 1
   * (point1 / point2); the final call carries `commit: true`.
   * Mirrors desktop's `MoveRulerEndpointCommand` flow at MapView.cpp:
   * 547-589 (live model mutate) + 680-724 (release commits).
   */
  onEndpointDrag?: (
    rulerId: string,
    which: 0 | 1,
    studX: number,
    studY: number,
    commit: boolean,
  ) => void;
}

export function RulerLayers({
  map,
  selectedRulerId,
  onRulerClick,
  onRulerDoubleClick,
  onEndpointDrag,
}: Props) {
  const layers = map.layers.filter(
    (l): l is LayerRuler => l.type === 'ruler' && l.visible,
  );
  // Index brick centres by id for O(1) lookup of attached endpoints.
  const brickCentres = useMemo(() => {
    const m = new Map<string, { x: number; y: number }>();
    for (const layer of map.layers) {
      if (layer.type !== 'brick') continue;
      for (const b of layer.bricks) {
        m.set(b.id, brickCentreStuds(b));
      }
    }
    return m;
  }, [map]);

  if (layers.length === 0) return null;
  return (
    <Group>
      {layers.map((layer) => {
        const opacity = Math.max(0, Math.min(100, layer.transparency)) / 100;
        return (
          <Group key={layer.id} opacity={opacity}>
            {layer.rulerItems.map((item) => {
              const sel = item.id === selectedRulerId;
              // `key` must be passed directly to JSX, not spread from a
              // props object — React 19 warns (and doesn't reliably use
              // it for reconciliation) when key rides along in a spread.
              const props: {
                brickCentres: typeof brickCentres;
                selected: boolean;
                onClick?: () => void;
                onDoubleClick?: () => void;
                onEndpointDrag?: (which: 0 | 1, studX: number, studY: number, commit: boolean) => void;
              } = { brickCentres, selected: sel };
              if (onRulerClick) props.onClick = () => onRulerClick(item.id);
              if (onRulerDoubleClick) props.onDoubleClick = () => onRulerDoubleClick(item.id);
              if (onEndpointDrag) {
                props.onEndpointDrag = (which, sx, sy, commit) =>
                  onEndpointDrag(item.id, which, sx, sy, commit);
              }
              return item.kind === 'linear' ? (
                <LinearRulerView key={item.id} item={item} {...props} />
              ) : (
                <CircularRulerView key={item.id} item={item} {...props} />
              );
            })}
          </Group>
        );
      })}
    </Group>
  );
}

function brickCentreStuds(b: Brick): { x: number; y: number } {
  return {
    x: b.displayArea.x + b.displayArea.width / 2,
    y: b.displayArea.y + b.displayArea.height / 2,
  };
}

function resolveAnchor(
  attachedBrickId: string,
  fallback: { x: number; y: number },
  brickCentres: Map<string, { x: number; y: number }>,
): { x: number; y: number } {
  if (!attachedBrickId) return fallback;
  return brickCentres.get(attachedBrickId) ?? fallback;
}

function LinearRulerView({
  item,
  brickCentres,
  selected,
  onClick,
  onDoubleClick,
  onEndpointDrag,
}: {
  item: LinearRulerItem;
  brickCentres: Map<string, { x: number; y: number }>;
  selected: boolean;
  onClick?: () => void;
  onDoubleClick?: () => void;
  onEndpointDrag?: (which: 0 | 1, studX: number, studY: number, commit: boolean) => void;
}) {
  const PX = studToPx();
  const showRulerAttachPoints = useEditorStore((s) => s.showRulerAttachPoints);
  const p1Stud = resolveAnchor(item.attachedBrick1Id, item.point1, brickCentres);
  const p2Stud = resolveAnchor(item.attachedBrick2Id, item.point2, brickCentres);
  const a1 = { x: p1Stud.x * PX, y: p1Stud.y * PX };
  const a2 = { x: p2Stud.x * PX, y: p2Stud.y * PX };
  const dx = a2.x - a1.x;
  const dy = a2.y - a1.y;
  const lenPx = Math.hypot(dx, dy);

  // Offset measure line — perpendicular to the anchor pair.
  // Vanilla normal is `(uy, -ux)` — see SceneBuilder.cpp:531-532.
  const needOffset =
    item.allowOffset && Math.abs(item.offsetDistance) > 0.001 && lenPx > 0.001;
  let nrm = { x: 0, y: 0 };
  if (lenPx > 0.001) nrm = { x: dy / lenPx, y: -dx / lenPx };
  const offPx = needOffset ? item.offsetDistance * PX : 0;
  const o1 = { x: a1.x + nrm.x * offPx, y: a1.y + nrm.y * offPx };
  const o2 = { x: a2.x + nrm.x * offPx, y: a2.y + nrm.y * offPx };

  const stroke = cssColor(item.color);
  const strokeWidth = Math.max(0.5, item.lineThickness);

  // Distance label — sized 6 % of pixel length, clamped 9-36 px,
  // matching SceneBuilder.cpp:575-576. Bold/italic from font.style.
  const distStuds = Math.hypot(p2Stud.x - p1Stud.x, p2Stud.y - p1Stud.y);
  const labelText = item.displayDistance
    ? item.displayUnit
      ? formatDistance(distStuds, item.unit)
      : distStuds.toFixed(2)
    : null;
  const labelFontPx = Math.max(9, Math.min(36, lenPx * 0.06));
  const labelFontStyle = parseFontStyle(item.measureFont.style);

  // Compute label dimensions via a hidden Konva text + a measure ref.
  // The width determines how big a gap to leave in the main line.
  const textRef = useRef<Konva.Text | null>(null);
  const [labelWidth, setLabelWidth] = useState(0);
  useEffect(() => {
    if (!labelText) return;
    const node = textRef.current;
    if (!node) return;
    const r = node.getClientRect({ skipTransform: true });
    setLabelWidth(r.width);
  }, [labelText, labelFontPx, labelFontStyle, item.measureFont.family]);

  const halfText = labelWidth / 2 + 6;

  // Label rotation — flipped 180° when the line angle would put the
  // text upside-down (SceneBuilder.cpp:562-564).
  let angleDeg = 0;
  if (lenPx > 0.001) {
    angleDeg = (Math.atan2(o2.y - o1.y, o2.x - o1.x) * 180) / Math.PI;
    if (angleDeg > 90 || angleDeg < -90) angleDeg += 180;
  }

  const midX = (o1.x + o2.x) / 2;
  const midY = (o1.y + o2.y) / 2;

  // Unit vector along the offset line, used to split the main line
  // around the label.
  const ux = lenPx > 0.001 ? dx / lenPx : 1;
  const uy = lenPx > 0.001 ? dy / lenPx : 0;
  const splitOnLine = labelText && halfText * 2 < lenPx - 8;
  const seg1End = splitOnLine ? { x: midX - ux * halfText, y: midY - uy * halfText } : o2;
  const seg2Start = splitOnLine ? { x: midX + ux * halfText, y: midY + uy * halfText } : o1;

  // Short ruler without a distance label gets perpendicular end-caps
  // at each endpoint (SceneBuilder.cpp:638-673).
  const drawEndCaps = !item.displayDistance && distStuds < 4 && lenPx > 0.001;
  const capPx = 4 * PX;
  const perp = { x: dy / Math.max(0.001, lenPx), y: -dx / Math.max(0.001, lenPx) };

  // Hit-target for click/double-click — a thicker invisible line
  // along the visible measure line so the user doesn't have to hit
  // the 1-2px stroke.
  const HIT_PX = 12;

  // Anchor dots: drawn ONLY when the offset is in effect (matches
  // desktop SceneBuilder.cpp:694-716; without offset, the visible
  // ruler ends are the anchor points).
  const anchorMarkers: Array<{ x: number; y: number; attached: boolean }> = [];
  if (needOffset) {
    anchorMarkers.push({ x: a1.x, y: a1.y, attached: !!item.attachedBrick1Id });
    anchorMarkers.push({ x: a2.x, y: a2.y, attached: !!item.attachedBrick2Id });
  }

  // Guideline dash pattern: BlueBrick uses lengths in studs; Konva
  // wants px.
  const dash = item.guidelineDashPattern.length >= 2
    ? item.guidelineDashPattern.filter((d) => d > 0)
    : [4, 4];
  const guidelineStroke = cssColor(item.guidelineColor);
  const guidelineWidth = Math.max(0.5, item.guidelineThickness);

  return (
    <Group>
      {/* Main measure line(s). */}
      {splitOnLine ? (
        <>
          <Line
            points={[o1.x, o1.y, seg1End.x, seg1End.y]}
            stroke={stroke}
            strokeWidth={strokeWidth}
            lineCap="butt"
            listening={false}
            perfectDrawEnabled={false}
          />
          <Line
            points={[seg2Start.x, seg2Start.y, o2.x, o2.y]}
            stroke={stroke}
            strokeWidth={strokeWidth}
            lineCap="butt"
            listening={false}
            perfectDrawEnabled={false}
          />
        </>
      ) : (
        <Line
          points={[o1.x, o1.y, o2.x, o2.y]}
          stroke={stroke}
          strokeWidth={strokeWidth}
          lineCap="butt"
          listening={false}
          perfectDrawEnabled={false}
        />
      )}

      {/* Distance label, rotated and flipped to stay readable. */}
      {labelText && (
        <KonvaText
          ref={textRef}
          x={midX}
          y={midY}
          text={labelText}
          fontFamily={item.measureFont.family || 'Arial'}
          fontStyle={labelFontStyle}
          fontSize={labelFontPx}
          fill={cssColor(item.measureFontColor)}
          offsetX={labelWidth / 2}
          offsetY={labelFontPx / 2}
          rotation={angleDeg}
          listening={false}
          perfectDrawEnabled={false}
        />
      )}

      {/* End caps for short rulers without a label. */}
      {drawEndCaps && (
        <>
          <Line
            points={[
              o1.x + perp.x * capPx,
              o1.y + perp.y * capPx,
              o1.x - perp.x * capPx,
              o1.y - perp.y * capPx,
            ]}
            stroke={guidelineStroke}
            strokeWidth={guidelineWidth}
            dash={dash}
            listening={false}
            perfectDrawEnabled={false}
          />
          <Line
            points={[
              o2.x + perp.x * capPx,
              o2.y + perp.y * capPx,
              o2.x - perp.x * capPx,
              o2.y - perp.y * capPx,
            ]}
            stroke={guidelineStroke}
            strokeWidth={guidelineWidth}
            dash={dash}
            listening={false}
            perfectDrawEnabled={false}
          />
        </>
      )}

      {/* Perpendicular guidelines + anchor dots when offset is on. */}
      {needOffset && (
        <>
          <Line
            points={[a1.x, a1.y, o1.x, o1.y]}
            stroke={guidelineStroke}
            strokeWidth={guidelineWidth}
            dash={dash}
            listening={false}
            perfectDrawEnabled={false}
          />
          <Line
            points={[a2.x, a2.y, o2.x, o2.y]}
            stroke={guidelineStroke}
            strokeWidth={guidelineWidth}
            dash={dash}
            listening={false}
            perfectDrawEnabled={false}
          />
        </>
      )}
      {/* Anchor attachment dots — shown when ruler has an offset OR when the
          view/rulerAttachPoints toggle is on. Orange = free endpoint,
          green = attached to a brick. Port of SceneBuilder.cpp anchor dots. */}
      {(needOffset || showRulerAttachPoints) && anchorMarkers.map((m, i) => (
        <KonvaCircle
          key={i}
          x={m.x}
          y={m.y}
          radius={4}
          fill={m.attached ? 'rgb(30,180,60)' : 'rgb(240,140,30)'}
          stroke="rgb(40,40,40)"
          strokeWidth={1.5}
          listening={false}
          perfectDrawEnabled={false}
        />
      ))}

      {/* Selection halo on the offset line. */}
      {selected && (
        <Line
          points={[o1.x, o1.y, o2.x, o2.y]}
          stroke="rgba(255, 215, 0, 0.5)"
          strokeWidth={Math.max(strokeWidth + 4, 6)}
          listening={false}
          perfectDrawEnabled={false}
        />
      )}

      {/* Invisible thick hit-target. */}
      {(onClick || onDoubleClick) && (
        <Line
          points={[o1.x, o1.y, o2.x, o2.y]}
          stroke="transparent"
          strokeWidth={HIT_PX}
          onClick={(e) => {
            e.cancelBubble = true;
            onClick?.();
          }}
          onTap={(e) => {
            e.cancelBubble = true;
            onClick?.();
          }}
          onDblClick={(e) => {
            e.cancelBubble = true;
            onDoubleClick?.();
          }}
          onDblTap={(e) => {
            e.cancelBubble = true;
            onDoubleClick?.();
          }}
        />
      )}

      {/* Endpoint reshape handles — only visible when this ruler is
          selected. Drag → MoveRulerEndpointCommand. Mirrors desktop
          MapView.cpp:399-444 (hit-test) + 547-589 (live drag) +
          680-724 (release commit). 0.8-stud * 1.5 = ~10px hit radius
          at native scale (port of MapView.cpp:409-410). */}
      {selected && onEndpointDrag && (
        <>
          <EndpointHandle x={a1.x} y={a1.y} which={0} onDrag={onEndpointDrag} />
          <EndpointHandle x={a2.x} y={a2.y} which={1} onDrag={onEndpointDrag} />
        </>
      )}
    </Group>
  );
}

/**
 * Draggable endpoint handle on a selected linear ruler. Reports
 * stud-coords on every dragmove (live) and once more on dragend with
 * `commit: true`. The committing call is what `MoveRulerEndpointCommand`
 * pushes onto the undo stack on desktop (RulerCommands.cpp:203-282).
 */
function EndpointHandle({
  x,
  y,
  which,
  onDrag,
}: {
  x: number;
  y: number;
  which: 0 | 1;
  onDrag: (which: 0 | 1, studX: number, studY: number, commit: boolean) => void;
}) {
  const PX = studToPx();
  return (
    <KonvaCircle
      x={x}
      y={y}
      radius={6}
      fill="rgb(255,215,0)"
      stroke="rgb(20,20,20)"
      strokeWidth={1.5}
      strokeScaleEnabled={false}
      draggable
      onDragMove={(e) => {
        e.cancelBubble = true;
        const node = e.target;
        onDrag(which, node.x() / PX, node.y() / PX, false);
      }}
      onDragEnd={(e) => {
        e.cancelBubble = true;
        const node = e.target;
        onDrag(which, node.x() / PX, node.y() / PX, true);
      }}
    />
  );
}

function CircularRulerView({
  item,
  brickCentres,
  selected,
  onClick,
  onDoubleClick,
}: {
  item: CircularRulerItem;
  brickCentres: Map<string, { x: number; y: number }>;
  selected: boolean;
  onClick?: () => void;
  onDoubleClick?: () => void;
}) {
  const PX = studToPx();
  const cStud = resolveAnchor(item.attachedBrickId, item.center, brickCentres);
  const cx = cStud.x * PX;
  const cy = cStud.y * PX;
  const rPx = Math.max(0, item.radius) * PX;
  const stroke = cssColor(item.color);
  const strokeWidth = Math.max(0.5, item.lineThickness);

  const labelText = item.displayDistance
    ? item.displayUnit
      ? formatDistance(item.radius, item.unit)
      : item.radius.toFixed(2)
    : null;
  const labelFontPx = Math.max(9, Math.min(36, rPx * 0.18));
  const labelFontStyle = parseFontStyle(item.measureFont.style);

  return (
    <Group>
      <KonvaCircle
        x={cx}
        y={cy}
        radius={rPx}
        stroke={stroke}
        strokeWidth={strokeWidth}
        fillEnabled={false}
        listening={false}
        perfectDrawEnabled={false}
      />
      {labelText && (
        <KonvaText
          x={cx + rPx + 4}
          y={cy - labelFontPx / 2}
          text={labelText}
          fontFamily={item.measureFont.family || 'Arial'}
          fontStyle={labelFontStyle}
          fontSize={labelFontPx}
          fill={cssColor(item.measureFontColor)}
          listening={false}
          perfectDrawEnabled={false}
        />
      )}
      {selected && (
        <KonvaCircle
          x={cx}
          y={cy}
          radius={rPx}
          stroke="rgba(255, 215, 0, 0.5)"
          strokeWidth={Math.max(strokeWidth + 4, 6)}
          fillEnabled={false}
          listening={false}
          perfectDrawEnabled={false}
        />
      )}
      {(onClick || onDoubleClick) && (
        <KonvaCircle
          x={cx}
          y={cy}
          radius={rPx}
          stroke="transparent"
          strokeWidth={12}
          fillEnabled={false}
          onClick={(e) => {
            e.cancelBubble = true;
            onClick?.();
          }}
          onTap={(e) => {
            e.cancelBubble = true;
            onClick?.();
          }}
          onDblClick={(e) => {
            e.cancelBubble = true;
            onDoubleClick?.();
          }}
          onDblTap={(e) => {
            e.cancelBubble = true;
            onDoubleClick?.();
          }}
        />
      )}
    </Group>
  );
}

function parseFontStyle(style: string | undefined): string {
  const s = (style ?? '').toLowerCase();
  const bold = s.includes('bold');
  const italic = s.includes('italic');
  if (bold && italic) return 'bold italic';
  if (bold) return 'bold';
  if (italic) return 'italic';
  return 'normal';
}

/**
 * Format a stud count as the desktop's `formatDistance` does (matches
 * Tools/Distance.cs Unit enum: 0 STUD, 1 LDU, 2 STRAIGHT_TRACK,
 * 3 MODULE, 4 METER, 5 FEET — see SceneBuilder.cpp:459-...).
 */
function formatDistance(studs: number, unit: number): string {
  switch (unit) {
    case 1: // LDU — 1 stud = 20 LDU
      return `${(studs * 20).toFixed(1)} LDU`;
    case 2: // STRAIGHT_TRACK — 1 track = 16 studs
      return `${(studs / 16).toFixed(2)} ST`;
    case 3: // MODULE — 1 module = 96 studs
      return `${(studs / 96).toFixed(2)} mod`;
    case 4:
      return `${(studs * 0.008).toFixed(2)} m`;
    case 5:
      return `${(studs * 0.026248).toFixed(2)} ft`;
    default:
      return `${studs.toFixed(1)} studs`;
  }
}

function cssColor(c: ColorSpec): string {
  if (c.kind === 'known') {
    const known: Record<string, string> = {
      black: '#000000',
      white: '#ffffff',
      red: '#ff0000',
      green: '#008000',
      blue: '#0000ff',
      yellow: '#ffff00',
      orange: '#ffa500',
      gray: '#808080',
      darkgray: '#a9a9a9',
      lightgray: '#d3d3d3',
    };
    return known[(c.name ?? '').toLowerCase()] ?? COLOR_DEFAULT;
  }
  return c.argb.length === 8 ? `#${c.argb.slice(2)}` : `#${c.argb}`;
}


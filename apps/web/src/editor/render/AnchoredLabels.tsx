// Render `.bbm.cld` sidecar anchored labels — port of
// SceneBuilder::addAnchoredLabels (rendering/SceneBuilderSidecar.cpp:195-228).
//
// Each label has:
//   - text + font (family, sizePt, style flags)
//   - color (ARGB hex or KnownColor name)
//   - kind: 0=World / 1=Brick / 2=Group / 3=Module
//   - targetId: GUID of the anchor (empty for World)
//   - offset: x/y in studs relative to the anchor
//   - rot: rotation in degrees
//   - minZoom: optional visibility threshold
//
// World and Brick anchors position the label directly.
// Group anchors target a shared `myGroup` id — we compute the AABB of
// all bricks in that group and draw a dashed leader from its centre.
// Module anchors target a sidecar module id — same AABB approach.

import { Group, Line, Text } from 'react-konva';
import type { BbmMap } from '@cld/model';
import type { AnchoredLabel, SidecarModule } from '@cld/bbm';
import type { KonvaEventObject } from 'konva/lib/Node';
import { studToPx } from './coords';
import { buildLabelIndex, labelAnchorStuds } from '../mixedSelection';
import type { AnnoDragHandlers } from './groupDragNodes';

interface Props {
  map: BbmMap;
  labels: AnchoredLabel[];
  /** Current zoom — labels with `minZoom > zoom` are hidden. */
  zoom: number;
  modules?: SidecarModule[];
  /** Called when the user double-clicks a label. */
  onDoubleClick?: (label: AnchoredLabel) => void;
  /** Highlighted labels (part of the mixed selection). */
  selectedIds?: ReadonlySet<string>;
  /** Mouse-down selects; `additive` = Shift/Ctrl held (toggle). */
  onSelect?: (id: string, additive: boolean) => void;
  /**
   * Drag a label (and the rest of the selection) — desktop labels are
   * movable items committing MoveAnchoredLabelCommand inside the "Drag"
   * macro (MapViewDrag.cpp:412-450).
   */
  drag?: AnnoDragHandlers;
}

export function AnchoredLabels({
  map,
  labels,
  zoom,
  modules = [],
  onDoubleClick,
  selectedIds,
  onSelect,
  drag,
}: Props) {
  if (!labels || labels.length === 0) return null;

  const index = buildLabelIndex(map, modules);

  return (
    <Group>
      {labels.map((label) => {
        if (label.minZoom > 0 && zoom < label.minZoom) return null;
        const fontSize = Math.max(1, Math.round(label.font.size));
        const style = (label.font.style ?? '').toLowerCase();
        const isBold = style.includes('bold');
        const isItalic = style.includes('italic');
        const fontStyle =
          isBold && isItalic ? 'bold italic' : isBold ? 'bold' : isItalic ? 'italic' : 'normal';
        const fill = argbToCss(label.color);

        // Anchor: origin for World labels, the brick centre for Brick
        // labels, the member AABB centre (leader-line end) for Group /
        // Module labels. A lost anchor hides the label.
        const anchor = labelAnchorStuds(label, index);
        if (!anchor) return null;
        const anchorPxX = anchor.x * studToPx();
        const anchorPxY = anchor.y * studToPx();
        const leaderTargetPx =
          label.kind === 2 || label.kind === 3 ? { x: anchorPxX, y: anchorPxY } : null;

        const x = anchorPxX + label.offset.x * studToPx();
        const y = anchorPxY + label.offset.y * studToPx();

        const groupProps = {
          ...(onDoubleClick ? { onDblClick: () => onDoubleClick(label) } : {}),
          ...(onSelect
            ? {
                onMouseDown: (e: KonvaEventObject<MouseEvent>) => {
                  if (e.evt.button !== 0) return;
                  e.cancelBubble = true;
                  const additive = e.evt.shiftKey || e.evt.ctrlKey || e.evt.metaKey;
                  // Pressing an already-selected label keeps the mixed
                  // selection so the drag moves all of it.
                  if (additive || !selectedIds?.has(label.id)) onSelect(label.id, additive);
                },
              }
            : {}),
          ...(drag
            ? {
                draggable: true,
                onDragStart: (e: KonvaEventObject<DragEvent>) => drag.start('labels', label.id, e.target),
                onDragMove: (e: KonvaEventObject<DragEvent>) => drag.move(e.target),
                onDragEnd: (e: KonvaEventObject<DragEvent>) => drag.end(e.target),
              }
            : {}),
        };
        const isSelected = !!selectedIds?.has(label.id);
        return (
          <Group key={label.id} name={`label-${label.id}`} {...groupProps}>
            {leaderTargetPx && (
              <Line
                points={[leaderTargetPx.x, leaderTargetPx.y, x, y]}
                stroke={fill}
                strokeWidth={1}
                dash={[4, 4]}
                listening={false}
                perfectDrawEnabled={false}
              />
            )}
            <Text
              x={x}
              y={y}
              text={label.text}
              fontFamily={label.font.family || 'Arial'}
              fontSize={fontSize}
              fontStyle={fontStyle}
              fill={fill}
              rotation={label.rot}
              listening={!!onDoubleClick || !!onSelect || !!drag}
              {...(isSelected ? { shadowColor: '#ffcc00', shadowBlur: 8, shadowOpacity: 1 } : {})}
              perfectDrawEnabled={false}
            />
          </Group>
        );
      })}
    </Group>
  );
}

/**
 * `AnchoredLabel.color` is `{ known, argb, name }` — `argb` is a
 * 32-bit AARRGGBB integer when `known` is false, else use `name` (a
 * .NET KnownColor). For colours we don't have in the lookup, fall
 * back to black so the label is at least visible.
 */
function argbToCss(c: { known: boolean; argb: number; name: string }): string {
  if (c.known) {
    const known: Record<string, string> = {
      black: '#000000',
      white: '#ffffff',
      red: '#ff0000',
      green: '#008000',
      blue: '#0000ff',
      yellow: '#ffff00',
      orange: '#ffa500',
    };
    return known[(c.name ?? '').toLowerCase()] ?? '#000000';
  }
  // 32-bit AARRGGBB: extract RGB; alpha handled by Konva opacity if needed.
  const argb = c.argb >>> 0;
  const r = (argb >> 16) & 0xff;
  const g = (argb >> 8) & 0xff;
  const b = argb & 0xff;
  return `rgb(${r}, ${g}, ${b})`;
}

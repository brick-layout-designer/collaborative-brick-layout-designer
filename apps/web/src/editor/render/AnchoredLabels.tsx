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
// Only Brick anchors attach the label: desktop makes it a child of the
// brick item, so the offset is in the brick's rotated frame and the text
// turns with the brick. World, Group and Module labels — and a Brick
// label whose brick is gone — sit at their offset as a world position
// (SceneBuilderSidecar.cpp:214-224). Font sizes are points
// (see labelFontPx).

import { Group, Text } from 'react-konva';
import type { BbmMap } from '@cld/model';
import type { AnchoredLabel, SidecarModule } from '@cld/bbm';
import type { KonvaEventObject } from 'konva/lib/Node';
import { studToPx } from './coords';
import { labelColorHex } from '../labelColor';
import { buildLabelIndex, labelFontFamily, labelFontPx, labelPlacement } from '../mixedSelection';
import type { AnnoDragHandlers } from './groupDragNodes';
import type { PartWire } from '../../api';

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
  /** Catalog, so Brick labels hang off the brick's sprite centre (its pivot). */
  partsByKey?: ReadonlyMap<string, PartWire>;
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
  partsByKey,
}: Props) {
  if (!labels || labels.length === 0) return null;

  const index = buildLabelIndex(map, modules, partsByKey);

  return (
    <Group>
      {labels.map((label) => {
        if (label.minZoom > 0 && zoom < label.minZoom) return null;
        const fontSize = labelFontPx(label.font.size);
        const style = (label.font.style ?? '').toLowerCase();
        const isBold = style.includes('bold');
        const isItalic = style.includes('italic');
        const fontStyle =
          isBold && isItalic ? 'bold italic' : isBold ? 'bold' : isItalic ? 'italic' : 'normal';
        const fill = argbToCss(label.color);
        const place = labelPlacement(label, index);
        const x = studToPx(place.x);
        const y = studToPx(place.y);

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
            <Text
              x={x}
              y={y}
              text={label.text}
              fontFamily={labelFontFamily(label.font.family)}
              fontSize={fontSize}
              fontStyle={fontStyle}
              fill={fill}
              rotation={place.rotation}
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

function argbToCss(c: { known: boolean; argb: number; name: string }): string {
  return `#${labelColorHex(c)}`;
}

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
import { useEditorStore } from '../editorStore';
import { textReadable } from '../textLegibility';
import { tapGuard } from '../touchGesture';
import { TEXT_GLOW } from './selectionStyle';
import { usePosedMap } from '../liveDragPose';

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
  map: committedMap,
  labels,
  zoom,
  modules = [],
  onDoubleClick,
  selectedIds,
  onSelect,
  drag,
  partsByKey,
}: Props) {
  // The parts being dragged where they are now (liveDragPose.ts), so this
  // follows the drag every frame, not only the drop.
  const map = usePosedMap(committedMap, (pose) => labels.some((l) => l.kind === 1 && pose.ids.has(l.targetId)));
  const minTextPx = useEditorStore((s) => s.minTextPx);
  if (!labels || labels.length === 0) return null;

  const index = buildLabelIndex(map, modules, partsByKey);

  return (
    <Group>
      {labels.map((label) => {
        if (label.minZoom > 0 && zoom < label.minZoom) return null;
        const fontSize = labelFontPx(label.font.size);
        // Too small to read on screen (phone viewer only): leave it out.
        if (!textReadable(fontSize, zoom, minTextPx)) return null;
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
                // A finger's tap picks it ("Select more" adds); not after a pan or long press.
                onTap: (e: KonvaEventObject<TouchEvent>) => {
                  if (tapGuard.suppress) return;
                  e.cancelBubble = true;
                  onSelect(label.id, useEditorStore.getState().touchSelectMore);
                },
              }
            : {}),
          ...(drag
            ? {
                draggable: true,
                onDragStart: (e: KonvaEventObject<DragEvent>) => drag.start('labels', label.id, e.target),
                onDragMove: (e: KonvaEventObject<DragEvent>) => drag.move(e.target, e.evt),
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
              {...(isSelected ? TEXT_GLOW : {})}
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

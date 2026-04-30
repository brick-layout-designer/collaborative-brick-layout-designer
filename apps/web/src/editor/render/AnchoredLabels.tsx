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
import type { BbmMap, Brick } from '@cld/model';
import type { AnchoredLabel, SidecarModule } from '@cld/bbm';
import { studToPx } from './coords';

interface Props {
  map: BbmMap;
  labels: AnchoredLabel[];
  /** Current zoom — labels with `minZoom > zoom` are hidden. */
  zoom: number;
  modules?: SidecarModule[];
  /** Called when the user double-clicks a label. */
  onDoubleClick?: (label: AnchoredLabel) => void;
}

export function AnchoredLabels({ map, labels, zoom, modules = [], onDoubleClick }: Props) {
  if (!labels || labels.length === 0) return null;

  // Index brick by id; also collect bricks by group id and module member set.
  const brickById = new Map<string, Brick>();
  const bricksByGroup = new Map<string, Brick[]>();
  for (const layer of map.layers) {
    if (layer.type !== 'brick') continue;
    for (const b of layer.bricks) {
      brickById.set(b.id, b);
      if (b.myGroup) {
        const arr = bricksByGroup.get(b.myGroup) ?? [];
        arr.push(b);
        bricksByGroup.set(b.myGroup, arr);
      }
    }
  }

  // Index module members by module id.
  const bricksByModule = new Map<string, Brick[]>();
  for (const mod of modules) {
    const memberSet = new Set(mod.members);
    const members: Brick[] = [];
    for (const layer of map.layers) {
      if (layer.type !== 'brick') continue;
      for (const b of layer.bricks) {
        if (memberSet.has(b.id)) members.push(b);
      }
    }
    if (members.length > 0) bricksByModule.set(mod.id, members);
  }

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

        let anchorPxX = 0;
        let anchorPxY = 0;
        let leaderTargetPx: { x: number; y: number } | null = null;

        if (label.kind === 1 /* Brick */) {
          const target = brickById.get(label.targetId);
          if (!target) return null;
          anchorPxX = (target.displayArea.x + target.displayArea.width / 2) * studToPx();
          anchorPxY = (target.displayArea.y + target.displayArea.height / 2) * studToPx();
        } else if (label.kind === 2 /* Group */ || label.kind === 3 /* Module */) {
          const bricks =
            label.kind === 2
              ? (bricksByGroup.get(label.targetId) ?? null)
              : (bricksByModule.get(label.targetId) ?? null);
          if (!bricks || bricks.length === 0) return null;
          const aabb = bricksAabb(bricks);
          const cx = (aabb.minX + aabb.maxX) / 2;
          const cy = (aabb.minY + aabb.maxY) / 2;
          leaderTargetPx = { x: cx * studToPx(), y: cy * studToPx() };
          // Label position is offset from the anchor centre.
          anchorPxX = leaderTargetPx.x;
          anchorPxY = leaderTargetPx.y;
        }
        // Kind 0 (World): anchorPx stays at origin; offset positions the label absolutely.

        const x = anchorPxX + label.offset.x * studToPx();
        const y = anchorPxY + label.offset.y * studToPx();

        const groupProps = onDoubleClick ? { onDblClick: () => onDoubleClick(label) } : {};
        return (
          <Group key={label.id} {...groupProps}>
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
              listening={!!onDoubleClick}
              perfectDrawEnabled={false}
            />
          </Group>
        );
      })}
    </Group>
  );
}

function bricksAabb(bricks: Brick[]): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const b of bricks) {
    minX = Math.min(minX, b.displayArea.x);
    minY = Math.min(minY, b.displayArea.y);
    maxX = Math.max(maxX, b.displayArea.x + b.displayArea.width);
    maxY = Math.max(maxY, b.displayArea.y + b.displayArea.height);
  }
  return { minX, minY, maxX, maxY };
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

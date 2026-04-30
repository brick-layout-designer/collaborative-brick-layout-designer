// Module name labels + frame outlines — port of SceneBuilderSidecar.cpp
// module rendering (view/moduleNames + view/moduleFrameThickness).
//
// Each sidecar module has a `members` array of brick IDs. We compute the
// AABB of all member bricks, draw a dashed outline around it (frame), and
// place the module name above the top-left corner (label).

import { Group, Rect, Text } from 'react-konva';
import type { BbmMap } from '@cld/model';
import type { SidecarModule } from '@cld/bbm';
import { useEditorStore } from '../editorStore';
import { studToPx } from './coords';

interface Props {
  map: BbmMap;
  modules: SidecarModule[];
}

export function ModuleOverlay({ map, modules }: Props) {
  const showModuleNames = useEditorStore((s) => s.showModuleNames);
  const showModuleFrames = useEditorStore((s) => s.showModuleFrames);
  const frameThickness = useEditorStore((s) => s.moduleFrameThickness);

  if ((!showModuleNames && !showModuleFrames) || modules.length === 0) return null;

  // Index brick positions by id.
  const brickById = new Map<string, { x: number; y: number; w: number; h: number }>();
  for (const layer of map.layers) {
    if (layer.type !== 'brick') continue;
    for (const b of layer.bricks) {
      brickById.set(b.id, {
        x: b.displayArea.x,
        y: b.displayArea.y,
        w: b.displayArea.width,
        h: b.displayArea.height,
      });
    }
  }

  const pxPerStud = studToPx();

  return (
    <Group listening={false}>
      {modules.map((mod) => {
        // Compute AABB of member bricks in studs.
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const id of mod.members) {
          const b = brickById.get(id);
          if (!b) continue;
          minX = Math.min(minX, b.x);
          minY = Math.min(minY, b.y);
          maxX = Math.max(maxX, b.x + b.w);
          maxY = Math.max(maxY, b.y + b.h);
        }
        if (!isFinite(minX)) return null;

        const px = minX * pxPerStud;
        const py = minY * pxPerStud;
        const pw = (maxX - minX) * pxPerStud;
        const ph = (maxY - minY) * pxPerStud;
        const PAD = 4;

        return (
          <Group key={mod.id}>
            {showModuleFrames && (
              <Rect
                x={px - PAD}
                y={py - PAD}
                width={pw + PAD * 2}
                height={ph + PAD * 2}
                stroke="rgba(100,180,255,0.8)"
                strokeWidth={frameThickness}
                strokeScaleEnabled={false}
                dash={[6, 4]}
                fillEnabled={false}
                perfectDrawEnabled={false}
              />
            )}
            {showModuleNames && (
              <Text
                x={px - PAD}
                y={py - PAD - 14}
                text={mod.name || '(module)'}
                fontSize={11}
                fontStyle="bold"
                fill="rgba(100,180,255,0.9)"
                stroke="rgba(0,0,0,0.6)"
                strokeWidth={2}
                fillAfterStrokeEnabled
                perfectDrawEnabled={false}
              />
            )}
          </Group>
        );
      })}
    </Group>
  );
}

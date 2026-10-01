// Module name labels + frame outlines — port of SceneBuilderSidecar.cpp
// module rendering (view/moduleNames + view/moduleFrameThickness).
//
// Each sidecar module has a `members` array of brick IDs. We compute the
// AABB of all member bricks, draw a dashed outline around it (frame), and
// place the module name outside the frame, centred on a long side, sized
// as `moduleLabelPercent`% of the long axis (SceneBuilderSidecar.cpp:242-368).
// Desktop also dodges other modules' labels; we keep the first slot.

import Konva from 'konva';
import { Group, Rect, Text } from 'react-konva';
import type { BbmMap } from '@cld/model';
import type { SidecarModule } from '@cld/bbm';
import { useEditorStore } from '../editorStore';
import { moduleLabelLayouts } from './moduleLabels';

export { fitModuleLabel, moduleLabelFontPx, moduleLabelLayouts, moduleLabelBoundsStuds, type ModuleLabelLayout } from './moduleLabels';

interface Props {
  map: BbmMap;
  modules: SidecarModule[];
}

export function measureBold(text: string): (fontPx: number) => number {
  return (fontPx) => new Konva.Text({ text, fontSize: fontPx, fontStyle: 'bold' }).width();
}

export function ModuleOverlay({ map, modules }: Props) {
  const showModuleNames = useEditorStore((s) => s.showModuleNames);
  const frameThickness = useEditorStore((s) => s.moduleFrameThickness);
  const labelPercent = useEditorStore((s) => s.moduleLabelPercent);

  // Names and frames share one toggle, like desktop view/moduleNames.
  if (!showModuleNames || modules.length === 0) return null;

  return (
    <Group listening={false}>
      {moduleLabelLayouts(map, modules, labelPercent, measureBold).map(({ id, name, frame, text }) => (
        <Group key={id}>
          <Rect
            {...frame}
            stroke="rgba(100,180,255,0.8)"
            strokeWidth={frameThickness}
            strokeScaleEnabled={false}
            dash={[6, 4]}
            fillEnabled={false}
            perfectDrawEnabled={false}
          />
          <Text
            x={text.x}
            y={text.y}
            rotation={text.rotation}
            width={text.width}
            align="center"
            wrap="none"
            text={name}
            fontSize={text.fontPx}
            fontStyle="bold"
            fill="rgba(100,180,255,0.9)"
            stroke="rgba(0,0,0,0.6)"
            strokeWidth={Math.max(2, text.fontPx / 12)}
            fillAfterStrokeEnabled
            perfectDrawEnabled={false}
          />
        </Group>
      ))}
    </Group>
  );
}

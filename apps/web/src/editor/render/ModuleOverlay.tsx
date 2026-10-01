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
import { MAP_FONT_STACK } from './mapText';
import { MODULE_FRAME_DASH, MODULE_FRAME_STROKE, MODULE_NAME_FILL, MODULE_NAME_STROKE, moduleLabelLayouts, moduleNameStrokePx } from './moduleLabels';

export { fitModuleLabel, moduleLabelFontPx, moduleLabelLayouts, moduleLabelBoundsStuds, type ModuleLabelLayout } from './moduleLabels';

interface Props {
  map: BbmMap;
  modules: SidecarModule[];
}

export function measureBold(text: string): (fontPx: number) => number {
  return (fontPx) => new Konva.Text({ text, fontSize: fontPx, fontStyle: 'bold', fontFamily: MAP_FONT_STACK }).width();
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
            stroke={MODULE_FRAME_STROKE}
            strokeWidth={frameThickness}
            strokeScaleEnabled={false}
            dash={MODULE_FRAME_DASH}
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
            fontFamily={MAP_FONT_STACK}
            fill={MODULE_NAME_FILL}
            stroke={MODULE_NAME_STROKE}
            strokeWidth={moduleNameStrokePx(text.fontPx)}
            fillAfterStrokeEnabled
            perfectDrawEnabled={false}
          />
        </Group>
      ))}
    </Group>
  );
}

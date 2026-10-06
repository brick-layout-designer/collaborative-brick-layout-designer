// Electric-circuit overlay — draws the rails, cutter bars and short-circuit
// marks computed by electricCircuits.ts (the desktop's SceneBuilderElectric).
// Widths are in studs, as in BlueBrick, so they scale with the zoom and
// match exported pictures.

import { useMemo } from 'react';
import { Group, Line } from 'react-konva';
import type { BbmMap } from '@cld/model';
import type { PartWire } from '../../api';
import { electricOverlay } from './electricCircuits';

interface Props {
  map: BbmMap;
  partsByKey: Map<string, PartWire>;
}

export function ElectricCircuitLayer({ map, partsByKey }: Props) {
  const { strokes } = useMemo(() => electricOverlay(map, partsByKey), [map, partsByKey]);
  if (strokes.length === 0) return null;
  return (
    <Group listening={false}>
      {strokes.map((s, i) => (
        <Line
          key={i}
          points={s.points}
          stroke={s.color}
          strokeWidth={s.width}
          lineCap="butt"
          lineJoin="round"
          listening={false}
          perfectDrawEnabled={false}
        />
      ))}
    </Group>
  );
}

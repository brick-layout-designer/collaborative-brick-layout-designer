// Electric-circuit overlay — draws the rails and short-circuit markers
// computed by electricCircuits.ts (port of SceneBuilderElectric.cpp).
// Lines use strokeScaleEnabled={false} (cosmetic pen, desktop-equivalent).

import { useMemo } from 'react';
import { Group, Line, RegularPolygon } from 'react-konva';
import type { BbmMap } from '@cld/model';
import type { PartWire } from '../../api';
import { electricOverlay } from './electricCircuits';

const STROKE_W = 3; // screen px, cosmetic
const SHORTCUT_R = 8; // diamond half-size in screen px
const K_SHORT = 'rgba(255,165,0,0.9)'; // Orange

interface Props {
  map: BbmMap;
  partsByKey: Map<string, PartWire>;
}

export function ElectricCircuitLayer({ map, partsByKey }: Props) {
  const segments = useMemo(() => electricOverlay(map, partsByKey), [map, partsByKey]);

  if (segments.lines.length === 0 && segments.diamonds.length === 0) return null;

  return (
    <Group listening={false}>
      {segments.lines.map((l, i) => (
        <Line
          key={i}
          points={[l.x1, l.y1, l.x2, l.y2]}
          stroke={l.color}
          strokeWidth={STROKE_W}
          strokeScaleEnabled={false}
          listening={false}
          perfectDrawEnabled={false}
        />
      ))}
      {segments.diamonds.map((d, i) => (
        <RegularPolygon
          key={`d-${i}`}
          x={d.x}
          y={d.y}
          sides={4}
          radius={SHORTCUT_R}
          rotation={45}
          stroke={K_SHORT}
          strokeWidth={2}
          strokeScaleEnabled={false}
          fill="transparent"
          listening={false}
          perfectDrawEnabled={false}
        />
      ))}
    </Group>
  );
}

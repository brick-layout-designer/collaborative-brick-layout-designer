// Render LayerArea cells (paint-area tool output) — port of
// SceneBuilder::addAreaLayer (rendering/SceneBuilder.cpp:437-457).
//
// Each cell is a square of side `areaCellSize` studs at world-coords
// (cell.x * areaCellSize, cell.y * areaCellSize). The cell colour is
// stored as `aarrggbb` UPPERCASE hex (per AreaCell.color comment in
// @cld/model). The desktop multiplies the cell's own alpha by the
// layer's `transparency / 100`.

import { Group, Rect } from 'react-konva';
import type { BbmMap, LayerArea } from '@cld/model';
import { studToPx } from './coords';

export function AreaLayers({ map }: { map: BbmMap }) {
  const layers = map.layers.filter((l): l is LayerArea => l.type === 'area' && l.visible);
  if (layers.length === 0) return null;
  return (
    <Group>
      {layers.map((layer) => (
        <SingleAreaLayer key={layer.id} layer={layer} />
      ))}
    </Group>
  );
}

function SingleAreaLayer({ layer }: { layer: LayerArea }) {
  const sizePx = studToPx(layer.areaCellSize);
  const alphaScale = Math.max(0, Math.min(100, layer.transparency)) / 100;
  return (
    <Group>
      {layer.areas.map((cell, i) => {
        const fill = argbHexToCss(cell.color, alphaScale);
        if (!fill) return null;
        return (
          <Rect
            key={i}
            x={cell.x * sizePx}
            y={cell.y * sizePx}
            width={sizePx}
            height={sizePx}
            fill={fill}
            listening={false}
            perfectDrawEnabled={false}
            strokeEnabled={false}
          />
        );
      })}
    </Group>
  );
}

/**
 * Convert AARRGGBB / RRGGBB hex (uppercase per AreaCell.color comment in
 * @cld/model) to a CSS rgba() with the layer's transparency multiplied
 * into the alpha channel.
 */
function argbHexToCss(hex: string, alphaScale: number): string | null {
  const h = hex.replace(/^#/, '');
  let a = 255;
  let r: number;
  let g: number;
  let b: number;
  if (h.length === 8) {
    a = parseInt(h.slice(0, 2), 16);
    r = parseInt(h.slice(2, 4), 16);
    g = parseInt(h.slice(4, 6), 16);
    b = parseInt(h.slice(6, 8), 16);
  } else if (h.length === 6) {
    r = parseInt(h.slice(0, 2), 16);
    g = parseInt(h.slice(2, 4), 16);
    b = parseInt(h.slice(4, 6), 16);
  } else {
    return null;
  }
  if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) return null;
  const finalAlpha = (a * alphaScale) / 255;
  return `rgba(${r}, ${g}, ${b}, ${finalAlpha})`;
}

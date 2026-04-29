import { Group, Line, Rect } from 'react-konva';
import type { BbmMap, ColorSpec, LayerGrid } from '@cld/model';
import { studToPx, COLOR_DEFAULT } from './coords';

// Stage-extent used for drawing the grid background. The desktop computes
// this from the map's actual extent; we pick a generous fixed size so the
// grid is always visible regardless of zoom/pan. Real layouts fit easily.
const EXTENT_STUDS = 2000;

export function GridLayer({ map }: { map: BbmMap }) {
  // Pick the FIRST grid layer the map has — the desktop assumes one.
  // Bricks live in their own LayerBrick instances.
  const grid = map.layers.find((l): l is LayerGrid => l.type === 'grid');
  if (!grid || !grid.visible) return null;

  return (
    <Group>
      {/* Background fill. */}
      <Rect
        x={-EXTENT_STUDS * studToPx() / 2}
        y={-EXTENT_STUDS * studToPx() / 2}
        width={EXTENT_STUDS * studToPx()}
        height={EXTENT_STUDS * studToPx()}
        fill={cssColor(map.backgroundColor)}
      />
      {grid.displaySubGrid && <SubGridLines grid={grid} />}
      {grid.displayGrid && <MajorGridLines grid={grid} />}
    </Group>
  );
}

function MajorGridLines({ grid }: { grid: LayerGrid }) {
  const stepStuds = grid.gridSizeInStud;
  const lines = [];
  const px = studToPx();
  const halfPx = (EXTENT_STUDS / 2) * px;
  const stroke = cssColor(grid.gridColor);
  const opacity = grid.transparency / 100;

  for (let s = -EXTENT_STUDS / 2; s <= EXTENT_STUDS / 2; s += stepStuds) {
    const p = s * px;
    lines.push(
      <Line
        key={`v-${s}`}
        points={[p, -halfPx, p, halfPx]}
        stroke={stroke}
        strokeWidth={grid.gridThickness}
        opacity={opacity}
        perfectDrawEnabled={false}
        listening={false}
      />,
    );
    lines.push(
      <Line
        key={`h-${s}`}
        points={[-halfPx, p, halfPx, p]}
        stroke={stroke}
        strokeWidth={grid.gridThickness}
        opacity={opacity}
        perfectDrawEnabled={false}
        listening={false}
      />,
    );
  }
  return <Group>{lines}</Group>;
}

function SubGridLines({ grid }: { grid: LayerGrid }) {
  const stepStuds = grid.gridSizeInStud / Math.max(1, grid.subDivisionNumber);
  const lines = [];
  const px = studToPx();
  const halfPx = (EXTENT_STUDS / 2) * px;
  const stroke = cssColor(grid.subGridColor);
  const opacity = (grid.transparency / 100) * 0.5;

  for (let s = -EXTENT_STUDS / 2; s <= EXTENT_STUDS / 2; s += stepStuds) {
    const p = s * px;
    lines.push(
      <Line
        key={`sv-${s}`}
        points={[p, -halfPx, p, halfPx]}
        stroke={stroke}
        strokeWidth={grid.subGridThickness}
        opacity={opacity}
        perfectDrawEnabled={false}
        listening={false}
      />,
    );
    lines.push(
      <Line
        key={`sh-${s}`}
        points={[-halfPx, p, halfPx, p]}
        stroke={stroke}
        strokeWidth={grid.subGridThickness}
        opacity={opacity}
        perfectDrawEnabled={false}
        listening={false}
      />,
    );
  }
  return <Group>{lines}</Group>;
}

/** Convert a BlueBrick ColorSpec to a CSS color string. */
function cssColor(c: ColorSpec): string {
  if (c.kind === 'known') return KNOWN_COLORS[c.name.toLowerCase()] ?? COLOR_DEFAULT;
  // ARGB hex like "ffaabbcc" — strip the alpha for now (Konva supports rgba
  // but the corpus uses opaque colors almost always).
  if (c.argb.length === 8) return `#${c.argb.slice(2)}`;
  return `#${c.argb}`;
}

// Subset of System.Drawing.KnownColor that the BBM corpus actually uses.
// Anything missing falls back to neutral grey — the export is faithful
// either way because we preserve `kind: 'known'` in the model.
const KNOWN_COLORS: Record<string, string> = {
  black: '#000000',
  white: '#ffffff',
  cornflowerblue: '#6495ed',
  lightgray: '#d3d3d3',
  gray: '#808080',
  darkgray: '#a9a9a9',
  red: '#ff0000',
  green: '#008000',
  blue: '#0000ff',
  yellow: '#ffff00',
  orange: '#ffa500',
};

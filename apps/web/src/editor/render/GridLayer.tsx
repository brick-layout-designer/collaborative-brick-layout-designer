import type { JSX } from 'react';
import { Group, Line, Rect } from 'react-konva';
import type { BbmMap, ColorSpec, LayerGrid } from '@cld/model';
import { studToPx, COLOR_DEFAULT } from './coords';
import { useEditorStore } from '../editorStore';

export interface ViewportRect {
  /** World-space (stud) bounds currently visible on the stage. */
  studXMin: number;
  studYMin: number;
  studXMax: number;
  studYMax: number;
}

/**
 * Background fill + grid lines, sized to whatever is currently visible.
 *
 * Old behaviour drew a fixed 2000-stud square centred on the origin —
 * panning or zooming far enough left a blank stage. We now derive the
 * extent from the live viewport so the grid is always covering exactly
 * what the user sees.
 */
export function GridLayer({
  map,
  viewport,
  showGrid: showGridProp,
}: {
  map: BbmMap;
  viewport: ViewportRect;
  /** Override the editor-store value. Pass `true` from the public viewer to avoid a store subscription. */
  showGrid?: boolean;
}) {
  const showGridStore = useEditorStore((s) => s.showGrid);
  const showGrid = showGridProp ?? showGridStore;
  const grid = map.layers.find((l): l is LayerGrid => l.type === 'grid');

  // Background always covers the full visible area regardless of grid visibility.
  const bgPad = (grid?.gridSizeInStud ?? 32) * 2;
  const bgXMin = viewport.studXMin - bgPad;
  const bgYMin = viewport.studYMin - bgPad;
  const bgXMax = viewport.studXMax + bgPad;
  const bgYMax = viewport.studYMax + bgPad;
  const px = studToPx();

  // Grid lines only render when the grid layer exists, is visible, and showGrid is on.
  const gridVisible = grid && grid.visible && showGrid;
  const pad = gridVisible ? grid.gridSizeInStud * 2 : bgPad;
  const xMin = viewport.studXMin - pad;
  const yMin = viewport.studYMin - pad;
  const xMax = viewport.studXMax + pad;
  const yMax = viewport.studYMax + pad;

  return (
    <Group>
      <Rect
        x={bgXMin * px}
        y={bgYMin * px}
        width={(bgXMax - bgXMin) * px}
        height={(bgYMax - bgYMin) * px}
        fill={cssColor(map.backgroundColor)}
        listening={false}
      />
      {gridVisible && grid.displaySubGrid && <SubGridLines grid={grid} bounds={{ xMin, yMin, xMax, yMax }} />}
      {gridVisible && grid.displayGrid && <MajorGridLines grid={grid} bounds={{ xMin, yMin, xMax, yMax }} />}
    </Group>
  );
}

interface Bounds {
  xMin: number;
  yMin: number;
  xMax: number;
  yMax: number;
}

// Desktop draws grid lines at full pen colour (no transparency multiplier
// applied, even when the layer has a non-100 `transparency`) — see
// MapViewPaint.cpp:84-104. The sub-step is `gridSizeInStud /
// max(subDivisionNumber, 2)` (line 77) so a single-division grid still
// yields a meaningful sub-step.

function MajorGridLines({ grid, bounds }: { grid: LayerGrid; bounds: Bounds }) {
  return (
    <GridLines
      stepStuds={grid.gridSizeInStud}
      bounds={bounds}
      stroke={cssColor(grid.gridColor)}
      thickness={grid.gridThickness}
      opacity={1}
      keyPrefix="g"
    />
  );
}

function SubGridLines({ grid, bounds }: { grid: LayerGrid; bounds: Bounds }) {
  const step = grid.gridSizeInStud / Math.max(2, grid.subDivisionNumber);
  return (
    <GridLines
      stepStuds={step}
      bounds={bounds}
      stroke={cssColor(grid.subGridColor)}
      thickness={grid.subGridThickness}
      opacity={1}
      keyPrefix="s"
    />
  );
}

function GridLines({
  stepStuds,
  bounds,
  stroke,
  thickness,
  opacity,
  keyPrefix,
}: {
  stepStuds: number;
  bounds: Bounds;
  stroke: string;
  thickness: number;
  opacity: number;
  keyPrefix: string;
}) {
  const px = studToPx();
  const lines: JSX.Element[] = [];
  // Snap start to a multiple of `stepStuds` so the lines stay anchored
  // to the world even while the user pans.
  const startX = Math.floor(bounds.xMin / stepStuds) * stepStuds;
  const startY = Math.floor(bounds.yMin / stepStuds) * stepStuds;
  // Cap the number of lines we emit even when zoomed way out — we don't
  // need 50000 sub-grid lines, the grid is purely cosmetic past a point.
  const maxLines = 600;
  const xCount = Math.ceil((bounds.xMax - startX) / stepStuds);
  const yCount = Math.ceil((bounds.yMax - startY) / stepStuds);
  if (xCount > maxLines || yCount > maxLines) return null;

  for (let i = 0; i <= xCount; i++) {
    const s = startX + i * stepStuds;
    const p = s * px;
    lines.push(
      <Line
        key={`${keyPrefix}-v-${i}`}
        points={[p, bounds.yMin * px, p, bounds.yMax * px]}
        stroke={stroke}
        strokeWidth={thickness}
        opacity={opacity}
        perfectDrawEnabled={false}
        listening={false}
      />,
    );
  }
  for (let j = 0; j <= yCount; j++) {
    const s = startY + j * stepStuds;
    const p = s * px;
    lines.push(
      <Line
        key={`${keyPrefix}-h-${j}`}
        points={[bounds.xMin * px, p, bounds.xMax * px, p]}
        stroke={stroke}
        strokeWidth={thickness}
        opacity={opacity}
        perfectDrawEnabled={false}
        listening={false}
      />,
    );
  }
  return <Group>{lines}</Group>;
}

function cssColor(c: ColorSpec): string {
  if (c.kind === 'known') return KNOWN_COLORS[c.name.toLowerCase()] ?? COLOR_DEFAULT;
  // ARGB hex like "ffaabbcc" — strip the alpha for now (Konva supports rgba
  // but real-world `.bbm` files use opaque colors almost always).
  if (c.argb.length === 8) return `#${c.argb.slice(2)}`;
  return `#${c.argb}`;
}

// Subset of System.Drawing.KnownColor that real `.bbm` files actually use.
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

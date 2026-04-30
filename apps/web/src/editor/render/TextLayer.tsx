// Render LayerText cells (free text labels) — port of
// SceneBuilder::addTextLayer (rendering/SceneBuilder.cpp:377-435).
//
// Algorithm:
//   1. Render at a probe pixel-size, measure its bbox.
//   2. Scale the font so the bbox fits inside displayArea (accounting
//      for 90°/270° rotation that swaps W↔H).
//   3. Centre the text on displayArea.center and rotate around it.
//
// Per-layer transparency lands on the layer Group (matches desktop
// SceneBuilder.cpp:832-834).

import { useEffect, useRef, useState } from 'react';
import { Group, Text as KonvaText } from 'react-konva';
import type Konva from 'konva';
import type { BbmMap, ColorSpec, LayerText, TextCell } from '@cld/model';
import { studToPx, COLOR_DEFAULT } from './coords';

const PROBE_PX = 100;

export interface TextCellRef {
  layerId: string;
  cellIndex: number;
  cell: TextCell;
}

export function TextLayers({
  map,
  isViewer,
  onEditText,
}: {
  map: BbmMap;
  isViewer?: boolean;
  onEditText?: (ref: TextCellRef) => void;
}) {
  const layers = map.layers.filter((l): l is LayerText => l.type === 'text' && l.visible);
  if (layers.length === 0) return null;
  return (
    <Group>
      {layers.map((layer) => {
        const opacity = Math.max(0, Math.min(100, layer.transparency)) / 100;
        return (
          <Group key={layer.id} opacity={opacity}>
            {layer.textCells.map((cell, i) => (
              <FittedTextCell
                key={i}
                cell={cell}
                interactive={!isViewer && !!onEditText}
                onDblClick={() => onEditText?.({ layerId: layer.id, cellIndex: i, cell })}
              />
            ))}
          </Group>
        );
      })}
    </Group>
  );
}

function FittedTextCell({
  cell,
  interactive,
  onDblClick,
}: {
  cell: TextCell;
  interactive?: boolean;
  onDblClick?: () => void;
}) {
  const ref = useRef<Konva.Text | null>(null);
  const [layout, setLayout] = useState({ fontSize: PROBE_PX, w: 0, h: 0 });

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    // Force the node to its probe size to get a clean measurement.
    node.fontSize(PROBE_PX);
    const probe = node.getClientRect({ skipTransform: true, skipShadow: true, skipStroke: true });
    if (probe.width <= 0 || probe.height <= 0) return;

    const orient = ((cell.orientation % 360) + 360) % 360;
    const rot90 = Math.abs(orient - 90) < 1 || Math.abs(orient - 270) < 1;
    const boxWpx = (rot90 ? cell.displayArea.height : cell.displayArea.width) * studToPx();
    const boxHpx = (rot90 ? cell.displayArea.width : cell.displayArea.height) * studToPx();

    const scale = Math.min(boxWpx / probe.width, boxHpx / probe.height);
    const finalSize = Math.max(1, Math.floor(PROBE_PX * scale));

    // Re-measure at the final size so the offsetX/Y centring is exact.
    node.fontSize(finalSize);
    const final = node.getClientRect({ skipTransform: true, skipShadow: true, skipStroke: true });
    setLayout({ fontSize: finalSize, w: final.width, h: final.height });
  }, [
    cell.text,
    cell.displayArea.width,
    cell.displayArea.height,
    cell.orientation,
    cell.font.family,
    cell.font.style,
  ]);

  const style = (cell.font.style ?? '').toLowerCase();
  const isBold = style.includes('bold');
  const isItalic = style.includes('italic');
  const fontStyle = isBold && isItalic ? 'bold italic' : isBold ? 'bold' : isItalic ? 'italic' : 'normal';

  // Centre the text on displayArea centre, rotated in place. Konva
  // rotates around (x, y); offsetX/Y shift the local bbox so its centre
  // lands on (x, y).
  const cx = (cell.displayArea.x + cell.displayArea.width / 2) * studToPx();
  const cy = (cell.displayArea.y + cell.displayArea.height / 2) * studToPx();

  return (
    <KonvaText
      ref={ref}
      x={cx}
      y={cy}
      text={cell.text}
      fontFamily={cell.font.family || 'Arial'}
      fontStyle={fontStyle}
      fontSize={layout.fontSize}
      fill={cssColor(cell.fontColor)}
      offsetX={layout.w / 2}
      offsetY={layout.h / 2}
      rotation={cell.orientation}
      listening={interactive ?? false}
      perfectDrawEnabled={false}
      hitStrokeWidth={0}
      {...(interactive && onDblClick ? { onDblClick, cursor: 'pointer' } : {})}
    />
  );
}

function cssColor(c: ColorSpec): string {
  if (c.kind === 'known') {
    const known: Record<string, string> = {
      black: '#000000',
      white: '#ffffff',
      red: '#ff0000',
      green: '#008000',
      blue: '#0000ff',
      yellow: '#ffff00',
      orange: '#ffa500',
      gray: '#808080',
      darkgray: '#a9a9a9',
      lightgray: '#d3d3d3',
    };
    return known[c.name.toLowerCase()] ?? COLOR_DEFAULT;
  }
  if (c.argb.length === 8) return `#${c.argb.slice(2)}`;
  return `#${c.argb}`;
}

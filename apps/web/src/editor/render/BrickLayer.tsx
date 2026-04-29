import { useEffect, useState } from 'react';
import { Group, Image as KonvaImage, Rect } from 'react-konva';
import * as Y from 'yjs';
import type { KonvaEventObject } from 'konva/lib/Node';
import type { BbmMap, Brick, LayerBrick } from '@cld/model';
import { useQuery } from '@tanstack/react-query';
import { api, spriteUrlFor, type PartWire } from '../../api';
import { useEditorStore } from '../editorStore';
import { deleteBricks, moveBrick, translateBricks } from '../mutations';
import { studToPx } from './coords';
import { ensureSprite, getSpriteSync } from './spriteCache';

interface Props {
  map: BbmMap;
  doc: Y.Doc;
  /** When true, the canvas is read-only (no drag, no delete-on-click). */
  isViewer?: boolean;
}

export function BrickLayer({ map, doc, isViewer = false }: Props) {
  const catalog = useQuery({
    queryKey: ['parts-catalog'],
    queryFn: api.parts.catalog,
    staleTime: 5 * 60 * 1000,
  });

  const partsByKey = new Map<string, PartWire>();
  if (catalog.data) {
    for (const p of catalog.data.parts) partsByKey.set(p.partNumber.toLowerCase(), p);
  }

  const brickLayers = map.layers.filter((l): l is LayerBrick => l.type === 'brick');
  return (
    <Group>
      {brickLayers.map((layer) =>
        layer.visible
          ? layer.bricks.map((brick) => (
              <BrickGlyph
                key={brick.id}
                brick={brick}
                layerId={layer.id}
                doc={doc}
                meta={partsByKey.get(brick.partNumber.toLowerCase())}
                isViewer={isViewer}
              />
            ))
          : null,
      )}
    </Group>
  );
}

function BrickGlyph({
  brick,
  layerId,
  doc,
  meta,
  isViewer,
}: {
  brick: Brick;
  layerId: string;
  doc: Y.Doc;
  isViewer: boolean;
  meta: PartWire | undefined;
}) {
  const selection = useEditorStore((s) => s.selection);
  const tool = useEditorStore((s) => s.tool);
  const toggleSelected = useEditorStore((s) => s.toggleSelected);
  const isSelected = selection.includes(brick.id);
  const spriteUrl = meta ? spriteUrlFor(meta) : '';

  // Ensure the sprite gets loaded into the sync cache. A successful load
  // bumps a counter so this component re-renders and renders the image.
  const [, setRev] = useState(0);
  useEffect(() => {
    if (!spriteUrl) return;
    let cancelled = false;
    ensureSprite(spriteUrl)
      .then(() => {
        if (!cancelled) setRev((r) => r + 1);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [spriteUrl]);

  const x = studToPx(brick.displayArea.x);
  const y = studToPx(brick.displayArea.y);
  const w = studToPx(brick.displayArea.width);
  const h = studToPx(brick.displayArea.height);

  const sprite = spriteUrl ? getSpriteSync(spriteUrl) : null;

  function handleClick(e: KonvaEventObject<MouseEvent | TouchEvent>) {
    if (tool === 'select') {
      // Selection itself is local state — viewers can highlight bricks
      // for their own reading purposes, but mutations are blocked below.
      e.cancelBubble = true;
      const additive =
        'shiftKey' in e.evt ? e.evt.shiftKey || e.evt.metaKey : false;
      toggleSelected(brick.id, additive);
    } else if (tool === 'delete' && !isViewer) {
      e.cancelBubble = true;
      deleteBricks(doc, layerId, [brick.id]);
    }
  }

  function handleDragEnd(e: KonvaEventObject<DragEvent>) {
    if (isViewer) return;
    if (tool !== 'drag' && tool !== 'select') return;
    const newCentreStudX = e.target.x() / studToPx();
    const newCentreStudY = e.target.y() / studToPx();

    if (selection.includes(brick.id) && selection.length > 1) {
      // Multi-select drag: translate every selected brick by the same delta.
      // Using THIS brick's old centre to compute the delta keeps relative
      // positions intact when the user drags by another brick in the
      // selection.
      const oldCentreStudX = brick.displayArea.x + brick.displayArea.width / 2;
      const oldCentreStudY = brick.displayArea.y + brick.displayArea.height / 2;
      const dx = newCentreStudX - oldCentreStudX;
      const dy = newCentreStudY - oldCentreStudY;
      translateBricks(doc, layerId, selection, dx, dy);
    } else {
      moveBrick(doc, layerId, brick.id, newCentreStudX, newCentreStudY);
    }
  }

  return (
    <Group
      x={x + w / 2}
      y={y + h / 2}
      rotation={brick.orientation}
      draggable={!isViewer && (tool === 'drag' || tool === 'select')}
      onClick={handleClick}
      onTap={handleClick}
      onDragEnd={handleDragEnd}
    >
      {sprite ? (
        <KonvaImage
          image={sprite}
          x={-w / 2}
          y={-h / 2}
          width={w}
          height={h}
          opacity={1}
        />
      ) : (
        <Rect
          x={-w / 2}
          y={-h / 2}
          width={w}
          height={h}
          fill="#404040"
          stroke="#888"
          strokeWidth={1}
        />
      )}
      {isSelected && (
        <Rect
          x={-w / 2 - 2}
          y={-h / 2 - 2}
          width={w + 4}
          height={h + 4}
          stroke="#3b82f6"
          strokeWidth={2}
          dash={[4, 4]}
          listening={false}
        />
      )}
    </Group>
  );
}

// Mutation helpers (deleteBricks, moveBrick, translateBricks) live in
// `../mutations.ts`, where they're exercised by mutations.test.ts.

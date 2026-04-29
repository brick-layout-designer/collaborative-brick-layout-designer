import { useEffect, useState } from 'react';
import { Group, Image as KonvaImage, Rect } from 'react-konva';
import * as Y from 'yjs';
import type { KonvaEventObject } from 'konva/lib/Node';
import type { BbmMap, Brick, LayerBrick } from '@cld/model';
import { useQuery } from '@tanstack/react-query';
import { api, type PartWire } from '../../api';
import { useEditorStore } from '../editorStore';
import { LOCAL_ORIGIN } from '../useLayoutDoc';
import { studToPx } from './coords';
import { ensureSprite, getSpriteSync } from './spriteCache';

interface Props {
  map: BbmMap;
  doc: Y.Doc;
}

export function BrickLayer({ map, doc }: Props) {
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
}: {
  brick: Brick;
  layerId: string;
  doc: Y.Doc;
  meta: PartWire | undefined;
}) {
  const selection = useEditorStore((s) => s.selection);
  const tool = useEditorStore((s) => s.tool);
  const toggleSelected = useEditorStore((s) => s.toggleSelected);
  const isSelected = selection.includes(brick.id);
  const spriteUrl = meta?.spritePath ? `/parts/${meta.spritePath}` : '';

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
      e.cancelBubble = true;
      const additive =
        'shiftKey' in e.evt ? e.evt.shiftKey || e.evt.metaKey : false;
      toggleSelected(brick.id, additive);
    } else if (tool === 'delete') {
      e.cancelBubble = true;
      deleteBrick(doc, layerId, brick.id);
    }
  }

  function handleDragEnd(e: KonvaEventObject<DragEvent>) {
    if (tool !== 'drag' && tool !== 'select') return;
    const newX = e.target.x();
    const newY = e.target.y();
    moveBrick(doc, layerId, brick.id, newX / studToPx(), newY / studToPx());
  }

  return (
    <Group
      x={x + w / 2}
      y={y + h / 2}
      rotation={brick.orientation}
      draggable={tool === 'drag' || tool === 'select'}
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

// ---------------------------------------------------------------------------
// Mutations — every doc change wraps in doc.transact(fn, LOCAL_ORIGIN) so
// per-user undo (Y.UndoManager) only walks back our own transactions.
// ---------------------------------------------------------------------------

function deleteBrick(doc: Y.Doc, layerId: string, brickId: string): void {
  doc.transact(() => {
    const layerData = doc.getMap('layerData').get(layerId);
    if (!(layerData instanceof Y.Map)) return;
    const bricks = layerData.get('bricks');
    if (!(bricks instanceof Y.Array)) return;
    const idx = findBrickIndex(bricks, brickId);
    if (idx === -1) return;
    bricks.delete(idx, 1);
  }, LOCAL_ORIGIN);
}

function moveBrick(
  doc: Y.Doc,
  layerId: string,
  brickId: string,
  newX: number,
  newY: number,
): void {
  doc.transact(() => {
    const layerData = doc.getMap('layerData').get(layerId);
    if (!(layerData instanceof Y.Map)) return;
    const bricks = layerData.get('bricks');
    if (!(bricks instanceof Y.Array)) return;
    const idx = findBrickIndex(bricks, brickId);
    if (idx === -1) return;
    const yBrick = bricks.get(idx);
    if (!(yBrick instanceof Y.Map)) return;
    const area = yBrick.get('displayArea') as { x: number; y: number; width: number; height: number };
    yBrick.set('displayArea', {
      ...area,
      // Konva Group origin is the brick's CENTRE; convert back to top-left
      // for storage so the .bbm round-trip remains identical.
      x: newX - area.width / 2,
      y: newY - area.height / 2,
    });
  }, LOCAL_ORIGIN);
}

function findBrickIndex(bricks: Y.Array<unknown>, brickId: string): number {
  for (let i = 0; i < bricks.length; i++) {
    const b = bricks.get(i);
    if (b instanceof Y.Map && b.get('id') === brickId) return i;
  }
  return -1;
}

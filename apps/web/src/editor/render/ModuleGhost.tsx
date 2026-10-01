import { useEffect, useMemo, useState } from 'react';
import { Group, Image as KonvaImage, Rect } from 'react-konva';
import { spriteUrlFor, type PartWire } from '../../api';
import type { ModuleBatch } from '../mutations';
import { lookupPart } from '../snap';
import { ensureSprite, getSpriteSync } from './spriteCache';
import { studToPx } from './coords';

interface Props {
  batches: ModuleBatch[];
  /** Translation the drop will apply (studs), from `moduleDropTranslation`. */
  offset: { dx: number; dy: number };
  partsByKey: Map<string, PartWire>;
}

/**
 * Faded preview of a module being dragged from the Module library — port
 * of desktop `MapView::updateModuleDragPreview` (MapView.cpp:1796-1900).
 * Each brick is drawn where the drop will put it: the same translation
 * (`moduleDropTranslation`) the drop applies, so the ghost lands exactly
 * where the module will. Sprites draw at natural size rotated about the
 * displayArea centre, like BrickLayer; a part without a sprite shows its
 * displayArea box.
 */
export function ModuleGhost({ batches, offset, partsByKey }: Props) {
  const [, force] = useState(0);
  const bricks = useMemo(
    () =>
      batches.flatMap((b) =>
        b.bricks.map((brick) => {
          const meta = lookupPart(partsByKey, brick.partNumber);
          return { brick, meta, url: meta ? spriteUrlFor(meta) : '' };
        }),
      ),
    [batches, partsByKey],
  );
  useEffect(() => {
    let cancelled = false;
    const urls = [...new Set(bricks.map((b) => b.url).filter(Boolean))];
    for (const url of urls) {
      ensureSprite(url)
        .then(() => {
          if (!cancelled) force((n) => n + 1);
        })
        .catch(() => undefined);
    }
    return () => {
      cancelled = true;
    };
  }, [bricks]);

  return (
    <Group x={studToPx(offset.dx)} y={studToPx(offset.dy)} opacity={0.55} listening={false}>
      {bricks.map(({ brick, meta, url }, i) => {
        const a = brick.displayArea;
        const cx = studToPx(a.x + a.width / 2);
        const cy = studToPx(a.y + a.height / 2);
        const sprite = url ? getSpriteSync(url) : null;
        if (!sprite || !meta) {
          return (
            <Rect
              key={i}
              x={studToPx(a.x)}
              y={studToPx(a.y)}
              width={studToPx(a.width)}
              height={studToPx(a.height)}
              stroke="#60a5fa"
              strokeWidth={1}
              dash={[4, 3]}
            />
          );
        }
        const scale = 8 / (meta.pxPerStud > 0 ? meta.pxPerStud : 8);
        const w = sprite.naturalWidth * scale;
        const h = sprite.naturalHeight * scale;
        return (
          <KonvaImage
            key={i}
            image={sprite}
            x={cx}
            y={cy}
            width={w}
            height={h}
            offsetX={w / 2}
            offsetY={h / 2}
            rotation={brick.orientation ?? 0}
          />
        );
      })}
    </Group>
  );
}

import { useEffect, useState } from 'react';
import { Image as KonvaImage } from 'react-konva';
import { spriteUrlFor, type PartWire } from '../../api';
import { ensureSprite, getSpriteSync } from './spriteCache';
import { studToPx } from './coords';

interface Props {
  /** Part to ghost. Null = nothing rendered. */
  part: PartWire | null;
  /** Cursor position in world studs. */
  cursorStudX: number;
  cursorStudY: number;
}

/**
 * Faded sprite under the cursor in Place mode. Sized identically to how
 * the brick will be sized when the user clicks (sprite natural pixels /
 * pxPerStud). Phase 4 will add a snap-to-grid hint here when the cursor
 * is within tolerance of an existing connection point.
 */
export function PlaceGhost({ part, cursorStudX, cursorStudY }: Props) {
  const [, force] = useState(0);
  // Compute the sprite URL OUTSIDE the effect so it's stable per part
  // and the effect dep is a simple string.
  const url = part ? spriteUrlFor(part) : '';
  useEffect(() => {
    if (!url) return;
    let cancelled = false;
    ensureSprite(url)
      .then(() => {
        if (!cancelled) force((n) => n + 1);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [url]);

  if (!part) return null;
  const sprite = url ? getSpriteSync(url) : null;
  if (!sprite) return null;

  const widthStuds = sprite.naturalWidth / part.pxPerStud;
  const heightStuds = sprite.naturalHeight / part.pxPerStud;

  return (
    <KonvaImage
      image={sprite}
      x={studToPx(cursorStudX) - studToPx(widthStuds) / 2}
      y={studToPx(cursorStudY) - studToPx(heightStuds) / 2}
      width={studToPx(widthStuds)}
      height={studToPx(heightStuds)}
      opacity={0.4}
      listening={false}
    />
  );
}

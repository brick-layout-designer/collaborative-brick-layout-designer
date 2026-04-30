import { Rect } from 'react-konva';
import { studToPx } from './coords';
import { type Marquee } from './marqueeMath';

export type { Marquee } from './marqueeMath';
export { bricksInMarquee } from './marqueeMath';

export function MarqueeOverlay({ marquee }: { marquee: Marquee | null }) {
  if (!marquee) return null;
  const x = Math.min(marquee.x0, marquee.x1);
  const y = Math.min(marquee.y0, marquee.y1);
  const w = Math.abs(marquee.x1 - marquee.x0);
  const h = Math.abs(marquee.y1 - marquee.y0);
  return (
    <Rect
      x={studToPx(x)}
      y={studToPx(y)}
      width={studToPx(w)}
      height={studToPx(h)}
      fill="rgba(59, 130, 246, 0.15)"
      stroke="#3b82f6"
      strokeWidth={1}
      dash={[4, 4]}
      listening={false}
    />
  );
}

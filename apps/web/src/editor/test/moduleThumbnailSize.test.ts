// Module pictures: 1024 px, WebP where the browser can, small copies for lists.

import { describe, expect, it } from 'vitest';
import { canvasToThumbnail, thumbnailScale, THUMBNAIL_SIDE } from '../moduleThumbnail';
import { lowResThumbnail, moduleThumbnailUrl, moduleVersionThumbnailUrl } from '../../api';

/** A canvas whose toBlob answers like a browser that does (or doesn't) make WebP. */
function fakeCanvas(makesWebp: boolean): HTMLCanvasElement & { asked: Array<[string, number | undefined]> } {
  const asked: Array<[string, number | undefined]> = [];
  return {
    asked,
    toBlob(cb: (b: Blob | null) => void, type: string, quality?: number) {
      asked.push([type, quality]);
      const made = type === 'image/webp' && !makesWebp ? 'image/png' : type;
      cb(new Blob([new Uint8Array([1, 2, 3])], { type: made }));
    },
  } as unknown as HTMLCanvasElement & { asked: Array<[string, number | undefined]> };
}

describe('module pictures', () => {
  it('are 1024 px on the longest side', () => {
    expect(THUMBNAIL_SIDE).toBe(1024);
    // A big module: 2048 px at 1× → half.
    expect(thumbnailScale(2048, 1000)).toBe(0.5);
    expect(thumbnailScale(1000, 2048)).toBe(0.5);
    // A middling one is drawn larger, to fill 1024.
    expect(thumbnailScale(512, 256)).toBe(2);
  });

  it('fill 1024 px however small the module, so a smaller one is always an old picture', () => {
    expect(thumbnailScale(32, 16)).toBe(32);
    expect(thumbnailScale(0, 0)).toBe(1);
  });

  it('are WebP where the browser makes it, else PNG', async () => {
    const webp = fakeCanvas(true);
    expect((await canvasToThumbnail(webp)).mime).toBe('image/webp');
    expect(webp.asked).toEqual([['image/webp', 0.85]]);
    const png = fakeCanvas(false);
    expect((await canvasToThumbnail(png)).mime).toBe('image/png');
    expect(png.asked.map((a) => a[0])).toEqual(['image/webp', 'image/png']);
  });

  it('lists ask for the small copy; old 256 px pictures are low resolution', () => {
    const m = { id: 'm1', thumbnailAt: 5 };
    expect(moduleThumbnailUrl(m, 'small')).toBe('/api/modules/m1/thumbnail?v=5&size=small');
    expect(moduleThumbnailUrl(m)).toBe('/api/modules/m1/thumbnail?v=5');
    expect(moduleVersionThumbnailUrl('m1', { version: 2, hasThumbnail: true }, 'small')).toBe('/api/modules/m1/versions/2/thumbnail?size=small');
    expect(lowResThumbnail({ thumbnailAt: 5, thumbnailSide: 256 })).toBe(true);
    expect(lowResThumbnail({ thumbnailAt: 5, thumbnailSide: 511 })).toBe(true);
    expect(lowResThumbnail({ thumbnailAt: 5, thumbnailSide: 512 })).toBe(false);
    expect(lowResThumbnail({ thumbnailAt: 5, thumbnailSide: 1024 })).toBe(false);
    expect(lowResThumbnail({ thumbnailAt: null, thumbnailSide: 256 })).toBe(false);
    expect(lowResThumbnail({ thumbnailAt: 5 })).toBe(false);
  });
});

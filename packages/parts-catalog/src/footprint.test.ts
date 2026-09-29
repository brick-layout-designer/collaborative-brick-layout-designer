import { describe, expect, it } from 'vitest';
import { footprint, imageOffset } from './footprint.js';
import { imageSize } from './imageSize.js';

describe('imageSize', () => {
  it('reads GIF, PNG and JPEG headers', () => {
    const gif = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x80, 0x00, 0x40, 0x01]);
    expect(imageSize(gif)).toEqual({ w: 128, h: 320 });
    const png = new Uint8Array(24);
    png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    png.set([0, 0, 1, 0, 0, 0, 0, 0x20], 16);
    expect(imageSize(png)).toEqual({ w: 256, h: 32 });
    // SOI, an APP0 segment, then SOF0 (height 48, width 64).
    const jpg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x30, 0x00, 0x40, 0x03]);
    expect(imageSize(jpg)).toEqual({ w: 64, h: 48 });
  });

  it('is null for anything else', () => {
    expect(imageSize(new Uint8Array([1, 2, 3]))).toBeNull();
    expect(imageSize(new Uint8Array(0))).toBeNull();
  });
});

describe('footprint (BlueBrick updateImage)', () => {
  const plate = { pxPerStud: 8, spriteSize: { w: 32, h: 16 } };

  it('is the sprite box in studs, turned with the brick', () => {
    expect(footprint(plate, 0)!.size).toEqual({ w: 4, h: 2 });
    const turned = footprint(plate, 90)!.size;
    expect(turned.w).toBeCloseTo(2, 5);
    expect(turned.h).toBeCloseTo(4, 5);
    // A 45° turn grows the box: (31·√½ + 15·√½ + 1) / 8.
    expect(footprint(plate, 45)!.size.w).toBeCloseTo((46 * Math.SQRT1_2 + 1) / 8, 4);
    expect(footprint(plate, 0)!.imageOffset).toEqual({ x: 0, y: 0 });
  });

  it('a <hull> sets the box and moves the sprite centre off it', () => {
    // Hull covering only the left half of a 32 x 16 sprite.
    const part = { ...plate, hullPts: [{ x: 0, y: 0 }, { x: 15, y: 0 }, { x: 15, y: 15 }, { x: 0, y: 15 }] };
    const fp = footprint(part, 0)!;
    expect(fp.size).toEqual({ w: 2, h: 2 });
    // Sprite centre is 1 stud right of the hull box centre.
    expect(fp.imageOffset.x).toBeCloseTo(1, 5);
    expect(fp.imageOffset.y).toBeCloseTo(0, 5);
    expect(imageOffset(part, 0).x).toBeCloseTo(1, 5);
    // Turned 180°, the offset turns with it.
    expect(imageOffset(part, 180).x).toBeCloseTo(-1, 4);
  });

  it('nothing without a sprite size', () => {
    expect(footprint({ pxPerStud: 8 }, 0)).toBeNull();
    expect(imageOffset({ pxPerStud: 8, hullPts: [{ x: 0, y: 0 }] }, 0)).toEqual({ x: 0, y: 0 });
  });
});

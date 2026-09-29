// Pixel size of a GIF, PNG or JPEG from its header — the sprite size the
// desktop gets from QPixmap, which BlueBrick's footprint needs. Pure, so
// it runs in the scanner, the server and the browser.

export interface ImageSize {
  w: number;
  h: number;
}

export function imageSize(bytes: Uint8Array): ImageSize | null {
  const b = bytes;
  const at = (i: number) => b[i] ?? 0;
  // GIF87a / GIF89a: logical screen size, little-endian, at 6..9.
  if (b.length >= 10 && at(0) === 0x47 && at(1) === 0x49 && at(2) === 0x46) {
    return { w: at(6) | (at(7) << 8), h: at(8) | (at(9) << 8) };
  }
  // PNG: IHDR width / height, big-endian, at 16..23.
  if (b.length >= 24 && at(0) === 0x89 && at(1) === 0x50 && at(2) === 0x4e && at(3) === 0x47) {
    const be32 = (i: number) => ((at(i) << 24) | (at(i + 1) << 16) | (at(i + 2) << 8) | at(i + 3)) >>> 0;
    return { w: be32(16), h: be32(20) };
  }
  // JPEG: walk the segments to the first start-of-frame marker.
  if (b.length >= 4 && at(0) === 0xff && at(1) === 0xd8) {
    let i = 2;
    while (i + 9 < b.length) {
      if (at(i) !== 0xff) return null;
      const marker = at(i + 1);
      if (marker === 0xff) { i++; continue; }
      const len = (at(i + 2) << 8) | at(i + 3);
      const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
      if (isSof) return { h: (at(i + 5) << 8) | at(i + 6), w: (at(i + 7) << 8) | at(i + 8) };
      if (len < 2) return null;
      i += 2 + len;
    }
  }
  return null;
}

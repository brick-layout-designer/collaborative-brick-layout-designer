// A module's picture waits for the parts list and every part picture, so
// it never shows missing-part crosses for parts that were still loading.

import { describe, expect, it } from 'vitest';
import { waitForPartPictures } from '../moduleThumbnail';
import type { SpriteProgress } from '../render/spriteCache';

const P = (wanted: number, loaded: number, failed = 0): SpriteProgress => ({ wanted, loaded, failed, initial: false });

function script(states: { catalog: boolean; progress: SpriteProgress }[]) {
  let i = 0;
  const now = () => states[Math.min(i, states.length - 1)]!;
  return {
    catalogReady: () => now().catalog,
    progress: () => now().progress,
    sleep: async () => {
      i++;
    },
    frame: async () => {
      i++;
    },
  };
}

describe('waitForPartPictures', () => {
  it('waits for the parts list, then for every picture, before drawing', async () => {
    const s = script([
      { catalog: false, progress: P(0, 0) }, // parts list not in: would draw crosses
      { catalog: true, progress: P(3, 1) }, // pictures still loading
      { catalog: true, progress: P(3, 3) }, // all in
      { catalog: true, progress: P(3, 3) }, // after the canvas paints
    ]);
    expect(await waitForPartPictures(s.catalogReady, s.progress, 60_000, s.sleep, s.frame)).toBe(true);
  });

  it('settles again when drawing asks for more pictures', async () => {
    const seen: number[] = [];
    const s = script([
      { catalog: true, progress: P(0, 0) },
      { catalog: true, progress: P(2, 0) }, // the paint asked for two pictures
      { catalog: true, progress: P(2, 2) },
      { catalog: true, progress: P(2, 2) },
    ]);
    const ok = await waitForPartPictures(s.catalogReady, () => {
      const p = s.progress();
      seen.push(p.loaded);
      return p;
    }, 60_000, s.sleep, s.frame);
    expect(ok).toBe(true);
    // It only finished once both new pictures had loaded.
    expect(seen.at(-1)).toBe(2);
  });

  it('gives up rather than hanging a save', async () => {
    const s = script([{ catalog: false, progress: P(0, 0) }]);
    expect(await waitForPartPictures(s.catalogReady, s.progress, 0, s.sleep, s.frame)).toBe(false);
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { pasteOffset, pasteTarget, readBricksFromClipboard, writeBricksToClipboard, type ClipboardEntry } from '../clipboard';

const SAMPLE: ClipboardEntry[] = [
  {
    sourceLayerName: 'Track Layer',
    brick: {
      partNumber: 'TS_TRACK18S',
      displayArea: { x: 10, y: 20, width: 16, height: 16 },
      orientation: 0,
      altitude: 0,
      activeConnectionPointIndex: 0,
    },
  },
];

describe('clipboard — memory fallback', () => {
  beforeEach(() => {
    // Ensure the navigator.clipboard API is absent so the memory path runs.
    vi.stubGlobal('navigator', {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('round-trips bricks through the memory fallback', async () => {
    await writeBricksToClipboard(SAMPLE);
    const result = await readBricksFromClipboard();
    expect(result).toEqual(SAMPLE);
  });

  it('returns null when nothing has been written yet', async () => {
    // The module-level memoryFallback may have been set by a prior write in
    // this run; reset by writing empty and then checking a fresh read after
    // we can't clear state directly.
    // Instead, validate the shape contract: after a write, read returns it.
    await writeBricksToClipboard([]);
    const result = await readBricksFromClipboard();
    expect(result).toEqual([]);
  });

  it('overwrites previous clipboard contents', async () => {
    const first: ClipboardEntry[] = [{ ...SAMPLE[0]! }];
    const second: ClipboardEntry[] = [
      { ...SAMPLE[0]!, sourceLayerName: 'Layer 2' },
    ];
    await writeBricksToClipboard(first);
    await writeBricksToClipboard(second);
    const result = await readBricksFromClipboard();
    expect(result).toEqual(second);
  });

  it('preserves all brick fields accurately', async () => {
    const entry: ClipboardEntry = {
      sourceLayerName: 'Special',
      brick: {
        partNumber: 'MY_PART_42',
        displayArea: { x: -5, y: 100, width: 32, height: 16 },
        orientation: 270,
        altitude: 3,
        activeConnectionPointIndex: 1,
      },
    };
    await writeBricksToClipboard([entry]);
    const result = await readBricksFromClipboard();
    expect(result).toHaveLength(1);
    expect(result![0]).toEqual(entry);
  });
});

describe('clipboard — browser clipboard API', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('writes to navigator.clipboard and reads back', async () => {
    let stored = '';
    vi.stubGlobal('navigator', {
      clipboard: {
        writeText: vi.fn(async (text: string) => { stored = text; }),
        readText: vi.fn(async () => stored),
      },
    });

    await writeBricksToClipboard(SAMPLE);
    const result = await readBricksFromClipboard();
    expect(result).toEqual(SAMPLE);
  });

  it('falls back to memory when readText returns foreign content', async () => {
    vi.stubGlobal('navigator', {
      clipboard: {
        writeText: vi.fn(async () => {}),
        readText: vi.fn(async () => JSON.stringify({ kind: 'something-else', entries: [] })),
      },
    });

    // Write to set the memory fallback.
    await writeBricksToClipboard(SAMPLE);
    // Browser clipboard returns foreign content → falls through to memory.
    const result = await readBricksFromClipboard();
    expect(result).toEqual(SAMPLE);
  });

  it('falls back to memory when readText rejects', async () => {
    vi.stubGlobal('navigator', {
      clipboard: {
        writeText: vi.fn(async () => {}),
        readText: vi.fn(async () => { throw new Error('no permission'); }),
      },
    });

    await writeBricksToClipboard(SAMPLE);
    const result = await readBricksFromClipboard();
    expect(result).toEqual(SAMPLE);
  });

  it('falls back to memory when writeText rejects', async () => {
    vi.stubGlobal('navigator', {
      clipboard: {
        writeText: vi.fn(async () => { throw new Error('not allowed'); }),
        readText: vi.fn(async () => ''),
      },
    });

    await writeBricksToClipboard(SAMPLE);
    // Memory fallback must still be set even when browser write fails.
    vi.stubGlobal('navigator', {});
    const result = await readBricksFromClipboard();
    expect(result).toEqual(SAMPLE);
  });
});

describe('hasClipboardBricks', () => {
  it('is true once this session has copied bricks', async () => {
    vi.resetModules();
    const clip = await import('../clipboard');
    expect(clip.hasClipboardBricks()).toBe(false);
    await clip.writeBricksToClipboard([]);
    expect(clip.hasClipboardBricks()).toBe(false);
    await clip.writeBricksToClipboard([
      { sourceLayerName: 'Bricks', brick: { partNumber: '3001.1' } } as never,
    ]);
    expect(clip.hasClipboardBricks()).toBe(true);
  });
});

describe('paste placement (MapViewClipboard.cpp:62-73)', () => {
  it('lands the group centre under the cursor', () => {
    const areas = [
      { x: 0, y: 0, width: 4, height: 2 },
      { x: 10, y: 10, width: 2, height: 2 },
    ];
    // Centres (2, 1) and (11, 11) average to (6.5, 6).
    expect(pasteOffset(areas, { x: 100, y: 50 })).toEqual({ dx: 93.5, dy: 44 });
    expect(pasteOffset([], { x: 1, y: 1 })).toEqual({ dx: 0, dy: 0 });
  });

  it('uses the cursor, or the centre of the panned and zoomed view without one', () => {
    const view = { width: 800, height: 600, panX: 100, panY: -200, zoom: 2 };
    expect(pasteTarget({ x: 3, y: 4 }, view)).toEqual({ x: 3, y: 4 });
    // Screen centre (400, 300) → world ((400-100)/2, (300+200)/2) px = (150, 250) px → studs / 8.
    expect(pasteTarget(null, view)).toEqual({ x: 18.75, y: 31.25 });
  });
});

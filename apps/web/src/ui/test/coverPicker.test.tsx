// CoverPicker: the fit / fill / zoom / pan arithmetic, drawing the final
// picture (background first, then the picture where the preview shows it),
// and the picker itself: choosing a see-through picture offers a background
// colour, and what it composes uses the colour picked.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useRef, useState } from 'react';
import {
  CARD_H,
  CARD_W,
  anyTransparent,
  clampCrop,
  composeCover,
  coversCard,
  drawRect,
  fillCrop,
  fillZoom,
  fitCrop,
  fitZoom,
  panCrop,
  zoomAbout,
  zoomRange,
  type CoverCtx,
} from '../coverMath';
import { CoverPicker, type CoverMode, type CoverPickerHandle } from '../CoverPicker';

const wide = { w: 2400, h: 900 }; // wider than 4:3
const tall = { w: 600, h: 1200 }; // taller than 4:3

describe('cover arithmetic', () => {
  it('fits the whole picture, or fills the card', () => {
    expect(fitZoom(wide)).toBeCloseTo(0.5); // 1200 / 2400
    expect(fillZoom(wide)).toBeCloseTo(1); // 900 / 900
    expect(fitZoom(tall)).toBeCloseTo(0.75); // 900 / 1200
    expect(fillZoom(tall)).toBeCloseTo(2); // 1200 / 600
    // Fit: the whole picture shows, centred, with bands above and below.
    expect(drawRect(fitCrop(wide), wide)).toEqual({ x: 0, y: 225, w: 1200, h: 450 });
    expect(coversCard(fitCrop(wide), wide)).toBe(false);
    // Fill: covers the card, the sides cut off evenly.
    expect(drawRect(fillCrop(wide), wide)).toEqual({ x: -600, y: 0, w: 2400, h: 900 });
    expect(coversCard(fillCrop(wide), wide)).toBe(true);
    expect(zoomRange(tall)).toEqual({ min: 0.75, max: 8 });
  });

  it('keeps the zoom in range and the picture on the card', () => {
    expect(clampCrop({ zoom: 0.01, x: 0, y: 0 }, wide).zoom).toBeCloseTo(0.5);
    expect(clampCrop({ zoom: 99, x: 0, y: 0 }, wide).zoom).toBeCloseTo(4);
    // Filled: it moves until its edge meets the card's, and no further.
    const filled = fillCrop(wide);
    expect(panCrop(filled, 10_000, 10_000, wide)).toEqual({ zoom: 1, x: 600, y: 0 });
    expect(panCrop(filled, -250, 0, wide).x).toBe(-250);
    // Fitted: the smaller side can slide until it touches the card's edge.
    const fitted = fitCrop(wide);
    expect(panCrop(fitted, 0, -10_000, wide)).toEqual({ zoom: 0.5, x: 0, y: -225 });
    expect(drawRect(panCrop(fitted, 0, -10_000, wide), wide).y).toBe(0);
    // A tall picture fitted: it slides sideways until it touches either edge.
    expect(panCrop(fitCrop(tall), 10_000, 0, tall)).toEqual({ zoom: 0.75, x: 375, y: 0 });
    expect(drawRect(panCrop(fitCrop(tall), 10_000, 0, tall), tall).x + 450).toBe(CARD_W);
    expect(clampCrop({ zoom: Number.NaN, x: Number.NaN, y: 0 }, wide)).toEqual({ zoom: 0.5, x: 0, y: 0 });
  });

  it('zooms about a point, keeping what is under it still', () => {
    const c = fillCrop(wide);
    const at = { x: 900, y: 300 };
    const before = drawRect(c, wide);
    const u = (at.x - before.x) / before.w;
    const v = (at.y - before.y) / before.h;
    const z = zoomAbout(c, 2, at.x, at.y, wide);
    expect(z.zoom).toBe(2);
    const after = drawRect(z, wide);
    expect(after.x + u * after.w).toBeCloseTo(at.x);
    expect(after.y + v * after.h).toBeCloseTo(at.y);
  });

  it('spots a see-through pixel', () => {
    expect(anyTransparent([1, 2, 3, 255, 4, 5, 6, 255])).toBe(false);
    expect(anyTransparent([1, 2, 3, 255, 4, 5, 6, 0])).toBe(true);
    expect(anyTransparent([1, 2, 3, 128])).toBe(true);
  });

  it('draws the background first, then the picture where the crop puts it, at any size', () => {
    const calls: unknown[][] = [];
    const ctx: CoverCtx = {
      fillStyle: '',
      fillRect: (...a) => calls.push(['fillRect', ctx.fillStyle, ...a]),
      drawImage: (_img, ...a) => calls.push(['drawImage', ...a]),
    };
    const img = {} as CanvasImageSource;
    composeCover(ctx, img, wide, fitCrop(wide), '#123456');
    expect(calls).toEqual([
      ['fillRect', '#123456', 0, 0, CARD_W, CARD_H],
      ['drawImage', 0, 225, 1200, 450],
    ]);
    // The preview: the same picture at a quarter of the size.
    calls.length = 0;
    composeCover(ctx, img, wide, fitCrop(wide), '#123456', CARD_W / 4, CARD_H / 4);
    expect(calls).toEqual([
      ['fillRect', '#123456', 0, 0, 300, 225],
      ['drawImage', 0, 56.25, 300, 112.5],
    ]);
  });
});

// ---- the picker ------------------------------------------------------------

interface FakeCtx extends CoverCtx {
  log: unknown[][];
  getImageData: () => { data: Uint8ClampedArray };
}

let alpha = 255;
let ctxs: FakeCtx[] = [];

beforeEach(() => {
  ctxs = [];
  alpha = 255;
  vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 800, height: 400, close: () => undefined })));
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (this: HTMLCanvasElement) {
    const ctx: FakeCtx = {
      fillStyle: '',
      log: [],
      fillRect: (...a) => ctx.log.push(['fillRect', ctx.fillStyle, ...a]),
      drawImage: (_i, ...a) => ctx.log.push(['drawImage', ...a]),
      getImageData: () => ({ data: new Uint8ClampedArray([9, 9, 9, alpha, 9, 9, 9, 255]) }),
    };
    ctxs.push(ctx);
    return ctx as unknown as CanvasRenderingContext2D;
  } as never);
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (cb: BlobCallback, type?: string) {
    cb(new Blob(['xx'], { type: type ?? 'image/png' }));
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function Harness({ onHandle }: { onHandle: (h: { current: CoverPickerHandle | null }) => void }) {
  const [mode, setMode] = useState<CoverMode>('drawn');
  const handle = useRef<CoverPickerHandle | null>(null);
  onHandle(handle);
  return <CoverPicker mode={mode} onModeChange={setMode} drawnUrl="/drawn.png" currentUrl={null} maxBytes={1024} handle={handle} />;
}

const pick = async (type: string) => {
  const file = new File(['x'], `p.${type.split('/')[1]}`, { type });
  await act(async () => {
    fireEvent.change(screen.getByLabelText('Cover picture'), { target: { files: [file] } });
  });
};

describe('CoverPicker', () => {
  it('starts on the drawn picture, and composes nothing until a picture is chosen', async () => {
    let h: { current: CoverPickerHandle | null } = { current: null };
    render(<Harness onHandle={(x) => (h = x)} />);
    expect(screen.getByAltText('The drawn picture')).toHaveProperty('src', expect.stringContaining('/drawn.png'));
    expect(h.current!.hasNew()).toBe(false);
    expect(await h.current!.compose()).toBeNull();
  });

  it('a see-through picture offers a background colour, and the picture is composed on it', async () => {
    alpha = 0;
    let h: { current: CoverPickerHandle | null } = { current: null };
    render(<Harness onHandle={(x) => (h = x)} />);
    fireEvent.click(screen.getByLabelText('Upload your own picture'));
    await pick('image/png');
    await waitFor(() => expect(screen.getByTestId('cover-preview')).toBeTruthy());
    expect(screen.getByText(/see-through/)).toBeTruthy();
    fireEvent.click(screen.getByRole('radio', { name: 'Black' }));
    expect(h.current!.hasNew()).toBe(true);
    const up = await h.current!.compose();
    expect(up).toMatchObject({ mime: 'image/webp' });
    // The full-size canvas: black first, then the picture filling the card (800 × 400 → zoom 2.25).
    const last = ctxs[ctxs.length - 1]!.log;
    expect(last[0]).toEqual(['fillRect', '#000000', 0, 0, CARD_W, CARD_H]);
    expect(last[1]).toEqual(['drawImage', -300, 0, 1800, 900]);
  });

  it('a photo that fills the card asks for no background; Fit leaves bands, so it does', async () => {
    render(<Harness onHandle={() => undefined} />);
    fireEvent.click(screen.getByLabelText('Upload your own picture'));
    await pick('image/jpeg');
    await waitFor(() => expect(screen.getByTestId('cover-preview')).toBeTruthy());
    expect(screen.queryByRole('radiogroup', { name: 'Background colour' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Fit' }));
    expect(screen.getByRole('radiogroup', { name: 'Background colour' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Fill' }));
    expect(screen.queryByRole('radiogroup', { name: 'Background colour' })).toBeNull();
  });

  it('refuses other kinds of file, and “Remove custom picture” goes back to the drawn one', async () => {
    let h: { current: CoverPickerHandle | null } = { current: null };
    render(<Harness onHandle={(x) => (h = x)} />);
    fireEvent.click(screen.getByLabelText('Upload your own picture'));
    await pick('image/gif');
    expect(screen.getByText('Choose a PNG, JPEG or WebP picture.')).toBeTruthy();
    await pick('image/png');
    await waitFor(() => expect(screen.getByTestId('cover-preview')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Remove custom picture' }));
    expect(screen.getByLabelText('Use the drawn picture')).toHaveProperty('checked', true);
    expect(h.current!.hasNew()).toBe(false);
  });

  it('the mouse wheel zooms the preview without scrolling the page behind it', async () => {
    render(<Harness onHandle={() => undefined} />);
    fireEvent.click(screen.getByLabelText('Upload your own picture'));
    await pick('image/jpeg');
    const preview = await waitFor(() => screen.getByTestId('cover-preview'));
    const zoom = screen.getByLabelText('Zoom') as HTMLInputElement;
    const before = Number(zoom.value);
    const wheel = new WheelEvent('wheel', { deltaY: -200, clientX: 10, clientY: 10, bubbles: true, cancelable: true });
    act(() => {
      preview.dispatchEvent(wheel);
    });
    expect(wheel.defaultPrevented).toBe(true);
    expect(Number(zoom.value)).toBeGreaterThan(before);
  });

  it('says so when even the smallest version is over the limit', async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (cb: BlobCallback, type?: string) {
      cb(new Blob([new Uint8Array(4096)], { type: type ?? 'image/png' }));
    });
    let h: { current: CoverPickerHandle | null } = { current: null };
    render(<Harness onHandle={(x) => (h = x)} />);
    fireEvent.click(screen.getByLabelText('Upload your own picture'));
    await pick('image/jpeg');
    await waitFor(() => expect(screen.getByTestId('cover-preview')).toBeTruthy());
    await expect(h.current!.compose()).rejects.toThrow('too big');
  });
});

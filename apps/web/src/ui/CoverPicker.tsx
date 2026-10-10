// CoverPicker: the picture on a catalog card (a collection, a module, a
// part). "Use the drawn picture", or "Upload your own picture": a file, or
// the camera or gallery on a phone. The upload is placed on the card by
// dragging, a zoom slider, pinching, the mouse wheel or the arrow keys, with
// Fit (the whole picture) and Fill (cover the card). The preview is the
// card's size and crop. A see-through picture (or the bands beside a fitted
// one) gets a background color. The browser draws the final 1200 × 900
// picture; the server checks and re-encodes it, with no metadata.

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { CARD_H, CARD_W, anyTransparent, clampCrop, composeCover, coversCard, fillCrop, fitCrop, panCrop, zoomAbout, zoomRange, type Crop, type Size } from './coverMath';

const COVER_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
/** The preview: a catalog card's width, 4:3. */
const PREVIEW_W = 288;
const PREVIEW_H = (PREVIEW_W * CARD_H) / CARD_W;

/** "5 MB", "300 KB". */
export const sizeText = (bytes: number) => (bytes >= 1024 * 1024 ? `${Math.round((bytes / (1024 * 1024)) * 10) / 10} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);

/** A picture to upload as a cover, as the routes take it (JSON, base64), and a preview. */
export interface CoverUpload {
  mime: string;
  data: string;
  previewUrl: string;
}

/** What the parent asks for when it saves. */
export interface CoverPickerHandle {
  /** A new picture was chosen (and not removed). */
  hasNew: () => boolean;
  /** The composed picture, ready to upload; null when there's no new one. */
  compose: () => Promise<CoverUpload | null>;
}

export type CoverMode = 'drawn' | 'upload';

/** The background swatches: the theme's card color first, then a few plain ones. */
export const SWATCHES: { label: string; value: string }[] = [
  { label: 'White', value: '#FFFFFF' },
  { label: 'Light grey', value: '#E5E7EB' },
  { label: 'Dark grey', value: '#2A2E33' },
  { label: 'Black', value: '#000000' },
  { label: 'Sky', value: '#BFDBFE' },
  { label: 'Grass', value: '#BBF7D0' },
];

/** The theme's card background, as it is now (it's baked into the picture). */
export function themeBackground(): string {
  try {
    const v = getComputedStyle(document.documentElement).getPropertyValue('--soft').trim();
    return v || '#F1EEE8';
  } catch {
    return '#F1EEE8';
  }
}

interface Loaded {
  src: CanvasImageSource;
  size: Size;
  transparent: boolean;
  name: string;
}

async function loadPicture(file: File): Promise<Loaded> {
  if (!COVER_TYPES.includes(file.type)) throw new Error('Choose a PNG, JPEG or WebP picture.');
  let src: CanvasImageSource;
  let size: Size;
  try {
    // Turned the way the camera says.
    const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
    src = bmp;
    size = { w: bmp.width, h: bmp.height };
  } catch {
    throw new Error('That picture couldn’t be read.');
  }
  if (!size.w || !size.h) throw new Error('That picture couldn’t be read.');
  // A JPEG is never see-through; for the others, look at a small copy.
  let transparent = false;
  if (file.type !== 'image/jpeg') {
    const c = document.createElement('canvas');
    const s = Math.min(1, 256 / Math.max(size.w, size.h));
    c.width = Math.max(1, Math.round(size.w * s));
    c.height = Math.max(1, Math.round(size.h * s));
    const ctx = c.getContext('2d', { willReadFrequently: true });
    if (ctx) {
      ctx.drawImage(src, 0, 0, c.width, c.height);
      transparent = anyTransparent(ctx.getImageData(0, 0, c.width, c.height).data);
    }
  }
  return { src, size, transparent, name: file.name };
}

const blobOf = (canvas: HTMLCanvasElement, type: string, quality: number) => new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));

const dataUrlOf = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error('That picture couldn’t be read.'));
    r.readAsDataURL(blob);
  });

/** The final picture: WebP where the browser can, else JPEG, smaller until it fits `max`. */
async function encodeCanvas(canvas: HTMLCanvasElement, max: number): Promise<CoverUpload> {
  for (const q of [0.9, 0.8, 0.7, 0.55]) {
    let blob = await blobOf(canvas, 'image/webp', q);
    if (!blob || blob.type !== 'image/webp') blob = await blobOf(canvas, 'image/jpeg', q);
    if (!blob) break;
    if (blob.size <= max) {
      const url = await dataUrlOf(blob);
      return { mime: blob.type, data: url.slice(url.indexOf(',') + 1), previewUrl: url };
    }
  }
  throw new Error(`That picture is too big. Choose one under ${sizeText(max)}.`);
}

const btn = 'tap-target rounded-lg border border-border px-3 py-1.5 hover:bg-soft disabled:opacity-40';

export function CoverPicker({
  mode,
  onModeChange,
  drawnUrl,
  drawnLabel = 'Use the drawn picture',
  drawnHint,
  currentUrl,
  maxBytes,
  reviewNote,
  handle,
  onRemoveCurrent,
  name = 'cover-mode',
}: {
  mode: CoverMode;
  onModeChange: (m: CoverMode) => void;
  /** The drawn picture (what "Use the drawn picture" shows). */
  drawnUrl: string | null;
  drawnLabel?: string;
  /** More about the drawn choice (a collection: pick the item in the list). */
  drawnHint?: ReactNode;
  /** The uploaded picture it has now (or the one waiting for review). */
  currentUrl: string | null;
  maxBytes: number;
  /** "A moderator checks it…", when it's public. */
  reviewNote?: string | undefined;
  /** Filled in for the parent, to compose the picture when it saves. */
  handle: { current: CoverPickerHandle | null };
  /** "Remove custom picture" pressed: back to the drawn one. */
  onRemoveCurrent?: () => void;
  name?: string;
}) {
  const [pic, setPic] = useState<Loaded | null>(null);
  const [crop, setCrop] = useState<Crop>({ zoom: 1, x: 0, y: 0 });
  const [bgChoice, setBgChoice] = useState<string>('theme');
  const [custom, setCustom] = useState('#336699');
  const [error, setError] = useState<string | null>(null);
  const [coarse] = useState(() => typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const background = bgChoice === 'theme' ? themeBackground() : bgChoice === 'custom' ? custom : bgChoice;
  const showBackground = !!pic && (pic.transparent || !coversCard(crop, pic.size));

  // The preview, redrawn as the crop or background changes (at 2× for sharp screens).
  useEffect(() => {
    const c = canvasRef.current;
    if (!c || !pic) return;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    composeCover(ctx, pic.src, pic.size, crop, background, c.width, c.height);
  }, [pic, crop, background]);

  // The mouse wheel zooms the preview, and only that: a listener React
  // would add is passive, so the dialog behind it scrolled too.
  useEffect(() => {
    const c = canvasRef.current;
    if (!c || !pic) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = c.getBoundingClientRect();
      const at = { x: ((e.clientX - r.left) / r.width) * CARD_W, y: ((e.clientY - r.top) / r.height) * CARD_H };
      setCrop((cr) => zoomAbout(cr, cr.zoom * Math.exp(-e.deltaY / 500), at.x, at.y, pic.size));
    };
    c.addEventListener('wheel', onWheel, { passive: false });
    return () => c.removeEventListener('wheel', onWheel);
    // The canvas comes and goes with the mode.
  }, [pic, mode]);

  handle.current = {
    hasNew: () => mode === 'upload' && !!pic,
    compose: async () => {
      if (mode !== 'upload' || !pic) return null;
      const canvas = document.createElement('canvas');
      canvas.width = CARD_W;
      canvas.height = CARD_H;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('This browser can’t prepare the picture.');
      composeCover(ctx, pic.src, pic.size, crop, background);
      return encodeCanvas(canvas, maxBytes);
    },
  };

  const choose = (f: File | undefined) => {
    if (!f) return;
    setError(null);
    loadPicture(f).then(
      (p) => {
        setPic(p);
        // Start by covering the card: what most photos want.
        setCrop(fillCrop(p.size));
        onModeChange('upload');
      },
      (e: Error) => setError(e.message),
    );
  };

  /** A pointer's position in card pixels. */
  const toCard = (clientX: number, clientY: number) => {
    const r = canvasRef.current!.getBoundingClientRect();
    return { x: ((clientX - r.left) / r.width) * CARD_W, y: ((clientY - r.top) / r.height) * CARD_H };
  };

  const range = pic ? zoomRange(pic.size) : { min: 1, max: 1 };
  // The slider runs on a log scale, so each step feels the same.
  const toSlider = (z: number) => (Math.log(z / range.min) / Math.log(range.max / range.min || 2)) * 100;
  const fromSlider = (v: number) => range.min * Math.pow(range.max / range.min || 2, v / 100);

  const fileInput = (label: string, capture: boolean) => (
    <label className={`${btn} inline-flex cursor-pointer items-center font-semibold focus-within:ring-2 focus-within:ring-accent`}>
      {label}
      <input
        type="file"
        accept="image/png,image/jpeg,image/webp"
        {...(capture ? { capture: 'environment' as const } : {})}
        aria-label={capture ? 'Take a photo for the cover' : 'Cover picture'}
        className="sr-only"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          choose(f);
        }}
      />
    </label>
  );

  return (
    <fieldset className="space-y-2" data-testid="cover-picker">
      <legend className="mb-1 text-muted">Cover</legend>
      <label className="flex min-h-9 items-center gap-2">
        <input type="radio" name={name} checked={mode === 'drawn'} onChange={() => onModeChange('drawn')} />
        {drawnLabel}
      </label>
      {mode === 'drawn' && (
        <div className="space-y-1 pl-6">
          {drawnUrl ? (
            <img src={drawnUrl} alt="The drawn picture" className="aspect-[4/3] w-full max-w-72 rounded-lg border border-line bg-soft object-contain" />
          ) : null}
          {drawnHint}
        </div>
      )}
      <label className="flex min-h-9 items-center gap-2">
        <input type="radio" name={name} checked={mode === 'upload'} onChange={() => onModeChange('upload')} />
        Upload your own picture
      </label>
      {mode === 'upload' && (
        <div className="space-y-3 rounded-lg border border-line p-3">
          {pic ? (
            <>
              <canvas
                ref={canvasRef}
                width={PREVIEW_W * 2}
                height={PREVIEW_H * 2}
                tabIndex={0}
                role="img"
                aria-label="Cover preview, as cards show it. Drag to move it, pinch or use the slider to zoom; arrow keys move it too."
                data-testid="cover-preview"
                style={{ width: PREVIEW_W, maxWidth: '100%', aspectRatio: `${CARD_W} / ${CARD_H}`, touchAction: 'none' }}
                className="cursor-grab rounded-lg border border-line bg-soft active:cursor-grabbing focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                onPointerDown={(e) => {
                  e.currentTarget.setPointerCapture?.(e.pointerId);
                  pointers.current.set(e.pointerId, toCard(e.clientX, e.clientY));
                }}
                onPointerMove={(e) => {
                  const prev = pointers.current.get(e.pointerId);
                  if (!prev) return;
                  const now = toCard(e.clientX, e.clientY);
                  const all = [...pointers.current.entries()];
                  if (all.length >= 2) {
                    // Pinch: the distance between two fingers sets the zoom, about their middle.
                    const other = all.find(([id]) => id !== e.pointerId)![1];
                    const before = Math.hypot(prev.x - other.x, prev.y - other.y);
                    const after = Math.hypot(now.x - other.x, now.y - other.y);
                    if (before > 4) setCrop((c) => zoomAbout(c, (c.zoom * after) / before, (now.x + other.x) / 2, (now.y + other.y) / 2, pic.size));
                  } else {
                    setCrop((c) => panCrop(c, now.x - prev.x, now.y - prev.y, pic.size));
                  }
                  pointers.current.set(e.pointerId, now);
                }}
                onPointerUp={(e) => pointers.current.delete(e.pointerId)}
                onPointerCancel={(e) => pointers.current.delete(e.pointerId)}
                onKeyDown={(e) => {
                  const step = e.shiftKey ? 60 : 15;
                  const move: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
                  const m = move[e.key];
                  if (m) {
                    e.preventDefault();
                    setCrop((c) => panCrop(c, m[0], m[1], pic.size));
                  } else if (e.key === '+' || e.key === '=' || e.key === '-') {
                    e.preventDefault();
                    setCrop((c) => zoomAbout(c, c.zoom * (e.key === '-' ? 1 / 1.1 : 1.1), CARD_W / 2, CARD_H / 2, pic.size));
                  }
                }}
              />
              <div className="flex flex-wrap items-center gap-2">
                <label className="flex min-w-[10rem] flex-1 items-center gap-2">
                  <span className="text-muted">Zoom</span>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    step={0.5}
                    value={toSlider(crop.zoom)}
                    aria-label="Zoom"
                    onChange={(e) => setCrop((c) => zoomAbout(c, fromSlider(Number(e.target.value)), CARD_W / 2, CARD_H / 2, pic.size))}
                    className="flex-1 accent-[var(--accent)]"
                  />
                </label>
                <button type="button" className={btn} onClick={() => setCrop(clampCrop(fitCrop(pic.size), pic.size))} title="Show the whole picture">
                  Fit
                </button>
                <button type="button" className={btn} onClick={() => setCrop(fillCrop(pic.size))} title="Cover the whole card">
                  Fill
                </button>
              </div>
              {showBackground && (
                <div className="space-y-1" role="radiogroup" aria-label="Background color">
                  <p className="text-muted">{pic.transparent ? 'Your picture is see-through in places. Background color:' : 'Background color beside the picture:'}</p>
                  <div className="flex flex-wrap items-center gap-2">
                    {[{ label: 'Same as the site', value: 'theme' }, ...SWATCHES].map((s) => (
                      <button
                        key={s.value}
                        type="button"
                        role="radio"
                        aria-checked={bgChoice === s.value}
                        aria-label={s.label}
                        title={s.label}
                        onClick={() => setBgChoice(s.value)}
                        style={{ background: s.value === 'theme' ? 'var(--soft)' : s.value }}
                        className={`size-8 rounded-full border border-border ${bgChoice === s.value ? 'ring-2 ring-accent ring-offset-2 ring-offset-panel' : ''}`}
                      />
                    ))}
                    <label
                      className={`relative inline-flex size-8 cursor-pointer items-center justify-center overflow-hidden rounded-full border border-border ${bgChoice === 'custom' ? 'ring-2 ring-accent ring-offset-2 ring-offset-panel' : ''}`}
                      style={{ background: custom }}
                      title="Pick a color"
                    >
                      <span className="sr-only">Pick a color</span>
                      <input
                        type="color"
                        value={custom}
                        aria-label="Pick a background color"
                        onChange={(e) => {
                          setCustom(e.target.value);
                          setBgChoice('custom');
                        }}
                        className="absolute inset-0 cursor-pointer opacity-0"
                      />
                    </label>
                  </div>
                </div>
              )}
            </>
          ) : currentUrl ? (
            <img src={currentUrl} alt="Your cover picture" className="aspect-[4/3] w-full max-w-72 rounded-lg border border-line bg-soft object-cover" />
          ) : (
            <p className="text-xs text-muted">No picture yet. Until you choose one, the drawn picture is used.</p>
          )}
          <div className="flex flex-wrap items-center gap-2">
            {fileInput(pic || currentUrl ? 'Choose another picture' : 'Choose a picture', false)}
            {coarse && fileInput('Take a photo', true)}
            {(pic || currentUrl) && (
              <button
                type="button"
                onClick={() => {
                  setPic(null);
                  onModeChange('drawn');
                  onRemoveCurrent?.();
                }}
                className="tap-target rounded-lg px-3 py-1.5 text-danger hover:bg-soft"
              >
                Remove custom picture
              </button>
            )}
          </div>
          {error && <p className="text-danger">{error}</p>}
          <p className="text-xs text-muted">
            A PNG, JPEG or WebP picture{maxBytes ? `, up to ${sizeText(maxBytes)} once placed` : ''}. Cards show it exactly like the preview.
            {reviewNote ? ` ${reviewNote}` : ''}
          </p>
        </div>
      )}
      {mode === 'drawn' && error && <p className="text-danger">{error}</p>}
    </fieldset>
  );
}

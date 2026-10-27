// While the view moves (a middle-button pan, a turn of the wheel, fingers on
// a touch screen) the map is shown as one picture that moves and scales with
// the view, instead of drawing every part again on every frame. On a layout
// of 5,000 parts each of those frames used to draw all 5,000.
//
// The picture is taken of the sheets that are costly to draw (the background
// sheet with the venue and areas, the parts sheet, the module outlines), a
// margin around the screen included, so a pan shows parts coming in from the
// edge. It is taken again, once, when the view leaves it or has zoomed in so
// far it would look soft, and when the map changes during the move (someone
// else's edit, a part's picture arriving). When the view stops, the sheets
// are drawn sharp again, as before.
//
// Nodes named VIEW_LIVE (the grid and the background color: cheap, and drawn
// for the view on screen only) keep being drawn live under the picture.
//
// Konva draws a layer through its `drawScene`; while frozen, each frozen
// layer's own `drawScene` is swapped for one that draws the live nodes and
// the picture. A draw into another canvas (an export) goes through as usual.

import Konva from 'konva';
import { SceneCanvas } from 'konva/lib/Canvas';

/** Name for nodes drawn live during a move, not taken into the picture. */
export const VIEW_LIVE = 'view-live';

export interface ViewBitmapOptions {
  /** The margin around the screen taken into the picture, as a share of its width and height on each side. */
  margin: number;
  /** The most device pixels the picture may have; past that it's taken at a lower resolution. */
  maxPixels: number;
  /** How far the view may zoom in on a picture before it's taken again (it would look soft). */
  maxZoomIn: number;
  /** The least time between two pictures taken because the map changed. */
  minChangeGapMs: number;
}

const DEFAULTS: ViewBitmapOptions = { margin: 0.5, maxPixels: 6_000_000, maxZoomIn: 1.75, minChangeGapMs: 150 };

interface Picture {
  /** Where it covers, in the stage's own (map) units. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** The view's scale when it was taken. */
  scale: number;
  /** The view and map it was taken of, to reuse it for the next move while nothing changed. */
  stageX: number;
  stageY: number;
  stageW: number;
  stageH: number;
  version: number;
}

type DrawScene = Konva.Layer['drawScene'];

/** After a move stops, when to take the next move's picture (after the sharp draw). */
const AFTER_MOVE_MS = 250;
/** After the map changes, how long it must stay still before the next move's picture is taken. */
const SETTLE_MS = 1000;

export class ViewBitmap {
  private readonly opts: ViewBitmapOptions;
  private canvas: SceneCanvas | null = null;
  private picture: Picture | null = null;
  private frozen = false;
  /** Bumped whenever the map's drawing may have changed. */
  private version = 0;
  private lastTakenAt = 0;
  private changeTimer: ReturnType<typeof setTimeout> | null = null;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private idleHandle: number | null = null;
  /** The sheets whose next draw is the sharp one after a move. */
  private sharpDrawPending = new Set<Konva.Layer>();
  private swapped: { layer: Konva.Layer; own: DrawScene | undefined }[] = [];
  private readonly offDraw: (() => void)[] = [];
  /** How many pictures were taken (for tests and profiling). */
  taken = 0;

  constructor(
    private readonly stage: Konva.Stage,
    /** The sheets taken into the picture, bottom first. */
    private readonly layers: () => Konva.Layer[],
    opts: Partial<ViewBitmapOptions> = {},
  ) {
    this.opts = { ...DEFAULTS, ...opts };
  }

  /** The view starts moving: show the picture from the next frame. */
  freeze(): void {
    if (this.frozen) return;
    const layers = this.layers();
    if (layers.length === 0) return;
    this.frozen = true;
    this.cancelIdle();
    // A picture of this very map is used as long as it covers the view.
    if (this.picture && this.picture.version !== this.version) this.picture = null;
    layers.forEach((layer, i) => {
      const own = Object.prototype.hasOwnProperty.call(layer, 'drawScene') ? layer.drawScene : undefined;
      const base = layer.drawScene;
      const frozen: DrawScene = (can, top) => {
        if ((can && can !== layer.getCanvas()) || top) return base.call(layer, can, top);
        this.drawFrozen(layer, i === 0);
        return layer;
      };
      layer.drawScene = frozen;
      this.swapped.push({ layer, own });
    });
  }

  /** The view has stopped: the sheets draw themselves again (the caller asks for the draw). */
  thaw(): void {
    if (!this.frozen) return;
    this.frozen = false;
    for (const { layer, own } of this.swapped) {
      if (own) layer.drawScene = own;
      else delete (layer as Partial<Konva.Layer>).drawScene;
    }
    this.swapped = [];
    // The sharp draw that follows isn't a change to the map.
    this.sharpDrawPending = new Set(this.layers());
    if (this.changeTimer !== null) clearTimeout(this.changeTimer);
    this.changeTimer = null;
    this.prepareWhenIdle(AFTER_MOVE_MS);
  }

  get isFrozen(): boolean {
    return this.frozen;
  }

  /** The map's drawing may have changed (an edit, a selection, a picture arriving). */
  invalidate(): void {
    this.version++;
    if (this.frozen) {
      this.layers()[0]?.batchDraw();
      return;
    }
    // Not moving: the picture is out of date. A new one is taken once the
    // map has been still for a moment, so the next move starts smoothly.
    this.picture = null;
    this.prepareWhenIdle(SETTLE_MS);
  }

  /**
   * Watches the sheets: a draw of one of them while the view is still means
   * its drawing changed (a hover, a drag, anything not reported through
   * `invalidate`), so a picture kept from before is out of date.
   */
  watchLayers(): void {
    for (const layer of this.layers()) {
      const onDraw = () => {
        if (this.frozen) return;
        if (this.sharpDrawPending.delete(layer)) return;
        this.invalidate();
      };
      layer.on('draw.view-bitmap', onDraw);
      this.offDraw.push(() => layer.off('draw.view-bitmap', onDraw));
    }
  }

  dispose(): void {
    this.thaw();
    this.cancelIdle();
    for (const off of this.offDraw.splice(0)) off();
    this.picture = null;
    this.canvas = null;
  }

  // ── internals ──

  /** Whether the kept picture is of this view and this map. */
  private fits(): boolean {
    const p = this.picture;
    const s = this.stage;
    return (
      !!p &&
      p.version === this.version &&
      p.stageX === s.x() &&
      p.stageY === s.y() &&
      p.scale === s.scaleX() &&
      p.stageW === s.width() &&
      p.stageH === s.height()
    );
  }

  /** Whether the picture still covers the view, sharp enough. */
  private covers(p: Picture): boolean {
    const s = this.stage;
    const scale = s.scaleX();
    if (scale / p.scale > this.opts.maxZoomIn) return false;
    const x0 = -s.x() / scale;
    const y0 = -s.y() / scale;
    const x1 = x0 + s.width() / scale;
    const y1 = y0 + s.height() / scale;
    const eps = 0.5 / scale;
    return p.x <= x0 + eps && p.y <= y0 + eps && p.x + p.w >= x1 - eps && p.y + p.h >= y1 - eps;
  }

  private drawFrozen(layer: Konva.Layer, bottom: boolean): void {
    const canvas = layer.getCanvas();
    const ctx = canvas.getContext();
    ctx.clear();
    for (const child of layer.getChildren()) if (child.hasName(VIEW_LIVE)) child.drawScene(canvas);
    if (!bottom) return;
    let p = this.picture;
    const changed = !!p && p.version !== this.version;
    const now = performance.now();
    if (!p || !this.covers(p)) {
      p = this.take();
    } else if (changed) {
      const wait = this.lastTakenAt + this.opts.minChangeGapMs - now;
      if (wait <= 0) p = this.take();
      else if (this.changeTimer === null) {
        this.changeTimer = setTimeout(() => {
          this.changeTimer = null;
          if (this.frozen) layer.batchDraw();
        }, wait);
      }
    }
    if (!p || !this.canvas) return;
    const s = this.stage;
    const scale = s.scaleX();
    ctx.save();
    ctx.translate(s.x(), s.y());
    ctx.scale(scale, scale);
    ctx.drawImage(this.canvas._canvas, p.x, p.y, p.w, p.h);
    ctx.restore();
  }

  /** Draws the sheets for the view on screen, with the margin, into the picture. */
  private take(): Picture | null {
    const s = this.stage;
    const layers = this.layers();
    const w = s.width();
    const h = s.height();
    const scale = s.scaleX();
    if (!(w > 0 && h > 0 && scale > 0) || layers.length === 0) return null;
    const m = this.opts.margin;
    const cw = Math.ceil(w * (1 + 2 * m));
    const ch = Math.ceil(h * (1 + 2 * m));
    const ratio = Math.min(layers[0]!.getCanvas().getPixelRatio(), Math.sqrt(this.opts.maxPixels / (cw * ch)));
    if (!this.canvas) this.canvas = new SceneCanvas({ width: cw, height: ch, pixelRatio: ratio });
    const canvas = this.canvas;
    if (canvas.pixelRatio !== ratio || canvas.width !== Math.floor(cw * ratio) || canvas.height !== Math.floor(ch * ratio)) {
      canvas.pixelRatio = ratio;
      canvas.setSize(cw, ch);
    } else {
      canvas.getContext().clear();
    }
    const ctx = canvas.getContext();
    ctx.save();
    ctx.translate(m * w, m * h);
    for (const layer of layers) {
      if (!layer.isVisible()) continue;
      for (const child of layer.getChildren()) {
        if (!child.hasName(VIEW_LIVE)) child.drawScene(canvas);
      }
    }
    ctx.restore();
    (canvas as unknown as { _trimIsolationCanvas?: () => void })._trimIsolationCanvas?.();
    this.taken++;
    this.lastTakenAt = performance.now();
    this.picture = {
      x: (-m * w - s.x()) / scale,
      y: (-m * h - s.y()) / scale,
      w: cw / scale,
      h: ch / scale,
      scale,
      stageX: s.x(),
      stageY: s.y(),
      stageW: w,
      stageH: h,
      version: this.version,
    };
    return this.picture;
  }

  /**
   * The picture for the view on screen is taken while the page is idle, so
   * the next move starts on it without a slow first frame: shortly after a
   * move (once its sharp draw has run), and once the map has been still for
   * a moment after a change. While changes keep coming (an edit, someone
   * else's, pictures arriving) it waits, so it isn't taken for each one.
   */
  private prepareWhenIdle(delayMs: number): void {
    this.cancelIdle();
    const run = () => {
      this.idleHandle = null;
      if (!this.frozen && !this.fits()) this.take();
    };
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null;
      const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number };
      if (w.requestIdleCallback) this.idleHandle = w.requestIdleCallback(run, { timeout: 500 });
      else run();
    }, delayMs);
  }

  private cancelIdle(): void {
    if (this.idleTimer !== null) clearTimeout(this.idleTimer);
    this.idleTimer = null;
    if (this.idleHandle !== null) (window as Window & { cancelIdleCallback?: (h: number) => void }).cancelIdleCallback?.(this.idleHandle);
    this.idleHandle = null;
  }
}

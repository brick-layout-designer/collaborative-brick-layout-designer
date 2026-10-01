// Konva draws on a 2D canvas, which jsdom lacks: a context whose every
// method does nothing, so react-konva trees mount and their nodes can be
// inspected (what a layer draws, not the pixels).
const fake = (): unknown =>
  new Proxy({} as Record<string | symbol, unknown>, {
    get: (t, k) =>
      k in t ? t[k] : k === 'measureText' ? () => ({ width: 0 }) : k === 'canvas' ? document.createElement('div') : () => fake(),
    set: (t, k, v) => {
      t[k] = v;
      return true;
    },
  });

export function stubCanvas(): void {
  HTMLCanvasElement.prototype.getContext = (() => fake()) as never;
}

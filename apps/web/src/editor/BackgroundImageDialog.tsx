// Map > Background Image dialog — port of desktop MapView background image
// workflow. Stores image server-side + records metadata in sidecar.

import { useRef, useState } from 'react';
import type * as Y from 'yjs';
import type { BackgroundImage } from '@cld/bbm';
import { readSidecarFromDoc } from '@cld/ydoc';
import { setBackgroundImage, clearBackgroundImage } from './mutations';

interface Props {
  layoutId: string;
  doc: Y.Doc;
  onClose: () => void;
}

export function BackgroundImageDialog({ layoutId, doc, onClose }: Props) {
  const existing = readSidecarFromDoc(doc)?.backgroundImage ?? null;

  const [file, setFile] = useState<File | null>(null);
  const [opacity, setOpacity] = useState(existing?.opacity ?? 0.5);
  const [useRect, setUseRect] = useState(!!existing?.rect);
  const [rect, setRect] = useState(existing?.rect ?? { x: 0, y: 0, w: 100, h: 100 });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  async function commit() {
    setBusy(true);
    setError(null);
    try {
      let url = existing?.url ?? `/api/layouts/${layoutId}/background-image`;
      if (file) {
        const form = new FormData();
        form.append('file', file);
        const res = await fetch(`/api/layouts/${layoutId}/background-image`, {
          method: 'POST',
          body: form,
          credentials: 'include',
        });
        if (!res.ok) throw new Error(`Upload failed: ${res.status}`);
        const data = (await res.json()) as { url: string };
        url = data.url;
      }
      const bg: BackgroundImage = {
        url,
        opacity,
        ...(useRect ? { rect } : {}),
      };
      setBackgroundImage(doc, bg);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed');
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    try {
      await fetch(`/api/layouts/${layoutId}/background-image`, {
        method: 'DELETE',
        credentials: 'include',
      });
      clearBackgroundImage(doc);
      onClose();
    } catch {
      setError('Failed to remove');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/60"
      onClick={onClose}
    >
      <div
        className="w-[26rem] rounded-lg border border-neutral-800 bg-neutral-900 p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-base font-semibold">Background Image</h2>

        <div className="mt-4 space-y-3 text-sm">
          <div>
            <label className="block text-xs text-neutral-400 mb-1">Image file (PNG / JPG / GIF / WebP, max 10 MB)</label>
            <input
              ref={inputRef}
              type="file"
              accept="image/png,image/jpeg,image/gif,image/webp"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="w-full text-xs text-neutral-300"
            />
            {existing?.url && !file && (
              <p className="mt-1 text-xs text-neutral-500">
                Current image will be kept unless you choose a new file.
              </p>
            )}
          </div>

          <div className="flex items-center gap-3">
            <label className="text-xs text-neutral-400 w-16">Opacity</label>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={opacity}
              onChange={(e) => setOpacity(parseFloat(e.target.value))}
              className="flex-1 accent-blue-500"
            />
            <span className="text-xs tabular-nums text-neutral-400 w-8 text-right">
              {Math.round(opacity * 100)}%
            </span>
          </div>

          <label className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={useRect}
              onChange={(e) => setUseRect(e.target.checked)}
              className="accent-blue-500"
            />
            Custom placement (studs)
          </label>

          {useRect && (
            <div className="grid grid-cols-2 gap-2 pl-5">
              {(['x', 'y', 'w', 'h'] as const).map((k) => (
                <label key={k} className="flex flex-col gap-0.5">
                  <span className="text-xs text-neutral-500">{k}</span>
                  <input
                    type="number"
                    value={rect[k]}
                    onChange={(e) => setRect((r) => ({ ...r, [k]: parseFloat(e.target.value) || 0 }))}
                    className="rounded border border-neutral-700 bg-neutral-800 px-2 py-1 text-xs"
                  />
                </label>
              ))}
            </div>
          )}
        </div>

        {error && <p className="mt-2 text-xs text-red-400">{error}</p>}

        <div className="mt-5 flex items-center justify-between">
          {existing && (
            <button
              onClick={remove}
              disabled={busy}
              className="rounded border border-red-900 px-3 py-1 text-xs text-red-400 hover:bg-red-950 disabled:opacity-50"
            >
              Remove image
            </button>
          )}
          <div className="ml-auto flex gap-2">
            <button
              onClick={onClose}
              className="rounded border border-neutral-700 px-3 py-1 text-xs hover:bg-neutral-800"
            >
              Cancel
            </button>
            <button
              onClick={commit}
              disabled={busy || (!file && !existing)}
              className="rounded bg-blue-600 px-3 py-1 text-xs hover:bg-blue-500 disabled:opacity-50"
            >
              {busy ? 'Saving…' : 'OK'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

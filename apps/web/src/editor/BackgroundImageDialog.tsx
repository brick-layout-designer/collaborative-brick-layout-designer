// Map > Background Image dialog — port of desktop MapView background image
// workflow. Stores image server-side + records metadata in sidecar.

import { useRef, useState } from 'react';
import type * as Y from 'yjs';
import type { BackgroundImage } from '@cld/bbm';
import { readSidecarFromDoc } from '@cld/ydoc';
import { setBackgroundImage, clearBackgroundImage } from './mutations';
import { noteWrite } from '../api';

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
        noteWrite('POST', `/api/layouts/${layoutId}/background-image`);
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
      noteWrite('DELETE', `/api/layouts/${layoutId}/background-image`);
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
        className="w-104 rounded-lg border border-line bg-panel p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-base font-semibold">Background Image</h2>

        <div className="mt-4 space-y-3 text-sm">
          <div>
            <label className="block text-xs text-muted mb-1">Image file (PNG / JPG / GIF / WebP, max 10 MB)</label>
            <input
              ref={inputRef}
              type="file"
              accept="image/png,image/jpeg,image/gif,image/webp"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="w-full text-xs text-neutral-300"
            />
            {existing?.url && !file && (
              <p className="mt-1 text-xs text-muted">
                Current image will be kept unless you choose a new file.
              </p>
            )}
          </div>

          <div className="flex items-center gap-3">
            <label className="text-xs text-muted w-16">Opacity</label>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={opacity}
              onChange={(e) => setOpacity(parseFloat(e.target.value))}
              className="flex-1 accent-accent"
            />
            <span className="text-xs tabular-nums text-muted w-8 text-right">
              {Math.round(opacity * 100)}%
            </span>
          </div>

          <label className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={useRect}
              onChange={(e) => setUseRect(e.target.checked)}
              className="accent-accent"
            />
            Custom placement (studs)
          </label>

          {useRect && (
            <div className="grid grid-cols-2 gap-2 pl-5">
              {(['x', 'y', 'w', 'h'] as const).map((k) => (
                <label key={k} className="flex flex-col gap-0.5">
                  <span className="text-xs text-muted">{k}</span>
                  <input
                    type="number"
                    value={rect[k]}
                    onChange={(e) => setRect((r) => ({ ...r, [k]: parseFloat(e.target.value) || 0 }))}
                    className="rounded-lg border border-border bg-soft px-2 py-1 text-xs"
                  />
                </label>
              ))}
            </div>
          )}
        </div>

        {error && <p className="mt-2 text-xs text-danger">{error}</p>}

        <div className="mt-5 flex items-center justify-between">
          {existing && (
            <button
              onClick={remove}
              disabled={busy}
              className="rounded-lg border border-red-900 px-3 py-1 text-xs text-danger hover:bg-red-950 disabled:opacity-50"
            >
              Remove image
            </button>
          )}
          <div className="ml-auto flex gap-2">
            <button
              onClick={onClose}
              className="rounded-lg border border-border px-3 py-1 text-xs hover:bg-soft"
            >
              Cancel
            </button>
            <button
              onClick={commit}
              disabled={busy || (!file && !existing)}
              className="rounded-lg bg-accent text-accent-ink px-3 py-1 text-xs hover:bg-accent-hover disabled:opacity-50"
            >
              {busy ? 'Saving…' : 'OK'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

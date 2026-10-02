// A module's version history: every save, newest first, with its picture,
// date, who saved it and the "What changed" note. People who can edit the
// module can restore an old version (which adds a new version, so nothing
// is lost); anyone who can open it can download a version as a .bbm.

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as Y from 'yjs';
import { docToBbm } from '@cld/ydoc';
import { api, moduleVersionThumbnailUrl, type ModuleSummary, type ModuleVersion } from '../api';
import { sanitizeFilename } from '../bbmFiles';
import { downloadBlob } from '../editor/sharePicture';

export function ModuleVersionsDialog({ module, onClose }: { module: Pick<ModuleSummary, 'id' | 'title'>; onClose: () => void }) {
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ['module-versions', module.id], queryFn: () => api.modules.versions(module.id) });
  const [preview, setPreview] = useState<ModuleVersion | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const restore = useMutation({
    mutationFn: (v: number) => api.modules.restoreVersion(module.id, v),
    onSuccess: (r, v) => {
      setError(null);
      setDone(`Version ${v} is the module again (saved as version ${r.version}).`);
      void qc.invalidateQueries({ queryKey: ['module-versions', module.id] });
      void qc.invalidateQueries({ queryKey: ['modules'] });
    },
    onError: (e: Error) => setError(e.message),
  });
  const download = async (v: ModuleVersion) => {
    setError(null);
    try {
      const bytes = await api.modules.versionSnapshot(module.id, v.version);
      const doc = new Y.Doc();
      try {
        Y.applyUpdate(doc, bytes);
        const { writeBbm } = await import('@cld/bbm');
        const xml = writeBbm(docToBbm(doc));
        downloadBlob(new Blob([xml], { type: 'application/xml' }), `${sanitizeFilename(module.title)} v${v.version}.bbm`);
      } finally {
        doc.destroy();
      }
    } catch (e) {
      setError(`That version could not be downloaded: ${(e as Error).message}`);
    }
  };
  const canRestore = list.data?.role === 'owner' || list.data?.role === 'editor';
  const versions = list.data?.versions ?? [];

  return (
    <div className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-black/60 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Versions of ${module.title}`}
        className="w-full max-w-lg space-y-4 rounded-section border border-line bg-panel p-5 text-sm"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-lg font-semibold">Version history</h3>
            <p className="text-muted">{module.title}: each save is kept, the newest 20.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="tap-target rounded-lg px-2 py-1 text-muted hover:bg-soft">
            ✕
          </button>
        </div>
        {list.isLoading && <p className="text-muted">Loading…</p>}
        {list.isError && <p className="text-danger">{(list.error as Error).message}</p>}
        {list.data && versions.length === 0 && (
          <p className="rounded-lg border border-dashed border-line p-4 text-muted">
            No versions yet. Each time the module is saved, a version is kept here.
          </p>
        )}
        {preview && (
          <figure className="space-y-2 rounded-lg border border-line bg-soft p-3">
            {moduleVersionThumbnailUrl(module.id, preview) ? (
              <img
                data-testid="version-preview"
                src={moduleVersionThumbnailUrl(module.id, preview)!}
                alt={`Version ${preview.version}`}
                className="mx-auto max-h-64 object-contain"
              />
            ) : (
              <p className="text-muted">This version has no picture.</p>
            )}
            <figcaption className="text-center text-xs text-muted">Version {preview.version}</figcaption>
          </figure>
        )}
        {versions.length > 0 && (
          <ul className="max-h-96 divide-y divide-line overflow-y-auto rounded-lg border border-line">
            {versions.map((v, i) => {
              const thumb = moduleVersionThumbnailUrl(module.id, v);
              return (
                <li key={v.version} data-testid="module-version" className="flex items-center gap-3 px-3 py-2">
                  {thumb ? (
                    <img src={thumb} alt="" loading="lazy" className="size-12 shrink-0 rounded-lg border border-line bg-soft object-contain" />
                  ) : (
                    <span aria-hidden className="size-12 shrink-0 rounded-lg border border-line bg-soft" />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">
                      Version {v.version}
                      {i === 0 && <span className="ml-2 rounded-full bg-ok-soft px-2 py-0.5 text-xs font-bold text-ok">Current</span>}
                    </p>
                    <p className="text-xs text-muted">
                      {new Date(v.createdAt).toLocaleString()}
                      {v.author ? ` · ${v.author}` : ''}
                    </p>
                    {v.note && <p className="break-words text-xs">{v.note}</p>}
                  </div>
                  <div className="flex shrink-0 flex-wrap justify-end gap-1">
                    <button type="button" onClick={() => setPreview(v)} className="tap-target rounded-lg border border-border px-2 py-1 text-xs hover:bg-soft">
                      Preview
                    </button>
                    <button
                      type="button"
                      onClick={() => void download(v)}
                      aria-label={`Download version ${v.version}`}
                      className="tap-target rounded-lg border border-border px-2 py-1 text-xs hover:bg-soft"
                    >
                      Download
                    </button>
                    {canRestore && i > 0 && (
                      <button
                        type="button"
                        disabled={restore.isPending}
                        onClick={() => {
                          if (confirm(`Make version ${v.version} the module again? This adds a new version; nothing is lost.`)) restore.mutate(v.version);
                        }}
                        aria-label={`Restore version ${v.version}`}
                        className="tap-target rounded-lg bg-accent px-2 py-1 text-xs font-semibold text-accent-ink hover:bg-accent-hover disabled:opacity-50"
                      >
                        Restore
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        {done && <p role="status" className="text-ok">{done}</p>}
        {error && <p className="text-danger">{error}</p>}
      </div>
    </div>
  );
}

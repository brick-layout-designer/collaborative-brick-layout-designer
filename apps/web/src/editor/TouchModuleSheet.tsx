// A picked module's menu on a phone or tablet (the touch bar's Module
// button): Edit module, Pin in place and the library entries (Save to
// library…, Update library version…, Update from library), as the map's
// right-click menu has them.

import { useEffect, useState } from 'react';
import type * as Y from 'yjs';
import { readSidecarFromDoc } from '@cld/ydoc';
import { enterModuleEdit, setModulePinned } from './moduleActions';
import { useLibraryEntries, type ModuleMenuEntry } from './moduleLibraryMenu';

export function TouchModuleSheet({ doc, moduleId, onClose }: { doc: Y.Doc; moduleId: string; onClose: () => void }) {
  const mod = readSidecarFromDoc(doc)?.modules?.find((m) => m.id === moduleId);
  const library = useLibraryEntries(doc);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setOpen(true));
    return () => cancelAnimationFrame(id);
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  if (!mod) return null;
  const entries: ModuleMenuEntry[] = [
    { id: 'edit', label: 'Edit module', onSelect: () => enterModuleEdit(mod.id) },
    { id: 'pin', label: mod.pinned ? 'Unpin' : 'Pin in place', onSelect: () => setModulePinned(doc, mod.id, !mod.pinned) },
    ...library(mod),
  ];
  return (
    <div className="fixed inset-0 z-40" data-no-gesture>
      <button
        type="button"
        aria-label="Close"
        tabIndex={-1}
        onClick={onClose}
        className={`absolute inset-0 bg-black/40 transition-opacity duration-200 ${open ? 'opacity-100' : 'opacity-0'}`}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={mod.name || 'Module'}
        data-testid="touch-module-sheet"
        className={`absolute inset-x-0 bottom-0 rounded-t-2xl border-t border-line bg-panel text-ink shadow-pop transition-transform duration-200 ease-out ${open ? 'translate-y-0' : 'translate-y-full'}`}
        style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))', paddingLeft: 'env(safe-area-inset-left)', paddingRight: 'env(safe-area-inset-right)' }}
      >
        <div className="mx-auto mt-2 h-1 w-10 rounded-full bg-line" aria-hidden />
        <div className="flex items-center gap-2 px-4 pt-2">
          <h2 className="min-w-0 flex-1 truncate text-lg font-bold">{mod.name || 'Module'}</h2>
          <button type="button" onClick={onClose} className="min-h-11 rounded-control px-4 text-sm font-bold hover:bg-soft">
            Close
          </button>
        </div>
        <ul className="flex flex-col gap-1 px-2 pt-1">
          {entries.map((e) => (
            <li key={e.id}>
              <button
                type="button"
                disabled={e.disabled}
                onClick={() => {
                  onClose();
                  e.onSelect();
                }}
                className="flex min-h-12 w-full items-center rounded-control px-3 text-left text-base font-semibold hover:bg-soft disabled:opacity-40"
              >
                {e.label}
              </button>
              {e.disabled && e.title && <p className="px-3 pb-1 text-xs text-muted">{e.title}</p>}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

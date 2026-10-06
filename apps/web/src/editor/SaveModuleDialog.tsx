// "Save selection as module" dialog — port of desktop's
// CreateModuleCommand (ModuleCommands.cpp). Collects the selected bricks
// from all brick layers, normalises positions so the centroid is at the
// origin, seeds a new Y.Doc, and POSTs it to /api/modules.

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { seedFromBbm, encodeDoc } from '@cld/ydoc';
import type { BbmMap } from '@cld/model';
import { api } from '../api';
import { SaveToPicker } from '../owners/OwnerControls';
import { ModuleThumb } from '../modules/ModuleThumb';
import { HelpButton } from '../help/HelpButton';
import { moduleMapFromSelection, oneSheetName, pickedBySheet } from './moduleSheets';

type Thumb = { mime: 'image/png' | 'image/webp'; data: string };

interface Props {
  map: BbmMap;
  selection: string[];
  onClose: () => void;
  /** `version`: set when an existing module was updated (its new version). */
  onSaved: (moduleId: string, title: string, version?: number) => void;
  /** The club that owns the layout being edited, if any: the default "Save to". */
  layoutOwnerOrgId?: string | null;
  /** A picture of this area of the map (studs), for the module's picture. */
  makeThumbnail?: (region: { x: number; y: number; width: number; height: number }) => Promise<Thumb | null>;
}

export function SaveModuleDialog({ map, selection, onClose, onSaved, layoutOwnerOrgId = null, makeThumbnail }: Props) {
  const [title, setTitle] = useState('');
  // A new module, or a new version of one you can edit.
  const [mode, setMode] = useState<'new' | 'update'>('new');
  const [target, setTarget] = useState('');
  const [note, setNote] = useState('');
  // The sheets the picked parts are on; with two or more, the dialog says so.
  const sheets = pickedBySheet(map, selection);
  const [oneSheet, setOneSheet] = useState(false);
  const modules = useQuery({ queryKey: ['modules'], queryFn: api.modules.list });
  const editable = (modules.data?.modules ?? []).filter((m) => m.role === undefined || m.role === 'owner' || m.role === 'editor');
  const [error, setError] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const orgs = useQuery({ queryKey: ['orgs'], queryFn: api.orgs.list });
  // Where it's saved: picked, else whoever owns this layout (its club, if
  // you're in it), else Me.
  const [picked, setPicked] = useState<string | null>(null);
  const layoutClub = orgs.data?.orgs.find((o) => o.id === layoutOwnerOrgId)?.slug ?? '';
  const ownerSlug = picked ?? layoutClub;

  const save = useMutation({
    mutationFn: async (name: string) => {
      const built = moduleMapFromSelection(map, selection, { oneSheet });
      if (!built) throw new Error('No bricks selected');
      const { moduleMap, region } = built;

      const doc = seedFromBbm(moduleMap);
      const bytes = encodeDoc(doc);
      doc.destroy();

      const picture = async (id: string) => {
        try {
          const thumb = await makeThumbnail?.(region);
          if (thumb) await api.modules.setThumbnail(id, thumb);
        } catch {
          // No picture: the lists show a placeholder until the module is opened.
        }
      };
      if (mode === 'update') {
        const existing = editable.find((m) => m.id === target);
        if (!existing) throw new Error('Pick the module to update.');
        const saved = await api.modules.saveSnapshot(existing.id, bytes, note);
        await picture(existing.id);
        return { id: existing.id, title: existing.title, version: saved.version };
      }
      const created = await api.modules.create(ownerSlug ? { title: name, orgSlug: ownerSlug } : { title: name });
      try {
        await api.modules.saveSnapshot(created.id, bytes, note);
      } catch (e) {
        // Don't leave an empty module behind when its contents didn't arrive.
        await api.modules.remove(created.id).catch(() => undefined);
        throw e;
      }
      await picture(created.id);
      return { id: created.id, title: created.title, version: 1 };
    },
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: ['modules'] });
      if (mode === 'update' && result.version) onSaved(result.id, result.title, result.version);
      else onSaved(result.id, result.title);
    },
    onError: (e) => setError((e as Error).message),
  });

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const name = title.trim();
    if (mode === 'update') {
      if (!target) { setError('Pick the module to update.'); return; }
    } else if (!name) { setError('Module name is required'); return; }
    save.mutate(name);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="w-80 rounded-lg border border-border bg-panel p-5 shadow-xl">
        <h2 className="mb-4 text-sm font-semibold text-ink">Save Selection as Module</h2>
        <form onSubmit={onSubmit} className="flex flex-col gap-3">
          <fieldset className="flex flex-col gap-1 text-xs">
            <legend className="sr-only">Save as</legend>
            <label className="flex items-center gap-2">
              <input type="radio" name="save-module-mode" checked={mode === 'new'} onChange={() => setMode('new')} />
              New module
            </label>
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name="save-module-mode"
                checked={mode === 'update'}
                disabled={editable.length === 0}
                onChange={() => setMode('update')}
              />
              Update an existing module{editable.length === 0 ? ' (none you can change yet)' : ''}
            </label>
          </fieldset>
          {mode === 'new' ? (
            <>
              <div>
                <label htmlFor="save-module-name" className="mb-1 block text-xs text-muted">Module name</label>
                <input
                  id="save-module-name"
                  autoFocus
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="My module"
                  className="w-full rounded-lg border border-border bg-soft px-3 py-1.5 text-sm outline-hidden focus:border-accent"
                />
              </div>
              <SaveToPicker value={ownerSlug} onChange={setPicked} orgs={orgs.data?.orgs} />
            </>
          ) : (
            <div role="radiogroup" aria-label="Module to update" className="max-h-56 space-y-1 overflow-y-auto rounded-lg border border-line p-1">
              {editable.map((m) => (
                <label
                  key={m.id}
                  className={`flex cursor-pointer items-center gap-2 rounded-lg p-1.5 text-xs ${target === m.id ? 'bg-soft ring-1 ring-accent' : 'hover:bg-soft'}`}
                >
                  <input type="radio" name="save-module-target" value={m.id} checked={target === m.id} onChange={() => setTarget(m.id)} className="sr-only" />
                  <ModuleThumb module={m} size="sm" />
                  <span className="min-w-0 flex-1 break-words font-medium">{m.title}</span>
                  {m.latestVersion ? <span className="shrink-0 text-muted">v{m.latestVersion}</span> : null}
                </label>
              ))}
            </div>
          )}
          <div>
            <label htmlFor="save-module-note" className="mb-1 block text-xs text-muted">What changed? (optional)</label>
            <input
              id="save-module-note"
              value={note}
              maxLength={300}
              onChange={(e) => setNote(e.target.value)}
              placeholder={mode === 'update' ? 'e.g. Longer siding' : 'e.g. First version'}
              className="w-full rounded-lg border border-border bg-soft px-3 py-1.5 text-sm outline-hidden focus:border-accent"
            />
          </div>
          {sheets.length > 1 && (
            <div data-testid="module-sheets" className="rounded-lg border border-line p-2 text-xs">
              <p className="flex items-start gap-1">
                <span className="flex-1">
                  {oneSheet ? (
                    <>
                      All its parts go on one sheet: <b>{oneSheetName(sheets)}</b>.
                    </>
                  ) : (
                    <>
                      This module uses {sheets.length} sheets: <b>{sheets.map((g) => g.layer.name || 'untitled').join(', ')}</b>.
                    </>
                  )}
                </span>
                <HelpButton helpKey="module.sheets" />
              </p>
              <label className="mt-1.5 flex items-center gap-2">
                <input type="checkbox" checked={oneSheet} onChange={(e) => setOneSheet(e.target.checked)} />
                Put everything on one sheet
              </label>
            </div>
          )}
          {error && <p className="text-xs text-danger">{error}</p>}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg px-3 py-1.5 text-xs text-muted hover:bg-soft"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={save.isPending}
              className="rounded-lg bg-accent px-3 py-1.5 text-xs text-accent-ink hover:bg-accent-hover disabled:opacity-50"
            >
              {save.isPending ? 'Saving…' : 'Save'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

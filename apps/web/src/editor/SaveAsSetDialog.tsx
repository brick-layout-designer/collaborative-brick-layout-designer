import { useMemo, useState, type FormEvent } from 'react';
import * as Y from 'yjs';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { docToBbm } from '@cld/ydoc';
import type { LayerBrick } from '@cld/model';
import { api, toBase64 } from '../api';
import { HelpButton } from '../help/HelpButton';
import { noticeDownloaded, useEditorStore } from './editorStore';
import { indexParts } from './partIndex';
import { buildSetXml, setPartNumber, setSubparts } from './setXml';
import { useEscape } from './useEscape';

interface Props {
  doc: Y.Doc;
  onClose: () => void;
  /** Only looking at this layout: say why the set can't be saved. */
  viewOnly?: boolean;
}

/**
 * Save selection as set: the picked parts, as they sit, saved to your
 * custom parts as a set, so the Parts panel can place them again in any
 * layout (and they can be shared like a part). Download .set.xml still
 * gives the file, for BlueBrick or a parts folder.
 */
export function SaveAsSetDialog({ doc, onClose, viewOnly = false }: Props) {
  useEscape(onClose);
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const selection = useEditorStore((s) => s.selection);
  const me = useQuery({ queryKey: ['me'], queryFn: api.me });
  const catalog = useQuery({ queryKey: ['parts-catalog'], queryFn: api.parts.catalog, staleTime: 60_000 });
  const mine = useQuery({ queryKey: ['custom-parts'], queryFn: api.customParts.list, enabled: !!me.data?.user });
  const index = useMemo(() => indexParts(catalog.data?.parts), [catalog.data]);

  // The selected parts, on every parts sheet.
  const map = docToBbm(doc);
  const selSet = new Set(selection);
  const picked = map.layers
    .filter((l): l is LayerBrick => l.type === 'brick')
    .flatMap((l) => l.bricks)
    .filter((b) => selSet.has(b.id));

  const user = me.data?.user;
  const cannotSave = me.isLoading
    ? 'Checking your account…'
    : !user
      ? 'Sign in to save sets to your custom parts. You can still download it as a file.'
      : user.isDemoAccount
        ? 'The demo account can’t save parts. Make your own account to save sets; you can still download it as a file.'
        : viewOnly
          ? 'You can only look at this layout, so saving from it is turned off. You can still download it as a file.'
          : null;

  const trimmedName = () => name.trim() || 'New Set';
  const setXml = () => buildSetXml(trimmedName(), setSubparts(picked, index));

  async function save(e: FormEvent) {
    e.preventDefault();
    if (picked.length === 0) {
      setError('Select one or more parts first.');
      return;
    }
    if (cannotSave) return;
    const displayName = trimmedName();
    const partNumber = setPartNumber(displayName);
    const taken = mine.data?.parts.some((p) => p.ownerUserId === user?.id && p.partNumber.toLowerCase() === partNumber.toLowerCase());
    if (taken) {
      setError(`You already have a part or set called “${partNumber}”. Pick another name.`);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await api.customParts.create({
        partNumber,
        displayName,
        xmlBase64: toBase64(new TextEncoder().encode(setXml())),
        category: 'My sets',
      });
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['custom-parts'] }),
        qc.invalidateQueries({ queryKey: ['parts-catalog'] }),
      ]);
      useEditorStore.getState().showNotice(`Saved the set “${displayName}”. It’s in the Parts panel, under My sets.`, 'done', 7000);
      onClose();
    } catch (err) {
      setError(`Could not save the set: ${(err as Error).message}`);
    } finally {
      setSaving(false);
    }
  }

  function download() {
    if (picked.length === 0) {
      setError('Select one or more parts first.');
      return;
    }
    downloadText(`${setPartNumber(trimmedName())}.set.xml`, setXml());
    onClose();
  }

  return (
    <div role="dialog" aria-label="Save selection as set" aria-modal="true" className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <form
        onSubmit={save}
        className="w-96 max-w-[calc(100vw-2rem)] space-y-3 rounded-lg border border-border bg-panel p-5 text-sm shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-base font-semibold">Save selection as set</h3>
        <p className="flex items-start gap-1 text-xs text-muted">
          <span>A set is a group of parts saved together, to place again in one go. It goes to your custom parts.</span>
          <HelpButton helpKey="set.about" />
        </p>
        {picked.length === 0 ? (
          <p className="text-xs text-amber-400">No parts selected. Select the parts for the set first.</p>
        ) : (
          <p className="text-xs text-muted">{picked.length} part{picked.length !== 1 ? 's' : ''} selected.</p>
        )}
        <label className="block">
          <span className="mb-1 block text-muted">Set name</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="New Set"
            className="w-full rounded-lg border border-border bg-soft px-3 py-2"
            autoFocus
          />
        </label>
        {cannotSave && picked.length > 0 && <p className="text-xs text-amber-400">{cannotSave}</p>}
        {error && <p role="alert" className="text-xs text-danger">{error}</p>}
        <div className="flex flex-wrap justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className="rounded-lg border border-border px-4 py-1.5 hover:bg-soft">
            Cancel
          </button>
          <button
            type="button"
            onClick={download}
            disabled={picked.length === 0}
            className="rounded-lg border border-border px-4 py-1.5 hover:bg-soft disabled:opacity-40"
          >
            Download .set.xml
          </button>
          <button
            type="submit"
            disabled={picked.length === 0 || !!cannotSave || saving}
            className="rounded-lg bg-accent px-4 py-1.5 text-accent-ink hover:bg-accent-hover disabled:opacity-40"
          >
            {saving ? 'Saving…' : 'Save set'}
          </button>
        </div>
      </form>
    </div>
  );
}

function downloadText(filename: string, text: string) {
  const blob = new Blob([text], { type: 'application/xml' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
  noticeDownloaded(filename);
}

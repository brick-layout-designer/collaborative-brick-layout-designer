// Touch editing's bottom sheets beyond "Add part": the sheets (layers)
// list, to show / hide, rename and reorder from a phone, with buttons big
// enough for a finger. Every change goes through the same mutations as
// the Sheets panel, so undo and live sync just work.

import { useEffect, useState, type ReactNode } from 'react';
import type * as Y from 'yjs';
import type { BbmMap, Layer } from '@cld/model';
import { useEditorStore } from './editorStore';
import { moveLayer, renameLayer, setLayerVisible } from './mutations';

/** A sheet that slides up from the bottom, over a dimmed map, with a title and Close. */
export function BottomSheet({ title, onClose, children, footer }: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}) {
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
        aria-label={title}
        className={`absolute inset-x-0 bottom-0 flex max-h-[80dvh] flex-col rounded-t-2xl border-t border-line bg-panel text-ink shadow-pop transition-transform duration-200 ease-out ${open ? 'translate-y-0' : 'translate-y-full'}`}
        style={{ paddingBottom: 'env(safe-area-inset-bottom)', paddingLeft: 'env(safe-area-inset-left)', paddingRight: 'env(safe-area-inset-right)' }}
      >
        <div className="mx-auto mt-2 h-1 w-10 rounded-full bg-line" aria-hidden />
        <div className="flex items-center gap-2 px-4 pt-2">
          <h2 className="flex-1 text-lg font-bold">{title}</h2>
          <button type="button" onClick={onClose} className="min-h-11 rounded-control px-4 text-sm font-bold hover:bg-soft">
            Close
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-4 pt-2">{children}</div>
        {footer && <div className="border-t border-line px-4 py-2">{footer}</div>}
      </div>
    </div>
  );
}

const svg = { width: 22, height: 22, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true };
const Eye = () => (<svg {...svg}><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></svg>);
const EyeOff = () => (<svg {...svg}><path d="M3 3l18 18" /><path d="M10.6 5.1A10.6 10.6 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3.2 4.2M6.6 6.6A17 17 0 0 0 2 12s3.5 7 10 7a10 10 0 0 0 5.4-1.6" /></svg>);
const Pencil = () => (<svg {...svg}><path d="M4 20h4L19 9l-4-4L4 16z" /></svg>);
const Up = () => (<svg {...svg}><path d="M6 15l6-6 6 6" /></svg>);
const Down = () => (<svg {...svg}><path d="M6 9l6 6 6-6" /></svg>);

const KIND: Record<Layer['type'], string> = { grid: 'Grid', brick: 'Parts', text: 'Text', area: 'Area', ruler: 'Rulers' };

const iconBtn =
  'flex size-11 shrink-0 items-center justify-center rounded-control text-ink hover:bg-soft disabled:opacity-30';

function SheetRow({ layer, doc, first, last, active }: { layer: Layer; doc: Y.Doc; first: boolean; last: boolean; active: boolean }) {
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(layer.name);
  const label = layer.name || KIND[layer.type];
  const save = () => {
    const next = name.trim();
    if (next && next !== layer.name) renameLayer(doc, layer.id, next);
    setRenaming(false);
  };
  return (
    <li data-sheet={layer.id} className={`flex items-center gap-1 rounded-control px-1 ${active ? 'bg-soft' : ''}`}>
      <button
        type="button"
        aria-label={`${layer.visible ? 'Hide' : 'Show'} ${label}`}
        aria-pressed={layer.visible}
        onClick={() => setLayerVisible(doc, layer.id, !layer.visible)}
        className={iconBtn}
      >
        {layer.visible ? <Eye /> : <EyeOff />}
      </button>
      {renaming ? (
        <form
          className="flex min-w-0 flex-1 items-center gap-1"
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            aria-label={`New name for ${label}`}
            maxLength={120}
            // 16 px, so iOS doesn't zoom in on the field.
            className="h-11 min-w-0 flex-1 rounded-control border border-line bg-bg px-3 text-base"
          />
          <button type="submit" className="min-h-11 shrink-0 rounded-control bg-accent px-3 text-sm font-bold text-accent-ink">
            Save
          </button>
        </form>
      ) : (
        <>
          <button
            type="button"
            onClick={() => useEditorStore.getState().setActiveLayer(layer.id)}
            aria-current={active ? 'true' : undefined}
            className={`min-h-11 min-w-0 flex-1 text-left ${layer.visible ? '' : 'text-muted'}`}
          >
            <span className="block truncate text-base font-bold">{label}</span>
            <span className="block text-xs text-muted">{KIND[layer.type]}{active ? ' · picked sheet' : ''}</span>
          </button>
          <button
            type="button"
            aria-label={`Rename ${label}`}
            onClick={() => {
              setName(layer.name);
              setRenaming(true);
            }}
            className={iconBtn}
          >
            <Pencil />
          </button>
          <button type="button" aria-label={`Move ${label} up`} disabled={first} onClick={() => moveLayer(doc, layer.id, 'up')} className={iconBtn}>
            <Up />
          </button>
          <button type="button" aria-label={`Move ${label} down`} disabled={last} onClick={() => moveLayer(doc, layer.id, 'down')} className={iconBtn}>
            <Down />
          </button>
        </>
      )}
    </li>
  );
}

/** The sheets, topmost first (as the Sheets panel lists them): show / hide, rename and reorder by touch. */
export function SheetsSheet({ map, doc, onClose }: { map: BbmMap; doc: Y.Doc; onClose: () => void }) {
  const activeLayerId = useEditorStore((s) => s.activeLayerId);
  const rows = [...map.layers].reverse();
  return (
    <BottomSheet title="Sheets" onClose={onClose}>
      <p className="mb-2 text-sm text-muted">Sheets are like see-through pages. The top one is drawn over the others.</p>
      <ul className="flex flex-col gap-1" aria-label="Sheets, top first">
        {rows.map((layer, i) => (
          <SheetRow
            key={layer.id}
            layer={layer}
            doc={doc}
            first={i === 0}
            last={i === rows.length - 1}
            active={layer.id === activeLayerId}
          />
        ))}
      </ul>
    </BottomSheet>
  );
}

/** Edit a label's or a text's words by touch: a big text box and Save. */
export function TextEditSheet({ title, initial, onSave, onClose }: {
  title: string;
  initial: string;
  onSave: (text: string) => void;
  onClose: () => void;
}) {
  const [text, setText] = useState(initial);
  const empty = text.trim().length === 0;
  return (
    <BottomSheet
      title={title}
      onClose={onClose}
      footer={
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="min-h-11 rounded-control px-4 text-sm font-bold hover:bg-soft">
            Cancel
          </button>
          <button
            type="button"
            disabled={empty}
            onClick={() => {
              if (text !== initial) onSave(text);
              onClose();
            }}
            className="min-h-11 rounded-control bg-accent px-5 text-sm font-bold text-accent-ink hover:bg-accent-hover disabled:opacity-40"
          >
            Save
          </button>
        </div>
      }
    >
      <textarea
        autoFocus
        value={text}
        onChange={(e) => setText(e.target.value)}
        aria-label="Text"
        rows={4}
        // 16 px, so iOS doesn't zoom in on the field.
        className="w-full rounded-control border border-line bg-bg p-3 text-base"
      />
      {empty && <p className="mt-1 text-sm text-muted">Type some words, or use Delete to remove it.</p>}
    </BottomSheet>
  );
}

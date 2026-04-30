// PanelHost — wraps a dockable panel in a header with a "move panel"
// dropdown and a drag handle for reordering within a dock column.
// Per-user persistence of the dock layout is handled by `dockLayout.ts`.

import { useState } from 'react';
import type { DockZone } from './dockLayout';

const DRAG_MIME = 'application/x-cld-panel';

interface Props {
  /** Stable identifier so the dock layout knows what's where. */
  panelId: string;
  /** User-facing title in the header. */
  title: string;
  /** Current zone. Drives the "move to ..." menu. */
  zone: DockZone;
  /** Move handler — called with the target zone. */
  onMove: (panelId: string, zone: DockZone) => void;
  /** Reorder handler — called when this panel is dropped onto another. */
  onReorder?: (fromId: string, toId: string) => void;
  /** Panel body. */
  children: React.ReactNode;
}

export { DRAG_MIME };

export function PanelHost({ panelId, title, zone, onMove, onReorder, children }: Props) {
  const [open, setOpen] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const moveTargets: { zone: DockZone; label: string }[] = [];
  if (zone !== 'left') moveTargets.push({ zone: 'left', label: 'Move to left' });
  if (zone !== 'right') moveTargets.push({ zone: 'right', label: 'Move to right' });
  if (zone !== 'float') moveTargets.push({ zone: 'float', label: 'Float panel' });
  if (zone !== 'hidden') moveTargets.push({ zone: 'hidden', label: 'Hide panel' });

  return (
    <section
      className={`flex h-full min-h-0 w-full flex-col bg-neutral-925 transition-colors ${dragOver ? 'outline outline-2 outline-blue-500' : ''}`}
      onDragOver={onReorder ? (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setDragOver(true); } : undefined}
      onDragLeave={onReorder ? () => setDragOver(false) : undefined}
      onDrop={onReorder ? (e) => {
        e.preventDefault();
        setDragOver(false);
        const fromId = e.dataTransfer.getData(DRAG_MIME);
        if (fromId && fromId !== panelId) onReorder(fromId, panelId);
      } : undefined}
    >
      <header className="relative flex items-center justify-between border-b border-neutral-800 bg-neutral-900 px-2 py-1 text-xs text-neutral-400">
        {/* Drag handle — grab to reorder within dock */}
        <span
          draggable
          onDragStart={(e) => { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData(DRAG_MIME, panelId); }}
          className="mr-1 cursor-grab select-none text-neutral-600 hover:text-neutral-400 active:cursor-grabbing"
          title="Drag to reorder"
        >
          ⠿
        </span>
        <span className="flex-1 truncate font-semibold uppercase tracking-wider">{title}</span>
        <button
          onClick={() => setOpen((v) => !v)}
          className="rounded px-1.5 py-0.5 text-[10px] hover:bg-neutral-800"
          title="Move or hide panel"
        >
          ⋯
        </button>
        {open && (
          <ul
            className="absolute right-1 top-full z-20 mt-1 w-40 rounded border border-neutral-700 bg-neutral-900 text-xs shadow"
            onClick={() => setOpen(false)}
          >
            {moveTargets.map((m) => (
              <li key={m.zone}>
                <button
                  onClick={() => onMove(panelId, m.zone)}
                  className="block w-full px-2 py-1 text-left hover:bg-neutral-800"
                >
                  {m.label}
                </button>
              </li>
            ))}
          </ul>
        )}
      </header>
      <div className="flex-1 min-h-0 overflow-hidden">{children}</div>
    </section>
  );
}

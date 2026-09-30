// PanelHost — wraps a dockable panel in a header with a "move panel"
// dropdown and a drag handle for reordering within a dock column.
// Per-user persistence of the dock layout is handled by `dockLayout.ts`.

import { useState } from 'react';
import type { DockZone } from './dockLayout';
import { usePreferences } from '../theme/PrefsProvider';

/** One-line explanations behind each panel's "?" (Settings > Show help buttons). */
export const PANEL_HELP: Record<string, { question: string; answer: string }> = {
  parts: { question: 'What are parts?', answer: 'Parts are the pieces you build with. Drag one onto the map, or click it to drop it in the middle.' },
  layers: {
    question: 'What are sheets?',
    answer: 'Sheets are like see-through pages stacked on the map: track on one, buildings on another. Hide or lock a sheet to work on the rest.',
  },
  usedparts: { question: 'What is the parts list?', answer: 'Every part this layout uses, with how many of each.' },
  modules: { question: 'What are modules?', answer: 'Groups of pieces kept together, so you can move or reuse them as one.' },
  modlibrary: { question: 'What is the module library?', answer: 'Modules saved to your account or your club, ready to drop into this layout.' },
  venuelibrary: {
    question: 'What is the room library?',
    answer: 'Rooms and halls saved to your account or your club. Put one under the layout to check that it fits.',
  },
};

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
  const [showHelp, setShowHelp] = useState(false);
  const { prefs } = usePreferences();
  const help = PANEL_HELP[panelId];
  const moveTargets: { zone: DockZone; label: string }[] = [];
  if (zone !== 'left') moveTargets.push({ zone: 'left', label: 'Move to left' });
  if (zone !== 'right') moveTargets.push({ zone: 'right', label: 'Move to right' });
  if (zone !== 'float') moveTargets.push({ zone: 'float', label: 'Float panel' });
  if (zone !== 'hidden') moveTargets.push({ zone: 'hidden', label: 'Hide panel' });

  return (
    <section
      className={`flex h-full min-h-0 w-full flex-col bg-panel transition-colors ${dragOver ? 'outline-solid outline-2 outline-accent' : ''}`}
      onDragOver={onReorder ? (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setDragOver(true); } : undefined}
      onDragLeave={onReorder ? () => setDragOver(false) : undefined}
      onDrop={onReorder ? (e) => {
        e.preventDefault();
        setDragOver(false);
        const fromId = e.dataTransfer.getData(DRAG_MIME);
        if (fromId && fromId !== panelId) onReorder(fromId, panelId);
      } : undefined}
    >
      <header className="relative flex min-h-11 items-center gap-1.5 border-b border-line bg-panel px-3 py-1.5">
        {/* Drag handle — grab to reorder within dock */}
        <span
          draggable
          onDragStart={(e) => { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData(DRAG_MIME, panelId); }}
          className="cursor-grab select-none text-neutral-600 hover:text-muted active:cursor-grabbing"
          title="Drag to reorder"
        >
          ⠿
        </span>
        <h2 className="min-w-0 truncate font-display text-[15px] font-bold text-ink">{title}</h2>
        {help && prefs.helpIcons && (
          <button
            type="button"
            aria-label={help.question}
            title={help.question}
            aria-expanded={showHelp}
            onClick={() => setShowHelp((v) => !v)}
            className="flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full border-[1.6px] border-muted text-[10px] font-extrabold text-muted hover:border-ink hover:text-ink"
          >
            ?
          </button>
        )}
        <span className="grow" />
        <button
          onClick={() => setOpen((v) => !v)}
          className="rounded-md px-1.5 py-0.5 text-xs text-muted hover:bg-soft"
          title="Move or hide panel"
        >
          ⋯
        </button>
        {open && (
          <ul
            className="absolute right-1 top-full z-20 mt-1 w-40 rounded-lg border border-border bg-panel text-xs shadow-sm"
            onClick={() => setOpen(false)}
          >
            {moveTargets.map((m) => (
              <li key={m.zone}>
                <button
                  onClick={() => onMove(panelId, m.zone)}
                  className="block w-full px-2 py-1 text-left hover:bg-soft"
                >
                  {m.label}
                </button>
              </li>
            ))}
          </ul>
        )}
      </header>
      {showHelp && help && prefs.helpIcons && (
        <p className="border-b border-line bg-accent-soft px-3 py-2 text-[13px] leading-snug text-ink">{help.answer}</p>
      )}
      <div className="flex-1 min-h-0 overflow-hidden">{children}</div>
    </section>
  );
}

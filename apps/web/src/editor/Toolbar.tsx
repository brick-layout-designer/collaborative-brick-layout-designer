import { useEffect } from 'react';
import { useEditorStore, type Tool } from './editorStore';

// Shortcut letters intentionally avoid `R` (which the canvas uses for
// "rotate selection ±90°", matching desktop MainWindowMenus.cpp:418/423)
// and `X` (commonly cut-on-other-platforms). Desktop has no equivalent
// 1-key tool switcher at all — these are a web-port convenience.
const TOOLS: { id: Tool; label: string; shortcut: string | null }[] = [
  { id: 'select', label: 'Select', shortcut: 'V' },
  { id: 'drag', label: 'Drag', shortcut: 'M' },
  { id: 'paint', label: 'Paint', shortcut: 'B' },
  { id: 'erase', label: 'Erase', shortcut: 'E' },
  { id: 'rulerLinear', label: 'Ruler ─', shortcut: null },
  { id: 'rulerCircular', label: 'Ruler ◯', shortcut: null },
  { id: 'venueOutline', label: 'Venue ⬟', shortcut: null },
  { id: 'venueObstacle', label: 'Venue ☐', shortcut: null },
  { id: 'rotate', label: 'Rotate', shortcut: null },
  { id: 'delete', label: 'Delete', shortcut: null },
];

export function Toolbar() {
  const tool = useEditorStore((s) => s.tool);
  const setTool = useEditorStore((s) => s.setTool);

  // Keyboard shortcuts. Lowercase to match e.key for letter keys.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      // Don't capture when typing in an input.
      if (e.target instanceof HTMLElement && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) {
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
      const t = TOOLS.find(
        (x) => x.shortcut !== null && x.shortcut.toLowerCase() === e.key.toLowerCase(),
      );
      if (t) {
        e.preventDefault();
        setTool(t.id);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setTool]);

  return (
    <div className="flex items-center gap-1 rounded border border-neutral-800 bg-neutral-900 p-1 text-xs">
      {TOOLS.map((t) => (
        <button
          key={t.id}
          onClick={() => setTool(t.id)}
          title={t.shortcut ? `${t.label} (${t.shortcut})` : t.label}
          className={
            'rounded px-2 py-1 ' +
            (tool === t.id ? 'bg-blue-600 text-white' : 'text-neutral-300 hover:bg-neutral-800')
          }
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

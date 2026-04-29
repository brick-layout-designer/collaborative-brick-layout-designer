import { useEffect } from 'react';
import { useEditorStore, type Tool } from './editorStore';

const TOOLS: { id: Tool; label: string; shortcut: string }[] = [
  { id: 'select', label: 'Select', shortcut: 'V' },
  { id: 'place', label: 'Place', shortcut: 'P' },
  { id: 'drag', label: 'Drag', shortcut: 'M' },
  { id: 'rotate', label: 'Rotate', shortcut: 'R' },
  { id: 'delete', label: 'Delete', shortcut: 'X' },
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
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const t = TOOLS.find((x) => x.shortcut.toLowerCase() === e.key.toLowerCase());
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
          title={`${t.label} (${t.shortcut})`}
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

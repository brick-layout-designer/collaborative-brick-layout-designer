// Local-only editor state. Selection, current tool, viewport pan/zoom.
// Phase 4 will project a slim subset of this to Yjs awareness so other
// users can see "alice is hovering on this brick"; in Phase 3 it stays
// purely local.

import { create } from 'zustand';

export type Tool = 'select' | 'place' | 'drag' | 'rotate' | 'delete';

export interface EditorState {
  tool: Tool;
  /** Brick ids currently selected. */
  selection: string[];
  /** Layer id currently being edited. */
  activeLayerId: string | null;
  /** Part library key picked for the place tool. Empty when nothing chosen. */
  placePartKey: string;
  /** Stage zoom factor — 1 = native (1 stud = pxPerStud px). */
  zoom: number;
  /** Stage pan in stage-local pixels. */
  panX: number;
  panY: number;

  setTool: (t: Tool) => void;
  setSelection: (ids: string[]) => void;
  toggleSelected: (id: string, additive: boolean) => void;
  setActiveLayer: (id: string | null) => void;
  setPlacePart: (key: string) => void;
  setZoom: (z: number) => void;
  setPan: (x: number, y: number) => void;
}

export const useEditorStore = create<EditorState>((set) => ({
  tool: 'select',
  selection: [],
  activeLayerId: null,
  placePartKey: '',
  zoom: 1,
  panX: 0,
  panY: 0,

  setTool: (tool) => set({ tool }),
  setSelection: (selection) => set({ selection }),
  toggleSelected: (id, additive) =>
    set((s) => {
      if (additive) {
        return s.selection.includes(id)
          ? { selection: s.selection.filter((x) => x !== id) }
          : { selection: [...s.selection, id] };
      }
      return { selection: [id] };
    }),
  setActiveLayer: (activeLayerId) => set({ activeLayerId }),
  setPlacePart: (placePartKey) => set({ placePartKey, tool: placePartKey ? 'place' : 'select' }),
  setZoom: (zoom) => set({ zoom: clamp(zoom, 0.1, 8) }),
  setPan: (panX, panY) => set({ panX, panY }),
}));

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

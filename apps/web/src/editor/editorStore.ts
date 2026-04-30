// Local-only editor state. Selection, current tool, viewport pan/zoom.
// Phase 4 will project a slim subset of this to Yjs awareness so other
// users can see "alice is hovering on this brick"; in Phase 3 it stays
// purely local.

import { create } from 'zustand';

export type Tool =
  | 'select'
  | 'drag'
  | 'rotate'
  | 'delete'
  | 'paint'
  | 'erase'
  | 'rulerLinear'
  | 'rulerCircular'
  | 'venueOutline'
  | 'venueObstacle';

/**
 * Snap-step values offered in the toolbar. Mirrors desktop
 * PreferencesDialog.cpp:118-122 — `[off, 32, 16, 8, 4, 2, 1, 0.5]`
 * studs. 0 means "no grid snap" (connection snap still fires).
 */
export const SNAP_STEPS = [0, 32, 16, 8, 4, 2, 1, 0.5] as const;

/**
 * Rotation-step values. Mirrors desktop's rotation-step submenu
 * (MainWindowMenus.cpp:403-415) — 90 / 45 / 22.5 / 11.25 / 5 / 1°.
 */
export const ROTATION_STEPS = [90, 45, 22.5, 11.25, 5, 1] as const;

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
  /**
   * Active grid-snap step in studs. 0 = grid snap disabled (connection
   * snap still applies). Default 1 stud (matches desktop default).
   */
  snapStepStuds: number;
  /**
   * Rotation step in degrees for R / Shift+R and the rotate tool.
   * Mirrors `editing/rotationStepDegrees` from desktop preferences.
   * Default 90° (matches desktop default).
   */
  rotationStepDegrees: number;
  /**
   * Live-snap indicator. Set during a drag when a connection snap is
   * firing; cleared on drag end. Coordinates are in WORLD STUDS.
   * Drives the green snap ring drawn by the canvas overlay (port of
   * SelectionOverlay::setSnapState — SelectionOverlay.cpp:63-68).
   */
  liveSnap: { studX: number; studY: number } | null;
  /**
   * Paint colour as AARRGGBB hex (uppercase, no leading "#"). Drives
   * the Paint Area tool. Defaults to a 50%-alpha green similar to the
   * desktop's Preferences default (`editing/paintColor`).
   */
  paintColor: string;
  /** Last known mouse position in WORLD STUDS — drives the status-bar HUD. */
  hudMouseStudX: number | null;
  hudMouseStudY: number | null;

  /** View toggle: show/hide connection-point dots (persisted). Desktop View menu. */
  showConnectionPoints: boolean;
  /** View toggle: show/hide the grid layer (persisted). Desktop View menu. */
  showGrid: boolean;
  /** View toggle: draw brick hull outlines (`view/brickHulls`). */
  showBrickHulls: boolean;
  /** View toggle: draw per-brick altitude badge labels (`view/brickElevation`). */
  showBrickElevation: boolean;
  /** View toggle: show ruler attach-point markers (`view/rulerAttachPoints`). */
  showRulerAttachPoints: boolean;
  /**
   * When true, connection-point dots render at full brightness on every
   * brick, not just selected ones. Desktop `appearance/alwaysShowConnections`.
   */
  alwaysShowConnections: boolean;
  /**
   * Wheel-zoom speed multiplier. 1.0 = desktop default (1.0015^delta).
   * Values > 1 zoom faster, < 1 slower. Mirrors `general/wheelZoomFactor`.
   */
  wheelZoomFactor: number;
  /**
   * Selection halo colour as RRGGBB hex (no leading #, no alpha).
   * Mirrors `appearance/selectionTint`. Default is desktop gold FFD700.
   */
  selectionTint: string;
  /** Show module name labels on canvas (`view/moduleNames`). */
  showModuleNames: boolean;
  /** Show module frame outlines on canvas (`view/moduleFrameThickness`). */
  showModuleFrames: boolean;
  /** Module frame thickness in px (`view/moduleFrameThickness`). */
  moduleFrameThickness: number;
  /** Show electric circuit overlay (`view/electricCircuits`). No-op until circuit data exists. */
  showElectricCircuits: boolean;
  /** Stamp export watermark on canvas export (`export/watermark`). */
  showExportWatermark: boolean;
  /** Module label font size percent (`view/moduleLabelPercent`). */
  moduleLabelPercent: number;
  /** Venue edge-distance label font size in px (`appearance/venueLabelPx`). Default 28. */
  venueLabelPx: number;
  /**
   * Maximum undo stack depth. 0 = unlimited (default, matches desktop default of 100).
   * Mirrors `general/undoStackDepth`.
   */
  undoStackDepth: number;
  /**
   * When true, opening the app navigates directly to the last opened layout.
   * Mirrors `general/reopenLastFile`.
   */
  reopenLastFile: boolean;
  /** Map bounding box in studs — updated by Canvas on every render. Drives the status bar. */
  hudMapWidthStuds: number | null;
  hudMapHeightStuds: number | null;

  /**
   * Transient status message shown in the status bar for ~3 s then auto-cleared.
   * Port of QMainWindow::showStatusMessage (MainWindow.cpp:861).
   */
  statusMessage: string | null;
  statusMessageTimerId: ReturnType<typeof setTimeout> | null;

  setTool: (t: Tool) => void;
  setSelection: (ids: string[]) => void;
  toggleSelected: (id: string, additive: boolean) => void;
  setActiveLayer: (id: string | null) => void;
  setPlacePart: (key: string) => void;
  setZoom: (z: number) => void;
  setPan: (x: number, y: number) => void;
  setSnapStep: (studs: number) => void;
  setRotationStep: (degrees: number) => void;
  setLiveSnap: (p: { studX: number; studY: number } | null) => void;
  setPaintColor: (argbHex: string) => void;
  setHudMouse: (studX: number | null, studY: number | null) => void;
  setShowConnectionPoints: (v: boolean) => void;
  setShowGrid: (v: boolean) => void;
  setShowBrickHulls: (v: boolean) => void;
  setShowBrickElevation: (v: boolean) => void;
  setShowRulerAttachPoints: (v: boolean) => void;
  setAlwaysShowConnections: (v: boolean) => void;
  setWheelZoomFactor: (v: number) => void;
  setSelectionTint: (rrggbb: string) => void;
  setShowModuleNames: (v: boolean) => void;
  setShowModuleFrames: (v: boolean) => void;
  setModuleFrameThickness: (v: number) => void;
  setShowElectricCircuits: (v: boolean) => void;
  setShowExportWatermark: (v: boolean) => void;
  setModuleLabelPercent: (v: number) => void;
  setVenueLabelPx: (v: number) => void;
  setUndoStackDepth: (v: number) => void;
  setReopenLastFile: (v: boolean) => void;
  setHudMapBounds: (w: number | null, h: number | null) => void;
  /** Show a transient message in the status bar; auto-clears after `durationMs` (default 3000). */
  showStatusMessage: (msg: string, durationMs?: number) => void;
  /**
   * Atomic zoom-around-point. Used by the wheel handler so the world
   * coordinate under the cursor stays put across the zoom step — desktop
   * achieves this via Qt's `AnchorUnderMouse` (MapView.cpp:89).
   */
  zoomAround: (newZoom: number, anchorPxX: number, anchorPxY: number) => void;
}

export const useEditorStore = create<EditorState>((set) => ({
  tool: 'select',
  selection: [],
  activeLayerId: null,
  placePartKey: '',
  zoom: 1,
  panX: 0,
  panY: 0,
  statusMessage: null,
  statusMessageTimerId: null,
  snapStepStuds: (() => {
    const v = localStorage.getItem('cld:snapStepStuds');
    const n = v !== null ? parseFloat(v) : 1;
    return Number.isFinite(n) && n >= 0 ? n : 1;
  })(),
  rotationStepDegrees: (() => {
    const v = localStorage.getItem('cld:rotationStepDegrees');
    const n = v !== null ? parseFloat(v) : 90;
    return Number.isFinite(n) && n > 0 ? n : 90;
  })(),
  liveSnap: null,
  hudMapWidthStuds: null,
  hudMapHeightStuds: null,
  paintColor: (() => {
    const v = localStorage.getItem('cld:paintColor');
    return v ?? '80008000';
  })(),
  hudMouseStudX: null,
  hudMouseStudY: null,
  showConnectionPoints: localStorage.getItem('cld:showConnectionPoints') !== 'false',
  showGrid: localStorage.getItem('cld:showGrid') !== 'false',
  showBrickHulls: localStorage.getItem('cld:showBrickHulls') === 'true',
  showBrickElevation: localStorage.getItem('cld:showBrickElevation') === 'true',
  showRulerAttachPoints: localStorage.getItem('cld:showRulerAttachPoints') === 'true',
  alwaysShowConnections: localStorage.getItem('cld:alwaysShowConnections') === 'true',
  wheelZoomFactor: (() => {
    const v = localStorage.getItem('cld:wheelZoomFactor');
    const n = v !== null ? parseFloat(v) : 1;
    return Number.isFinite(n) && n > 0 ? n : 1;
  })(),
  selectionTint: localStorage.getItem('cld:selectionTint') ?? 'FFD700',
  showModuleNames: localStorage.getItem('cld:showModuleNames') === 'true',
  showModuleFrames: localStorage.getItem('cld:showModuleFrames') === 'true',
  moduleFrameThickness: (() => {
    const v = localStorage.getItem('cld:moduleFrameThickness');
    const n = v !== null ? parseFloat(v) : 2;
    return Number.isFinite(n) && n > 0 ? n : 2;
  })(),
  undoStackDepth: (() => {
    const v = localStorage.getItem('cld:undoStackDepth');
    const n = v !== null ? parseInt(v, 10) : 100;
    return Number.isInteger(n) && n >= 0 ? n : 100;
  })(),
  reopenLastFile: localStorage.getItem('cld:reopenLastFile') === 'true',
  showElectricCircuits: localStorage.getItem('cld:showElectricCircuits') === 'true',
  showExportWatermark: localStorage.getItem('cld:showExportWatermark') === 'true',
  moduleLabelPercent: (() => {
    const v = localStorage.getItem('cld:moduleLabelPercent');
    const n = v !== null ? parseFloat(v) : 100;
    return Number.isFinite(n) && n > 0 ? n : 100;
  })(),
  venueLabelPx: (() => {
    const v = localStorage.getItem('cld:venueLabelPx');
    const n = v !== null ? parseInt(v, 10) : 28;
    return Number.isInteger(n) && n >= 4 ? n : 28;
  })(),

  setTool: (tool) => set({ tool }),
  setPaintColor: (paintColor) => {
    localStorage.setItem('cld:paintColor', paintColor);
    set({ paintColor });
  },
  setHudMouse: (hudMouseStudX, hudMouseStudY) => set({ hudMouseStudX, hudMouseStudY }),
  setShowConnectionPoints: (v) => {
    localStorage.setItem('cld:showConnectionPoints', String(v));
    set({ showConnectionPoints: v });
  },
  setShowGrid: (v) => {
    localStorage.setItem('cld:showGrid', String(v));
    set({ showGrid: v });
  },
  setShowBrickHulls: (v) => {
    localStorage.setItem('cld:showBrickHulls', String(v));
    set({ showBrickHulls: v });
  },
  setShowBrickElevation: (v) => {
    localStorage.setItem('cld:showBrickElevation', String(v));
    set({ showBrickElevation: v });
  },
  setShowRulerAttachPoints: (v) => {
    localStorage.setItem('cld:showRulerAttachPoints', String(v));
    set({ showRulerAttachPoints: v });
  },
  setAlwaysShowConnections: (v) => {
    localStorage.setItem('cld:alwaysShowConnections', String(v));
    set({ alwaysShowConnections: v });
  },
  setWheelZoomFactor: (v) => {
    const clamped = Math.max(0.1, Math.min(10, v));
    localStorage.setItem('cld:wheelZoomFactor', String(clamped));
    set({ wheelZoomFactor: clamped });
  },
  setSelectionTint: (rrggbb) => {
    const clean = rrggbb.replace(/[^0-9a-fA-F]/g, '').slice(0, 6).toUpperCase().padEnd(6, '0');
    localStorage.setItem('cld:selectionTint', clean);
    set({ selectionTint: clean });
  },
  setShowModuleNames: (v) => {
    localStorage.setItem('cld:showModuleNames', String(v));
    set({ showModuleNames: v });
  },
  setShowModuleFrames: (v) => {
    localStorage.setItem('cld:showModuleFrames', String(v));
    set({ showModuleFrames: v });
  },
  setModuleFrameThickness: (v) => {
    const clamped = Math.max(1, Math.min(20, v));
    localStorage.setItem('cld:moduleFrameThickness', String(clamped));
    set({ moduleFrameThickness: clamped });
  },
  setUndoStackDepth: (v) => {
    const clamped = Math.max(0, Math.min(1000, Math.round(v)));
    localStorage.setItem('cld:undoStackDepth', String(clamped));
    set({ undoStackDepth: clamped });
  },
  setReopenLastFile: (v) => {
    localStorage.setItem('cld:reopenLastFile', String(v));
    set({ reopenLastFile: v });
  },
  setShowElectricCircuits: (v) => {
    localStorage.setItem('cld:showElectricCircuits', String(v));
    set({ showElectricCircuits: v });
  },
  setShowExportWatermark: (v) => {
    localStorage.setItem('cld:showExportWatermark', String(v));
    set({ showExportWatermark: v });
  },
  setModuleLabelPercent: (v) => {
    const clamped = Math.max(10, Math.min(400, v));
    localStorage.setItem('cld:moduleLabelPercent', String(clamped));
    set({ moduleLabelPercent: clamped });
  },
  setVenueLabelPx: (v) => {
    const clamped = Math.max(4, Math.min(200, Math.round(v)));
    localStorage.setItem('cld:venueLabelPx', String(clamped));
    set({ venueLabelPx: clamped });
  },
  setHudMapBounds: (hudMapWidthStuds, hudMapHeightStuds) => set({ hudMapWidthStuds, hudMapHeightStuds }),
  showStatusMessage: (msg, durationMs = 3000) =>
    set((s) => {
      if (s.statusMessageTimerId !== null) clearTimeout(s.statusMessageTimerId);
      const id = setTimeout(() => {
        useEditorStore.setState({ statusMessage: null, statusMessageTimerId: null });
      }, durationMs);
      return { statusMessage: msg, statusMessageTimerId: id };
    }),
  setSnapStep: (studs) => {
    const v = Math.max(0, studs);
    localStorage.setItem('cld:snapStepStuds', String(v));
    set({ snapStepStuds: v });
  },
  setRotationStep: (degrees) => {
    const v = Math.max(0.1, degrees);
    localStorage.setItem('cld:rotationStepDegrees', String(v));
    set({ rotationStepDegrees: v });
  },
  setLiveSnap: (liveSnap) => set({ liveSnap }),
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
  setPlacePart: (placePartKey) => set({ placePartKey }),
  setZoom: (zoom) => set({ zoom: clamp(zoom, 0.1, 8) }),
  setPan: (panX, panY) => set({ panX, panY }),
  zoomAround: (newZoom, anchorPxX, anchorPxY) =>
    set((s) => {
      const next = clamp(newZoom, 0.1, 8);
      if (next === s.zoom) return s;
      // Pin the world coord under the cursor: anchor (in stage pixels) maps
      // to world (anchor − pan) / zoom; keep that ratio constant by
      // adjusting pan to (anchor − world*newZoom).
      const worldX = (anchorPxX - s.panX) / s.zoom;
      const worldY = (anchorPxY - s.panY) / s.zoom;
      return {
        zoom: next,
        panX: anchorPxX - worldX * next,
        panY: anchorPxY - worldY * next,
      };
    }),
}));

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

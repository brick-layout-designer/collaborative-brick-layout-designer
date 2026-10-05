// Edit module: everything outside the module being edited is dimmed, and
// the module's outline is drawn in the accent colour. The HUD layer draws
// it (no clicks). The desktop's MapView draws the same in its foreground.

import { Group, Line, Rect } from 'react-konva';
import type { BbmMap } from '@cld/model';
import type { SidecarModule } from '@cld/bbm';
import { useEditorStore } from '../editorStore';
import { studToPx } from './coords';
import { boundsOf, type StudRect } from '../moduleEdit';

/** How the outside of an edited module is dimmed (both apps, both themes). */
export const MODULE_EDIT_DIM = 'rgba(15,23,42,0.5)';
/** The edited module's outline: the accent blue, 2 screen px, dashed 8/4. */
export const MODULE_EDIT_OUTLINE = 'rgb(37,99,235)';
/** Its margin around the module's parts, in studs (the module frame's 4 px). */
export const MODULE_EDIT_PAD_STUDS = 0.5;

/** The outline of the module being edited (its parts on visible sheets, plus the frame's margin), in studs. */
export function editedModuleFrame(map: BbmMap, modules: readonly SidecarModule[], id: string | null): StudRect | null {
  const mod = id ? modules.find((m) => m.id === id) : undefined;
  if (!mod) return null;
  const areas = new Map<string, StudRect>();
  for (const l of map.layers) if (l.type === 'brick' && l.visible) for (const b of l.bricks) areas.set(b.id, b.displayArea);
  const b = boundsOf(mod.members, areas);
  if (!b) return null;
  const p = MODULE_EDIT_PAD_STUDS;
  return { x: b.x - p, y: b.y - p, width: b.width + 2 * p, height: b.height + 2 * p };
}

const FAR = 1e7;

export function ModuleEditDim({ frame }: { frame: StudRect | null }) {
  const zoom = useEditorStore((s) => s.zoom);
  if (!frame) return null;
  const x0 = studToPx(frame.x);
  const y0 = studToPx(frame.y);
  const x1 = studToPx(frame.x + frame.width);
  const y1 = studToPx(frame.y + frame.height);
  const px = 1 / (zoom > 0 ? zoom : 1);
  // Four bands around the module, so the module itself stays bright.
  return (
    <Group name="module-edit-dim" listening={false}>
      <Rect x={-FAR} y={-FAR} width={2 * FAR} height={y0 + FAR} fill={MODULE_EDIT_DIM} perfectDrawEnabled={false} />
      <Rect x={-FAR} y={y1} width={2 * FAR} height={FAR - y1} fill={MODULE_EDIT_DIM} perfectDrawEnabled={false} />
      <Rect x={-FAR} y={y0} width={x0 + FAR} height={y1 - y0} fill={MODULE_EDIT_DIM} perfectDrawEnabled={false} />
      <Rect x={x1} y={y0} width={FAR - x1} height={y1 - y0} fill={MODULE_EDIT_DIM} perfectDrawEnabled={false} />
      <Line
        name="module-edit-outline"
        points={[x0, y0, x1, y0, x1, y1, x0, y1]}
        closed
        stroke={MODULE_EDIT_OUTLINE}
        strokeWidth={2 * px}
        dash={[8 * px, 4 * px]}
        perfectDrawEnabled={false}
      />
    </Group>
  );
}

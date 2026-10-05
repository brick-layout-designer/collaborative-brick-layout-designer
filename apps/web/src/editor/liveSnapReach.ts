// The connection-snap reach for the view as it is now: the screen reach at
// the current zoom, scaled by the Snap strength setting (snapFeel.ts).

import { useEditorStore } from './editorStore';
import { studToPx } from './render/coords';
import { snapReachStuds } from './snapFeel';

export function liveSnapReach(): number {
  const { zoom, connectionSnap } = useEditorStore.getState();
  return snapReachStuds(studToPx() * zoom, connectionSnap);
}

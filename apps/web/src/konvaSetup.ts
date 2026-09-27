// Global Konva configuration. Imported for its side effect by the pages
// that render a Konva stage (editor, public viewer) so Konva stays out of
// the initial bundle for every other route.
import Konva from 'konva';

// Only the LEFT mouse button starts a Konva drag. Default is `[0, 1, 2]`
// — i.e. middle and right clicks also drag, which clobbers our
// middle-click-pan and right-click-cancel behaviours (the editor's
// stage handlers can't fire when Konva eats the event for a drag).
// Mirrors the desktop, where pan is `Qt::MiddleButton` and drag is
// `Qt::LeftButton` only (MapView.cpp:392-541).
Konva.dragButtons = [0];

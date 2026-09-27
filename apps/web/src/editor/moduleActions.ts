// Modules ▸ Create from Selection — desktop MainWindow::onCreateModuleFromSelection
// (MainWindow.cpp:1056-1077): ask for a name (default "New Module") and
// register the selected bricks as a sidecar module. Shared by the Map menu
// and the Modules panel.

import type * as Y from 'yjs';
import { useEditorStore } from './editorStore';
import { bricksByLayer, createSidecarModule } from './mutations';
import { projectDoc } from './useDocMap';

export function createModuleFromSelection(doc: Y.Doc): void {
  const { selection, showStatusMessage } = useEditorStore.getState();
  // Only bricks can be module members; drop ids that aren't bricks.
  const map = projectDoc(doc);
  const members = map ? [...bricksByLayer(map, selection).values()].flat() : [];
  if (members.length === 0) {
    window.alert('Select one or more bricks first.');
    return;
  }
  const name = window.prompt('Module name:', 'New Module');
  if (name === null || name.trim() === '') return;
  if (createSidecarModule(doc, name, members)) showStatusMessage('Module created', 3000);
}

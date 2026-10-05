// Modules ▸ Create from Selection — desktop MainWindow::onCreateModuleFromSelection
// (MainWindow.cpp:1056-1077): ask for a name (default "New Module") and
// register the selected bricks as a sidecar module. Shared by the Map menu
// and the Modules panel.

import type * as Y from 'yjs';
import type { SidecarModule } from '@cld/bbm';
import { readSidecarFromDoc } from '@cld/ydoc';
import { useEditorStore } from './editorStore';
import { bricksByLayer, createSidecarModule, deleteSidecarModule, updateSidecarModule } from './mutations';
import { pinnedAmong, withMembersAdded, withMembersRemoved, withPinned } from './moduleEdit';
import { projectDoc } from './useDocMap';

export function createModuleFromSelection(doc: Y.Doc): void {
  const { selection } = useEditorStore.getState();
  // Only bricks can be module members; drop ids that aren't bricks.
  const map = projectDoc(doc);
  const members = map ? [...bricksByLayer(map, selection).values()].flat() : [];
  if (members.length === 0) {
    window.alert('Select one or more parts first.');
    return;
  }
  const name = window.prompt('Module name:', 'New Module');
  if (name === null || name.trim() === '') return;
  if (createSidecarModule(doc, name, members)) useEditorStore.getState().showNotice(`Grouped “${name}” as a module`);
}

// ---------------------------------------------------------------------------
// Edit module and Pin in place (moduleEdit.ts has the rules).
// ---------------------------------------------------------------------------

/** Opens a module to change it part by part; `partId` (the part double-clicked) is picked. */
export function enterModuleEdit(id: string, partId?: string): void {
  const st = useEditorStore.getState();
  st.setEditingModule(id);
  if (partId) st.setSelection([partId]);
}

/** Back to editing the whole layout. */
export function leaveModuleEdit(): void {
  useEditorStore.getState().setEditingModule(null);
}

/** New parts placed while a module is edited join it (one undo step with the placing, when inside its transaction). */
export function joinEditedModule(doc: Y.Doc, ids: readonly string[]): void {
  const id = useEditorStore.getState().editingModuleId;
  if (!id || ids.length === 0) return;
  updateSidecarModule(doc, id, (m) => withMembersAdded(m, ids));
}

/** Takes parts out of a module (they stay on the map, on their own). */
export function takeOutOfModule(doc: Y.Doc, moduleId: string, ids: readonly string[]): void {
  updateSidecarModule(doc, moduleId, (m) => withMembersRemoved(m, ids));
}

export function setModulePinned(doc: Y.Doc, id: string, pinned: boolean): void {
  updateSidecarModule(doc, id, (m) => withPinned(m, pinned));
}

/** Says why a move didn't happen: the module is pinned in place. */
export function tellPinned(m: SidecarModule): void {
  useEditorStore
    .getState()
    .showNotice(`“${m.name || 'This module'}” is pinned in place. Unpin it from its ⋯ menu to move it, or use Edit module to change its parts.`, 'error', 6000);
}

/**
 * Whether the selection may move or turn as a whole; tells the person
 * when a pinned module stops it.
 */
export function selectionMayMove(doc: Y.Doc, ids: readonly string[]): boolean {
  const pinned = pinnedAmong(ids, readSidecarFromDoc(doc)?.modules ?? [], useEditorStore.getState().editingModuleId);
  if (pinned) tellPinned(pinned);
  return !pinned;
}

/**
 * Parts placed while a module is edited join it. A set or a library
 * module dropped in arrives as a module of its own: that one is dissolved
 * into the edited module (no module inside a module).
 */
export function absorbIntoEditedModule(doc: Y.Doc, ids: readonly string[]): void {
  const editing = useEditorStore.getState().editingModuleId;
  if (!editing || ids.length === 0) return;
  const placed = new Set(ids);
  doc.transact(() => {
    for (const m of readSidecarFromDoc(doc)?.modules ?? []) {
      if (m.id !== editing && m.members.length > 0 && m.members.every((id) => placed.has(id))) deleteSidecarModule(doc, m.id);
    }
    joinEditedModule(doc, ids);
  });
}

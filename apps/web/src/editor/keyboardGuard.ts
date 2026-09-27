// Shared guard for the editor's window-level keyboard shortcuts.
//
// Shortcuts (Delete, arrows, R, Ctrl+Z, tool letters, ...) must not fire
// while the user is typing or operating a form control: a focused <select>
// used to both change its value AND nudge/delete the selected bricks.

/** True when a keydown on `target` belongs to a form control or dialog. */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (target.isContentEditable) return true;
  return target.closest('[role="dialog"]') !== null;
}

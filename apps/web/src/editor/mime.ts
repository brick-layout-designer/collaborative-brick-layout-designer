// Drag-and-drop MIME types shared between panels and the canvas. Kept in
// a leaf module so importing one doesn't pull a lazily-loaded panel into
// the editor's main chunk.

/** Module-library panel → canvas drag payload (the module id). */
export const MODULE_MIME = 'application/x-cld-module';

/** Companion payload carrying the module's display name (sidecar entry name). */
export const MODULE_NAME_MIME = 'application/x-cld-module-name';

/**
 * The module-library drag in progress, if any. Browsers hide drag
 * payloads (getData) during dragover, so the canvas reads the module id
 * from here to draw its ghost. `session` changes on every drag start, so
 * a cached snapshot is never reused across drags.
 */
export const activeModuleDrag: { id: string | null; session: number } = { id: null, session: 0 };

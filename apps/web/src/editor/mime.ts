// Drag-and-drop MIME types shared between panels and the canvas. Kept in
// a leaf module so importing one doesn't pull a lazily-loaded panel into
// the editor's main chunk.

/** Module-library panel → canvas drag payload (the module id). */
export const MODULE_MIME = 'application/x-cld-module';

/** Companion payload carrying the module's display name (sidecar entry name). */
export const MODULE_NAME_MIME = 'application/x-cld-module-name';

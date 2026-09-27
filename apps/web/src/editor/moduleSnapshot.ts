// Fetch a saved library module's Y.Doc snapshot and turn it into
// per-layer insert batches. Shared by the module-library panel (click /
// drag to canvas) and the Insert Module dialog.

import * as Y from 'yjs';
import { docToBbm } from '@cld/ydoc';
import type { ModuleBatch } from './mutations';
import { moduleBatchesFromMap } from './moduleDrop';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export async function fetchModuleBatches(moduleId: string): Promise<ModuleBatch[]> {
  if (!UUID_RE.test(moduleId)) throw new Error('invalid module id');
  // Same-origin relative fetch; the id is a validated UUID.
  const res = await fetch(`/api/modules/${moduleId}/snapshot`, { credentials: 'include' });
  if (!res.ok) throw new Error(`snapshot fetch failed: ${res.status}`);
  const buf = await res.arrayBuffer();
  const moduleDoc = new Y.Doc();
  try {
    Y.applyUpdate(moduleDoc, new Uint8Array(buf));
    const batches = moduleBatchesFromMap(docToBbm(moduleDoc));
    if (batches.length === 0) throw new Error('module has no bricks');
    return batches;
  } catch (e) {
    if (e instanceof Error && e.message === 'module has no bricks') throw e;
    throw new Error('module snapshot is empty or invalid');
  } finally {
    moduleDoc.destroy();
  }
}

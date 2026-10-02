// A layout's first saved view starts its sidecar; that sidecar must have
// the fields every sidecar file has, or Download Layout makes a file that
// won't open again ("Sidecar parse failed").
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { readSidecar, writeSidecar } from '@cld/bbm';
import { readSidecarFromDoc } from '@cld/ydoc';
import { addSavedView } from '../mutations';

describe('the first saved view starts a sidecar that reads back', () => {
  it('has a schemaVersion and opens again', () => {
    const doc = new Y.Doc();
    addSavedView(doc, { id: 'v1', name: 'Overview', fit: true, rect: null, sheets: null, grid: false, labels: true });
    const sidecar = readSidecarFromDoc(doc)!;
    expect(sidecar.schemaVersion).toBe(1);
    expect(readSidecar(writeSidecar(sidecar)).views?.map((v) => v.name)).toEqual(['Overview']);
  });
});

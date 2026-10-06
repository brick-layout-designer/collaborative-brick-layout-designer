// Regression: window-level editor shortcuts must ignore keystrokes aimed
// at form controls. A focused <select> used to change its value AND nudge
// or delete the selected bricks; Ctrl+Z in one undid a canvas edit.

import { afterEach, describe, expect, it } from 'vitest';
import { renderHook } from '@testing-library/react';
import { createDefaultLayoutDoc, docToBbm } from '@cld/ydoc';
import { isEditableTarget } from '../keyboardGuard';
import { useUndoManager } from '../useUndoManager';
import { placeBrick } from '../mutations';

afterEach(() => {
  document.body.innerHTML = '';
});

describe('isEditableTarget', () => {
  it('flags inputs, textareas, selects, contenteditable and dialog content', () => {
    const input = document.createElement('input');
    const textarea = document.createElement('textarea');
    const select = document.createElement('select');
    const editable = document.createElement('div');
    editable.contentEditable = 'true';
    // jsdom does not implement isContentEditable; emulate the browser.
    Object.defineProperty(editable, 'isContentEditable', { value: true });
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    const button = document.createElement('button');
    dialog.appendChild(button);
    for (const el of [input, textarea, select, editable, button]) {
      expect(isEditableTarget(el)).toBe(true);
    }
  });

  it('flags entries of an open menu', () => {
    const menu = document.createElement('div');
    menu.setAttribute('role', 'menu');
    const item = document.createElement('button');
    menu.appendChild(item);
    expect(isEditableTarget(item)).toBe(true);
  });

  it('lets canvas / body keystrokes through', () => {
    expect(isEditableTarget(document.body)).toBe(false);
    expect(isEditableTarget(document.createElement('canvas'))).toBe(false);
    expect(isEditableTarget(null)).toBe(false);
    expect(isEditableTarget(window)).toBe(false);
  });
});

describe('undo shortcut guard', () => {
  it('Ctrl+Z inside a <select> does not undo', () => {
    const doc = createDefaultLayoutDoc();
    const layerId = docToBbm(doc).layers.find((l) => l.type === 'brick')!.id;
    renderHook(() => useUndoManager(doc));
    placeBrick(doc, layerId, { partNumber: 'a', x: 0, y: 0, width: 1, height: 1 });
    const count = () => {
      const l = docToBbm(doc).layers.find((x) => x.id === layerId);
      return l?.type === 'brick' ? l.bricks.length : -1;
    };
    expect(count()).toBe(1);

    const select = document.createElement('select');
    document.body.appendChild(select);
    select.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));
    expect(count()).toBe(1);

    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));
    expect(count()).toBe(0);
  });
});

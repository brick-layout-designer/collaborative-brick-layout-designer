// A modal dialog takes the focus, keeps Tab inside, and gives the focus
// back to what opened it when it closes.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { installModalFocus } from '../modalFocus';

const tick = () => new Promise((r) => setTimeout(r, 0));
const tab = (shift = false) => {
  const e = new KeyboardEvent('keydown', { key: 'Tab', shiftKey: shift, bubbles: true, cancelable: true });
  (document.activeElement ?? document.body).dispatchEvent(e);
  return e;
};

describe('installModalFocus', () => {
  let stop: () => void;
  let opener: HTMLButtonElement;
  beforeEach(() => {
    document.body.innerHTML = '<button id="opener">Share…</button><button id="behind">Behind</button>';
    opener = document.getElementById('opener') as HTMLButtonElement;
    opener.focus();
    stop = installModalFocus();
  });
  afterEach(() => {
    stop();
    document.body.innerHTML = '';
  });

  const openDialog = async (html = '<button id="a">A</button><input id="b"><button id="c">Close</button>', attrs = 'role="dialog" aria-modal="true"') => {
    const wrap = document.createElement('div');
    wrap.innerHTML = `<div id="dlg" ${attrs}>${html}</div>`;
    document.body.appendChild(wrap);
    await tick();
    return wrap;
  };

  it('moves the focus into the dialog when it opens', async () => {
    await openDialog();
    expect(document.activeElement?.id).toBe('a');
  });

  it('passes over the help buttons to the first real control', async () => {
    await openDialog('<button data-help-key="x" id="help">?</button><input id="name"><button id="ok">OK</button>');
    expect(document.activeElement?.id).toBe('name');
  });

  it('leaves a dialog that focused its own field alone', async () => {
    const wrap = document.createElement('div');
    wrap.innerHTML = '<div role="dialog" aria-modal="true"><button id="a">A</button><input id="b"></div>';
    document.body.appendChild(wrap);
    (document.getElementById('b') as HTMLInputElement).focus();
    await tick();
    expect(document.activeElement?.id).toBe('b');
  });

  it('focuses a dialog with nothing to press itself', async () => {
    await openDialog('<p>Saving…</p>');
    expect(document.activeElement?.id).toBe('dlg');
  });

  it('keeps Tab and Shift+Tab inside the dialog', async () => {
    await openDialog();
    (document.getElementById('c') as HTMLElement).focus();
    expect(tab().defaultPrevented).toBe(true);
    expect(document.activeElement?.id).toBe('a');
    expect(tab(true).defaultPrevented).toBe(true);
    expect(document.activeElement?.id).toBe('c');
    // In the middle, the browser moves it as usual.
    (document.getElementById('a') as HTMLElement).focus();
    expect(tab().defaultPrevented).toBe(false);
  });

  it('a group of radio buttons is one stop: Shift+Tab from the picked one wraps round', async () => {
    await openDialog('<input type="radio" name="m" id="r1"><input type="radio" name="m" id="r2" checked><button id="ok">OK</button>');
    (document.getElementById('r2') as HTMLElement).focus();
    expect(tab(true).defaultPrevented).toBe(true);
    expect(document.activeElement?.id).toBe('ok');
    expect(tab().defaultPrevented).toBe(true);
    expect(document.activeElement?.id).toBe('r2');
  });

  it('brings the focus back in from the page behind', async () => {
    await openDialog();
    (document.getElementById('behind') as HTMLElement).focus();
    tab();
    expect(document.activeElement?.id).toBe('a');
  });

  it('gives the focus back to the opener when it closes', async () => {
    const wrap = await openDialog();
    wrap.remove();
    await tick();
    expect(document.activeElement?.id).toBe('opener');
  });

  it('a dialog over a dialog: Tab stays in the top one, and closing it goes back to the first', async () => {
    await openDialog();
    const inner = document.createElement('div');
    inner.innerHTML = '<div role="alertdialog" aria-modal="true"><button id="no">Cancel</button><button id="yes">Delete</button></div>';
    document.body.appendChild(inner);
    await tick();
    expect(document.activeElement?.id).toBe('no');
    (document.getElementById('yes') as HTMLElement).focus();
    tab();
    expect(document.activeElement?.id).toBe('no');
    inner.remove();
    await tick();
    expect(document.activeElement?.id).toBe('a');
  });

  it('leaves Tab alone when the dialog handled it itself, and ignores dialogs that are not modal', async () => {
    await openDialog('<button id="x">X</button>', 'role="dialog"');
    expect(document.activeElement?.id).toBe('opener');
    expect(tab().defaultPrevented).toBe(false);
  });
});

// Map background: colour with alpha (MainWindowMapMenu.cpp:48-60,
// XmlPrimitives.cpp:174-180) and image placement (MapViewPaint.cpp:41-67).

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createDefaultLayoutDoc, docToBbm } from '@cld/ydoc';
import { writeBbm } from '@cld/bbm';
import { argbSpec, backgroundImageRectPx, hexAlpha } from '../background';
import { BackgroundColorDialog } from '../BackgroundColorDialog';

afterEach(cleanup);

describe('backgroundImageRectPx', () => {
  it('draws an image without a rect at native size at the origin (regression: was stretched to the bricks)', () => {
    expect(backgroundImageRectPx({}, { width: 640, height: 480 })).toEqual({ x: 0, y: 0, width: 640, height: 480 });
  });
  it('uses a stored rect (studs → 8 px/stud)', () => {
    expect(backgroundImageRectPx({ rect: { x: 1, y: -2, w: 10, h: 5 } }, { width: 640, height: 480 }))
      .toEqual({ x: 8, y: -16, width: 80, height: 40 });
  });
});

describe('background colour alpha', () => {
  it('writes lowercase aarrggbb like desktop', () => {
    expect(argbSpec('#6495ED', 128)).toEqual({ kind: 'argb', argb: '806495ed' });
    expect(argbSpec('00ff00', 300)).toEqual({ kind: 'argb', argb: 'ff00ff00' });
  });
  it('reads picker state back, known colours opaque', () => {
    expect(hexAlpha({ kind: 'argb', argb: '40112233' })).toEqual({ hex: '#112233', alpha: 64 });
    expect(hexAlpha({ kind: 'known', name: 'White' })).toEqual({ hex: '#ffffff', alpha: 255 });
  });

  it('the dialog saves the alpha into the doc and the .bbm', () => {
    const doc = createDefaultLayoutDoc();
    render(<BackgroundColorDialog current={docToBbm(doc).backgroundColor} doc={doc} onClose={() => {}} />);
    fireEvent.change(document.querySelector('input[type="color"]')!, { target: { value: '#102030' } });
    fireEvent.change(screen.getByLabelText('Alpha'), { target: { value: '100' } });
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    const map = docToBbm(doc);
    expect(map.backgroundColor).toEqual({ kind: 'argb', argb: '64102030' });
    expect(writeBbm(map)).toMatch(/<BackgroundColor>\s*<IsKnownColor>false<\/IsKnownColor>\s*<Name>64102030<\/Name>/);
  });
});

import { describe, expect, it } from 'vitest';
import { fontStack } from '../render/fontStack';

describe('fontStack', () => {
  it('draws every family in the bundled map font, as the desktop does', () => {
    for (const f of ['Tahoma', 'Microsoft Sans Serif', 'Arial', '', undefined, 'Evil"Font'])
      expect(fontStack(f)).toBe('"BLD Map Sans", "Liberation Sans", Arial, sans-serif');
  });
});

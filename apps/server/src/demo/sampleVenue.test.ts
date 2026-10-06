// The demo's sample venue: the fixture's own hall, or (an install without
// the file, or a file without a name) an empty one called "Community Hall",
// never "Sample room".

import { describe, expect, it } from 'vitest';
import { sampleVenue } from './reset.js';

describe('sampleVenue', () => {
  it('keeps the file’s own name and drops its format tag', () => {
    const v = sampleVenue(JSON.stringify({ schema: 'bld-venue/1', name: 'Grand Lobby', edges: [1] }));
    expect(v).toEqual({ name: 'Grand Lobby', edges: [1] });
  });
  it('a missing, unreadable or unnamed file gives a Community Hall', () => {
    expect(sampleVenue(null)).toEqual({ name: 'Community Hall', edges: [] });
    expect(sampleVenue('{nope')).toEqual({ name: 'Community Hall', edges: [] });
    expect(sampleVenue(JSON.stringify({ edges: [] })).name).toBe('Community Hall');
  });
});

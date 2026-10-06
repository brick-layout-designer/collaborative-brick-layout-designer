// The catalog's kinds: which tabs show (each has its own switch), what
// buttons say, and the one-line size and parts summary of a layout or venue.

import { describe, expect, it } from 'vitest';
import { hasPage, KIND_LABEL, kindsOn, summaryText } from '../CatalogPage';

describe('catalog kinds', () => {
  it('shows a tab only for the catalogs that are on, in order', () => {
    expect(kindsOn(undefined)).toEqual([]);
    expect(kindsOn({ modules: true, parts: false })).toEqual(['module']);
    expect(kindsOn({ modules: true, parts: true, layouts: true, venues: true })).toEqual(['module', 'part', 'layout', 'venue']);
    expect(kindsOn({ venues: true })).toEqual(['venue']);
  });

  it('layouts and venues open their own page; copies go to my layouts and venues', () => {
    expect(hasPage('layout')).toBe(true);
    expect(hasPage('venue')).toBe(true);
    expect(hasPage('module')).toBe(false);
    expect(KIND_LABEL.layout.add).toBe('Copy to my layouts');
    expect(KIND_LABEL.venue.add).toBe('Copy to my venues');
  });

  it('says how big it is, in studs and metres, and how many parts', () => {
    expect(summaryText({ widthStuds: 960, heightStuds: 480, partCount: 1204 })).toBe('960 × 480 studs (7.7 × 3.8 m) · 1,204 parts');
    expect(summaryText({ widthStuds: 400, heightStuds: 300 })).toBe('400 × 300 studs (3.2 × 2.4 m)');
    expect(summaryText({ widthStuds: 0, heightStuds: 0, partCount: 1 })).toBe('1 part');
  });
});

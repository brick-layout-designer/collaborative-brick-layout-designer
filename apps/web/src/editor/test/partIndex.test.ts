// Catalog index with old part numbers (<OldNameList>, desktop canonicalKey).

import { describe, expect, it } from 'vitest';
import type { PartWire } from '../../api';
import { actualPartNumber, indexParts } from '../partIndex';

const part = (key: string, partNumber: string, colorCode: string, oldNames?: string[]) =>
  ({ key, partNumber, colorCode, ...(oldNames ? { oldNames } : {}) }) as unknown as PartWire;

const BASEPLATE = part('4186p01.2', '4186p01', '2', ['4186P01']);
const RENAMED = part('3811.1', '3811', '1', ['OLD3811', '3001.1']);
const BRICK = part('3001.1', '3001', '1');
const index = indexParts([BASEPLATE, RENAMED, BRICK]);

describe('indexParts', () => {
  it('finds a part by key, bare part number and old name, case-insensitively', () => {
    expect(index.get('4186p01.2')).toBe(BASEPLATE);
    expect(index.get('3811')).toBe(RENAMED);
    expect(index.get('old3811')).toBe(RENAMED);
  });

  it('an old name never shadows a real part', () => {
    // 3811.1 lists 3001.1 as an old name, but 3001.1 is a real key.
    expect(index.get('3001.1')).toBe(BRICK);
  });
});

describe('actualPartNumber (BlueBrick getActualPartNumber)', () => {
  it('maps an old name to PARTNUMBER.COLOR upper-cased', () => {
    expect(actualPartNumber(index, 'old3811')).toBe('3811.1');
    expect(actualPartNumber(index, 'OLD3811')).toBe('3811.1');
    // An old name that is also the bare number still converts, like desktop.
    expect(actualPartNumber(index, '4186P01')).toBe('4186P01.2');
  });

  it('keeps current and unknown ids as written', () => {
    expect(actualPartNumber(index, '3001.1')).toBe('3001.1');
    expect(actualPartNumber(index, '4186p01.2')).toBe('4186p01.2');
    expect(actualPartNumber(index, 'TS_UNKNOWN')).toBe('TS_UNKNOWN');
    expect(actualPartNumber(index, '3811')).toBe('3811');
  });
});

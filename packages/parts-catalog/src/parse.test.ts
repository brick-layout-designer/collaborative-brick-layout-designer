import { describe, expect, it } from 'vitest';
import { parsePartXml } from './parse.js';

const TRACK_XML = `<?xml version="1.0" encoding="UTF-8"?>
<part>
  <Author>Alban Nanty</Author>
  <Description>
    <en>Curve track (Radius 56 studs)</en>
    <fr>Rail courbe (rayon de 56 tenons)</fr>
  </Description>
  <SortingKey>A2.6</SortingKey>
  <ConnexionList>
    <connexion>
      <type>1</type>
      <position><x>-9.1875</x><y>-1.25</y></position>
      <angle>180</angle>
      <electricPlug>1</electricPlug>
      <nextConnexionPreference>1</nextConnexionPreference>
    </connexion>
    <connexion>
      <type>1</type>
      <position><x>8.11745</x><y>1.490835</y></position>
      <angle>18</angle>
      <electricPlug>-1</electricPlug>
    </connexion>
  </ConnexionList>
</part>`;

const SIMPLE_XML = `<?xml version="1.0" encoding="UTF-8"?>
<part>
  <Author>Alex</Author>
  <Description><en>Plate</en></Description>
</part>`;

const GROUP_XML = `<?xml version="1.0" encoding="utf-8"?>
<group>
  <Author>Alban</Author>
  <Description><en>Crossover</en></Description>
  <CanUngroup>true</CanUngroup>
  <SubPartList>
    <SubPart id="TS_TRACK18S.8">
      <position><x>0</x><y>0</y></position>
      <angle>0</angle>
    </SubPart>
    <SubPart id="TS_TRACK_FLEX.8">
      <position><x>16</x><y>0</y></position>
      <angle>90</angle>
    </SubPart>
  </SubPartList>
</group>`;

describe('parsePartXml — leaf parts', () => {
  it('parses author, description, sortingKey, and connection list', () => {
    const part = parsePartXml(TRACK_XML, {
      partNumber: 'TS_CURVE_R56',
      colorCode: '8',
      spritePath: '4DBrix/TS_CURVE_R56.8.gif',
    });

    expect(part.kind).toBe('leaf');
    expect(part.key).toBe('ts_curve_r56.8'); // lowercased library key
    expect(part.author).toBe('Alban Nanty');
    expect(part.descriptions.en).toContain('Curve track');
    expect(part.descriptions.fr).toContain('Rail courbe');
    expect(part.sortingKey).toBe('A2.6');
    expect(part.connections).toHaveLength(2);

    expect(part.connections[0]).toEqual({
      type: '1',
      x: -9.1875,
      y: -1.25,
      angle: 180,
      electricPlug: 1,
      nextConnexionPreference: 1,
    });

    expect(part.connections[1]).toEqual({
      type: '1',
      x: 8.11745,
      y: 1.490835,
      angle: 18,
      electricPlug: -1,
    });
  });

  it('preserves fractional positions without rounding', () => {
    const part = parsePartXml(TRACK_XML, {
      partNumber: 'TS_CURVE_R56',
      colorCode: '8',
      spritePath: '',
    });
    expect(part.connections[0]?.x).toBe(-9.1875);
    expect(part.connections[1]?.x).toBe(8.11745);
  });

  it('handles parts with no connection list', () => {
    const part = parsePartXml(SIMPLE_XML, {
      partNumber: 'plate',
      colorCode: '1',
      spritePath: '',
    });
    expect(part.connections).toEqual([]);
    expect(part.kind).toBe('leaf');
  });

  it('defaults pxPerStud to 8 when missing', () => {
    const part = parsePartXml(SIMPLE_XML, {
      partNumber: 'plate',
      colorCode: '1',
      spritePath: '',
    });
    expect(part.pxPerStud).toBe(8);
  });

  it('honours <PixelsPerStud> when present', () => {
    const part = parsePartXml(
      `<?xml version="1.0"?><part><PixelsPerStud>16</PixelsPerStud></part>`,
      { partNumber: 'p', colorCode: '0', spritePath: '' },
    );
    expect(part.pxPerStud).toBe(16);
  });

  it('treats empty <type> as the no-connect case', () => {
    const part = parsePartXml(
      `<?xml version="1.0"?>
      <part>
        <ConnexionList>
          <connexion>
            <type></type>
            <position><x>0</x><y>0</y></position>
            <angle>0</angle>
          </connexion>
        </ConnexionList>
      </part>`,
      { partNumber: 'p', colorCode: '0', spritePath: '' },
    );
    expect(part.connections[0]?.type).toBe('');
  });
});

describe('parsePartXml — group composites', () => {
  it('parses subparts with stable lower-case ids', () => {
    const grp = parsePartXml(GROUP_XML, {
      partNumber: 'crossover',
      colorCode: '1',
      spritePath: '',
    });
    expect(grp.kind).toBe('group');
    expect(grp.canUngroup).toBe(true);
    expect(grp.subparts).toHaveLength(2);
    expect(grp.subparts[0]).toEqual({
      subKey: 'ts_track18s.8',
      x: 0,
      y: 0,
      angle: 0,
    });
    expect(grp.subparts[1]?.angle).toBe(90);
  });
});

describe('parsePartXml — error handling', () => {
  it('throws on missing root element', () => {
    expect(() => parsePartXml('<random/>', { partNumber: 'p', colorCode: '0', spritePath: '' }))
      .toThrow(/<part> or <group>/);
  });
});

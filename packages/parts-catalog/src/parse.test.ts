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

describe('parsePartXml — old part names', () => {
  const input = { partNumber: '3811', colorCode: '1', spritePath: '' };
  it('reads <OldNameList> (one or several names)', () => {
    const one = '<part><OldNameList><OldName> 4186P01 </OldName></OldNameList></part>';
    expect(parsePartXml(one, input).oldNames).toEqual(['4186P01']);
    const two = '<part><OldNameList><OldName>A</OldName><OldName>B</OldName></OldNameList></part>';
    expect(parsePartXml(two, input).oldNames).toEqual(['A', 'B']);
  });

  it('no list means no old names', () => {
    expect(parsePartXml('<part></part>', input).oldNames).toEqual([]);
  });
});

describe('parsePartXml map-format remaps', () => {
  const input = { partNumber: 'X', colorCode: '1', spritePath: '' };

  it('reads <LDraw>, <TrackDesigner> and <FourDBrix>', () => {
    const meta = parsePartXml(
      `<part>
        <LDraw>
          <Angle>90</Angle>
          <Translation><x>-10</x><y>2.5</y></Translation>
          <PreferredHeight>-24</PreferredHeight>
          <SleeperID>4166a</SleeperID>
          <Alias>3001.4</Alias>
        </LDraw>
        <TrackDesigner>
          <IDList><!-- ID of this part in Track Designer -->
            <ID registry="default">627</ID>
            <ID registry="freelug">10003811</ID>
          </IDList>
          <Flag>3</Flag> <!-- attachment -->
          <HasSeveralGeometries>true</HasSeveralGeometries>
          <TDBitmapList>
            <TDBitmap><BBConnexionPointIndex>1</BBConnexionPointIndex><Type>2</Type><AngleBetweenTDandBB>-22.5</AngleBetweenTDandBB></TDBitmap>
            <TDBitmap><BBConnexionPointIndex>0</BBConnexionPointIndex></TDBitmap>
          </TDBitmapList>
        </TrackDesigner>
        <FourDBrix>
          <PartType>SEGMENT</PartType>
          <PartName>TS_MONORAILUPPERRAMP</PartName>
          <OrientationDifference>180</OrientationDifference>
          <ConnectionIndexUsedAsOrigin>1</ConnectionIndexUsedAsOrigin>
        </FourDBrix>
      </part>`,
      input,
    );
    expect(meta.ldraw).toEqual({ angle: 90, translation: { x: -10, y: 2.5 }, preferredHeight: -24, sleeper: '4166A.0', alias: '3001.4' });
    expect(meta.trackDesigner).toEqual({
      defaultId: 627,
      registryIds: { freelug: 10003811 },
      flags: 3,
      hasSeveralPorts: true,
      ports: [
        { bbConnectionIndex: 1, type: 2, angleDifference: -22.5 },
        { bbConnectionIndex: 0, type: 20, angleDifference: 0 },
      ],
    });
    expect(meta.fourDBrix).toEqual({ type: 'segment', partName: 'TS_MONORAILUPPERRAMP', orientationDifference: 180, originConnection: 1 });
  });

  it('reads a single <ID>, a registry-only id and the other 4DBrix types', () => {
    expect(parsePartXml('<part><TrackDesigner><ID>42</ID></TrackDesigner></part>', input).trackDesigner?.defaultId).toBe(42);
    expect(parsePartXml('<part><TrackDesigner><IDList><ID registry="lug">7</ID></IDList></TrackDesigner></part>', input).trackDesigner)
      .toMatchObject({ defaultId: 7, registryIds: { lug: 7 } });
    // No id: not a TrackDesigner part.
    expect(parsePartXml('<part><TrackDesigner><Flag>1</Flag></TrackDesigner></part>', input).trackDesigner).toBeUndefined();
    for (const [raw, type] of [['table', 'table'], ['BASEPLATE', 'baseplate'], ['Structure', 'structure'], ['?', 'segment']] as const) {
      expect(parsePartXml(`<part><FourDBrix><PartType>${raw}</PartType><PartName>a/b.svg</PartName></FourDBrix></part>`, input).fourDBrix)
        .toEqual({ type, partName: 'a/b.svg', orientationDifference: 0, originConnection: 0 });
    }
    expect(parsePartXml(SIMPLE_XML, input)).not.toHaveProperty('ldraw');
  });
});

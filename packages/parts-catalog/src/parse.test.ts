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
    expect(grp.groupNextPreferred).toBeUndefined();
  });

  it("reads a set's connection preferences (flex.group)", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<group>
  <CanUngroup>false</CanUngroup>
  <SubPartList>
    <SubPart id="88492.8"><position><x>-0.8</x><y>0</y></position><angle>0</angle></SubPart>
    <SubPart id="88493.8"><position><x>0.8</x><y>0</y></position><angle>0</angle></SubPart>
  </SubPartList>
  <GroupConnectionPreferenceList>
    <nextIndex from="0">2</nextIndex>
    <nextIndex from="2">0</nextIndex>
  </GroupConnectionPreferenceList>
</group>`;
    const grp = parsePartXml(xml, { partNumber: 'flex', colorCode: 'group', spritePath: '' });
    expect(grp.canUngroup).toBe(false);
    expect(grp.groupNextPreferred).toEqual({ 0: 2, 2: 0 });
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

describe('parsePartXml — <SnapMargin>', () => {
  const xml = (margin: string) => `<?xml version="1.0" encoding="UTF-8"?><part>${margin}</part>`;
  const parse = (margin: string) => parsePartXml(xml(margin), { partNumber: '2865', colorCode: '8', spritePath: '' });

  it('reads the margin grid snapping leaves out, in studs', () => {
    const p = parse('<SnapMargin><left>0.5</left><right>0.7</right><top>0</top><bottom>2.625</bottom></SnapMargin>');
    expect(p.snapMargin).toEqual({ left: 0.5, right: 0.7, top: 0, bottom: 2.625 });
  });

  it('leaves it out when absent or all zero', () => {
    expect(parse('').snapMargin).toBeUndefined();
    expect(parse('<SnapMargin><left>0</left><right>0</right><top>0</top><bottom>0</bottom></SnapMargin>').snapMargin).toBeUndefined();
  });
});

describe('<PickShape>', () => {
  const pt = (x: number, y: number) => `<point><x>${x}</x><y>${y}</y></point>`;
  // An L, 8 x 8 studs with the top-right 4 x 4 empty, as the desktop's importer writes it.
  const L_XML = `<part><Description><en>ell</en></Description>
    <PickShape><ring>${pt(-4, -4)}${pt(0, -4)}${pt(0, 0)}${pt(4, 0)}${pt(4, 4)}${pt(-4, 4)}</ring></PickShape></part>`;

  it('reads the rings and leaves the hull (and so the footprint) alone', () => {
    const part = parsePartXml(L_XML, { partNumber: 'ell', colorCode: '', spritePath: '' });
    expect(part.pickShape).toEqual([[{ x: -4, y: -4 }, { x: 0, y: -4 }, { x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 4 }, { x: -4, y: 4 }]]);
    expect(part.hullPts).toEqual([]);
  });

  it('is absent without one, and skips rings too small to be shapes', () => {
    expect(parsePartXml('<part/>', { partNumber: 'a', colorCode: '', spritePath: '' }).pickShape).toBeUndefined();
    const tiny = `<part><PickShape><ring>${pt(0, 0)}${pt(1, 0)}</ring></PickShape></part>`;
    expect(parsePartXml(tiny, { partNumber: 'a', colorCode: '', spritePath: '' }).pickShape).toBeUndefined();
  });
});

describe('<Designer>: who built an imported model', () => {
  const xml = (designer: string) =>
    `<?xml version="1.0"?><part><Author>me</Author>${designer}<ImageURL></ImageURL></part>`;
  const parse = (designer: string) => parsePartXml(xml(designer), { partNumber: 'MARKET', colorCode: '', spritePath: '' });

  it('reads the name and an http(s) link', () => {
    expect(parse('<Designer url="https://example.com/sam">Sam Builder</Designer>').designer).toEqual({
      name: 'Sam Builder',
      url: 'https://example.com/sam',
    });
    expect(parse('<Designer>Sam</Designer>').designer).toEqual({ name: 'Sam' });
  });

  it('drops a link that isn’t a web page, and an empty name', () => {
    expect(parse('<Designer url="javascript:alert(1)">Sam</Designer>').designer).toEqual({ name: 'Sam' });
    expect(parse('<Designer url="https://example.com"> </Designer>').designer).toBeUndefined();
    expect(parse('').designer).toBeUndefined();
  });
});

import { describe, expect, it } from 'vitest';
import { stripImportSource } from './partXml.js';

const part = (inner: string) => `<?xml version="1.0"?>\n<part>\n<Description><en>Yard</en></Description>${inner}\n<ConnexionList/>\n</part>`;

describe('stripImportSource', () => {
  it('removes the block that holds the importer\'s local path', () => {
    const xml = part(
      '\n<ImportSource><SourcePath>C:\\Users\\sam\\Models\\yard.io</SourcePath><QuarterTurns>1</QuarterTurns><DroppedConnection x="1" y="2"/></ImportSource>',
    );
    const out = stripImportSource(Buffer.from(xml)).toString('utf8');
    expect(out).not.toContain('ImportSource');
    expect(out).not.toContain('sam');
    expect(out).toContain('<Description><en>Yard</en></Description>');
    expect(out).toContain('<ConnexionList/>');
  });

  it('removes several blocks and an empty one, and keeps ImportedFrom (just a file name)', () => {
    const xml = part('<ImportSource/><ImportedFrom file="yard.io" format="studio"/><ImportSource ><SourcePath>/home/sam/yard.io</SourcePath></ImportSource>');
    const out = stripImportSource(Buffer.from(xml)).toString('utf8');
    expect(out).not.toContain('ImportSource');
    expect(out).not.toContain('/home/sam');
    expect(out).toContain('<ImportedFrom file="yard.io" format="studio"/>');
  });

  it('leaves a part without one untouched (the same buffer)', () => {
    const buf = Buffer.from(part(''));
    expect(stripImportSource(buf)).toBe(buf);
  });

  it('leaves a lookalike element alone', () => {
    const xml = part('<ImportSourceNote>keep</ImportSourceNote>');
    expect(stripImportSource(Buffer.from(xml)).toString('utf8')).toContain('<ImportSourceNote>keep</ImportSourceNote>');
  });
});

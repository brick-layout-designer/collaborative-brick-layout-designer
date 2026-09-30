// Parts That Differ: a layout file's own version of parts the server has,
// shown both ways, with Keep the server's by default, Use the file's and
// Keep both (desktop PartDifferencesDialog).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { PartDifferencesDialog } from '../PartDifferencesDialog';
import type { PartDifference } from '../../layoutParts';

const partXml = (en: string, author?: string) =>
  `<part>${author ? `<Author>${author}</Author>` : ''}<Description><en>${en}</en></Description></part>`;

const DIFFERENCES: PartDifference[] = [
  {
    partNumber: 'MINE.1',
    customPartId: 'a',
    serverPartNumber: 'MINE.1',
    serverXml: partXml('Mine on the server', 'Ann'),
    fileXml: partXml('Mine in the file', 'Bo'),
    sprite: new Uint8Array([1, 2, 3]),
    spriteMime: 'image/png',
  },
  {
    partNumber: 'KIT.1',
    customPartId: 'k',
    serverPartNumber: 'KIT.1',
    serverXml: partXml('Kit'),
    fileXml: partXml('Kit, changed'),
    sprite: new Uint8Array([4]),
    spriteMime: 'image/gif',
  },
  {
    partNumber: 'BARE.1',
    customPartId: 'b',
    serverPartNumber: 'BARE.1',
    serverXml: '<part/>',
    fileXml: partXml('No image'),
  },
];

let created: Blob[];
let revoked: string[];
beforeEach(() => {
  created = [];
  revoked = [];
  vi.spyOn(URL, 'createObjectURL').mockImplementation((b) => {
    created.push(b as Blob);
    return `blob:${created.length - 1}`;
  });
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation((u) => void revoked.push(u));
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const open = () => {
  const onDone = vi.fn();
  const view = render(<PartDifferencesDialog differences={DIFFERENCES} onDone={onDone} />);
  return { onDone, view, dialog: screen.getByRole('dialog', { name: 'Parts That Differ' }) };
};

describe('Parts That Differ', () => {
  it('shows each part both ways: the server sprite, the file bytes, description and author', () => {
    const { dialog } = open();
    expect(dialog.textContent).toContain('This layout has its own version of 3 parts the server already has.');
    expect(screen.getByAltText('MINE.1 on the server').getAttribute('src')).toBe('/api/custom-parts/a/sprite');
    expect(screen.getByAltText('MINE.1 in the file').getAttribute('src')).toBe('blob:0');
    expect(screen.getByAltText('KIT.1 in the file').getAttribute('src')).toBe('blob:1');
    expect(created.map((b) => b.type)).toEqual(['image/png', 'image/gif']);
    const row = screen.getByText('MINE.1').closest('tr')!;
    expect(row.textContent).toContain('Mine on the server');
    expect(row.textContent).toContain('by Ann');
    expect(row.textContent).toContain('Mine in the file');
    expect(row.textContent).toContain('by Bo');
    // No file image: nothing to show, and nothing the server could take.
    const bare = screen.getByText('BARE.1').closest('tr')!;
    expect(within(bare).getAllByText('No image', { selector: 'span' })).toHaveLength(1);
    expect((within(bare).getByRole('option', { name: "Use the file's" }) as HTMLOptionElement).disabled).toBe(true);
    expect((within(bare).getByRole('option', { name: 'Keep both' }) as HTMLOptionElement).disabled).toBe(true);
  });

  it("defaults every part to Keep the server's", () => {
    const { onDone } = open();
    for (const d of DIFFERENCES) expect((screen.getByLabelText(`Use for ${d.partNumber}`) as HTMLSelectElement).value).toBe('server');
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    expect(onDone).toHaveBeenCalledWith(['server', 'server', 'server']);
  });

  it('returns the choice made for each part', () => {
    const { onDone } = open();
    fireEvent.change(screen.getByLabelText('Use for MINE.1'), { target: { value: 'file' } });
    fireEvent.change(screen.getByLabelText('Use for KIT.1'), { target: { value: 'both' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    expect(onDone).toHaveBeenCalledWith(['file', 'both', 'server']);
  });

  it("Keep All the Server's answers null, and the file images are let go on close", () => {
    const { onDone, view } = open();
    fireEvent.change(screen.getByLabelText('Use for MINE.1'), { target: { value: 'both' } });
    fireEvent.click(screen.getByRole('button', { name: "Keep All the Server's" }));
    expect(onDone).toHaveBeenCalledWith(null);
    view.unmount();
    expect(revoked).toEqual(['blob:0', 'blob:1']);
  });
});

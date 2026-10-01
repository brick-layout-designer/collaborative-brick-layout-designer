// Phone card tables: each cell is labelled with its column's header.

import { describe, expect, it } from 'vitest';
import { labelTableCells } from '../cardTables';

describe('labelTableCells', () => {
  it('labels each cell with its column header, and leaves a full-width cell unlabelled', () => {
    const div = document.createElement('div');
    div.innerHTML = `<table><thead><tr><th>Email</th><th>Layouts</th></tr></thead>
      <tbody><tr><td>a@b.c</td><td>3</td></tr><tr><td colspan="2">No more</td></tr></tbody></table>`;
    labelTableCells(div);
    const cells = Array.from(div.querySelectorAll('td')).map((td) => td.getAttribute('data-label'));
    expect(cells).toEqual(['Email', 'Layouts', '']);
  });
});

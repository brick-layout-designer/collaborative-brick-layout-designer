import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { csvCell, describeSeries, formatBytes, formatCompact, niceTicks, toCsv } from './format';
import { BarList, DataTable, LineChart, StatTile } from './charts';

afterEach(cleanup);

const DAY = 86_400_000;
const starts = [0, 1, 2, 3].map((i) => Date.UTC(2026, 8, 1) + i * DAY);

describe('format helpers', () => {
  it('compacts numbers and bytes', () => {
    expect(formatCompact(1284)).toBe('1,284');
    expect(formatCompact(12_900)).toBe('12.9K');
    expect(formatCompact(4_200_000)).toBe('4.2M');
    expect(formatBytes(500)).toBe('500 B');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(500 * 1024 * 1024)).toBe('500 MB');
  });

  it('sums a series up in one sentence', () => {
    expect(describeSeries('New people', [1, 4, 0, 2], starts, 'day')).toBe(
      'New people: 7 in total; busiest day 2 Sep with 4; today 2.',
    );
    expect(describeSeries('Active', [3, 5, 9, 6], starts, 'day', formatCompact, 'level')).toBe(
      'Active: 6 now, up from 3; highest 9 on 3 Sep.',
    );
    expect(describeSeries('Errors', [0, 0, 0, 0], starts, 'day')).toBe('Errors: nothing recorded in this period.');
  });

  it('writes CSV that quotes and defuses formulas', () => {
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell(-3)).toBe('-3');
    expect(csvCell(null)).toBe('');
    expect(toCsv(['Day', 'n'], [['2026-09-01', 3]])).toBe('Day,n\r\n2026-09-01,3\r\n');
  });

  it('picks round axis ticks that cover the maximum', () => {
    expect(niceTicks(9)).toEqual([0, 5, 10]);
    expect(niceTicks(3)).toEqual([0, 1, 2, 3]);
    expect(niceTicks(1000)).toEqual([0, 250, 500, 750, 1000]);
    expect(niceTicks(0)).toEqual([0, 1]);
  });
});

describe('LineChart', () => {
  it('names itself with its summary, steps with the keyboard and offers a table', () => {
    render(<LineChart title="New people" values={[1, 4, 0, 2]} starts={starts} bucket="day" />);
    const svg = screen.getByRole('img');
    expect(svg.getAttribute('aria-label')).toBe('New people: 7 in total; busiest day 2 Sep with 4; today 2.');
    fireEvent.keyDown(svg, { key: 'ArrowRight' });
    fireEvent.keyDown(svg, { key: 'ArrowRight' });
    expect(screen.getByRole('status').textContent).toBe('42 Sep');
    fireEvent.keyDown(svg, { key: 'Escape' });
    expect(screen.queryByRole('status')).toBeNull();
    const table = screen.getByRole('table');
    expect(within(table).getAllByRole('row')).toHaveLength(5);
    expect(screen.getByRole('button', { name: 'Download New people as CSV' })).toBeTruthy();
  });
});

describe('BarList and tables', () => {
  it('sums the leader up and shows values as text', () => {
    render(<BarList title="Web or desktop" unit="person-days" items={[{ label: 'Web app', value: 30 }, { label: 'Desktop app', value: 10 }]} />);
    expect(screen.getByRole('list').getAttribute('aria-label')).toBe('Web or desktop: Web app leads with 30 person-days (75%), out of 2 in the list.');
    expect(screen.getByText('Desktop app')).toBeTruthy();
  });

  it('says so when empty', () => {
    render(<BarList title="Desktop versions" unit="x" items={[]} empty="No desktop app seen." />);
    expect(screen.getByText('No desktop app seen.')).toBeTruthy();
    render(<DataTable title="Backups" rows={[]} rowKey={() => 'x'} columns={[]} empty="No backups." />);
    expect(screen.getByText('No backups.')).toBeTruthy();
  });

  it('shows a change against a named period', () => {
    render(<StatTile label="Active today" value="12" delta={{ from: 10, to: 12, period: 'vs a week ago' }} />);
    expect(screen.getByText(/\+20% vs a week ago/)).toBeTruthy();
  });
});

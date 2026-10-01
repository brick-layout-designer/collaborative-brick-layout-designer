// The Views panel (ViewsPanel.tsx): list, add (fits the whole layout),
// go to a view, "Use this area" / "Fit whole layout", sheets, rename,
// delete, share and export all; viewers can look and share only.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import * as Y from 'yjs';
import { addSavedView, readSavedViews } from '../mutations';
import { newView } from '../savedViews';
import { ViewsPanel, type ViewsPanelProps } from '../ViewsPanel';

afterEach(cleanup);

function setup(over: Partial<ViewsPanelProps> = {}) {
  const doc = new Y.Doc();
  const props: ViewsPanelProps = {
    doc,
    isViewer: false,
    sheets: [
      { id: 'track', name: 'Track' },
      { id: 'town', name: 'Town' },
    ],
    activeViewId: null,
    screenRect: () => ({ x: 10.123, y: 20, width: 300, height: 200 }),
    gridShown: true,
    onGoTo: vi.fn(),
    onShowEverything: vi.fn(),
    onApply: vi.fn(),
    onLeave: vi.fn(),
    onShare: vi.fn(),
    onExportAll: vi.fn(),
    ...over,
  };
  render(<ViewsPanel {...props} />);
  return { doc, props };
}

describe('ViewsPanel', () => {
  it('explains itself when there are no views, and adds one that fits the whole layout', () => {
    const { doc, props } = setup();
    expect(screen.getByText(/No saved views yet/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '+ Add view' }));
    fireEvent.change(screen.getByLabelText('Name the view'), { target: { value: 'Station' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add view' }));
    const views = readSavedViews(doc);
    expect(views).toHaveLength(1);
    expect(views[0]).toMatchObject({ name: 'Station', fit: true, rect: null, sheets: null, grid: true, labels: true });
    // Adding shows it straight away, and the list follows the doc.
    expect(props.onGoTo).toHaveBeenCalledWith(views[0]);
    expect(screen.getByRole('button', { name: /^Station/ })).toBeTruthy();
    expect(screen.getByText('Whole layout · all sheets')).toBeTruthy();
  });

  it('an unnamed view gets a number', () => {
    const { doc } = setup();
    fireEvent.click(screen.getByRole('button', { name: '+ Add view' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add view' }));
    expect(readSavedViews(doc)[0]!.name).toBe('View 1');
  });

  it('taps go to a view, share it, and export all', () => {
    const doc = new Y.Doc();
    addSavedView(doc, newView('a', 'Station'));
    const onGoTo = vi.fn();
    const onShare = vi.fn();
    const onExportAll = vi.fn();
    setup({ doc, onGoTo, onShare, onExportAll, activeViewId: null });
    fireEvent.click(screen.getByRole('button', { name: /^Station/ }));
    expect(onGoTo).toHaveBeenCalledWith(expect.objectContaining({ id: 'a' }));
    fireEvent.click(screen.getByRole('button', { name: 'Share a picture of Station' }));
    expect(onShare).toHaveBeenCalledWith(expect.objectContaining({ id: 'a' }));
    fireEvent.click(screen.getByRole('button', { name: 'Export all views' }));
    expect(onExportAll).toHaveBeenCalled();
  });

  it('tapping the view on show stops showing it, without moving the map', () => {
    const doc = new Y.Doc();
    addSavedView(doc, newView('a', 'Station'));
    const { props } = setup({ doc, activeViewId: 'a' });
    const row = screen.getByRole('button', { name: /^Station/ });
    expect(row.getAttribute('aria-current')).toBe('true');
    expect(row.textContent).toContain('tap to stop');
    fireEvent.click(row);
    expect(props.onLeave).toHaveBeenCalled();
    expect(props.onGoTo).not.toHaveBeenCalled();
  });

  it('changing the view on show updates what shows, without snapping the map back', () => {
    const doc = new Y.Doc();
    addSavedView(doc, newView('a', 'Station'));
    const { props } = setup({ doc, activeViewId: 'a' });
    fireEvent.click(screen.getByRole('button', { name: 'Change Station' }));
    fireEvent.click(screen.getByLabelText('Show labels'));
    expect(props.onApply).toHaveBeenCalledWith(expect.objectContaining({ id: 'a', labels: false }));
    fireEvent.click(within(screen.getByTestId('view-options')).getByRole('button', { name: 'Use this area' }));
    expect(props.onGoTo).not.toHaveBeenCalled();
  });

  it('shows that a view opens and closes, and Done closes it', () => {
    const doc = new Y.Doc();
    addSavedView(doc, newView('a', 'Station'));
    setup({ doc });
    const toggle = screen.getByRole('button', { name: 'Change Station' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(toggle.textContent).toContain('Edit');
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(within(screen.getByTestId('view-options')).getByRole('button', { name: 'Done' }));
    expect(screen.queryByTestId('view-options')).toBeNull();
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
  });

  it('shows progress on Export all views while it runs', () => {
    const doc = new Y.Doc();
    addSavedView(doc, newView('a', 'Station'));
    setup({ doc, exporting: 'Making picture 1 of 2…' });
    const btn = screen.getByRole('button', { name: 'Making picture 1 of 2…' }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it('"Use this area" keeps what is on screen; "Fit whole layout" goes back', () => {
    const doc = new Y.Doc();
    addSavedView(doc, newView('a', 'Station'));
    setup({ doc });
    fireEvent.click(screen.getByRole('button', { name: 'Change Station' }));
    const options = screen.getByTestId('view-options');
    fireEvent.click(within(options).getByRole('button', { name: 'Use this area' }));
    expect(readSavedViews(doc)[0]).toMatchObject({ fit: false, rect: { x: 10.12, y: 20, w: 300, h: 200 } });
    expect(screen.getByText('One area · all sheets')).toBeTruthy();
    fireEvent.click(within(options).getByRole('button', { name: 'Fit whole layout' }));
    expect(readSavedViews(doc)[0]).toMatchObject({ fit: true, rect: null });
  });

  it('picks sheets, grid and labels', () => {
    const doc = new Y.Doc();
    addSavedView(doc, newView('a', 'Station'));
    setup({ doc });
    fireEvent.click(screen.getByRole('button', { name: 'Change Station' }));
    fireEvent.click(screen.getByLabelText('All sheets'));
    expect(readSavedViews(doc)[0]!.sheets).toEqual(['track', 'town']);
    fireEvent.click(screen.getByLabelText('Track'));
    expect(readSavedViews(doc)[0]!.sheets).toEqual(['town']);
    expect(screen.getByText('Whole layout · 1 sheet')).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Show labels'));
    fireEvent.click(screen.getByLabelText('Show the grid'));
    expect(readSavedViews(doc)[0]).toMatchObject({ labels: false, grid: true });
  });

  it('renames and deletes (after asking)', () => {
    const doc = new Y.Doc();
    addSavedView(doc, newView('a', 'Station'));
    addSavedView(doc, newView('b', 'Yard'));
    setup({ doc });
    fireEvent.click(screen.getByRole('button', { name: 'Change Station' }));
    fireEvent.click(screen.getByRole('button', { name: 'Rename' }));
    fireEvent.change(screen.getByLabelText('View name'), { target: { value: 'Main station' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(readSavedViews(doc).map((v) => v.name)).toEqual(['Main station', 'Yard']);
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(readSavedViews(doc)).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(readSavedViews(doc).map((v) => v.id)).toEqual(['b']);
    confirm.mockRestore();
  });

  it('viewers can look and share, not change', () => {
    const doc = new Y.Doc();
    addSavedView(doc, newView('a', 'Station'));
    setup({ doc, isViewer: true });
    expect(screen.getByRole('button', { name: /^Station/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Share a picture of Station' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Change Station' })).toBeNull();
    expect(screen.queryByRole('button', { name: '+ Add view' })).toBeNull();
  });
});
